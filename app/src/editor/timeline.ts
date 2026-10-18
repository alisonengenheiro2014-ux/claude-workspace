// Pure operations on the timeline document. Every function takes a doc and
// returns a new one; the store keeps the old one for undo.
import type { AspectRatio, AssetRow, CaptionClip, Clip, Id, MediaClip, TextClip, TextStyle, TimelineDoc, Track, Transform, Us } from "../data/db";
import { DEFAULT_STYLE, DEFAULT_TEXT_US } from "./text";
import { captionPreset, type CaptionGrouping } from "./presets";

export const IMAGE_DEFAULT_US: Us = 3_000_000;
export const MIN_CLIP_US: Us = 100_000; // shortest clip a split or trim may leave

const uid = () => crypto.randomUUID();

export function emptyDoc(aspectRatio: AspectRatio = "original"): TimelineDoc {
  return {
    version: 1,
    canvas: { aspectRatio, width: 1080, height: 1920, background: { type: "color", color: "#000000" } },
    tracks: [{ id: uid(), kind: "main", muted: false, hidden: false, locked: false, items: [] }],
    transitions: [],
  };
}

export function mainTrack(doc: TimelineDoc): Track {
  return doc.tracks.find((t) => t.kind === "main")!;
}

export function mainClips(doc: TimelineDoc): MediaClip[] {
  return mainTrack(doc).items.filter((c): c is MediaClip => c.type === "media");
}

export function newMediaClip(asset: AssetRow): MediaClip {
  const outUs = asset.kind === "image" ? IMAGE_DEFAULT_US : asset.durationUs;
  return {
    id: uid(),
    type: "media",
    assetId: asset.id,
    startUs: 0,
    durationUs: outUs,
    inUs: 0,
    outUs,
    speed: 1,
    speedCurve: null,
    keepPitch: true,
    reverse: false,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0,
    crop: null,
    mask: null,
    chroma: null,
    filter: null,
    adjust: null,
    freeze: false,
    stabilize: 0,
    denoise: false,
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
    opacity: 1,
    blendMode: "normal",
    animation: { in: null, out: null, loop: null },
    keyframes: [],
  };
}

export function clipDuration(c: MediaClip): Us {
  return Math.round((c.outUs - c.inUs) / c.speed);
}

// The main track is magnetic: clips sit end to end from zero.
function relayout(track: Track) {
  let at = 0;
  for (const c of track.items) {
    c.startUs = at;
    if (c.type === "media") c.durationUs = clipDuration(c);
    at += c.durationUs;
  }
}

function edit(doc: TimelineDoc, fn: (draft: TimelineDoc) => void): TimelineDoc {
  const draft = structuredClone(doc);
  fn(draft);
  relayout(mainTrack(draft));
  // other tracks: keep items in time order, drop text tracks left empty
  for (const t of draft.tracks) if (t.kind !== "main") t.items.sort((a, b) => a.startUs - b.startUs);
  draft.tracks = draft.tracks.filter((t) => t.kind === "main" || t.items.length > 0);
  // drop transitions whose clips are gone or no longer adjacent
  const items = mainTrack(draft).items;
  draft.transitions = draft.transitions.filter((t) => {
    const i = items.findIndex((c) => c.id === t.fromClipId);
    return i >= 0 && items[i + 1]?.id === t.toClipId;
  });
  return draft;
}

export function durationOf(doc: TimelineDoc): Us {
  const items = mainTrack(doc).items;
  const last = items[items.length - 1];
  return last ? last.startUs + last.durationUs : 0;
}

export function findClip(doc: TimelineDoc, clipId: Id): MediaClip | undefined {
  return mainClips(doc).find((c) => c.id === clipId);
}

