import { describe, expect, it } from "vitest";
import { applyMatrix, cssFilter, isNeutral, lookOf, NEUTRAL, washes } from "./look";

describe("filters and adjustments", () => {
  it("no filter and no adjustment is neutral", () => {
    expect(isNeutral(lookOf({ filter: null, adjust: null }))).toBe(true);
    expect(cssFilter(NEUTRAL)).toBe("none");
  });

  it("the export maths matches the CSS filter functions", () => {
    expect(applyMatrix({ ...NEUTRAL, brightness: 1.2 }, 100, 100, 100)).toEqual([120, 120, 120]);
    expect(applyMatrix({ ...NEUTRAL, contrast: 2 }, 191, 64, 128)).toEqual([255, 0, 129]);
    expect(applyMatrix({ ...NEUTRAL, saturate: 0 }, 255, 0, 0)).toEqual([54, 54, 54]);
    // brightness first, then contrast (CSS order)
    expect(applyMatrix({ ...NEUTRAL, brightness: 0.5, contrast: 2 }, 200, 200, 200)).toEqual([73, 73, 73]);
  });

  it("intensity scales a filter; adjustments add on top", () => {
    const half = lookOf({ filter: { id: "bw", intensity: 50 }, adjust: null });
    expect(half.saturate).toBeCloseTo(0.5);
    expect(cssFilter(half)).toContain("saturate(0.500)");
    const warm = lookOf({ filter: null, adjust: { brightness: 0, contrast: 0, saturation: 0, exposure: 0, temperature: 25, tint: 0, sharpen: 0, vignette: 0, highlights: 0, shadows: 0 } });
    expect(warm.temp).toBeCloseTo(0.5);
    expect(washes(warm)).toEqual([{ color: "#ff8a1f", alpha: 0.275 }]);
  });
});
