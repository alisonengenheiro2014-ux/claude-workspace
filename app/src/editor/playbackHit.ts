// Hit-testing active text/captions while a video is playing.
// A full-frame main media box must never hide editable captions on top.
import type { Id } from "../data/db";
import { hitBox, type TextBox } from "./text";

export function editableOverlayAt(
  boxes: ReadonlyMap<Id, TextBox>,
  x: number,
  y: number,
  scale: number,
  editable: (id: Id) => boolean,
): Id | null {
  const entries = Array.from(boxes.entries());
  for (let i = entries.length - 1; i >= 0; i--) {
    const [id, box] = entries[i];
    if (editable(id) && hitBox(box, x, y, 8 * scale)) return id;
  }
  return null;
}
