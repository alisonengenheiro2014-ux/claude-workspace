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
import { drawContain } from "../editor/player";
import { drawText, loadFonts, textsAt } from "../editor/text";
import { durationOf, frameSize, mainClips } from "../editor/timeline";

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

async function mixAudio(clips: MediaClip[], assets: Map<Id, AssetRow>, inputs: Map<Id, Input>, totalUs: number, signal: AbortSignal) {
  const length = Math.max(1, Math.ceil((totalUs / 1e6) * SAMPLE_RATE));
  const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE);
  let any = false;
  for (const clip of clips) {
    const asset = assets.get(clip.assetId);
    if (!asset || asset.kind !== "video" || !asset.hasAudio || clip.volume === 0) continue;
    const track = await (await openInput(asset, inputs)).getPrimaryAudioTrack();
    if (!track) continue;
    const gain = ctx.createGain();
    gain.gain.value = clip.volume;
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
      if (play > 0) node.start(at, skip, play);
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
  const inputs = new Map<Id, Input>();

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, { codec: codecs.video, bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: opts.fps });

  try {
    onProgress(0, "audio");
    const mixed = codecs.audio ? await mixAudio(clips, assets, inputs, totalUs, signal) : null;
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
    for (const clip of clips) {
      const asset = assets.get(clip.assetId);
      const first = Math.round((clip.startUs / 1e6) * opts.fps);
      const last = Math.min(totalFrames, Math.round(((clip.startUs + clip.durationUs) / 1e6) * opts.fps));
      if (last <= first) continue;

      // text and other overlays go on top of whatever the clip drew
      const emit = async () => {
        if (signal.aborted) throw new ExportCancelled();
        const tUs = Math.round(frame * frameS * 1e6);
        for (const t of textsAt(doc.tracks, tUs)) drawText(ctx, t, width, height, tUs - t.startUs);
        await videoSource.add(frame * frameS, frameS);
        frame++;
        if (frame % 10 === 0) onProgress(frame / totalFrames, "video");
      };

      if (!asset) {
        for (let f = first; f < last; f++) {
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, width, height);
          await emit();
        }
      } else if (asset.kind === "image") {
        const file = await assetFile(asset);
        if (!file) throw new Error(`Mídia ausente: ${asset.name}`);
        const bmp = await createImageBitmap(file);
        try {
          for (let f = first; f < last; f++) {
            drawContain(ctx, bmp, bmp.width, bmp.height, bg);
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
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, width, height);
            current?.drawWithFit(ctx, { fit: "contain" });
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
