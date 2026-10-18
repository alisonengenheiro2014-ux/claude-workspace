// Beat marks for music (S08 Batidas). Finds the tempo from how the sound's
// loudness jumps (onsets), then lays beats on that grid, aligned with the
// strongest onsets. Good for music with a steady beat; speech gets none.
import type { Us } from "../data/db";

const HOP = 0.01; // s per analysis frame

export function detectBeats(buf: AudioBuffer): Us[] {
  const sr = buf.sampleRate;
  const hop = Math.round(sr * HOP);
  const n = Math.floor(buf.length / hop);
  if (n < 200) return [];
  // loudness per 10 ms, all channels
  const e = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = i * hop; j < (i + 1) * hop; j++) s += d[j] * d[j];
      e[i] += s / hop;
    }
  }
  // onset strength: rises in log loudness
  const nov = new Float32Array(n);
  for (let i = 1; i < n; i++) nov[i] = Math.max(0, Math.log1p(1000 * e[i]) - Math.log1p(1000 * e[i - 1]));
  // tempo: the lag (60..180 bpm) where the onsets repeat best
  let bestLag = 0;
  let bestScore = 0;
  let bestRaw = 0;
  let rawSum = 0;
  let lags = 0;
  for (let lag = Math.round(60 / 180 / HOP); lag <= Math.round(60 / 60 / HOP); lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += nov[i] * nov[i - lag];
    rawSum += s;
    lags++;
    const raw = s;
    // a mild preference for 90-140 bpm, where most songs sit
    const bpm = 60 / (lag * HOP);
    s *= Math.exp(-0.5 * Math.pow(Math.log2(bpm / 115), 2) / 0.35);
    if (s > bestScore) {
      bestScore = s;
      bestLag = lag;
      bestRaw = raw;
    }
  }
  // too little rhythm (speech, noise, silence): the best repeat is barely
  // better than any other
  if (!bestLag || bestScore <= 0 || bestRaw < (rawSum / lags) * 2) return [];
  // phase: the offset whose grid lands on the most onset strength
  let bestPhase = 0;
  let bestSum = -1;
  for (let ph = 0; ph < bestLag; ph++) {
    let s = 0;
    for (let i = ph; i < n; i += bestLag) s += nov[i] + 0.5 * (nov[i - 1] ?? 0) + 0.5 * (nov[i + 1] ?? 0);
    if (s > bestSum) {
      bestSum = s;
      bestPhase = ph;
    }
  }
  const out: Us[] = [];
  for (let i = bestPhase; i < n; i += bestLag) {
    // nudge each beat to the strongest onset within ±40 ms
    let k = i;
    for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) if (nov[j] > nov[k]) k = j;
    out.push(Math.round(k * HOP * 1e6));
  }
  return out;
}
