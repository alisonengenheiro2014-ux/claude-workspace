import { describe, expect, it } from "vitest";
import { autoAdjust } from "./enhance";

const fill = (n: number, f: (i: number) => [number, number, number]) => {
  const a = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = f(i);
    a.set([r, g, b, 255], i * 4);
  }
  return a;
};

describe("Aprimorar", () => {
  it("brightens a dark, flat, grey picture and gives it contrast and colour", () => {
    const a = autoAdjust(fill(1000, (i) => [40 + (i % 40), 40 + (i % 40), 40 + (i % 40)]));
    expect(a.exposure).toBeGreaterThan(10);
    expect(a.contrast).toBeGreaterThan(10);
    expect(a.saturation).toBeGreaterThan(10);
  });
  it("holds back a bright picture and warms a blue cast", () => {
    const a = autoAdjust(fill(1000, (i) => [225, 238, 245 + (i % 10)]));
    expect(a.exposure).toBeLessThan(0);
    expect(a.highlights).toBeLessThan(0);
    expect(a.temperature).toBeGreaterThan(0);
  });
  it("lifts deep shadows", () => {
    const a = autoAdjust(fill(1000, (i) => (i % 4 === 0 ? [5, 5, 5] : [140 + (i % 60), 130, 120])));
    expect(a.shadows).toBeGreaterThan(5);
  });
  it("leaves a well exposed picture mostly alone", () => {
    const a = autoAdjust(fill(1000, (i) => [i % 256, (i * 7) % 256, (i * 13) % 256]));
    expect(Math.abs(a.exposure)).toBeLessThanOrEqual(5);
    expect(a.contrast).toBeLessThanOrEqual(5);
  });
});
