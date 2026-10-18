import { describe, expect, it } from "vitest";
import type { TextClip } from "../data/db";
import { animatedAt, keyNear, keyTimes, mainZoom, shiftKeys, withKeyAt, withoutKeyAt } from "./keyframes";

const clip = (): TextClip => ({
  id: "t", type: "text", text: "x", style: {} as TextClip["style"], startUs: 0, durationUs: 4_000_000,
  transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 }, opacity: 1, blendMode: "normal",
  animation: { in: null, out: null, loop: null }, keyframes: [],
});

describe("keyframes", () => {
  it("without keyframes the item keeps its transform", () => {
    expect(animatedAt(clip(), 1_000_000).transform).toEqual({ x: 0.5, y: 0.5, scale: 1, rotation: 0 });
  });

  it("eases between two keyframes and holds before the first and after the last", () => {
    const c = clip();
    c.keyframes = withKeyAt(c, 1_000_000, { transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 }, opacity: 1 });
    c.keyframes = withKeyAt(c, 3_000_000, { transform: { x: 0.9, y: 0.5, scale: 2, rotation: 90 }, opacity: 0 });
    expect(keyTimes(c)).toEqual([1_000_000, 3_000_000]);
    expect(animatedAt(c, 0).transform.scale).toBe(1);
    expect(animatedAt(c, 2_000_000).transform.scale).toBeCloseTo(1.5); // half way, ease-in-out is symmetric
    expect(animatedAt(c, 1_500_000).transform.scale).toBeCloseTo(1.125); // eased: slow start
    expect(animatedAt(c, 4_000_000)).toEqual({ transform: { x: 0.9, y: 0.5, scale: 2, rotation: 90 }, opacity: 0 });
  });

  it("a keyframe near an existing one replaces it; it can be removed", () => {
    const c = clip();
    c.keyframes = withKeyAt(c, 1_000_000, { transform: c.transform, opacity: 1 });
    c.keyframes = withKeyAt(c, 1_020_000, { transform: { ...c.transform, scale: 3 }, opacity: 1 });
    expect(keyTimes(c)).toEqual([1_000_000]);
    expect(animatedAt(c, 1_000_000).transform.scale).toBe(3);
    expect(keyNear(c, 1_030_000)).toBe(1_000_000);
    expect(withoutKeyAt(c, 990_000)).toEqual([]);
  });

  it("the part after a cut keeps the same motion", () => {
    const c = clip();
    c.keyframes = withKeyAt(c, 1_000_000, { transform: c.transform, opacity: 1 });
    c.keyframes = withKeyAt(c, 3_000_000, { transform: { ...c.transform, scale: 2 }, opacity: 1 });
    const right = { ...c, keyframes: shiftKeys(c.keyframes, 2_000_000) };
    expect(animatedAt(right, 500_000).transform.scale).toBeCloseTo(animatedAt(c, 2_500_000).transform.scale);
    expect(mainZoom(right, 1_000_000)).toEqual({ scale: 2, dx: 0, dy: 0, opacity: 1 });
  });
});