// The clip under a timeline position, and how far into it the position is.
export function clipAt(doc: TimelineDoc, atUs: Us): { clip: MediaClip; offsetUs: Us } | null {
  const clips = mainClips(doc);
  for (const clip of clips) {
    if (atUs >= clip.startUs && atUs < clip.startUs + clip.durationUs) return { clip, offsetUs: atUs - clip.startUs };
  }
  const last = clips[clips.length - 1];
  if (last && atUs >= last.startUs + last.durationUs) return { clip: last, offsetUs: last.durationUs };
  return null;
}

// Where in the source media a timeline position lands.
export function sourceTimeUs(clip: MediaClip, offsetUs: Us): Us {
  return Math.min(clip.outUs, clip.inUs + Math.round(offsetUs * clip.speed));
}

// Inserts at the clip boundary nearest to atUs.
export function insertMedia(doc: TimelineDoc, assets: AssetRow[], atUs: Us): { doc: TimelineDoc; ids: Id[] } {
  const clips = assets.map(newMediaClip);
  const next = edit(doc, (d) => {
    const items = mainTrack(d).items;
    let index = items.length;
    for (let i = 0; i < items.length; i++) {
      const mid = items[i].startUs + items[i].durationUs / 2;
      if (atUs < mid) {
        index = i;
        break;
      }
    }
    items.splice(index, 0, ...clips);
  });
  return { doc: next, ids: clips.map((c) => c.id) };
}

export function canSplit(doc: TimelineDoc, clipId: Id, atUs: Us): boolean {
  const c = findClip(doc, clipId);
  if (!c) return false;
  return atUs - c.startUs >= MIN_CLIP_US && c.startUs + c.durationUs - atUs >= MIN_CLIP_US;
}

export function split(doc: TimelineDoc, clipId: Id, atUs: Us): { doc: TimelineDoc; rightId: Id } | null {
  if (!canSplit(doc, clipId, atUs)) return null;
  const rightId = uid();
  const next = edit(doc, (d) => {
    const items = mainTrack(d).items;
    const i = items.findIndex((c) => c.id === clipId);
    const left = items[i] as MediaClip;
    const cut = sourceTimeUs(left, atUs - left.startUs);
    const right: MediaClip = { ...structuredClone(left), id: rightId, inUs: cut };
    left.outUs = cut;
    items.splice(i + 1, 0, right);
    // a transition that followed the clip now follows its right part
    for (const t of d.transitions) if (t.fromClipId === clipId) t.fromClipId = rightId;
  });
  return { doc: next, rightId };
}

// Moves one edge of a clip by deltaUs of timeline time. Clamped so the clip
// stays at least MIN_CLIP_US long and inside its media.
export function trim(doc: TimelineDoc, clipId: Id, edge: "start" | "end", deltaUs: Us, mediaUs: Us | null): TimelineDoc {
  return edit(doc, (d) => {
    const c = mainTrack(d).items.find((x) => x.id === clipId) as MediaClip | undefined;
    if (!c) return;
    const delta = Math.round(deltaUs * c.speed);
    const min = Math.round(MIN_CLIP_US * c.speed);
    if (edge === "start") c.inUs = Math.max(0, Math.min(c.outUs - min, c.inUs + delta));
    else c.outUs = Math.max(c.inUs + min, Math.min(mediaUs ?? Number.POSITIVE_INFINITY, c.outUs + delta));
  });
}

export function remove(doc: TimelineDoc, clipId: Id): TimelineDoc {
  return edit(doc, (d) => {
    for (const t of d.tracks) t.items = t.items.filter((c) => c.id !== clipId);
  });
}

export function duplicate(doc: TimelineDoc, clipId: Id): { doc: TimelineDoc; id: Id } {
  const id = uid();
  const hit = findItem(doc, clipId);
  if (hit && hit.track.kind !== "main") {
    // a copy right after the original, in whichever lane has room
    const c = hit.clip;
    const total = durationOf(doc);
    const start = Math.min(c.startUs + c.durationUs, Math.max(0, total - c.durationUs));
    const next = edit(doc, (d) => {
      placeInLane(d, { ...structuredClone(c), id, startUs: start }, hit.track.kind);
    });
    return { doc: next, id };
  }
  const next = edit(doc, (d) => {
    const items = mainTrack(d).items;
    const i = items.findIndex((c) => c.id === clipId);
    if (i >= 0) items.splice(i + 1, 0, { ...structuredClone(items[i]), id });
  });
  return { doc: next, id };
}

