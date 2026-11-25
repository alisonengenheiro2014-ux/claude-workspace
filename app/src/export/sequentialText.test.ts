import { describe, expect, it } from "vitest";
import type { Track, Clip } from "../data/db";
import { createSequentialTextTracks } from "./sequentialText";
import { textsAt } from "../editor/text";

const clip = (id: string, startUs: number, durationUs: number): Clip => ({
  id, type: "caption", startUs, durationUs, text: "Teste " + id,
  words: [{ startUs: 0, endUs: durationUs, word: "Teste" }],
  transform: { x: 0.5, y: 0.75, scale: 1, rotation: 0 }, opacity: 1,
  blendMode: "normal", animation: { in: null, out: null, loop: null }, keyframes: [],
});
const lane = (id: string, clips: Clip[]): Track => ({
  id, kind: "caption", hidden: false, locked: false, muted: false, items: clips,
});
const active = (tracks: Track[], time: number) => tracks.flatMap((t) =>
  t.items.filter((c) => !t.hidden && c.startUs <= time && time < c.startUs + c.durationUs).map((c) => c.id)
);

describe("incremental captions during export", () => {
  const tracks = [lane("c1", [
    clip("start", 0, 2_000_000), clip("next", 2_000_000, 1_000_000), clip("end", 3_000_000, 2_000_000),
  ]), lane("c2", [clip("overlay", 1_000_000, 3_000_000)])];
  it("produces exactly the same visible captions as a full scan", () => {
    const indexed = createSequentialTextTracks(tracks);
    for (const t of [0, 500_000, 999_999, 1_000_000, 1_999_999, 2_000_000, 2_500_000, 3_999_999, 4_000_000, 4_999_999, 5_000_000]) {
      const visible = indexed(t);
      expect(active(visible, t)).toEqual(active(tracks, t));
      // Exact same caption styling, word-highlighting and timing as before.
      expect(textsAt(visible, t)).toEqual(textsAt(tracks, t));
    }
  });
  it("resets safely if called with an earlier timestamp", () => {
    const indexed = createSequentialTextTracks(tracks);
    indexed(4_900_000);
    expect(active(indexed(100_000), 100_000)).toEqual(active(tracks, 100_000));
  });
});
