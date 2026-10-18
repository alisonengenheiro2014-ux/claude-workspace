// Caption templates and text style presets. A caption template decides how
// words are grouped, the look, a highlight for the word being spoken, the
// entrance animation and where on the frame captions sit.
import type { AnimRef, TextStyle } from "../data/db";

export type CaptionGrouping = "word" | "phrase" | "lines";

export interface CaptionPreset {
  id: string;
  label: string;
  group: CaptionGrouping;
  maxWords: number; // for "phrase"
  style: TextStyle;
  highlight: string | null; // colour of the word being spoken
  anim: AnimRef | null;
  y: number; // vertical position, 0..1 of the frame
}

const base: TextStyle = {
  font: "montserrat",
  size: 64,
  color: "#ffffff",
  stroke: null,
  shadow: null,
  background: null,
  align: "center",
  bold: true,
  italic: false,
  uppercase: false,
  glow: null,
};

export const CAPTION_PRESETS: CaptionPreset[] = [
  {
    id: "word-pop",
    label: "Palavra por palavra",
    group: "word",
    maxWords: 1,
    style: { ...base, size: 66, uppercase: true, shadow: { color: "rgba(0,0,0,0.85)", blur: 6, x: 4, y: 6 } },
    highlight: null,
    anim: { id: "pop", durationUs: 160_000 },
    y: 0.5,
  },
  {
    id: "highlight-yellow",
    label: "Destaque amarelo",
    group: "phrase",
    maxWords: 3,
    style: { ...base, size: 62, uppercase: true, stroke: { color: "#000000", width: 12 } },
    highlight: "#ffd400",
    anim: { id: "pop", durationUs: 160_000 },
    y: 0.62,
  },
  {
    id: "classic",
    label: "Clássica",
    group: "lines",
    maxWords: 12,
    style: { ...base, size: 52, stroke: { color: "#000000", width: 10 } },
    highlight: null,
    anim: null,
    y: 0.78,
  },
  {
    id: "box",
    label: "Caixa",
    group: "lines",
    maxWords: 12,
    style: { ...base, font: "inter", size: 48, background: { color: "#000000", radius: 14, padding: 18 } },
    highlight: null,
    anim: { id: "fade", durationUs: 120_000 },
    y: 0.78,
  },
  {
    id: "neon",
    label: "Neon",
    group: "phrase",
    maxWords: 3,
    style: { ...base, size: 64, color: "#ffe14d", uppercase: true, glow: { color: "#ff6a00", blur: 28 } },
    highlight: null,
    anim: { id: "pop", durationUs: 160_000 },
    y: 0.55,
  },
  {
    id: "impact",
    label: "Impacto",
    group: "phrase",
    maxWords: 2,
    style: { ...base, font: "bebas", size: 104, color: "#ffd400", uppercase: true, shadow: { color: "rgba(0,0,0,0.9)", blur: 0, x: 5, y: 6 } },
    highlight: "#ffffff",
    anim: { id: "pop", durationUs: 160_000 },
    y: 0.6,
  },
];

export const DEFAULT_CAPTION_PRESET = "word-pop";

export function captionPreset(id: string | undefined) {
  return CAPTION_PRESETS.find((p) => p.id === id) ?? CAPTION_PRESETS[0];
}

// Ready-made looks for ordinary text items.
export const TEXT_PRESETS: { id: string; label: string; style: TextStyle }[] = [
  { id: "plain", label: "Simples", style: { ...base, size: 72, shadow: { color: "#000000", blur: 12, x: 0, y: 4 } } },
  { id: "outline", label: "Contorno", style: { ...base, size: 72, stroke: { color: "#000000", width: 10 } } },
  { id: "drop", label: "Sombra", style: { ...base, size: 72, uppercase: true, shadow: { color: "rgba(0,0,0,0.85)", blur: 6, x: 4, y: 6 } } },
  { id: "neon", label: "Neon", style: { ...base, size: 72, color: "#ffe14d", glow: { color: "#ff6a00", blur: 30 } } },
  { id: "box", label: "Caixa", style: { ...base, font: "inter", size: 56, background: { color: "#000000", radius: 16, padding: 24 } } },
  { id: "yellow-box", label: "Faixa amarela", style: { ...base, font: "anton", size: 64, color: "#000000", uppercase: true, background: { color: "#ffd400", radius: 8, padding: 20 } } },
  { id: "impact", label: "Impacto", style: { ...base, font: "bebas", size: 120, color: "#ffd400", uppercase: true, shadow: { color: "rgba(0,0,0,0.9)", blur: 0, x: 5, y: 6 } } },
  { id: "script", label: "Assinatura", style: { ...base, font: "pacifico", size: 80, bold: false, shadow: { color: "#000000", blur: 10, x: 0, y: 3 } } },
];
