// Incremental caption/text visibility for monotonic export timestamps.
// A ten-minute 30 fps export may have 18,000 frames and hundreds of
// captions; rescanning every caption on every frame needlessly costs time.
// Precompute sorted clips once and keep only currently visible clips.
import type { Clip, Track } from "../data/db";

export function createSequentialTextTracks(tracks: Track[]) {
  const lanes = tracks.filter((t) => !t.hidden && (t.kind === "text" || t.kind === "caption")).map((track) => ({
    original: track,
    sorted: [...track.items].sort((a, b) => a.startUs - b.startUs),
    cursor: 0,
    active: [] as Clip[],
  }));
  let previous = Number.NEGATIVE_INFINITY;
  return (tUs: number): Track[] => {
    if (tUs < previous) {
      for (const lane of lanes) { lane.cursor = 0; lane.active = []; }
    }
    previous = tUs;
    const result: Track[] = [];
    for (const lane of lanes) {
      while (lane.cursor < lane.sorted.length && lane.sorted[lane.cursor].startUs <= tUs) {
        const item = lane.sorted[lane.cursor++];
        if (item.startUs + item.durationUs > tUs) lane.active.push(item);
      }
      if (lane.active.length) {
        lane.active = lane.active.filter((c) => c.startUs + c.durationUs > tUs);
        if (lane.active.length) result.push({ ...lane.original, items: lane.active });
      }
    }
    return result;
  };
}
