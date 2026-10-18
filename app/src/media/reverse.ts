// S04 Inverter: makes a new video of a clip's part of its media, played
// backwards, which then replaces it on the timeline (the original stays, so
// inverting again goes back). Frames are decoded forwards in short windows
// from the end, and each window is written out last frame first: only a
// window's frames are ever in memory.
import { ALL_FORMATS, AudioBufferSink, AudioBufferSource, BlobSource, BufferTarget, CanvasSource, Input, Mp4OutputFormat, Output, VideoSampleSink, type VideoSample } from "mediabunny";
import type { AssetRow, Us } from "../data/db";
import { pickCodecs, videoBitrate } from "../export/exporter";
import { assetFile } from "./import";

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export async function reverseRange(
  asset: AssetRow,
  inUs: Us,
  outUs: Us,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<File> {
  const file = await assetFile(asset);
  if (!file) throw new Error(`Mídia ausente: ${asset.name}`);
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const vtrack = await input.getPrimaryVideoTrack();
    if (!vtrack) throw new Error("Esse arquivo não tem vídeo.");
    const atrack = asset.hasAudio ? await input.getPrimaryAudioTrack() : null;
    // at most 1080 on the short side: it is an editing copy
    const k = Math.min(1, 1080 / Math.min(vtrack.displayWidth, vtrack.displayHeight));
    const width = even(vtrack.displayWidth * k);
    const height = even(vtrack.displayHeight * k);
    const fps = Math.min(60, Math.max(1, Math.round(asset.fps || 30)));
    const bitrate = videoBitrate(width, height, fps, "high");
    const codecs = await pickCodecs(width, height, bitrate);
    if (!codecs.video) throw new Error("Este aparelho não consegue gerar vídeo neste tamanho.");

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d")!;
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
    const video = new CanvasSource(canvas, { codec: codecs.video, bitrate, keyFrameInterval: 1 });
    output.addVideoTrack(video, { frameRate: fps });

    // the sound, reversed sample by sample
    let audio: AudioBufferSource | null = null;
    let reversed: AudioBuffer | null = null;
    if (atrack && codecs.audio) {
      const parts: AudioBuffer[] = [];
      for await (const { buffer } of new AudioBufferSink(atrack).buffers(inUs / 1e6, outUs / 1e6)) parts.push(buffer);
      if (parts.length) {
        const rate = parts[0].sampleRate;
        const ch = parts[0].numberOfChannels;
        const length = Math.max(1, Math.round(((outUs - inUs) / 1e6) * rate));
        reversed = new AudioBuffer({ length, numberOfChannels: ch, sampleRate: rate });
        let at = 0;
        for (const b of parts) {
          for (let c = 0; c < ch; c++) {
            const src = b.getChannelData(Math.min(c, b.numberOfChannels - 1));
            const dst = reversed.getChannelData(c);
            for (let i = 0; i < src.length && at + i < length; i++) dst[length - 1 - (at + i)] = src[i];
          }
          at += b.length;
        }
        audio = new AudioBufferSource({ codec: codecs.audio, bitrate: 128_000 });
        output.addAudioTrack(audio);
      }
    }

    await output.start();
    if (audio && reversed) {
      await audio.add(reversed);
      audio.close();
    }

    const sink = new VideoSampleSink(vtrack);
    const win = 8 / fps; // seconds per window: a few frames in memory at a time
    const inS = inUs / 1e6;
    const outS = outUs / 1e6;
    let frame = 0;
    const total = Math.max(1, Math.round((outS - inS) * fps));
    let lastDrawn: VideoSample | null = null;
    for (let end = outS; end > inS + 1e-6; end -= win) {
      const start = Math.max(inS, end - win);
      const got: VideoSample[] = [];
      for await (const s of sink.samples(start, end)) {
        if (signal.aborted) {
          s.close();
          break;
        }
        if (s.timestamp >= start - 1e-6 && s.timestamp < end - 1e-6) got.push(s);
        else s.close();
      }
      if (signal.aborted) {
        got.forEach((s) => s.close());
        throw new DOMException("cancelled", "AbortError");
      }
      // output frames for this window, newest first, at the output frame rate
      const firstOut = Math.round((outS - end) * fps);
      const lastOut = Math.round((outS - start) * fps);
      for (let f = firstOut; f < lastOut; f++) {
        const srcS = outS - (f + 0.5) / fps;
        let pick: VideoSample | null = null;
        for (const s of got) if (s.timestamp <= srcS + 1e-6) pick = s;
        pick ??= got[0] ?? lastDrawn;
        if (pick) {
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, width, height);
          pick.drawWithFit(ctx, { fit: "contain" });
        }
        await video.add(frame / fps, 1 / fps);
        frame++;
        if (frame % 10 === 0) onProgress(Math.min(0.99, frame / total));
      }
      lastDrawn?.close();
      lastDrawn = got.length ? got[0].clone() : null;
      got.forEach((s) => s.close());
    }
    lastDrawn?.close();
    video.close();
    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error("Não foi possível gerar o vídeo invertido.");
    onProgress(1);
    const base = asset.name.replace(/\.[^.]+$/, "");
    return new File([buffer], `${base}-invertido.mp4`, { type: "video/mp4" });
  } finally {
    input.dispose();
  }
}