export function move(doc: TimelineDoc, clipId: Id, toIndex: number): TimelineDoc {
  return edit(doc, (d) => {
    const items = mainTrack(d).items;
    const i = items.findIndex((c) => c.id === clipId);
    if (i < 0) return;
    const [c] = items.splice(i, 1);
    items.splice(Math.max(0, Math.min(items.length, toIndex)), 0, c);
  });
}

export function setClip(doc: TimelineDoc, clipId: Id, patch: Partial<MediaClip>): TimelineDoc {
  return edit(doc, (d) => {
    const items = mainTrack(d).items;
    const i = items.findIndex((c) => c.id === clipId);
    if (i >= 0) items[i] = { ...(items[i] as MediaClip), ...patch } as Clip;
  });
}

export const ASPECTS: Record<Exclude<AspectRatio, "original">, number> = {
  "9:16": 9 / 16,
  "16:9": 16 / 9,
  "1:1": 1,
  "4:5": 4 / 5,
  "4:3": 4 / 3,
};

// Output frame size for a short-side resolution (720, 1080, 2160...).
// "original" follows the first clip's shape. Always even numbers.
export function frameSize(doc: TimelineDoc, assets: Map<Id, AssetRow>, shortSide: number) {
  let ratio: number;
  if (doc.canvas.aspectRatio === "original") {
    const first = mainClips(doc)[0];
    const a = first && assets.get(first.assetId);
    ratio = a && a.width && a.height ? a.width / a.height : 9 / 16;
  } else ratio = ASPECTS[doc.canvas.aspectRatio];
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return ratio >= 1
    ? { width: even(shortSide * ratio), height: even(shortSide) }
    : { width: even(shortSide), height: even(shortSide / ratio) };
}

// ---------- overlay tracks (text for now) ----------

export function findItem(doc: TimelineDoc, id: Id): { track: Track; clip: Clip } | null {
  for (const track of doc.tracks) {
    const clip = track.items.find((c) => c.id === id);
    if (clip) return { track, clip };
  }
  return null;
}

function overlaps(track: Track, start: Us, end: Us, ignoreId?: Id) {
  return track.items.some((c) => c.id !== ignoreId && start < c.startUs + c.durationUs && c.startUs < end);
}

// Puts an item in the first lane of its kind with room, or in a new lane on top.
function placeInLane(d: TimelineDoc, item: Clip, kind: Track["kind"], skip?: Track) {
  const end = item.startUs + item.durationUs;
  let lane = d.tracks.find((t) => t.kind === kind && t !== skip && !overlaps(t, item.startUs, end, item.id));
  if (!lane) {
    lane = { id: uid(), kind, muted: false, hidden: false, locked: false, items: [] };
    d.tracks.push(lane);
  }
  lane.items.push(item);
}

export function textTracks(doc: TimelineDoc) {
  return doc.tracks.filter((t) => t.kind === "text");
}

// A new text item at the playhead, default length, inside the video.
export function addText(doc: TimelineDoc, atUs: Us, text: string, style: TextStyle = DEFAULT_STYLE): { doc: TimelineDoc; id: Id } {
  const id = uid();
  const total = durationOf(doc);
  const dur = Math.max(MIN_CLIP_US, Math.min(DEFAULT_TEXT_US, total || DEFAULT_TEXT_US));
  const start = Math.max(0, Math.min(atUs, (total || dur) - dur));
  const clip: TextClip = {
    id,
    type: "text",
    text,
    style: structuredClone(style),
    startUs: start,
    durationUs: dur,
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
    opacity: 1,
    blendMode: "normal",
    animation: { in: null, out: null, loop: null },
    keyframes: [],
  };
  return { doc: edit(doc, (d) => placeInLane(d, clip, "text")), id };
}

