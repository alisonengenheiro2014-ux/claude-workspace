// Renders the timeline to an MP4 file on the device, with WebCodecs through
// Mediabunny. Audio is mixed first with an OfflineAudioContext, then every
// output frame is painted onto a canvas and encoded.
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type AudioCodec,
  type VideoCodec,
} from "mediabunny";
import type { AssetRow, Id, MediaClip, TimelineDoc } from "../data/db";
import { readFile } from "../data/opfs";
import { drawContain } from "../editor/player";
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
    const file = await readFile(asset.opfsPath);
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

      const emit = async () => {
        if (signal.aborted) throw new ExportCancelled();
        await videoSource.add(frame * frameS, frameS);
        frame++;
        if (frame % 10 === 0) onProgress(frame / totalFrames, "video");
      };

      if (!asset) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, width, height);
        for (let f = first; f < last; f++) await emit();
      } else if (asset.kind === "image") {
        const file = await readFile(asset.opfsPath);
        if (!file) throw new Error(`Mídia ausente: ${asset.name}`);
        const bmp = await createImageBitmap(file);
        drawContain(ctx, bmp, bmp.width, bmp.height, bg);
        bmp.close();
        for (let f = first; f < last; f++) await emit();
      } else {
        const track = await (await openInput(asset, inputs)).getPrimaryVideoTrack();
        if (!track) throw new Error(`Sem vídeo em ${asset.name}`);
        // decode at the output size: less memory than full 4K frames
        const s = Math.min(1, Math.max(width / track.displayWidth, height / track.displayHeight));
        const sink = new CanvasSink(track, {
          width: Math.max(2, Math.round(track.displayWidth * s)),
          height: Math.max(2, Math.round(track.displayHeight * s)),
          fit: "fill",
          poolSize: 2,
        });
        const times = function* () {
          for (let f = first; f < last; f++) {
            const offsetS = (f - first) * frameS;
            yield Math.min(clip.outUs / 1e6 - 1e-4, clip.inUs / 1e6 + offsetS * clip.speed);
          }
        };
        for await (const wc of sink.canvasesAtTimestamps(times())) {
          if (wc) drawContain(ctx, wc.canvas, wc.canvas.width, wc.canvas.height, bg);
          await emit();
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
