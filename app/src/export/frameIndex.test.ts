import { describe, expect, it } from "vitest";
import { createSequentialTrackIndex, transitionRequiresLayer } from "./frameIndex";
import type { Clip, EffectClip, MediaClip, Track } from "../data/db";
import { effectsAt, effectsFromActive } from "../editor/effects";
import { overlaysAt } from "../editor/overlay";
import type { TimelineDoc } from "../data/db";

const media = (id: string, startUs: number, durationUs: number) =>
  ({ id, type: "media", startUs, durationUs } as MediaClip);
const fx = (id: string, effectId: string, startUs: number, durationUs: number) =>
  ({ id, type: "effect", effectId, startUs, durationUs } as EffectClip);
const lane = (kind: Track["kind"], items: Clip[], hidden = false): Track =>
  ({ id: Math.random().toString(), kind, items, hidden, muted: false, locked: false });
const doc = (tracks: Track[]) => ({ tracks } as TimelineDoc);
const over = (c: Clip): c is MediaClip => c.type === "media";
const effect = (c: Clip): c is EffectClip => c.type === "effect";

describe("streaming frame optimizer matches original timeline", () => {
  const tracks = [
    lane("overlay", [media("first", 0, 4e6), media("late", 5e6, 3e6), media("middle", 2e6, 2e6)]),
    lane("overlay", [media("upper", 1e6, 6e6)]),
    lane("overlay", [media("hidden", 0, 9e6)], true),
    lane("effect", [fx("shake", "shake", 1e6, 3e6), fx("bw", "bw", 2e6, 1e6)]),
    lane("effect", [fx("sepia", "sepia", 2e6, 3e6)]),
  ];
  it("returns the same active overlays in original stacking order over thousands of frames", () => {
    const indexed = createSequentialTrackIndex(tracks, "overlay", over);
    for (let time = 0; time <= 8e6; time += 33333) {
      expect(indexed(time).map((c) => c.id)).toEqual(overlaysAt(doc(tracks), time).map((c) => c.id));
    }
  });
  it("returns exactly the same time-varying effects", () => {
    const indexed = createSequentialTrackIndex(tracks, "effect", effect);
    for (let time = 0; time <= 8e6; time += 33333) {
      expect(effectsFromActive(indexed(time), time)).toEqual(effectsAt(doc(tracks), time));
    }
  });
  it("resets after backward seek and preserves exact time boundaries", () => {
    const indexed = createSequentialTrackIndex(tracks, "overlay", over);
    indexed(8e6);
    for (const time of [0, 1e6, 2e6, 4e6, 5e6, 7e6]) {
      expect(indexed(time).map((c) => c.id)).toEqual(overlaysAt(doc(tracks), time).map((c) => c.id));
    }
  });
  it("directly renders only when no transition still needs the intermediate layer", () => {
    const window = { from: { id: "out" }, to: { id: "in" } };
    expect(transitionRequiresLayer(null, "out", true, true)).toBe(false);
    expect(transitionRequiresLayer(window, "out", false, true)).toBe(true);
    expect(transitionRequiresLayer(window, "in", true, false)).toBe(true);
    expect(transitionRequiresLayer(window, "out", false, false)).toBe(false);
    expect(transitionRequiresLayer(window, "other", true, true)).toBe(false);
  });
});