// Moves an overlay item in time. If it would collide in its lane, it hops to
// another lane (or a new one), like dragging between rows.
export function moveItem(doc: TimelineDoc, id: Id, startUs: Us): TimelineDoc {
  return edit(doc, (d) => {
    const hit = findItem(d, id);
    if (!hit || hit.track.kind === "main") return;
    const c = hit.clip;
    const total = durationOf(d);
    const from = c.startUs;
    c.startUs = Math.max(0, Math.min(Math.round(startUs), Math.max(0, total - c.durationUs)));
    if (hit.track.kind === "caption") {
      // captions keep one lane and their order: stop at the neighbours
      const others = hit.track.items.filter((x) => x.id !== id);
      const before = others.filter((x) => x.startUs < from).reduce((m, x) => Math.max(m, x.startUs + x.durationUs), 0);
      const after = others.filter((x) => x.startUs >= from).reduce((m, x) => Math.min(m, x.startUs), total);
      c.startUs = Math.max(before, Math.min(c.startUs, after - c.durationUs));
      return;
    }
    if (overlaps(hit.track, c.startUs, c.startUs + c.durationUs, c.id)) {
      hit.track.items = hit.track.items.filter((x) => x.id !== id);
      placeInLane(d, c, hit.track.kind, hit.track);
    }
  });
}

// Trims an overlay item's start or end, stopping at its neighbours and the
// video's end. Media items (audio) also move their in/out points and stop at
// the ends of their media (mediaUs).
export function trimItem(doc: TimelineDoc, id: Id, edge: "start" | "end", deltaUs: Us, mediaUs: Us | null = null): TimelineDoc {
  return edit(doc, (d) => {
    const hit = findItem(d, id);
    if (!hit || hit.track.kind === "main") return;
    const c = hit.clip;
    const end = c.startUs + c.durationUs;
    const others = hit.track.items.filter((x) => x.id !== id);
    const prevEnd = Math.max(0, ...others.filter((x) => x.startUs + x.durationUs <= c.startUs).map((x) => x.startUs + x.durationUs));
    const nextStart = Math.min(durationOf(d) || end, ...others.filter((x) => x.startUs >= end).map((x) => x.startUs));
    if (c.type === "media") {
      if (edge === "start") {
        // how far the start may move left: neighbour, timeline start, media start
        const minStart = Math.max(prevEnd, c.startUs - c.inUs / c.speed);
        const s = Math.max(minStart, Math.min(end - MIN_CLIP_US, c.startUs + Math.round(deltaUs)));
        c.inUs = Math.max(0, Math.round(c.inUs + (s - c.startUs) * c.speed));
        c.startUs = s;
      } else {
        const maxDur = Math.min(nextStart - c.startUs, mediaUs === null ? Infinity : (mediaUs - c.inUs) / c.speed);
        const dur = Math.max(MIN_CLIP_US, Math.min(maxDur, c.durationUs + Math.round(deltaUs)));
        c.outUs = Math.round(c.inUs + dur * c.speed);
      }
      c.durationUs = clipDuration(c);
      return;
    }
    if (edge === "start") {
      const s = Math.max(prevEnd, Math.min(end - MIN_CLIP_US, c.startUs + Math.round(deltaUs)));
      c.durationUs = end - s;
      c.startUs = s;
    } else {
      c.durationUs = Math.max(MIN_CLIP_US, Math.min(nextStart - c.startUs, c.durationUs + Math.round(deltaUs)));
    }
  });
}

// ---------- audio lanes ----------

export function audioTracks(doc: TimelineDoc) {
  return doc.tracks.filter((t) => t.kind === "audio");
}

