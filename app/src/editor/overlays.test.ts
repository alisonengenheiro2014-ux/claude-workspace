import { describe, expect, it } from "vitest";
import type { AssetRow, CaptionClip, MediaClip, TextClip } from "../data/db";
import { validateDoc } from "../data/db";
import {
  addAudio,
  addText,
  audioTracks,
  duplicate,
  emptyDoc,
  findItem,
  gainAt,
  insertMedia,
  move,
  moveItem,
  remove,
  applyCaptionPreset,
  captionWords,
  groupWords,
  setCaptionText,
  setCaptions,
  setCaptionStyle,
  setCaptionTransform,
  setText,
  setTransition,
  setTransitionAll,
  split,
  splitCaption,
  splitItem,
  textTracks,
  transitionAt,
  transitionWindows,
  trimItem,
} from "./timeline";
import { CAPTION_STYLE } from "./text";
import { CAPTION_PRESETS, DEFAULT_CAPTION_PRESET, captionPreset } from "./presets";

const A: AssetRow = {
  id: "a", projectId: "p", kind: "video", opfsPath: "p/a", name: "a", mime: "video/mp4", sizeBytes: 1,
  durationUs: 10_000_000, width: 1080, height: 1920, fps: 30, rotation: 0, hasAudio: true, codec: null,
  status: "ready", error: null, createdAt: 0, updatedAt: 0,
};
const assets = new Map([[A.id, A]]);
const base = () => insertMedia(emptyDoc(), [A], 0).doc; // 10 s of video

describe("text items", () => {
  it("adds at the playhead with the default length", () => {
    const { doc, id } = addText(base(), 2_000_000, "Oi");
    const c = findItem(doc, id)!.clip as TextClip;
    expect([c.startUs, c.durationUs, c.text]).toEqual([2_000_000, 3_000_000, "Oi"]);
    expect(textTracks(doc)).toHaveLength(1);
    expect(validateDoc(doc, assets)).toEqual([]);
  });

  it("keeps a text added near the end inside the video", () => {
    const { doc, id } = addText(base(), 9_500_000, "fim");
    const c = findItem(doc, id)!.clip;
    expect(c.startUs + c.durationUs).toBe(10_000_000);
  });

  it("stacks overlapping texts in new lanes and reuses free ones", () => {
    let d = addText(base(), 0, "1").doc;
    d = addText(d, 1_000_000, "2").doc; // overlaps 1 -> lane 2
    expect(textTracks(d)).toHaveLength(2);
    d = addText(d, 5_000_000, "3").doc; // free in lane 1
    expect(textTracks(d)).toHaveLength(2);
    expect(textTracks(d)[0].items.map((c) => (c as TextClip).text)).toEqual(["1", "3"]);
    expect(validateDoc(d, assets)).toEqual([]);
  });

  it("moving onto another text hops to a free lane", () => {
    let d = addText(base(), 0, "1").doc;
    const r = addText(d, 5_000_000, "2");
    d = moveItem(r.doc, r.id, 1_000_000);
    expect(textTracks(d)).toHaveLength(2);
    expect(findItem(d, r.id)!.clip.startUs).toBe(1_000_000);
    expect(validateDoc(d, assets)).toEqual([]);
  });

  it("move is clamped to the video", () => {
    const r = addText(base(), 0, "x");
    expect(findItem(moveItem(r.doc, r.id, 99_000_000), r.id)!.clip.startUs).toBe(7_000_000);
    expect(findItem(moveItem(r.doc, r.id, -5), r.id)!.clip.startUs).toBe(0);
  });

  it("trim stops at neighbours and at the end", () => {
    let d = addText(base(), 0, "1").doc; // 0-3 s
    const r = addText(d, 4_000_000, "2"); // 4-7 s, same lane
    d = r.doc;
    const t1 = trimItem(d, r.id, "start", -3_000_000);
    expect(findItem(t1, r.id)!.clip.startUs).toBe(3_000_000);
    const t2 = trimItem(d, r.id, "end", 9_000_000);
    expect(findItem(t2, r.id)!.clip.durationUs).toBe(6_000_000);
    const t3 = trimItem(d, r.id, "end", -9_000_000);
    expect(findItem(t3, r.id)!.clip.durationUs).toBe(100_000);
  });

  it("removing the last text drops its lane; duplicate goes after", () => {
    const r = addText(base(), 0, "x");
    expect(textTracks(remove(r.doc, r.id))).toHaveLength(0);
    const dup = duplicate(r.doc, r.id);
    expect(findItem(dup.doc, dup.id)!.clip.startUs).toBe(3_000_000);
    expect(validateDoc(dup.doc, assets)).toEqual([]);
  });

  it("setText patches only that item", () => {
    const r = addText(base(), 0, "x");
    const d = setText(r.doc, r.id, { text: "novo" });
    expect((findItem(d, r.id)!.clip as TextClip).text).toBe("novo");
    expect((findItem(r.doc, r.id)!.clip as TextClip).text).toBe("x");
  });
});

