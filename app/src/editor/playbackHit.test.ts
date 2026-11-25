import { describe, expect, it } from "vitest";
import type { TextBox } from "./text";
import { editableOverlayAt } from "./playbackHit";

const box = (cx: number, cy: number): TextBox => ({ cx, cy, w: 120, h: 40, rotation: 0 });

describe("editing a visible caption while the preview is playing", () => {
  const boxes = new Map([["main", box(50, 50)], ["caption-1", box(50, 50)], ["caption-2", box(250, 50)]]);
  const editable = (id: string) => id.startsWith("caption");
  it("chooses the caption over a main video that fills the image", () => {
    expect(editableOverlayAt(boxes, 50, 50, 1, editable)).toBe("caption-1");
  });
  it("selects the correct active caption under the fingertip", () => {
    expect(editableOverlayAt(boxes, 250, 50, 1, editable)).toBe("caption-2");
  });
  it("ignores touches outside captions or over only the main video", () => {
    expect(editableOverlayAt(boxes, 400, 250, 1, editable)).toBeNull();
    expect(editableOverlayAt(new Map([["main", box(50, 50)]]), 50, 50, 1, editable)).toBeNull();
  });
});
