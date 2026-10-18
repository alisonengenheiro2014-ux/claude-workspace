// Text to speech (S11) in a worker: Meta's MMS voice for Portuguese (VITS,
// reads letters directly, no phonemizer) through transformers.js, on the CPU
// with an 8-bit model. Downloaded once, then cached for offline use.
import { env, pipeline, type TextToAudioPipeline } from "@huggingface/transformers";

export type TtsRequest = { type: "speak"; text: string; local?: { modelPath: string; wasmPath: string; model: string } };
export type TtsMessage =
  | { type: "loading" }
  | { type: "download"; loaded: number; total: number }
  | { type: "progress"; fraction: number }
  | { type: "done"; audio: Float32Array; sampleRate: number }
  | { type: "error"; message: string };

// the first that loads is used
const MODELS = ["Xenova/mms-tts-por", "onnx-community/mms-tts-por"];

const post = (m: TtsMessage, transfer: Transferable[] = []) => self.postMessage(m, { transfer });
let tts: TextToAudioPipeline | null = null;

async function load(local: TtsRequest["local"]) {
  if (tts) return tts;
  post({ type: "loading" });
  if (local) {
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = local.modelPath;
    if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = local.wasmPath;
  }
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== "progress" || !p.file) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    post({ type: "download", loaded, total });
  };
  let last: unknown = null;
  for (const id of local ? [local.model] : MODELS) {
    try {
      tts = (await pipeline("text-to-speech", id, { device: "wasm", dtype: "q8" as never, progress_callback: progress_callback as never })) as TextToAudioPipeline;
      return tts;
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error("Não foi possível carregar a voz.");
}

// Sentence by sentence (the model does best on short text), with a short
// pause between them.
function sentences(text: string) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?;:])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

self.onmessage = async (e: MessageEvent<TtsRequest>) => {
  try {
    const model = await load(e.data.local);
    const parts = sentences(e.data.text);
    const chunks: Float32Array[] = [];
    let rate = 16_000;
    for (let i = 0; i < parts.length; i++) {
      const out = await model(parts[i]);
      const one = Array.isArray(out) ? out[0] : out;
      rate = one.sampling_rate;
      chunks.push(one.audio, new Float32Array(Math.round(rate * 0.25)));
      post({ type: "progress", fraction: (i + 1) / parts.length });
    }
    const length = chunks.reduce((n, c) => n + c.length, 0);
    const audio = new Float32Array(length);
    let at = 0;
    for (const c of chunks) {
      audio.set(c, at);
      at += c.length;
    }
    post({ type: "done", audio, sampleRate: rate }, [audio.buffer]);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
