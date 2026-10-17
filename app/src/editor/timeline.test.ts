import { describe, expect, it } from "vitest";
import type { AssetRow } from "../data/db";
import { validateDoc } from "../data/db";
import {
  clipAt,
  durationOf,
  duplicate,
  emptyDoc,
  frameSize,
  insertMedia,
  mainClips,
  move,
  remove,
  setClip,
  split,
  trim,
} from "./timeline";

function asset(id: string, durationUs: number, kind: AssetRow["kind"] = "video"): AssetRow {
  return {
    id, projectId: "p", kind, opfsPath: `p/${id}`, name: id, mime: "video/mp4", sizeBytes: 1,
    durationUs, width: 1080, height: 1920, fps: 30, rotation: 0, hasAudio: true, codec: null,
    status: "ready", error: null, createdAt: 0, updatedAt: 0,
  };
}

const A = asset("a", 4_000_000);
const B = asset("b", 6_000_000);
const IMG = asset("i", 0, "image");
const assets = new Map([A, B, IMG].map((x) => [x.id, x]));

function base() {
  return insertMedia(emptyDoc(), [A, B], 0).doc;
}

describe("timeline", () => {
  it("lays clips end to end", () => {
    const d = base();
    expect(mainClips(d).map((c) => [c.startUs, c.durationUs])).toEqual([[0, 4_000_000], [4_000_000, 6_000_000]]);
    expect(durationOf(d)).toBe(10_000_000);
    expect(validateDoc(d, assets)).toEqual([]);
  });

  it("images get a default length", () => {
    const d = insertMedia(emptyDoc(), [IMG], 0).doc;
    expect(durationOf(d)).toBe(3_000_000);
  });

  it("inserts at the nearest boundary", () => {
    const d = insertMedia(base(), [IMG], 1_000_000).doc; // inside A, before its middle
    expect(mainClips(d).map((c) => c.assetId)).toEqual(["i", "a", "b"]);
    const e = insertMedia(base(), [IMG], 3_000_000).doc; // past A's middle
    expect(mainClips(e).map((c) => c.assetId)).toEqual(["a", "i", "b"]);
  });

  it("splits and keeps the source continuous", () => {
    const d = base();
    const [a] = mainClips(d);
    const r = split(d, a.id, 1_500_000)!;
    const [l, rr, b] = mainClips(r.doc);
    expect([l.inUs, l.outUs, rr.inUs, rr.outUs]).toEqual([0, 1_500_000, 1_500_000, 4_000_000]);
    expect(b.startUs).toBe(4_000_000);
    expect(validateDoc(r.doc, assets)).toEqual([]);
  });

  it("refuses a split too close to an edge", () => {
    const d = base();
    expect(split(d, mainClips(d)[0].id, 50_000)).toBeNull();
  });

  it("split respects speed", () => {
    let d = base();
    d = setClip(d, mainClips(d)[0].id, { speed: 2 }); // 4 s of media plays in 2 s
    expect(mainClips(d)[0].durationUs).toBe(2_000_000);
    const r = split(d, mainClips(d)[0].id, 1_000_000)!;
    expect(mainClips(r.doc)[0].outUs).toBe(2_000_000);
  });

  it("trims and ripples, clamped to the media", () => {
    const d = base();
    const a = mainClips(d)[0];
    const t1 = trim(d, a.id, "start", 1_000_000, A.durationUs);
    expect(mainClips(t1)[0].inUs).toBe(1_000_000);
    expect(mainClips(t1)[1].startUs).toBe(3_000_000);
    const t2 = trim(d, a.id, "end", 9_000_000, A.durationUs);
    expect(mainClips(t2)[0].outUs).toBe(4_000_000);
    const t3 = trim(d, a.id, "start", 99_000_000, A.durationUs);
    expect(mainClips(t3)[0].durationUs).toBe(100_000);
  });

  it("removes, duplicates and moves", () => {
    const d = base();
    const [a, b] = mainClips(d);
    expect(mainClips(remove(d, a.id)).map((c) => c.startUs)).toEqual([0]);
    expect(durationOf(duplicate(d, a.id).doc)).toBe(14_000_000);
    expect(mainClips(move(d, b.id, 0)).map((c) => c.assetId)).toEqual(["b", "a"]);
  });

  it("finds the clip under a time", () => {
    const d = base();
    expect(clipAt(d, 4_500_000)?.clip.assetId).toBe("b");
    expect(clipAt(d, 4_500_000)?.offsetUs).toBe(500_000);
    expect(clipAt(d, 99_000_000)?.clip.assetId).toBe("b");
    expect(clipAt(emptyDoc(), 0)).toBeNull();
  });

  it("does not mutate its input", () => {
    const d = base();
    const before = JSON.stringify(d);
    split(d, mainClips(d)[0].id, 1_000_000);
    trim(d, mainClips(d)[0].id, "start", 500_000, A.durationUs);
    expect(JSON.stringify(d)).toBe(before);
  });

  it("frame size follows the aspect ratio, even pixels", () => {
    const d = base();
    expect(frameSize(d, assets, 1080)).toEqual({ width: 1080, height: 1920 });
    d.canvas.aspectRatio = "16:9";
    expect(frameSize(d, assets, 1080)).toEqual({ width: 1920, height: 1080 });
    d.canvas.aspectRatio = "4:5";
    expect(frameSize(d, assets, 720)).toEqual({ width: 720, height: 900 });
  });
});
