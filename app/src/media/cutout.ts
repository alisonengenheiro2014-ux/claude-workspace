// Runs the background removal worker on one photo; returns a PNG with the
// background clear.
import type { CutoutMessage, CutoutRequest } from "./cutout.worker";

export type CutoutEvent = { stage: "loading" } | { stage: "download"; loaded: number; total: number } | { stage: "working" };

let worker: Worker | null = null;

export function removeBackground(image: Blob, name: string, onEvent: (e: CutoutEvent) => void, signal: AbortSignal): Promise<File> {
  worker ??= new Worker(new URL("./cutout.worker.ts", import.meta.url), { type: "module" });
  const w = worker;
  let local: CutoutRequest["local"];
  try {
    local = JSON.parse(localStorage.getItem("cutout-local") ?? "null") ?? undefined;
  } catch {
    local = undefined;
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      w.terminate();
      worker = null;
      reject(new DOMException("cancelled", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    w.onmessage = (e: MessageEvent<CutoutMessage>) => {
      const m = e.data;
      if (m.type === "loading") onEvent({ stage: "loading" });
      else if (m.type === "download") onEvent({ stage: "download", loaded: m.loaded, total: m.total });
      else if (m.type === "working") onEvent({ stage: "working" });
      else if (m.type === "done") {
        signal.removeEventListener("abort", onAbort);
        resolve(new File([m.png], `${name.replace(/\.[^.]+$/, "")}-recorte.png`, { type: "image/png" }));
      } else if (m.type === "error") {
        signal.removeEventListener("abort", onAbort);
        reject(new Error(m.message));
      }
    };
    w.postMessage({ image, local } satisfies CutoutRequest);
  });
}
