// Renders the timeline to an MP4 file on the device, with WebCodecs through
// Mediabunny. Audio is mixed first with an OfflineAudioContext, then every
// output frame is painted onto a canvas and encoded.
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  StreamTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type AudioCodec,
  type VideoCodec,
  type VideoSample,
} from "mediabunny";
import type { AssetRow, Id, MediaClip, TimelineDoc } from "../data/db";
import { assetFile } from "../media/import";
import { clearDir, openStreamFile, readFile } from "../data/opfs";
import { containRect, drawFrame, frameBgOf, plainShape, shapedDraw, shapeOf, type Shape } from "../editor/frame";
import { applyLook, isNeutral, lookOf } from "../editor/look";
import { cropPlacement, overlayAt, overlaysAt } from "../editor/overlay";
import { blendOf } from "../editor/blend";
import { keyImage } from "../editor/chroma";
import { drawMask } from "../editor/mask";
import { applyEffects, effectsAt } from "../editor/effects";
import { isZoomed, mainZoom } from "../editor/keyframes";
import { drawText, loadFonts, textsAt, type TextBox } from "../editor/text";
import { drawTransition } from "../editor/transitions";
import { scheduleEnvelope, soundChain } from "../editor/audio";
import { clipAt, durationOf, frameSize, mainClips, offsetForSource, sourceTimeUs, speedAt, transitionAt, transitionWindows } from "../editor/timeline";

export interface ExportOptions {
  shortSide: 720 | 1080 | 1440 | 2160;
  still?: boolean; // Editar foto: the picture at 0 as a JPEG, no video
  fps: 24 | 25 | 30 | 50 | 60;
  quality: "low" | "recommended" | "high";
}

export interface ExportResult {
  file: File;
  videoCodec: VideoCodec | null; // null: a photo (Editar foto)
  audioCodec: AudioCodec | null;
}

export class ExportCancelled extends Error {}

// Turns a decoder error into something that says which file and what to try.
function readError(asset: AssetRow, err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  const what = `${asset.width}×${asset.height}${asset.hdr ? " HDR" : ""}`;
  return new Error(
    `O iPhone não conseguiu ler "${asset.name}" (${what}) durante a exportação. ` +
      `Tente exportar em 1080p ou com menos quadros por segundo. Detalhe: ${raw}`,
  );
}

const SAMPLE_RATE = 48_000;
const BITS_PER_PIXEL = { low: 0.05, recommended: 0.09, high: 0.15 } as const;

// Bitrate from frame size, fps and quality; ~8 Mbps for 1080p30 "recommended".
export function videoBitrate(width: number, height: number, fps: number, quality: ExportOptions["quality"]) {
  return Math.round(width * height * fps * BITS_PER_PIXEL[quality]);
}

export function estimateBytes(durationUs: number, width: number, height: number, o: ExportOptions) {
  const bits = (videoBitrate(width, height, o.fps, o.quality) + 128_000) * (durationUs / 1e6);
  return Math.round(bits / 8);
}

// Codecs this device can encode at the given size, best first. iPhones get
// H.264 or HEVC; browsers without them fall back to VP9 or AV1 (still MP4).
export async function pickCodecs(width: number, height: number, bitrate: number) {
  const format = new Mp4OutputFormat();
  const video = await getFirstEncodableVideoCodec(
    (["avc", "hevc", "vp9", "av1"] as VideoCodec[]).filter((c) => format.getSupportedVideoCodecs().includes(c)),
    { width, height, bitrate },
  );
  const audio = await getFirstEncodableAudioCodec(
    (["aac", "opus"] as AudioCodec[]).filter((c) => format.getSupportedAudioCodecs().includes(c)),
    { numberOfChannels: 2, sampleRate: SAMPLE_RATE, bitrate: 128_000 },
  );
  return { video, audio };
}

async function openInput(asset: AssetRow, cache: Map<Id, Input>) {
  let input = cache.get(asset.id);
  if (!input) {
    const file = await assetFile(asset);
    if (!file) throw new Error(`Mídia ausente: ${asset.name}`);
    input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    cache.set(asset.id, input);
  }
  return input;
}

