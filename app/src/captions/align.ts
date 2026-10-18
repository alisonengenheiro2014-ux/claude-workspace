// Word timing from sentence timing. Whisper gives each sentence's start and
// end; inside it, words are placed only where there is voice (by the sound's
// loudness every 10 ms), each taking time in proportion to its length. Pauses
// stay empty instead of stretching the words around them.
import type { SpeechSegment, SpeechWord } from "../editor/timeline";

export const FRAME_S = 0.01;

// Loudness (RMS) of every 10 ms of 16 kHz audio.
export function envelope(audio: Float32Array, sampleRate = 16_000): Float32Array {
  const n = Math.round(sampleRate * FRAME_S);
  const out = new Float32Array(Math.ceil(audio.length / n));
  for (let f = 0; f < out.length; f++) {
    let e = 0;
    const end = Math.min(audio.length, (f + 1) * n);
    for (let i = f * n; i < end; i++) e += audio[i] * audio[i];
    out[f] = Math.sqrt(e / Math.max(1, end - f * n));
  }
  return out;
}

export function alignWords(segments: SpeechSegment[], env: Float32Array): SpeechWord[] {
  const out: SpeechWord[] = [];
  for (const seg of segments) {
    const words = seg.text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    if (!words.length) continue;
    const f0 = Math.max(0, Math.floor(seg.start / FRAME_S));
    const f1 = Math.min(env.length, Math.max(f0 + 1, Math.ceil(seg.end / FRAME_S)));
    let peak = 0;
    for (let f = f0; f < f1; f++) peak = Math.max(peak, env[f]);
    const threshold = Math.max(0.008, peak * 0.15);
    const voiced: number[] = [];
    for (let f = f0; f < f1; f++) if (env[f] >= threshold) voiced.push(f);

    const weights = words.map((w) => Math.max(2, w.length + 1));
    const total = weights.reduce((a, b) => a + b, 0);
    // too little voice to trust: spread over the whole sentence
    const frames = voiced.length >= words.length * 4 ? voiced : Array.from({ length: f1 - f0 }, (_, i) => f0 + i);
    let acc = 0;
    words.forEach((word, i) => {
      const a = Math.floor((acc / total) * frames.length);
      acc += weights[i];
      const b = Math.max(a, Math.ceil((acc / total) * frames.length) - 1);
      const start = frames[Math.min(a, frames.length - 1)] * FRAME_S;
      const end = Math.max(start + 0.08, (frames[Math.min(b, frames.length - 1)] + 1) * FRAME_S);
      out.push({ start, end, word });
    });
  }
  return out.sort((a, b) => a.start - b.start);
}