const SONG: AssetRow = { ...A, id: "s", kind: "audio", durationUs: 30_000_000, width: 0, height: 0 };

describe("audio items", () => {
  it("a song added at 0 ends with the video", () => {
    const r = addAudio(base(), SONG, 0);
    const c = findItem(r.doc, r.id)!.clip as MediaClip;
    expect([c.startUs, c.inUs, c.outUs, c.durationUs]).toEqual([0, 0, 10_000_000, 10_000_000]);
    expect(audioTracks(r.doc)).toHaveLength(1);
    expect(validateDoc(r.doc, new Map([[A.id, A], [SONG.id, SONG]]))).toEqual([]);
  });

  it("trimming the start moves the in point; the end stops at the media", () => {
    const r = addAudio(base(), SONG, 2_000_000); // 2-10 s, song 0-8 s
    const t1 = trimItem(r.doc, r.id, "start", 1_000_000, SONG.durationUs);
    const c1 = findItem(t1, r.id)!.clip as MediaClip;
    expect([c1.startUs, c1.inUs, c1.durationUs]).toEqual([3_000_000, 1_000_000, 7_000_000]);
    const t2 = trimItem(r.doc, r.id, "start", -9_000_000, SONG.durationUs); // can't go before the song's start
    expect((findItem(t2, r.id)!.clip as MediaClip).inUs).toBe(0);
    expect(findItem(t2, r.id)!.clip.startUs).toBe(2_000_000);
  });

  it("splits into two parts in the same lane", () => {
    const r = addAudio(base(), SONG, 0);
    const s = splitItem(r.doc, r.id, 4_000_000)!;
    const [l, rr] = audioTracks(s.doc)[0].items as MediaClip[];
    expect([l.inUs, l.outUs, rr.startUs, rr.inUs, rr.outUs]).toEqual([0, 4_000_000, 4_000_000, 4_000_000, 10_000_000]);
  });

  it("fades shape the volume", () => {
    const clip = { volume: 0.8, fadeInUs: 1_000_000, fadeOutUs: 2_000_000, durationUs: 10_000_000 } as MediaClip;
    expect(gainAt(clip, 0)).toBe(0);
    expect(gainAt(clip, 500_000)).toBeCloseTo(0.4);
    expect(gainAt(clip, 5_000_000)).toBeCloseTo(0.8);
    expect(gainAt(clip, 9_000_000)).toBeCloseTo(0.4);
  });
});

describe("transitions", () => {
  const two = () => insertMedia(emptyDoc(), [A, { ...A, id: "b" }], 0).doc; // 10 s + 10 s
  const assets2 = new Map([[A.id, A], ["b", { ...A, id: "b" }]]);

  it("sets, clamps and removes a transition at a cut", () => {
    const d = two();
    const first = d.tracks[0].items[0].id;
    const t = setTransition(d, first, "dissolve", 1_000_000);
    expect(t.transitions).toHaveLength(1);
    expect(transitionWindows(t)[0]).toMatchObject({ cutUs: 10_000_000, startUs: 9_500_000, endUs: 10_500_000 });
    expect(transitionAt(t, 10_000_000)?.p).toBeCloseTo(0.5);
    expect(transitionAt(t, 8_000_000)).toBeNull();
    expect(validateDoc(t, assets2)).toEqual([]);
    expect(setTransition(t, first, "dissolve", 60_000_000).transitions[0].durationUs).toBe(5_000_000);
    expect(setTransition(t, first, null, 0).transitions).toHaveLength(0);
  });

  it("the last clip has no cut after it", () => {
    const d = two();
    expect(setTransition(d, d.tracks[0].items[1].id, "dissolve", 500_000).transitions).toHaveLength(0);
  });

  it("apply to all, and a split keeps the transition on the right part", () => {
    const d = insertMedia(emptyDoc(), [A, { ...A, id: "b" }, { ...A, id: "c" }], 0).doc;
    const all = setTransitionAll(d, "zoom", 500_000);
    expect(all.transitions).toHaveLength(2);
    const firstId = all.tracks[0].items[0].id;
    const r = split(all, firstId, 4_000_000)!;
    expect(r.doc.transitions.find((t) => t.toClipId === all.tracks[0].items[1].id)?.fromClipId).toBe(r.rightId);
  });

  it("moving a clip drops transitions whose clips are no longer neighbours", () => {
    const b = two();
    const firstId = b.tracks[0].items[0].id;
    const d = setTransition(b, firstId, "dissolve", 500_000);
    expect(d.transitions).toHaveLength(1);
    expect(move(d, firstId, 1).transitions).toHaveLength(0);
  });
});