export interface MixOptions {
  sampleRate: number;
  channels: number;
  // which clips to mix; default: what you hear (main and audio lanes, not muted)
  include?: (trackKind: string, asset: AssetRow) => boolean;
  // speech recognition wants the words, not the mix: no volume, no fades
  flat?: boolean;
}

// Mixes every sounding clip: the main track's video sound, overlay videos
// and the audio lanes, each with its volume and fades (the same envelope as the preview).
export async function mixAudio(
  doc: TimelineDoc,
  assets: Map<Id, AssetRow>,
  inputs: Map<Id, Input>,
  totalUs: number,
  signal: AbortSignal,
  opts: MixOptions = { sampleRate: SAMPLE_RATE, channels: 2 },
) {
  const length = Math.max(1, Math.ceil((totalUs / 1e6) * opts.sampleRate));
  const ctx = new OfflineAudioContext(opts.channels, length, opts.sampleRate);
  let any = false;
  const include = opts.include ?? ((kind: string) => kind === "main" || kind === "audio" || kind === "overlay");
  const sounding = doc.tracks
    .filter((t) => (t.kind === "main" || t.kind === "audio" || t.kind === "overlay") && (opts.include ? true : !t.muted && !t.hidden))
    .flatMap((t) => t.items.filter((c): c is MediaClip => c.type === "media").map((c) => ({ clip: c, kind: t.kind })));
  for (const { clip, kind } of sounding) {
    const asset = assets.get(clip.assetId);
    if (!asset || asset.kind === "image" || clip.freeze || !asset.hasAudio || clip.startUs >= totalUs || !include(kind, asset)) continue;
    if (!opts.flat && clip.volume === 0) continue;
    const track = await (await openInput(asset, inputs)).getPrimaryAudioTrack();
    if (!track) continue;
    const gain = ctx.createGain();
    if (opts.flat) gain.gain.value = 1;
    else scheduleEnvelope(gain.gain, clip, 0, clip.startUs / 1e6);
    gain.connect(ctx.destination);
    // noise reduction: the same filters as the preview, in front of the gain
    let into: AudioNode = gain;
    const chain = opts.flat ? null : soundChain(ctx, clip);
    if (chain) {
      chain.output.connect(gain);
      into = chain.input;
    }
    const sink = new AudioBufferSink(track);
    const inS = clip.inUs / 1e6;
    const outS = clip.outUs / 1e6;
    for await (const { buffer, timestamp } of sink.buffers(inS, outS)) {
      if (signal.aborted) throw new ExportCancelled();
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      const skip = Math.max(0, inS - timestamp); // part of the buffer before the clip's in point
      // with a speed curve each short buffer plays at the speed of its moment
      const offset = offsetForSource(clip, (timestamp + skip) * 1e6);
      node.playbackRate.value = speedAt(clip, offset);
      node.connect(into);
      const at = (clip.startUs + offset) / 1e6;
      const play = Math.min(buffer.duration - skip, outS - (timestamp + skip));
      if (play > 0 && at < totalUs / 1e6) node.start(at, skip, play);
      any = true;
    }
  }
  return any ? ctx.startRendering() : null;
}

