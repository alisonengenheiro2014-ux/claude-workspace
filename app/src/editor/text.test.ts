import { describe, expect, it } from "vitest";
import type { AssetRow, TextClip } from "../data/db";
import { validateDoc } from "../data/db";
import { addText, duplicate, emptyDoc, findItem, insertMedia, moveItem, remove, setText, textTracks, trimItem } from "./timeline";

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