// Audio (a song, a recording, or a video's sound) at atUs. By default it
// ends with the video; trim it longer or shorter afterwards.
export function addAudio(doc: TimelineDoc, asset: AssetRow, atUs: Us, inUs: Us = 0): { doc: TimelineDoc; id: Id } {
  const total = durationOf(doc);
  const start = Math.max(0, Math.min(atUs, Math.max(0, total - MIN_CLIP_US)));
  const room = total > start ? total - start : asset.durationUs;
  const clip: MediaClip = { ...newMediaClip(asset), inUs };
  clip.outUs = Math.min(asset.durationUs, inUs + Math.max(MIN_CLIP_US, room));
  clip.startUs = start;
  clip.durationUs = clipDuration(clip);
  return { doc: edit(doc, (d) => placeInLane(d, clip, "audio")), id: clip.id };
}

// Splits an audio item at atUs; the right part stays in the same lane.
export function splitItem(doc: TimelineDoc, id: Id, atUs: Us): { doc: TimelineDoc; rightId: Id } | null {
  const hit = findItem(doc, id);
  if (!hit || hit.track.kind === "main" || hit.clip.type !== "media") return null;
  const c = hit.clip;
  if (atUs - c.startUs < MIN_CLIP_US || c.startUs + c.durationUs - atUs < MIN_CLIP_US) return null;
  const rightId = uid();
  const next = edit(doc, (d) => {
    const h = findItem(d, id)!;
    const left = h.clip as MediaClip;
    const cut = sourceTimeUs(left, atUs - left.startUs);
    const right: MediaClip = { ...structuredClone(left), id: rightId, inUs: cut, startUs: atUs, fadeInUs: 0 };
    left.outUs = cut;
    left.fadeOutUs = 0;
    left.durationUs = clipDuration(left);
    right.durationUs = clipDuration(right);
    h.track.items.push(right);
  });
  return { doc: next, rightId };
}

// Patch for any item (audio volume, fades, mute).
export function setItem(doc: TimelineDoc, id: Id, patch: Partial<MediaClip>): TimelineDoc {
  return edit(doc, (d) => {
    const hit = findItem(d, id);
    if (!hit) return;
    const i = hit.track.items.indexOf(hit.clip);
    hit.track.items[i] = { ...hit.clip, ...patch } as Clip;
  });
}

export function setTrackMuted(doc: TimelineDoc, kind: Track["kind"], muted: boolean): TimelineDoc {
  return edit(doc, (d) => {
    for (const t of d.tracks) if (t.kind === kind) t.muted = muted;
  });
}

// Volume envelope of a clip at local time (0..durationUs): volume times the fades.
export function gainAt(c: MediaClip, localUs: Us): number {
  let g = c.volume;
  if (c.fadeInUs > 0 && localUs < c.fadeInUs) g *= Math.max(0, localUs / c.fadeInUs);
  const left = c.durationUs - localUs;
  if (c.fadeOutUs > 0 && left < c.fadeOutUs) g *= Math.max(0, left / c.fadeOutUs);
  return g;
}

export function setText(doc: TimelineDoc, id: Id, patch: Partial<TextClip>): TimelineDoc {
  return edit(doc, (d) => {
    const hit = findItem(d, id);
    if (!hit || hit.clip.type !== "text") return;
    const i = hit.track.items.indexOf(hit.clip);
    hit.track.items[i] = { ...hit.clip, ...patch } as TextClip;
  });
}

// ---------- transitions ----------

// Longest transition allowed at the cut after clip fromId: half the shorter clip.
export function maxTransitionUs(doc: TimelineDoc, fromId: Id): Us {
  const items = mainClips(doc);
  const i = items.findIndex((c) => c.id === fromId);
  if (i < 0 || i === items.length - 1) return 0;
  return Math.floor(Math.min(items[i].durationUs, items[i + 1].durationUs) / 2);
}