describe("captions", () => {
  const w = (start: number, end: number, word: string) => ({ start, end, word });
  const words = [w(0.5, 0.8, "Oi"), w(0.85, 1.2, "gente,"), w(1.3, 1.6, "hoje"), w(1.65, 1.9, "vamos"), w(1.95, 2.3, "falar"), w(3.5, 3.8, "do"), w(3.85, 4.3, "carro.")];

  it("splits text into captions of two short lines", () => {
    expect(splitCaption("um dois três")).toEqual(["um dois três"]);
    const parts = splitCaption("Olá pessoal, hoje vamos testar as legendas automáticas no celular e ver se funciona bem");
    expect(parts.every((p) => p.split("\n").length <= 2 && p.split("\n").every((l) => l.length <= 32))).toBe(true);
  });

  it("groups words by template: one word, short phrases, or lines", () => {
    expect(groupWords(words, "word", 1)).toHaveLength(7);
    // phrases of up to 3 words, closing at the comma and at the 1.2 s pause
    expect(groupWords(words, "phrase", 3).map((g) => g.map((x) => x.word).join(" "))).toEqual(["Oi gente,", "hoje vamos falar", "do carro."]);
    expect(groupWords(words, "lines", 12).map((g) => g.map((x) => x.word).join(" "))).toEqual(["Oi gente, hoje vamos falar", "do carro."]);
  });

  it("one caption per word, words kept relative to their caption", () => {
    const d = setCaptions(base(), words, "word-pop");
    const lane = d.tracks.find((x) => x.kind === "caption")!;
    expect(lane.items).toHaveLength(7);
    expect(lane.preset).toBe("word-pop");
    const first = lane.items[0] as CaptionClip;
    expect(first.startUs).toBe(500_000);
    expect(first.words[0]).toEqual({ startUs: 0, endUs: 300_000, word: "Oi" });
    expect(validateDoc(d, assets)).toEqual([]);
  });

  it("switching template regroups the same words", () => {
    const d = setCaptions(base(), words, "word-pop");
    const r = applyCaptionPreset(d, "highlight-yellow");
    const lane = r.tracks.find((x) => x.kind === "caption")!;
    expect(lane.items.map((c) => (c as CaptionClip).text)).toEqual(["Oi gente,", "hoje vamos falar", "do carro."]);
    expect(captionWords(r).map((x) => x.word)).toEqual(words.map((x) => x.word));
    expect(lane.style?.uppercase).toBe(true);
  });

  it("style and position apply to every caption; a caption moves within its lane", () => {
    let d = setCaptions(base(), [w(0, 2, "a"), w(4, 6, "b")], "classic");
    d = setCaptionStyle(d, { ...CAPTION_STYLE, color: "#ffd400" });
    d = setCaptionTransform(d, { x: 0.5, y: 0.3, scale: 1, rotation: 0 });
    const lane = d.tracks.find((x) => x.kind === "caption")!;
    expect(lane.style?.color).toBe("#ffd400");
    expect(lane.items.every((c) => c.transform.y === 0.3)).toBe(true);
    const moved = moveItem(d, lane.items[1].id, 0); // would overlap "a"
    const l2 = moved.tracks.filter((x) => x.kind === "caption");
    expect(l2).toHaveLength(1);
    expect(l2[0].items.find((c) => c.id === lane.items[1].id)!.startUs).toBe(2_000_000);
  });

  it("editing a caption's text retimes its words", () => {
    const d = setCaptions(base(), words, "highlight-yellow");
    const c = d.tracks.find((x) => x.kind === "caption")!.items[1] as CaptionClip;
    const e = setCaptionText(d, c.id, "hoje vou falar demais");
    const after = findItem(e, c.id)!.clip as CaptionClip;
    expect(after.words.map((x) => x.word)).toEqual(["hoje", "vou", "falar", "demais"]);
    expect(after.words[after.words.length - 1].endUs).toBeLessThanOrEqual(after.durationUs);
  });
});

describe("caption templates", () => {
  it("have unique ids and fall back to the default", () => {
    const ids = CAPTION_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(20);
    expect(captionPreset("gone").id).toBe(DEFAULT_CAPTION_PRESET);
  });
});