export async function exportTimeline(
  doc: TimelineDoc,
  assets: Map<Id, AssetRow>,
  opts: ExportOptions,
  onProgress: (fraction: number, stage: "audio" | "video" | "finishing") => void,
  signal: AbortSignal,
): Promise<ExportResult> {
  const clips = mainClips(doc);
  const totalUs = durationOf(doc);
  if (!clips.length || totalUs <= 0) throw new Error("O projeto está vazio.");

  const { width, height } = frameSize(doc, assets, opts.shortSide);

  await loadFonts();
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  const bg = doc.canvas.background.type === "color" ? doc.canvas.background.color : "#000000";
  // a photo background: decoded once for the whole export
  let bgImage: ImageBitmap | null = null;
  if (doc.canvas.background.type === "image") {
    const a = assets.get(doc.canvas.background.assetId);
    const f = a ? await assetFile(a) : null;
    bgImage = f ? await createImageBitmap(f) : null;
  }
  const fbg = frameBgOf(doc, bgImage && { src: bgImage, w: bgImage.width, h: bgImage.height });
  // A decoded frame, letterboxed; with a crop/turn/mirror it goes through a
  // canvas the size of the picture first (the sample applies its own rotation).
  let shapeScratch: OffscreenCanvas | null = null;
  const sampleDraw = (s: VideoSample, shape: Shape) => (c: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) => {
    if (plainShape(shape)) {
      s.drawWithFit(c, { fit: "contain" });
      return containRect(s.displayWidth, s.displayHeight, c.canvas.width, c.canvas.height);
    }
    if (!shapeScratch || shapeScratch.width !== s.displayWidth || shapeScratch.height !== s.displayHeight)
      shapeScratch = new OffscreenCanvas(s.displayWidth, s.displayHeight);
    s.draw(shapeScratch.getContext("2d")!, 0, 0);
    return shapedDraw(shapeScratch, s.displayWidth, s.displayHeight, shape)(c);
  };
  // The main clip's zoom and pan (keyframes) around a picture's draw().
  type Draw = (c: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) => { x: number; y: number; w: number; h: number } | null;
  const zoomed = (draw: Draw, z: ReturnType<typeof mainZoom>): Draw => {
    if (!isZoomed(z)) return draw;
    return (c) => {
      const W = c.canvas.width;
      const H = c.canvas.height;
      const cx = W / 2 + z.dx * W;
      const cy = H / 2 + z.dy * H;
      c.save();
      c.globalAlpha *= Math.max(0, z.opacity);
      c.translate(cx, cy);
      c.rotate((z.rot * Math.PI) / 180);
      c.scale(z.scale, z.scale);
      c.translate(-W / 2, -H / 2);
      const r = draw(c);
      c.restore();
      return r && { x: cx + (r.x - W / 2) * z.scale, y: cy + (r.y - H / 2) * z.scale, w: r.w * z.scale, h: r.h * z.scale };
    };
  };

  // The clip's mask (S12 Máscara on the main video) around a picture's draw().
  let maskLayer: OffscreenCanvas | null = null;
  let maskShape: OffscreenCanvas | null = null;
  const masked = (draw: Draw, mask: MediaClip["mask"]): Draw => {
    if (!mask) return draw;
    return (c) => {
      const W = c.canvas.width;
      const H = c.canvas.height;
      if (!maskLayer || maskLayer.width !== W || maskLayer.height !== H) maskLayer = new OffscreenCanvas(W, H);
      const l = maskLayer.getContext("2d")!;
      l.clearRect(0, 0, W, H);
      const r = draw(l);
      if (r) {
        const w = Math.max(1, Math.round(r.w));
        const h = Math.max(1, Math.round(r.h));
        if (!maskShape || maskShape.width !== w || maskShape.height !== h) maskShape = new OffscreenCanvas(w, h);
        drawMask(maskShape.getContext("2d")!, w, h, mask);
        l.save();
        l.globalCompositeOperation = "destination-in";
        l.drawImage(maskShape, r.x, r.y, r.w, r.h);
        l.restore();
        c.drawImage(maskLayer, 0, 0);
      }
      return r;
    };
  };

  // A video frame kept as a picture (freeze frames, transition stills).
  const frameAsPicture = async (asset: AssetRow, us: number) => {
    const track = await (await openInput(asset, inputs)).getPrimaryVideoTrack();
    const sample = track ? await new VideoSampleSink(track).getSample(us / 1e6) : null;
    if (!sample) return null;
    const c = new OffscreenCanvas(sample.displayWidth, sample.displayHeight);
    sample.draw(c.getContext("2d")!, 0, 0);
    sample.close();
    return c;
  };
  const inputs = new Map<Id, Input>();

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  // Each clip draws into `layer`; the output frame is the layer, or the
  // layer mixed with a neighbour's still during a transition, then text.
  const layer = new OffscreenCanvas(width, height);
  const lctx = layer.getContext("2d")!;
  const windows = transitionWindows(doc);

  // A clip's frame at source time us, letterboxed to the output size.
  const makeStill = async (clip: MediaClip, us: number, localUs: number) => {
    const c = new OffscreenCanvas(width, height);
    const cx = c.getContext("2d")!;
    const a = assets.get(clip.assetId);
    let pic: ImageBitmap | OffscreenCanvas | null = null;
    if (a?.kind === "image") {
      const file = await assetFile(a);
      pic = file ? await createImageBitmap(file) : null;
    } else if (a) pic = await frameAsPicture(a, clip.freeze ? clip.inUs : us);
    const r = drawFrame(cx, fbg, pic ? zoomed(masked(shapedDraw(pic, pic.width, pic.height, shapeOf(clip)), clip.mask), mainZoom(clip, localUs)) : () => null);
    if (r) applyLook(cx, r, lookOf(clip));
    if (pic instanceof ImageBitmap) pic.close();
    return c;
  };

  // photos and videos on top (S12): photos decoded once, each video read in
  // order while it is on screen, then closed
  type Reader = { samples: AsyncGenerator<VideoSample, void, unknown>; current: VideoSample | null; next: VideoSample | null; ended: boolean };
  const overlayImages = new Map<Id, ImageBitmap>();
  const readers = new Map<Id, Reader>();
  let overlayScratch: OffscreenCanvas | null = null;
  let maskScratch: OffscreenCanvas | null = null;
  const closeReader = async (r: Reader) => {
    r.current?.close();
    r.next?.close();
    await r.samples.return(undefined);
  };
  const pullFrom = async (r: Reader) => {
    const x = await r.samples.next();
    if (x.done) {
      r.ended = true;
      return null;
    }
    return x.value;
  };
  const drawOverlays = async (tUs: number) => {
    const live = overlaysAt(doc, tUs);
    for (const [id, r] of readers)
      if (!live.some((c) => c.id === id)) {
        readers.delete(id);
        await closeReader(r);
      }
    for (const c of live) {
      const a = assets.get(c.assetId);
      if (!a) continue;
      let draw: ((x: OffscreenCanvasRenderingContext2D, b: TextBox) => void) | null = null;
      if (a.kind === "image") {
        let bmp = overlayImages.get(a.id);
        if (!bmp) {
          const file = await assetFile(a);
          if (!file) throw new Error(`Mídia ausente: ${a.name}`);
          bmp = await createImageBitmap(file);
          overlayImages.set(a.id, bmp);
        }
        const img = bmp;
        draw = (x, b) => x.drawImage(img, -b.w / 2, -b.h / 2, b.w, b.h);
      } else {
        try {
          let r = readers.get(c.id);
          if (!r) {
            const track = await (await openInput(a, inputs)).getPrimaryVideoTrack();
            if (!track) continue;
            r = { samples: new VideoSampleSink(track).samples(c.inUs / 1e6, c.outUs / 1e6), current: null, next: null, ended: false };
            readers.set(c.id, r);
            r.next = await pullFrom(r);
          }
          const srcS = Math.min(c.outUs / 1e6 - 1e-4, (c.freeze ? c.inUs : sourceTimeUs(c, tUs - c.startUs)) / 1e6); // a held frame stays on it
          while (r.next && r.next.timestamp <= srcS + 1e-6) {
            r.current?.close();
            r.current = r.next;
            r.next = r.ended ? null : await pullFrom(r);
          }
          const cur = r.current;
          if (cur) draw = (x, b) => cur.draw(x, -b.w / 2, -b.h / 2, b.w, b.h);
        } catch (err) {
          throw readError(a, err);
        }
      }
      if (!draw) continue;
      if (c.crop || c.flip) {
        // the whole picture placed so the cropped part fills the box, clipped to it; mirrored after
        const whole = draw;
        const pl = cropPlacement(c.crop);
        draw = (x, b) => {
          x.save();
          x.beginPath();
          x.rect(-b.w / 2, -b.h / 2, b.w, b.h);
          x.clip();
          if (c.flip) x.scale(-1, 1);
          x.translate(-b.w / 2 + pl.x * b.w + (pl.w * b.w) / 2, -b.h / 2 + pl.y * b.h + (pl.h * b.h) / 2);
          whole(x, { ...b, w: pl.w * b.w, h: pl.h * b.h });
          x.restore();
        };
      }
      const { box: b, alpha } = overlayAt(a, c, width, height, tUs);
      const look = lookOf(c);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = blendOf(c.blendMode).canvas;
      ctx.translate(b.cx, b.cy);
      ctx.rotate((b.rotation * Math.PI) / 180);
      if (isNeutral(look) && !c.chroma && !c.mask) draw(ctx, b);
      else {
        // filtered on its own canvas first, so the look stays inside it
        const w = Math.max(1, Math.round(b.w));
        const h = Math.max(1, Math.round(b.h));
        if (!overlayScratch || overlayScratch.width !== w || overlayScratch.height !== h) overlayScratch = new OffscreenCanvas(w, h);
        const o = overlayScratch.getContext("2d")!;
        o.clearRect(0, 0, w, h);
        o.save();
        o.translate(w / 2, h / 2);
        draw(o, { ...b, w, h });
        o.restore();
        applyLook(o, { x: 0, y: 0, w, h }, look);
        if (c.chroma) {
          const img = o.getImageData(0, 0, w, h);
          keyImage(img, c.chroma);
          o.putImageData(img, 0, 0);
        }
        if (c.mask) {
          if (!maskScratch || maskScratch.width !== w || maskScratch.height !== h) maskScratch = new OffscreenCanvas(w, h);
          drawMask(maskScratch.getContext("2d")!, w, h, c.mask);
          o.save();
          o.globalCompositeOperation = "destination-in";
          o.drawImage(maskScratch, 0, 0);
          o.restore();
        }
        ctx.drawImage(overlayScratch, -b.w / 2, -b.h / 2, b.w, b.h);
      }
      ctx.restore();
    }
  };

  // The whole picture at timeline time `at` (the clip, layers, effects and
  // text) on the output canvas: the cover, or Editar foto's result. The
  // layers' videos read ahead to it are closed, to start over from 0.
  const composeAt = async (at: number) => {
    const hit = clipAt(doc, at);
    if (!hit) return false;
    try {
      const still = await makeStill(hit.clip, hit.clip.freeze ? hit.clip.inUs : sourceTimeUs(hit.clip, hit.offsetUs), hit.offsetUs);
      ctx.drawImage(still, 0, 0);
    } catch (err) {
      const a = assets.get(hit.clip.assetId);
      throw a ? readError(a, err) : err;
    }
    await drawOverlays(at);
    const fx = effectsAt(doc, at);
    if (fx) applyEffects(ctx, fx, bg);
    for (const t of textsAt(doc.tracks, at)) drawText(ctx, t, width, height, at - t.startUs);
    for (const r of readers.values()) await closeReader(r);
    readers.clear();
    return true;
  };

  // Capa: the first output frame shows the cover (a moment of the edit,
  // whole, with layers and text; or a photo) instead of the start
  let coverPic: OffscreenCanvas | null = null;
  const cover = doc.cover;
  if (cover?.type === "image") {
    const a = assets.get(cover.assetId);
    const file = a && (await assetFile(a));
    if (file) {
      const img = await createImageBitmap(file);
      coverPic = new OffscreenCanvas(width, height);
      drawFrame(coverPic.getContext("2d")!, fbg, shapedDraw(img, img.width, img.height, { crop: null, rotation: 0, flip: false }));
      img.close();
    }
  } else if (cover?.type === "frame") {
    if (await composeAt(Math.min(cover.atUs, Math.max(0, totalUs - 1)))) {
      coverPic = new OffscreenCanvas(width, height);
      coverPic.getContext("2d")!.drawImage(canvas, 0, 0);
    }
  }

  // Editar foto: just the composed picture, as a JPEG at full size
  if (opts.still) {
    try {
      if (!(await composeAt(0))) throw new Error("O projeto está vazio.");
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
      return { file: new File([blob], `foto-${stamp}.jpg`, { type: "image/jpeg" }), videoCodec: null, audioCodec: null };
    } finally {
      for (const b of overlayImages.values()) b.close();
      for (const input of inputs.values()) input.dispose();
    }
  }

  const bitrate = videoBitrate(width, height, opts.fps, opts.quality);
  const codecs = await pickCodecs(width, height, bitrate);
  if (!codecs.video) throw new Error("Este aparelho não consegue gerar vídeo neste tamanho.");

  // Straight to a file in OPFS when the browser allows it (long videos don't
  // fit in the iPhone's memory); otherwise in memory, as before.
  const name = `video-${stamp}.mp4`;
  let stream: WritableStream | null = null;
  try {
    await clearDir("exports");
    stream = await openStreamFile(`exports/${name}`);
  } catch {
    stream = null;
  }
  const output = new Output({
    // with a stream: the index goes at the end (fast start would need the whole file in memory)
    format: new Mp4OutputFormat({ fastStart: stream ? false : "in-memory" }),
    target: stream ? new StreamTarget(stream, { chunked: true, chunkSize: 4 * 1024 * 1024 }) : new BufferTarget(),
  });
  const videoSource = new CanvasSource(canvas, { codec: codecs.video, bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: opts.fps });

  try {
    onProgress(0, "audio");
    const mixed = codecs.audio ? await mixAudio(doc, assets, inputs, totalUs, signal) : null;
    const audioSource = mixed && codecs.audio ? new AudioBufferSource({ codec: codecs.audio, bitrate: 128_000 }) : null;
    if (audioSource) output.addAudioTrack(audioSource);

    await output.start();
    if (audioSource && mixed) {
      await audioSource.add(mixed);
      audioSource.close();
    }

    const frameS = 1 / opts.fps;
    const totalFrames = Math.max(1, Math.round((totalUs / 1e6) * opts.fps));
    let frame = 0;
    try {
      for (const clip of clips) {
        const asset = assets.get(clip.assetId);
        const first = Math.round((clip.startUs / 1e6) * opts.fps);
        const last = Math.min(totalFrames, Math.round(((clip.startUs + clip.durationUs) / 1e6) * opts.fps));
        if (last <= first) continue;

        // stills for the transitions into and out of this clip, made before
        // this clip's decoder starts so two decoders never run at once
        const into = windows.find((w) => w.to.id === clip.id);
        const outOf = windows.find((w) => w.from.id === clip.id);
        const prevStill = into ? await makeStill(into.from, Math.max(into.from.inUs, into.from.outUs - 34_000), into.from.durationUs) : null;
        const nextStill = outOf ? await makeStill(outOf.to, outOf.to.inUs, 0) : null;

        // zoom and pan at output frame f (keyframes)
      const zoomAt = (f: number) => mainZoom(clip, (f / opts.fps) * 1e6 - clip.startUs);
      // the clip's filter and adjustments, on its picture only
      const look = lookOf(clip);
      const paint = (r: { x: number; y: number; w: number; h: number } | null) => r && applyLook(lctx, r, look);

      // text and other overlays go on top of whatever the clip drew
        const emit = async () => {
          if (signal.aborted) throw new ExportCancelled();
          const tUs = Math.round(frame * frameS * 1e6);
          const w = transitionAt(doc, tUs);
          if (w && w.to.id === clip.id && prevStill) drawTransition(ctx, prevStill, layer, w.type, w.p, bg);
          else if (w && w.from.id === clip.id && nextStill) drawTransition(ctx, layer, nextStill, w.type, w.p, bg);
          else ctx.drawImage(layer, 0, 0);
          await drawOverlays(tUs);
          const fx = effectsAt(doc, tUs);
          if (fx) applyEffects(ctx, fx, bg);
          for (const t of textsAt(doc.tracks, tUs)) drawText(ctx, t, width, height, tUs - t.startUs);
          if (frame === 0 && coverPic) ctx.drawImage(coverPic, 0, 0);
          await videoSource.add(frame * frameS, frameS);
          frame++;
          if (frame % 10 === 0) onProgress(frame / totalFrames, "video");
        };

        if (!asset) {
          for (let f = first; f < last; f++) {
            drawFrame(lctx, fbg, () => null);
            await emit();
          }
        } else if (asset.kind === "image" || clip.freeze) {
          // a photo, or a video frame held (freeze frame)
          let pic: ImageBitmap | OffscreenCanvas | null;
          if (asset.kind === "image") {
            const file = await assetFile(asset);
            if (!file) throw new Error(`Mídia ausente: ${asset.name}`);
            pic = await createImageBitmap(file);
          } else {
            try {
              pic = await frameAsPicture(asset, clip.inUs);
            } catch (err) {
              throw readError(asset, err);
            }
          }
          const shape = shapeOf(clip);
          try {
            for (let f = first; f < last; f++) {
              paint(drawFrame(lctx, fbg, pic ? zoomed(masked(shapedDraw(pic, pic.width, pic.height, shape), clip.mask), zoomAt(f)) : () => null));
              await emit();
            }
          } finally {
            if (pic instanceof ImageBitmap) pic.close();
          }
        } else {
          const track = await (await openInput(asset, inputs)).getPrimaryVideoTrack();
          if (!track) throw new Error(`Sem vídeo em ${asset.name}`);
          // Decode the clip's frames in order and, for each output frame, draw
          // the latest decoded frame at or before its source time. Each frame is
          // closed as soon as it is replaced: 4K frames are large.
          const sink = new VideoSampleSink(track);
          const shape = shapeOf(clip);
          const inS = clip.inUs / 1e6;
          const outS = clip.outUs / 1e6;
          const samples = sink.samples(inS, outS);
          let current: VideoSample | null = null;
          let next: VideoSample | null = null;
          let ended = false;
          const pull = async () => {
            const r = await samples.next();
            if (r.done) {
              ended = true;
              return null;
            }
            return r.value;
          };
          try {
            next = await pull();
            for (let f = first; f < last; f++) {
              const srcS = Math.min(outS - 1e-4, sourceTimeUs(clip, (f / opts.fps) * 1e6 - clip.startUs) / 1e6);
              while (next && next.timestamp <= srcS + 1e-6) {
                current?.close();
                current = next;
                next = ended ? null : await pull();
              }
              paint(drawFrame(lctx, fbg, current ? zoomed(masked(sampleDraw(current, shape), clip.mask), zoomAt(f)) : () => null));
              await emit();
            }
          } catch (err) {
            if (err instanceof ExportCancelled) throw err;
            throw readError(asset, err);
          } finally {
            current?.close();
            next?.close();
            await samples.return(undefined);
          }
        }
      }

    } finally {
      for (const r of readers.values()) await closeReader(r).catch(() => {});
      for (const b of overlayImages.values()) b.close();
    }

    videoSource.close();
    onProgress(1, "finishing");
    await output.finalize();
    let file: File;
    if (stream) {
      const f = await readFile(`exports/${name}`);
      if (!f) throw new Error("A exportação não gerou arquivo.");
      file = new File([f], name, { type: "video/mp4" }); // a File backed by the disk, not memory
    } else {
      const buffer = (output.target as BufferTarget).buffer;
      if (!buffer) throw new Error("A exportação não gerou arquivo.");
      file = new File([buffer], name, { type: "video/mp4" });
    }
    return {
      file,
      videoCodec: codecs.video,
      audioCodec: audioOrNull(codecs.audio, output),
    };
  } catch (err) {
    if (output.state !== "finalized" && output.state !== "canceled") await output.cancel().catch(() => {});
    if (signal.aborted) throw new ExportCancelled();
    throw err;
  } finally {
    for (const input of inputs.values()) input.dispose();
  }
}

function audioOrNull(codec: AudioCodec | null, output: Output) {
  return output.tracks.some((t) => t.type === "audio") ? codec : null;
}
