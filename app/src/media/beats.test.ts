import { describe, expect, it } from "vitest";
import { detectBeats } from "./beats";
import { snapShift } from "../editor/timeline";

function fakeBuffer(seconds: number, beatEvery: number | null) {
  const sr = 8000;
  const d = new Float32Array(sr * seconds);
  // quiet noise, plus a short click on every beat
  let seed = 1;
  for (let i = 0; i < d.length; i++) {
    seed = (seed * 16807) % 2147483647;
    d[i] = ((seed / 2147483647) * 2 - 1) * 0.01;
  }
  if (beatEvery) for (let t = 0.25; t < seconds; t += beatEvery) for (let j = 0; j < 400; j++) d[Math.round(t * sr) + j] += Math.sin(j / 3) * Math.exp(-j / 80);
  return { sampleRate: sr, length: d.length, numberOfChannels: 1, getChannelData: () => d } as unknown as AudioBuffer;
}

describe("beats and snapping", () => {
  it("finds a 120 bpm beat on its clicks", () => {
    const beats = detectBeats(fakeBuffer(10, 0.5));
    expect(beats.length).toBeGreaterThanOrEqual(18);
    const gaps = beats.slice(1).map((b, i) => b - beats[i]);
    for (const g of gaps) expect(Math.abs(g - 500_000)).toBeLessThanOrEqual(20_000);
    expect(Math.abs(beats[0] - 250_000)).toBeLessThanOrEqual(20_000);
  });

  it("no rhythm, no beats", () => {
    expect(detectBeats(fakeBuffer(10, null))).toEqual([]);
  });

  it("snaps the nearest edge within the tolerance", () => {
    expect(snapShift([1_030_000, 3_030_000], [0, 1_000_000, 5_000_000], 50_000)).toBe(-30_000);
    expect(snapShift([1_200_000], [1_000_000], 50_000)).toBe(0);
  });
});
