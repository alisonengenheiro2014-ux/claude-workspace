// Tela dividida: ready layouts that put the main video and the layers at the
// playhead side by side. Each picture is cropped to its cell's shape (the
// middle part; Recortar moves it) and scaled to fill the cell, using the
// same crop and transform the editor already shows and exports.
import type { AssetRow, MediaClip } from "../data/db";
import { cropFor } from "../screens/CropSheet";
import { containRect, shapedSize, shapeOf } from "./frame";
import { displaySize } from "./overlay";

// a part of the frame, 0..1
export interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const LAYOUTS: { id: string; label: string; cells: Cell[] }[] = [
  { id: "2v", label: "2 em pé", cells: [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }] },
  { id: "2h", label: "2 lado a lado", cells: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }] },
  {
    id: "3v",
    label: "3 em pé",
    cells: [
      { x: 0, y: 0, w: 1, h: 1 / 3 },
      { x: 0, y: 1 / 3, w: 1, h: 1 / 3 },
      { x: 0, y: 2 / 3, w: 1, h: 1 / 3 },
    ],
  },
  {
    id: "1+2",
    label: "1 grande e 2",
    cells: [
      { x: 0, y: 0, w: 1, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
  {
    id: "2+1",
    label: "2 e 1 grande",
    cells: [
      { x: 0, y: 0.5, w: 1, h: 0.5 },
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
    ],
  },
  {
    id: "4",
    label: "4 quadros",
    cells: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
  {
    id: "6",
    label: "6 quadros",
    cells: Array.from({ length: 6 }, (_, i) => ({ x: (i % 2) / 2, y: Math.floor(i / 2) / 3, w: 0.5, h: 1 / 3 })),
  },
];

// The main video in a cell: cropped to the cell's shape (turned clips crop
// the other way), then zoomed and moved so its picture fills the cell.
export function mainInCell(asset: AssetRow | undefined, clip: MediaClip, W: number, H: number, cell: Cell): Partial<MediaClip> {
  const { w: sw, h: sh } = displaySize(asset);
  const shape = shapeOf(clip);
  const r = (cell.w * W) / (cell.h * H);
  const crop = cropFor(shape.rotation % 180 ? 1 / r : r, 1, 0.5, 0.5, sw, sh);
  const size = shapedSize(sw, sh, { ...shape, crop });
  const shown = containRect(size.w, size.h, W, H);
  return {
    crop,
    transform: { x: cell.x + cell.w / 2, y: cell.y + cell.h / 2, scale: (cell.w * W) / shown.w, rotation: clip.transform.rotation },
  };
}

// A layer in a cell: the same, for overlayBox's fit-inside-the-frame size.
export function layerInCell(asset: AssetRow | undefined, W: number, H: number, cell: Cell): Partial<MediaClip> {
  const { w: sw, h: sh } = displaySize(asset);
  const crop = cropFor((cell.w * W) / (cell.h * H), 1, 0.5, 0.5, sw, sh);
  const aw = sw * (crop?.w ?? 1);
  const ah = sh * (crop?.h ?? 1);
  const fit = Math.min(W / aw, H / ah);
  return { crop, flip: false, transform: { x: cell.x + cell.w / 2, y: cell.y + cell.h / 2, scale: (cell.w * W) / (aw * fit), rotation: 0 } };
}
