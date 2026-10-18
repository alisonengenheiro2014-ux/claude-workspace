// Speech recognition in a worker, with Whisper through transformers.js. The
// model is downloaded once (Hugging Face) and kept in the browser's cache, so
// later runs work offline. Runs on the CPU (WASM) with 8-bit models: on the
// iPhone the GPU path (fp32 encoder) used enough memory for iOS to close the
// app, so WebGPU is opt-in (gpu: true) until it is proven safe there.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

export type AsrModel = "base" | "tiny";

export type AsrRequest = {
  type: "run";
  audio: Float32Array; // 16 kHz mono, timeline-aligned
  language: string | null; // "portuguese", "english"... null = detect
  model: AsrModel;
  gpu?: boolean;
  // tests only: load the model and runtime from this server instead of the internet
  local?: { modelPath: string; wasmPath: string };
};

export type AsrMessage =
  | { type: "status"; stage: "loading" | "transcribing"; device: "webgpu" | "wasm" }
  | { type: "download"; loaded: number; total: number }
  | { type: "progress"; fraction: number }
  | { type: "segment"; start: number; end: number; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

const SR = 16_000;
const MODELS: Record<AsrModel, string> = {
  base: "onnx-community/whisper-base",
  tiny: "onnx-community/whisper-tiny",
};

const post = (m: AsrMessage) => self.postMessage(m);

let cached: { key: string; asr: AutomaticSpeechRecognitionPipeline; device: "webgpu" | "wasm" } | null = null;

async function hasWebGpu() {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function load(model: AsrModel, local: AsrRequest["local"], gpu: boolean) {
  const key = `${model}:${gpu}:${local?.modelPath ?? ""}`;
  if (cached?.key === key) return cached;
  if (local) {
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = local.modelPath;
    if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = local.wasmPath;
  }
  const id = local ? "Xenova/whisper-tiny" : MODELS[model];

  // download progress, summed over the model's files
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

  const tryDevice = async (device: "webgpu" | "wasm") => {
    post({ type: "status", stage: "loading", device });
    const dtype = device === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8";
    const asr = (await pipeline("automatic-speech-recognition", id, {
      device,
      dtype: dtype as never,
      progress_callback: progress_callback as never,
    })) as AutomaticSpeechRecognitionPipeline;
    return { key, asr, device };
  };

  if (gpu && !local && (await hasWebGpu())) {
    try {
      cached = await tryDevice("webgpu");
      return cached;
    } catch (err) {
      console.warn("WebGPU failed, using WASM", err);
    }
  }
  cached = await tryDevice("wasm");
  return cached;
}

// Cut points at the quietest moment near every ~28 s, so a word is rarely
// split between two windows.
function windows(audio: Float32Array): [number, number][] {
  const target = 28 * SR;
  const search = 2 * SR;
  const frame = SR / 50; // 20 ms
  const out: [number, number][] = [];
  let start = 0;
  while (audio.length - start > 30 * SR) {
    let best = start + target;
    let bestE = Infinity;
    for (let i = start + target - search; i < start + target + search; i += frame) {
      let e = 0;
      for (let j = i; j < i + frame; j++) e += audio[j] * audio[j];
      if (e < bestE) {
        bestE = e;
        best = i;
      }
    }
    out.push([start, best]);
    start = best;
  }
  out.push([start, audio.length]);
  return out;
}

self.onmessage = async (e: MessageEvent<AsrRequest>) => {
  const { audio, language, model, local, gpu = false } = e.data;
  try {
    // free a model loaded before, so two never sit in memory together
    if (cached && cached.key !== `${model}:${gpu}:${local?.modelPath ?? ""}`) {
      await cached.asr.dispose().catch(() => {});
      cached = null;
    }
    const { asr, device } = await load(model, local, gpu);
    post({ type: "status", stage: "transcribing", device });
    const parts = windows(audio);
    for (let i = 0; i < parts.length; i++) {
      const [a, b] = parts[i];
      const out = await asr(audio.subarray(a, b), {
        return_timestamps: true,
        ...(language ? { language, task: "transcribe" } : {}),
      });
      const offset = a / SR;
      for (const c of out.chunks ?? []) {
        const text = c.text.trim();
        // Whisper writes things like "[Música]" or "(aplausos)" over non-speech
        if (!text || /^[[(♪*].*[\])♪*]$/.test(text)) continue;
        const [s, en] = c.timestamp;
        const start = offset + (s ?? 0);
        const end = offset + (en ?? (b - a) / SR);
        post({ type: "segment", start, end: Math.max(start + 0.2, end), text });
      }
      post({ type: "progress", fraction: (i + 1) / parts.length });
    }
    post({ type: "done" });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