// Sets (or with type null removes) the transition at the cut after fromId.
export function setTransition(doc: TimelineDoc, fromId: Id, type: string | null, durationUs: Us): TimelineDoc {
  return edit(doc, (d) => {
    d.transitions = d.transitions.filter((t) => t.fromClipId !== fromId);
    const items = mainClips(d);
    const i = items.findIndex((c) => c.id === fromId);
    if (!type || i < 0 || i === items.length - 1) return;
    const max = maxTransitionUs(d, fromId);
    if (max < MIN_CLIP_US / 2) return;
    d.transitions.push({ id: uid(), fromClipId: fromId, toClipId: items[i + 1].id, type, durationUs: Math.min(durationUs, max) });
  });
}

// Same transition at every cut (each clamped to what its clips allow).
export function setTransitionAll(doc: TimelineDoc, type: string | null, durationUs: Us): TimelineDoc {
  let d = doc;
  const clips = mainClips(doc);
  for (let i = 0; i < clips.length - 1; i++) d = setTransition(d, clips[i].id, type, durationUs);
  return d;
}

export interface TransitionWindow {
  type: string;
  from: MediaClip; // outgoing (A)
  to: MediaClip; // incoming (B)
  cutUs: Us;
  startUs: Us;
  endUs: Us;
}

export function transitionWindows(doc: TimelineDoc): TransitionWindow[] {
  const clips = mainClips(doc);
  const out: TransitionWindow[] = [];
  for (const t of doc.transitions) {
    const i = clips.findIndex((c) => c.id === t.fromClipId);
    const from = clips[i];
    const to = clips[i + 1];
    if (!from || !to || to.id !== t.toClipId) continue;
    const cutUs = to.startUs;
    out.push({ type: t.type, from, to, cutUs, startUs: cutUs - t.durationUs / 2, endUs: cutUs + t.durationUs / 2 });
  }
  return out;
}

// The transition playing at tUs, with its progress 0..1.
export function transitionAt(doc: TimelineDoc, tUs: Us): (TransitionWindow & { p: number }) | null {
  for (const w of transitionWindows(doc)) {
    if (tUs >= w.startUs && tUs < w.endUs) return { ...w, p: (tUs - w.startUs) / (w.endUs - w.startUs) };
  }
  return null;
}

// ---------- captions ----------

export interface SpeechSegment {
  start: number; // seconds on the timeline
  end: number;
  text: string;
}

export interface SpeechWord {
  start: number; // seconds on the timeline
  end: number;
  word: string;
}

// Breaks a sentence into captions of up to maxLines lines of up to maxChars
// characters each, breaking between words.
export function splitCaption(text: string, maxChars = 32, maxLines = 2): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && (line + " " + w).length > maxChars) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += maxLines) out.push(lines.slice(i, i + maxLines).join("\n"));
  return out;
}

export function captionTrack(doc: TimelineDoc) {
  return doc.tracks.find((t) => t.kind === "caption");
}

// Groups words into captions the way a template says: one word each, a few
// words each, or up to two lines. A pause or the end of a sentence always
// starts a new caption.
export function groupWords(words: SpeechWord[], group: CaptionGrouping, maxWords: number): SpeechWord[][] {
  const groups: SpeechWord[][] = [];
  let cur: SpeechWord[] = [];
  const close = () => {
    if (cur.length) groups.push(cur);
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const pause = prev ? w.start - prev.end : 0;
    const sentenceEnd = prev ? /[.?!]$/.test(prev.word) : false;
    if (prev) {
      if (group === "word") close();
      else if (group === "phrase" && (cur.length >= maxWords || pause > 0.5 || sentenceEnd || /[,;:]$/.test(prev.word))) close();
      else if (group === "lines" && (pause > 0.7 || sentenceEnd || splitCaption([...cur, w].map((x) => x.word).join(" ")).length > 1)) close();
    }
    cur.push(w);
  }
  close();
  return groups;
}

