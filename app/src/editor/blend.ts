// Blend modes for overlays (S12 Mistura): CSS mix-blend-mode in the preview,
// the same mode as the canvas composite operation in the export.
import type { ClipBase } from "../data/db";

type Mode = ClipBase["blendMode"];
export const BLENDS: { id: Mode; label: string; css: string; canvas: GlobalCompositeOperation }[] = [
  { id: "normal", label: "Normal", css: "normal", canvas: "source-over" },
  { id: "multiply", label: "Multiplicar", css: "multiply", canvas: "multiply" },
  { id: "screen", label: "Tela", css: "screen", canvas: "screen" },
  { id: "overlay", label: "Sobrepor", css: "overlay", canvas: "overlay" },
  { id: "darken", label: "Escurecer", css: "darken", canvas: "darken" },
  { id: "lighten", label: "Clarear", css: "lighten", canvas: "lighten" },
  { id: "add", label: "Adicionar", css: "plus-lighter", canvas: "lighter" },
];

export const blendOf = (m: Mode) => BLENDS.find((b) => b.id === m) ?? BLENDS[0];
