// Sequential export indexes: each export frame's timestamp increases.
// A long video with many captions, overlays and effects must not walk every
// timeline item again for each of ~18k output frames.
// Preserve TRACK ORDER: overlays from higher lanes draw on top.
import type { Clip, Track } from "../data/db";

export function createSequentialTrackIndex<T extends Clip>(
  tracks: Track[], kind: Track["kind"], accepts: (clip: Clip) => clip is T,
): (tUs: number) => T[] {
  const lanes = tracks.filter((t) => t.kind === kind && !t.hidden).map((t) => ({
    clips: t.items.filter(accepts).sort((a, b) => a.startUs - b.startUs),
    cursor: 0,
    active: [] as T[],
    order: new Map(t.items.map((item, i) => [item.id, i])),
  }));
  let lastUs = Number.NEGATIVE_INFINITY;
  return (tUs: number): T[] => {
    if (tUs < lastUs) {
      for (const lane of lanes) { lane.cursor = 0; lane.active.length = 0; }
    }
    lastUs = tUs;
    const result: T[] = [];
    for (const lane of lanes) {
      // Sort only once, on creation; the active subset is small even when
      // there are thousands of timeline items.
      while (lane.cursor < lane.clips.length && lane.clips[lane.cursor].startUs <= tUs) {
        const c = lane.clips[lane.cursor++];
        if (c.startUs + c.durationUs > tUs) lane.active.push(c);
      }
      lane.active = lane.active.filter((c) => c.startUs + c.durationUs > tUs);
      // Match original lane insertion order, not order by startUs.
      // Multiple clips within one lane usually do not overlap.
      if (lane.active.length > 1) {
        lane.active.sort((a, b) => (lane.order.get(a.id) ?? 0) - (lane.order.get(b.id) ?? 0));
      }
      result.push(...lane.active);
    }
    return result;
  };
}

export function transitionRequiresLayer(
  window: { from: { id: string }; to: { id: string } } | null,
  clipId: string,
  prevStill: boolean,
  nextStill: boolean,
) {
  return !!window && (
    (window.to.id === clipId && prevStill) ||
    (window.from.id === clipId && nextStill)
  );
}
