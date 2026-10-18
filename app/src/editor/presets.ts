// Caption templates and text style presets. A caption template decides how
// words are grouped, the look, a highlight for the word being spoken, the
// entrance animation and where on the frame captions sit.
import type { AnimRef, TextStyle } from "../data/db";

export type CaptionGrouping = "word" | "phrase" | "lines";

// How the word being spoken stands out: its own colour, a box behind it,
// a bigger size, or a mix.
export interface WordHighlight {
  color?: string;
  box?: { color: string; radius: number; padding: number; border?: string };
  scale?: number;
}

export interface CaptionPreset {
  id: string;
  label: string;
  group: CaptionGrouping;
  maxWords: number; // for "phrase"
  style: TextStyle;
  highlight: WordHighlight | null;
  reveal?: boolean; // words appear one by one as they are spoken
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

const pop: AnimRef = { id: "pop", durationUs: 160_000 };
const soft = { color: "rgba(0,0,0,0.6)", blur: 10, x: 0, y: 3 };
const drop = { color: "rgba(0,0,0,0.85)", blur: 6, x: 4, y: 6 };
const heavy = { color: "rgba(0,0,0,0.9)", blur: 18, x: 0, y: 8 };
const caps = (s: Partial<TextStyle>): TextStyle => ({ ...base, uppercase: true, ...s });

// Order is the order of the grid. Ids are stored in projects: never rename one.
export const CAPTION_PRESETS: CaptionPreset[] = [
  {
    id: "classic",
    label: "Padrão",
    group: "lines",
    maxWords: 12,
    style: { ...base, size: 52, stroke: { color: "#000000", width: 10 } },
    highlight: null,
    anim: null,
    y: 0.78,
  },
  { id: "word-pop", label: "Palavra por palavra", group: "word", maxWords: 1, style: caps({ size: 66, shadow: drop }), highlight: null, anim: pop, y: 0.5 },
  {
    id: "purple-box",
    label: "Caixa roxa",
    group: "phrase",
    maxWords: 4,
    style: caps({ font: "bebas", size: 84, shadow: soft }),
    highlight: { box: { color: "#7c3aed", radius: 10, padding: 8 } },
    anim: null,
    y: 0.62,
  },
  { id: "word-shadow", label: "Sombra forte", group: "word", maxWords: 1, style: caps({ size: 76, shadow: heavy }), highlight: null, anim: pop, y: 0.55 },
  {
    id: "cyan-duo",
    label: "Ciano",
    group: "phrase",
    maxWords: 2,
    style: caps({ font: "anton", size: 92, stroke: { color: "#000000", width: 12 }, shadow: { color: "#000000", blur: 0, x: 0, y: 6 } }),
    highlight: { color: "#00e5ff" },
    anim: pop,
    y: 0.6,
  },
  {
    id: "yellow-duo",
    label: "Amarelo",
    group: "phrase",
    maxWords: 2,
    style: caps({ size: 78, stroke: { color: "#000000", width: 14 } }),
    highlight: { color: "#ffe600" },
    anim: pop,
    y: 0.6,
  },
  {
    id: "pink-box",
    label: "Caixa rosa",
    group: "phrase",
    maxWords: 4,
    style: caps({ size: 52, shadow: soft }),
    highlight: { box: { color: "#d946ef", radius: 8, padding: 8 } },
    anim: null,
    y: 0.62,
  },
  {
    id: "blue-box",
    label: "Caixa azul",
    group: "phrase",
    maxWords: 4,
    style: caps({ size: 52, shadow: soft }),
    highlight: { box: { color: "#1d4ed8", radius: 8, padding: 8, border: "#22d3ee" } },
    anim: null,
    y: 0.62,
  },
  { id: "clean-caps", label: "Maiúsculas", group: "lines", maxWords: 12, style: caps({ size: 52, shadow: soft }), highlight: null, anim: null, y: 0.75 },
  { id: "clean", label: "Simples", group: "lines", maxWords: 12, style: { ...base, size: 54, shadow: soft }, highlight: null, anim: null, y: 0.75 },
  {
    id: "typewriter",
    label: "Digitando",
    group: "phrase",
    maxWords: 4,
    style: caps({ size: 56, italic: true, shadow: drop }),
    highlight: null,
    anim: { id: "typewriter", durationUs: 500_000 },
    y: 0.62,
  },
  { id: "condensed", label: "Estreita", group: "lines", maxWords: 12, style: caps({ font: "oswald", size: 62, shadow: soft }), highlight: null, anim: null, y: 0.72 },
  {
    id: "orange-duo",
    label: "Laranja",
    group: "phrase",
    maxWords: 2,
    style: caps({ font: "anton", size: 96, shadow: { color: "rgba(0,0,0,0.85)", blur: 12, x: 0, y: 6 } }),
    highlight: { color: "#ffb300" },
    anim: pop,
    y: 0.6,
  },
  {
    id: "yellow-grow",
    label: "Cresce amarelo",
    group: "phrase",
    maxWords: 4,
    style: { ...base, font: "bebas", size: 88, shadow: drop },
    highlight: { color: "#ffd400", scale: 1.35 },
    anim: null,
    y: 0.62,
  },
  { id: "rounded", label: "Redonda", group: "phrase", maxWords: 4, style: caps({ font: "poppins", size: 56, shadow: drop }), highlight: null, anim: pop, y: 0.62 },
  {
    id: "cartoon",
    label: "Desenho",
    group: "word",
    maxWords: 1,
    style: caps({ font: "luckiest", size: 88, stroke: { color: "#1a1a1a", width: 12 }, shadow: heavy }),
    highlight: null,
    anim: pop,
    y: 0.55,
  },
  { id: "serif", label: "Elegante", group: "lines", maxWords: 12, style: { ...base, font: "dmserif", size: 64, shadow: soft }, highlight: null, anim: null, y: 0.72 },
  { id: "bubble", label: "Bolha", group: "word", maxWords: 1, style: caps({ font: "lilita", size: 92, shadow: heavy }), highlight: null, anim: pop, y: 0.55 },
  {
    id: "reveal",
    label: "Revelar",
    group: "phrase",
    maxWords: 5,
    style: caps({ size: 56, shadow: drop }),
    highlight: null,
    reveal: true,
    anim: null,
    y: 0.62,
  },
  {
    id: "highlight-yellow",
    label: "Destaque amarelo",
    group: "phrase",
    maxWords: 3,
    style: caps({ size: 62, stroke: { color: "#000000", width: 12 } }),
    highlight: { color: "#ffd400" },
    anim: pop,
    y: 0.62,
  },
  {
    id: "green-karaoke",
    label: "Karaokê verde",
    group: "phrase",
    maxWords: 3,
    style: caps({ font: "poppins", size: 60, stroke: { color: "#000000", width: 10 } }),
    highlight: { color: "#39ff14", scale: 1.12 },
    anim: null,
    y: 0.62,
  },
  {
    id: "red-box",
    label: "Caixa vermelha",
    group: "phrase",
    maxWords: 3,
    style: caps({ font: "anton", size: 72, shadow: soft }),
    highlight: { box: { color: "#ef4444", radius: 6, padding: 10 } },
    anim: pop,
    y: 0.62,
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
    id: "white-box",
    label: "Caixa branca",
    group: "phrase",
    maxWords: 4,
    style: { ...base, font: "poppins", size: 50, color: "#111111", background: { color: "#ffffff", radius: 16, padding: 18 } },
    highlight: { color: "#7c3aed" },
    anim: pop,
    y: 0.7,
  },
  {
    id: "neon",
    label: "Neon",
    group: "phrase",
    maxWords: 3,
    style: caps({ size: 64, color: "#ffe14d", glow: { color: "#ff6a00", blur: 28 } }),
    highlight: null,
    anim: pop,
    y: 0.55,
  },
  {
    id: "neon-pink",
    label: "Neon rosa",
    group: "word",
    maxWords: 1,
    style: caps({ font: "lilita", size: 84, color: "#ffe6fb", glow: { color: "#ff2d92", blur: 30 } }),
    highlight: null,
    anim: pop,
    y: 0.55,
  },
  {
    id: "impact",
    label: "Impacto",
    group: "phrase",
    maxWords: 2,
    style: caps({ font: "bebas", size: 104, color: "#ffd400", shadow: { color: "rgba(0,0,0,0.9)", blur: 0, x: 5, y: 6 } }),
    highlight: { color: "#ffffff" },
    anim: pop,
    y: 0.6,
  },
];

export const DEFAULT_CAPTION_PRESET = "word-pop";

export function captionPreset(id: string | undefined) {
  return CAPTION_PRESETS.find((p) => p.id === id) ?? CAPTION_PRESETS.find((p) => p.id === DEFAULT_CAPTION_PRESET)!;
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
