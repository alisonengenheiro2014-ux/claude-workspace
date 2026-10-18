// Text to speech (S11): runs the voice in a worker and returns a WAV file to
// add as a narration track.
import type { TtsMessage, TtsRequest } from "./tts.worker";

export type TtsEvent = { stage: "loading" } | { stage: "download"; loaded: number; total: number } | { stage: "speaking"; fraction: number };

let worker: Worker | null = null;

function localOverride(): TtsRequest["local"] {
  try {
    const raw = localStorage.getItem("tts-local");
    return raw ? (JSON.parse(raw) as TtsRequest["local"]) : undefined;
  } catch {
    return undefined;
  }
}

export function wavFile(audio: Float32Array, sampleRate: number, name: string) {
  const data = new DataView(new ArrayBuffer(44 + audio.length * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  data.setUint32(4, 36 + audio.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true); // PCM
  data.setUint16(22, 1, true); // mono
  data.setUint32(24, sampleRate, true);
  data.setUint32(28, sampleRate * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  str(36, "data");
  data.setUint32(40, audio.length * 2, true);
  for (let i = 0; i < audio.length; i++) data.setInt16(44 + i * 2, Math.max(-1, Math.min(1, audio[i])) * 0x7fff, true);
  return new File([data.buffer], name, { type: "audio/wav" });
}

export function speak(text: string, onEvent: (e: TtsEvent) => void, signal: AbortSignal): Promise<File> {
  worker ??= new Worker(new URL("./tts.worker.ts", import.meta.url), { type: "module" });
  const w = worker;
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      w.terminate();
      worker = null;
      reject(new DOMException("cancelled", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    w.onmessage = (e: MessageEvent<TtsMessage>) => {
      const m = e.data;
      if (m.type === "loading") onEvent({ stage: "loading" });
      else if (m.type === "download") onEvent({ stage: "download", loaded: m.loaded, total: m.total });
      else if (m.type === "progress") onEvent({ stage: "speaking", fraction: m.fraction });
      else if (m.type === "done") {
        signal.removeEventListener("abort", onAbort);
        const short = text.trim().slice(0, 24).replace(/[^\p{L}\p{N} ]/gu, "").trim() || "voz";
        resolve(wavFile(m.audio, m.sampleRate, `Voz - ${short}.wav`));
      } else if (m.type === "error") {
        signal.removeEventListener("abort", onAbort);
        reject(new Error(m.message));
      }
    };
    const req: TtsRequest = { type: "speak", text, local: localOverride() };
    w.postMessage(req);
  });
}
