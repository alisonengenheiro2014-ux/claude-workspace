import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captionSignature, checkpointPercent, clearCaptionCheckpoint, inspectCaptionCheckpoint,
  projectHasCaptionCheckpoint, saveCaptionCheckpoint,
} from "./checkpoint";
import type { CaptionRun } from "./checkpoint";

const sample = (lang = "portuguese"): CaptionRun => ({
  projectId: "p-1", language: lang, source: "all", model: "base",
  doc: { version: 1, canvas: { aspectRatio: "16:9", width: 1920, height: 1080, background: { type: "color", color: "black" } }, tracks: [], transitions: [] },
  assets: new Map(),
});
let data: Map<string, string>;
beforeEach(() => {
  data = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Whisper checkpoints on iPhone", () => {
  it("changes signature when language, source, model, doc or media changes", () => {
    const run = sample();
    expect(captionSignature(run)).not.toBe(captionSignature(sample("english")));
    expect(captionSignature(run)).not.toBe(captionSignature({ ...run, model: "tiny" }));
    expect(captionSignature(run)).not.toBe(captionSignature({ ...run, source: "video" }));
    expect(captionSignature(run)).not.toBe(captionSignature({
      ...run, doc: { ...run.doc, transitions: [{ id: "t", type: "fade", fromClipId: "a", toClipId: "b", durationUs: 1000 }] },
    }));
    const newMedia = sample();
    newMedia.assets.set("asset", { id: "asset", opfsPath: "media/a", sizeBytes: 1234, updatedAt: 1, durationUs: 1000 } as never);
    expect(captionSignature(run)).not.toBe(captionSignature(newMedia));
  });
  it("persists complete windows, restores words and safely ignores different edits", () => {
    const run = sample();
    const words = [{ start: 1.0, end: 2.0, text: "Meu Civic" }];
    expect(saveCaptionCheckpoint(run, 3, 12, words)).toBe(true);
    expect(projectHasCaptionCheckpoint(run.projectId)).toBe(true);
    const saved = inspectCaptionCheckpoint(run);
    expect(saved).toMatchObject({ nextWindow: 3, totalWindows: 12, segments: words });
    expect(checkpointPercent(saved)).toBe(25);
    expect(inspectCaptionCheckpoint(sample("english"))).toBeNull();
    clearCaptionCheckpoint(run.projectId);
    expect(projectHasCaptionCheckpoint(run.projectId)).toBe(false);
    expect(inspectCaptionCheckpoint(run)).toBeNull();
  });
  it("rejects incomplete or invalid progress and invalid saved JSON", () => {
    const run = sample();
    expect(saveCaptionCheckpoint(run, 0, 12, [])).toBe(false);
    expect(saveCaptionCheckpoint(run, 13, 12, [])).toBe(false);
    data.set("garagem:caption:checkpoint:v1:p-1", "{invalid");
    expect(inspectCaptionCheckpoint(run)).toBeNull();
    expect(checkpointPercent(null)).toBe(0);
  });
});
