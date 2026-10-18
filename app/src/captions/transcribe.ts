// Automatic captions: mix the chosen sound at 16 kHz, hand it to the Whisper
// worker, collect timed segments. The worker stays alive between runs so the
// model loads once per session.
import type { Input } from "mediabunny";
import type { AssetRow, Id, TimelineDoc } from "../data/db";
import { durationOf, type SpeechSegment } from "../editor/timeline";
import { mixAudio } from "../export/exporter";
import type { AsrMessage, AsrModel, AsrRequest } from "./asr.worker";

export type CaptionSource = "video" | "audio" | "all";

export interface TranscribeOptions {
  source: CaptionSource;
  language: string | null;
  model: AsrModel;
}

export type TranscribeEvent =
  | { stage: "mixing" }
  | { stage: "loading"; device: "webgpu" | "wasm" }
  | { stage: "download"; loaded: number; total: number }
  | { stage: "transcribing"; fraction: number; device: "webgpu" | "wasm" };

export class NoSpeechError extends Error {}

let worker: Worker | null = null;
function getWorker() {
  worker ??= new Worker(new URL("./asr.worker.ts", import.meta.url), { type: "module" });
  return worker;
}

// Tests point the worker at a local copy of the model (no internet there).
function localOverride(): AsrRequest["local"] {
  try {
    const raw = localStorage.getItem("asr-local");
    return raw ? (JSON.parse(raw) as AsrRequest["local"]) : undefined;
  } catch {
    return undefined;
  }
}

export async function transcribe(
  doc: TimelineDoc,
  assets: Map<Id, AssetRow>,
  opts: TranscribeOptions,
  onEvent: (e: TranscribeEvent) => void,
  signal: AbortSignal,
): Promise<SpeechSegment[]> {
  onEvent({ stage: "mixing" });
  const totalUs = durationOf(doc);
  const inputs = new Map<Id, Input>();
  let mixed: AudioBuffer | null;
  try {
    mixed = await mixAudio(doc, assets, inputs, totalUs, signal, {
      sampleRate: 16_000,
      channels: 1,
      flat: true,
      include: (kind, asset) =>
        opts.source === "all" ||
        (opts.source === "video" ? kind === "main" || asset.kind === "video" : kind === "audio" && asset.kind === "audio"),
    });
  } finally {
    for (const i of inputs.values()) i.dispose();
  }
  if (!mixed) throw new NoSpeechError("Não há som nessa origem para transcrever.");
  const audio = new Float32Array(mixed.getChannelData(0));
  let energy = 0;
  for (let i = 0; i < audio.length; i += 8) energy += audio[i] * audio[i];
  if (Math.sqrt(energy / (audio.length / 8)) < 0.002) throw new NoSpeechError("O som está em silêncio.");

  const w = getWorker();
  let device: "webgpu" | "wasm" = "wasm";
  return new Promise<SpeechSegment[]>((resolve, reject) => {
    const segments: SpeechSegment[] = [];
    const onAbort = () => {
      w.terminate();
      worker = null;
      reject(new DOMException("cancelled", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    w.onmessage = (e: MessageEvent<AsrMessage>) => {
      const m = e.data;
      if (m.type === "status") {
        device = m.device;
        onEvent(m.stage === "loading" ? { stage: "loading", device } : { stage: "transcribing", fraction: 0, device });
      } else if (m.type === "download") onEvent({ stage: "download", loaded: m.loaded, total: m.total });
      else if (m.type === "progress") onEvent({ stage: "transcribing", fraction: m.fraction, device });
      else if (m.type === "segment") segments.push({ start: m.start, end: m.end, text: m.text });
      else if (m.type === "done") {
        signal.removeEventListener("abort", onAbort);
        if (!segments.length) reject(new NoSpeechError("Não encontrei fala nesse som."));
        else resolve(segments.sort((a, b) => a.start - b.start));
      } else if (m.type === "error") {
        signal.removeEventListener("abort", onAbort);
        reject(new Error(m.message));
      }
    };
    const req: AsrRequest = { type: "run", audio, language: opts.language, model: opts.model, local: localOverride() };
    w.postMessage(req, [audio.buffer]);
  });
}