// Replaces the captions with these words, grouped and styled by a template.
export function setCaptions(doc: TimelineDoc, words: SpeechWord[], presetId: string, style?: TextStyle): TimelineDoc {
  const preset = captionPreset(presetId);
  return edit(doc, (d) => {
    d.tracks = d.tracks.filter((t) => t.kind !== "caption");
    const groups = groupWords(words, preset.group, preset.maxWords);
    const items: CaptionClip[] = [];
    groups.forEach((g, i) => {
      const startUs = Math.round(g[0].start * 1e6);
      const nextStart = groups[i + 1] ? Math.round(groups[i + 1][0].start * 1e6) : Infinity;
      let endUs = Math.max(startUs + 150_000, Math.round(g[g.length - 1].end * 1e6));
      if (nextStart - endUs < 350_000) endUs = nextStart; // no flicker between close captions
      endUs = Math.min(endUs, nextStart);
      if (endUs - startUs < MIN_CLIP_US) return;
      const text = g.map((w) => w.word).join(" ");
      items.push({
        id: uid(),
        type: "caption",
        text: preset.group === "lines" ? (splitCaption(text)[0] ?? text) : text,
        words: g.map((w) => ({ startUs: Math.round(w.start * 1e6) - startUs, endUs: Math.round(w.end * 1e6) - startUs, word: w.word })),
        startUs,
        durationUs: endUs - startUs,
        transform: { x: 0.5, y: preset.y, scale: 1, rotation: 0 },
        opacity: 1,
        blendMode: "normal",
        animation: { in: preset.anim, out: null, loop: null },
        keyframes: [],
      });
    });
    if (items.length)
      d.tracks.push({
        id: uid(),
        kind: "caption",
        muted: false,
        hidden: false,
        locked: false,
        items,
        style: structuredClone(style ?? preset.style),
        preset: preset.id,
      });
  });
}

// All caption words back on the timeline, in order (to regroup them).
export function captionWords(doc: TimelineDoc): SpeechWord[] {
  const t = captionTrack(doc);
  if (!t) return [];
  const out: SpeechWord[] = [];
  for (const c of t.items) {
    if (c.type !== "caption") continue;
    const ws = c.words.length ? c.words : spreadWords(c.text, c.durationUs);
    for (const w of ws) out.push({ start: (c.startUs + w.startUs) / 1e6, end: (c.startUs + w.endUs) / 1e6, word: w.word });
  }
  return out;
}

// Same words, another template.
export function applyCaptionPreset(doc: TimelineDoc, presetId: string): TimelineDoc {
  return setCaptions(doc, captionWords(doc), presetId);
}

// Words spread over a caption by their length (for typed or edited text).
function spreadWords(text: string, durationUs: Us): CaptionClip["words"] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const total = words.reduce((n, w) => n + w.length + 1, 0) || 1;
  let t = 0;
  return words.map((word) => {
    const d = (durationUs * (word.length + 1)) / total;
    const w = { startUs: Math.round(t), endUs: Math.round(t + d), word };
    t += d;
    return w;
  });
}

export function setCaptionStyle(doc: TimelineDoc, style: TextStyle): TimelineDoc {
  return edit(doc, (d) => {
    const t = captionTrack(d);
    if (t) t.style = structuredClone(style);
  });
}

// Captions move together: one position for all of them.
export function setCaptionTransform(doc: TimelineDoc, transform: Transform): TimelineDoc {
  return edit(doc, (d) => {
    const t = captionTrack(d);
    if (t) for (const c of t.items) c.transform = { ...transform };
  });
}

export function setCaptionText(doc: TimelineDoc, id: Id, text: string): TimelineDoc {
  return edit(doc, (d) => {
    const hit = findItem(d, id);
    if (hit?.clip.type !== "caption") return;
    hit.clip.text = text;
    // the words changed: share the caption's time out again
    hit.clip.words = spreadWords(text, hit.clip.durationUs);
  });
}

export function removeCaptions(doc: TimelineDoc): TimelineDoc {
  return edit(doc, (d) => {
    d.tracks = d.tracks.filter((t) => t.kind !== "caption");
  });
}
