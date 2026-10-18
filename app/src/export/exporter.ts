// Renders the timeline to an MP4 file on the device, with WebCodecs through
// Mediabunny. Audio is mixed first with an OfflineAudioContext, then every
// output frame is painted onto a canvas and encoded.
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
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
import { containDraw, containRect, drawFrame, frameBgOf } from "../editor/frame";
import { drawText, loadFonts, textsAt } from "../editor/text";
import { drawTransition } from "../editor/transitions";
import { scheduleEnvelope } from "../editor/audio";
import { durationOf, frameSize, mainClips, transitionAt, transitionWindows } from "../editor/timeline";

export interface ExportOptions {
  shortSide: 720 | 1080 | 1440 | 2160;
  fps: 24 | 25 | 30 | 50 | 60;
  quality: "low" | "recommended" | "high";
}

export interface ExportResult {
  file: File;
  videoCodec: VideoCodec;
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

// Mixes every sounding clip: the main track's video sound and the audio
// lanes, each with its volume and fades (the same envelope as the preview).
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
  const include = opts.include ?? ((kind: string) => kind === "main" || kind === "audio");
  const sounding = doc.tracks
    .filter((t) => (t.kind === "main" || t.kind === "audio") && (opts.include ? true : !t.muted))
    .flatMap((t) => t.items.filter((c): c is MediaClip => c.type === "media").map((c) => ({ clip: c, kind: t.kind })));
  for (const { clip, kind } of sounding) {
    const asset = assets.get(clip.assetId);
    if (!asset || asset.kind === "image" || !asset.hasAudio || clip.startUs >= totalUs || !include(kind, asset)) continue;
    if (!opts.flat && clip.volume === 0) continue;
    const track = await (await openInput(asset, inputs)).getPrimaryAudioTrack();
    if (!track) continue;
    const gain = ctx.createGain();
    if (opts.flat) gain.gain.value = 1;
    else scheduleEnvelope(gain.gain, clip, 0, clip.startUs / 1e6);
    gain.connect(ctx.destination);
    const sink = new AudioBufferSink(track);
    const inS = clip.inUs / 1e6;
    const outS = clip.outUs / 1e6;
    for await (const { buffer, timestamp } of sink.buffers(inS, outS)) {
      if (signal.aborted) throw new ExportCancelled();
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.playbackRate.value = clip.speed;
      node.connect(gain);
      const skip = Math.max(0, inS - timestamp); // part of the buffer before the clip's in point
      const at = clip.startUs / 1e6 + (timestamp + skip - inS) / clip.speed;
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
  const bitrate = videoBitrate(width, height, opts.fps, opts.quality);
  const codecs = await pickCodecs(width, height, bitrate);
  if (!codecs.video) throw new Error("Este aparelho não consegue gerar vídeo neste tamanho.");

  await loadFonts();
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  const bg = doc.canvas.background.type === "color" ? doc.canvas.background.color : "#000000";
  const fbg = frameBgOf(doc);
  const sampleDraw = (s: VideoSample) => (c: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) => {
    s.drawWithFit(c, { fit: "contain" });
    return containRect(s.displayWidth, s.displayHeight, c.canvas.width, c.canvas.height);
  };
  const inputs = new Map<Id, Input>();

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
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
    // Each clip draws into `layer`; the output frame is the layer, or the
    // layer mixed with a neighbour's still during a transition, then text.
    const layer = new OffscreenCanvas(width, height);
    const lctx = layer.getContext("2d")!;
    const windows = transitionWindows(doc);

    // A clip's frame at source time us, letterboxed to the output size.
    const makeStill = async (clip: MediaClip, us: number) => {
      const c = new OffscreenCanvas(width, height);
      const cx = c.getContext("2d")!;
      const a = assets.get(clip.assetId);
      if (a?.kind === "image") {
        const file = await assetFile(a);
        const bmp = file ? await createImageBitmap(file) : null;
        drawFrame(cx, fbg, bmp ? containDraw(bmp, bmp.width, bmp.height) : () => null);
        bmp?.close();
      } else if (a) {
        const track = await (await openInput(a, inputs)).getPrimaryVideoTrack();
        const sample = track ? await new VideoSampleSink(track).getSample(us / 1e6) : null;
        drawFrame(cx, fbg, sample ? sampleDraw(sample) : () => null);
        sample?.close();
      } else drawFrame(cx, fbg, () => null);
      return c;
    };

    for (const clip of clips) {
      const asset = assets.get(clip.assetId);
      const first = Math.round((clip.startUs / 1e6) * opts.fps);
      const last = Math.min(totalFrames, Math.round(((clip.startUs + clip.durationUs) / 1e6) * opts.fps));
      if (last <= first) continue;

      // stills for the transitions into and out of this clip, made before
      // this clip's decoder starts so two decoders never run at once
      const into = windows.find((w) => w.to.id === clip.id);
      const outOf = windows.find((w) => w.from.id === clip.id);
      const prevStill = into ? await makeStill(into.from, Math.max(into.from.inUs, into.from.outUs - 34_000)) : null;
      const nextStill = outOf ? await makeStill(outOf.to, outOf.to.inUs) : null;

      // text and other overlays go on top of whatever the clip drew
      const emit = async () => {
        if (signal.aborted) throw new ExportCancelled();
        const tUs = Math.round(frame * frameS * 1e6);
        const w = transitionAt(doc, tUs);
        if (w && w.to.id === clip.id && prevStill) drawTransition(ctx, prevStill, layer, w.type, w.p, bg);
        else if (w && w.from.id === clip.id && nextStill) drawTransition(ctx, layer, nextStill, w.type, w.p, bg);
        else ctx.drawImage(layer, 0, 0);
        for (const t of textsAt(doc.tracks, tUs)) drawText(ctx, t, width, height, tUs - t.startUs);
        await videoSource.add(frame * frameS, frameS);
        frame++;
        if (frame % 10 === 0) onProgress(frame / totalFrames, "video");
      };

      if (!asset) {
        for (let f = first; f < last; f++) {
          drawFrame(lctx, fbg, () => null);
          await emit();
        }
      } else if (asset.kind === "image") {
        const file = await assetFile(asset);
        if (!file) throw new Error(`Mídia ausente: ${asset.name}`);
        const bmp = await createImageBitmap(file);
        try {
          for (let f = first; f < last; f++) {
            drawFrame(lctx, fbg, containDraw(bmp, bmp.width, bmp.height));
            await emit();
          }
        } finally {
          bmp.close();
        }
      } else {
        const track = await (await openInput(asset, inputs)).getPrimaryVideoTrack();
        if (!track) throw new Error(`Sem vídeo em ${asset.name}`);
        // Decode the clip's frames in order and, for each output frame, draw
        // the latest decoded frame at or before its source time. Each frame is
        // closed as soon as it is replaced: 4K frames are large.
        const sink = new VideoSampleSink(track);
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
            const srcS = Math.min(outS - 1e-4, inS + (f - first) * frameS * clip.speed);
            while (next && next.timestamp <= srcS + 1e-6) {
              current?.close();
              current = next;
              next = ended ? null : await pull();
            }
            drawFrame(lctx, fbg, current ? sampleDraw(current) : () => null);
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

    videoSource.close();
    onProgress(1, "finishing");
    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error("A exportação não gerou arquivo.");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return {
      file: new File([buffer], `video-${stamp}.mp4`, { type: "video/mp4" }),
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
