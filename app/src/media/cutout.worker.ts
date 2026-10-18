// Background removal for photos (S12 Recorte): a person/object segmentation
// model (MODNet) through transformers.js on the CPU, in a worker. The model
// downloads once (~25 MB) and is cached for offline use.
import { env, pipeline, RawImage, type BackgroundRemovalPipeline } from "@huggingface/transformers";

export type CutoutRequest = { image: Blob; local?: { modelPath: string; wasmPath: string; model: string } };
export type CutoutMessage =
  | { type: "loading" }
  | { type: "download"; loaded: number; total: number }
  | { type: "working" }
  | { type: "done"; png: Blob }
  | { type: "error"; message: string };

const post = (m: CutoutMessage) => self.postMessage(m);
let cut: BackgroundRemovalPipeline | null = null;

self.onmessage = async (e: MessageEvent<CutoutRequest>) => {
  try {
    const { image, local } = e.data;
    if (!cut) {
      post({ type: "loading" });
      if (local) {
        env.allowRemoteModels = false;
        env.allowLocalModels = true;
        env.localModelPath = local.modelPath;
        if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = local.wasmPath;
      }
      const files = new Map<string, { loaded: number; total: number }>();
      cut = (await pipeline("background-removal", local?.model ?? "Xenova/modnet", {
        device: "wasm",
        dtype: "q8" as never,
        progress_callback: ((p: { status: string; file?: string; loaded?: number; total?: number }) => {
          if (p.status !== "progress" || !p.file) return;
          files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
          let loaded = 0;
          let total = 0;
          for (const f of files.values()) {
            loaded += f.loaded;
            total += f.total;
          }
          post({ type: "download", loaded, total });
        }) as never,
      })) as BackgroundRemovalPipeline;
    }
    post({ type: "working" });
    const out = await cut(await RawImage.fromBlob(image));
    const img = Array.isArray(out) ? out[0] : out;
    post({ type: "done", png: await img.toBlob("image/png") });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
