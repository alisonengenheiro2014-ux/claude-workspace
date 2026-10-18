import { describe, expect, it } from "vitest";
import { alignWords, envelope, FRAME_S } from "./align";

// 16 kHz test audio: loud where `talk` says, silent elsewhere.
function audioWith(seconds: number, talk: [number, number][]) {
  const a = new Float32Array(Math.round(seconds * 16_000));
  for (const [s, e] of talk) for (let i = Math.round(s * 16_000); i < Math.round(e * 16_000); i++) a[i] = 0.3 * Math.sin(i / 3);
  return a;
}

describe("word alignment", () => {
  it("puts words only where there is voice, skipping a pause", () => {
    // "oi gente" spoken 1.0-1.6 s, a pause, "tudo bem" 2.6-3.2 s; Whisper says 0.5-3.5
    const env = envelope(audioWith(4, [[1.0, 1.6], [2.6, 3.2]]));
    const words = alignWords([{ start: 0.5, end: 3.5, text: "oi gente tudo bem" }], env);
    expect(words.map((w) => w.word)).toEqual(["oi", "gente", "tudo", "bem"]);
    expect(words[0].start).toBeGreaterThanOrEqual(1.0 - FRAME_S);
    expect(words[1].end).toBeLessThanOrEqual(1.6 + FRAME_S);
    expect(words[2].start).toBeGreaterThanOrEqual(2.6 - FRAME_S);
    expect(words[3].end).toBeLessThanOrEqual(3.2 + FRAME_S);
    for (let i = 1; i < words.length; i++) expect(words[i].start).toBeGreaterThanOrEqual(words[i - 1].start);
  });

  it("falls back to the whole sentence when it hears almost nothing", () => {
    const env = envelope(audioWith(3, []));
    const words = alignWords([{ start: 0, end: 2, text: "um dois" }], env);
    expect(words[0].start).toBeCloseTo(0, 1);
    expect(words[1].end).toBeCloseTo(2, 1);
  });
});
