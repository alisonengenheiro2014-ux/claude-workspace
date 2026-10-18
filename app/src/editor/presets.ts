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
  wordPop?: boolean; // ... each with a little pop
  future?: string; // colour of the words not spoken yet
  wordColors?: string[]; // per word, by position in the caption
  wordScales?: number[];
  layout?: { perLine?: number; stagger?: number[]; align?: "left" | "center" | "right" };
  emoji?: string; // emoji above the caption (one matching a word, else this)
  cursor?: boolean;
  rotation?: number; // degrees
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
const fade: AnimRef = { id: "fade", durationUs: 120_000 };
const soft = { color: "rgba(0,0,0,0.6)", blur: 10, x: 0, y: 3 };
const drop = { color: "rgba(0,0,0,0.85)", blur: 6, x: 4, y: 6 };
const heavy = { color: "rgba(0,0,0,0.9)", blur: 18, x: 0, y: 8 };
const hard = { color: "#000000", blur: 0, x: 0, y: 6 };
const black = (width: number) => ({ color: "#000000", width });
const caps = (s: Partial<TextStyle>): TextStyle => ({ ...base, uppercase: true, ...s });
const sentence = (s: Partial<TextStyle>): TextStyle => ({ ...base, ...s });
const glow = (color: string, blur = 30) => ({ color, blur });

type P = Omit<CaptionPreset, "group" | "maxWords" | "anim" | "y"> & Partial<Pick<CaptionPreset, "group" | "maxWords" | "anim" | "y">>;
// phrase of a few words in the middle of the frame unless told otherwise
const t = (p: P): CaptionPreset => ({ group: "phrase", maxWords: 4, anim: null, y: 0.62, ...p });
const word = (p: Omit<P, "group" | "maxWords" | "highlight"> & { highlight?: P["highlight"] }): CaptionPreset =>
  t({ group: "word", maxWords: 1, anim: pop, y: 0.55, highlight: null, ...p });

// Order is the order of the grid: CapCut's, with the one from the user's own
// videos second. Ids are stored in
// projects: never rename one.
export const CAPTION_PRESETS: CaptionPreset[] = [
  t({ id: "classic", label: "Padrão", group: "lines", maxWords: 12, style: sentence({ size: 52, stroke: black(10) }), highlight: null, y: 0.78 }),
  word({ id: "word-pop", label: "Palavra por palavra", style: caps({ size: 66, shadow: drop }), anim: pop, y: 0.5 }),
  t({ id: "purple-box", label: "Caixa roxa", style: caps({ font: "bebas", size: 84, shadow: soft }), highlight: { box: { color: "#7c3aed", radius: 10, padding: 8 } } }),
  word({ id: "word-shadow", label: "Sombra forte", style: caps({ size: 76, shadow: heavy }) }),
  t({ id: "cyan-duo", label: "Ciano", maxWords: 2, style: caps({ font: "anton", size: 92, stroke: black(12), shadow: hard }), highlight: { color: "#00e5ff" }, anim: pop, y: 0.6 }),
  t({ id: "yellow-duo", label: "Amarelo", maxWords: 2, style: caps({ size: 78, stroke: black(14) }), highlight: { color: "#ffe600" }, anim: pop, y: 0.6 }),
  t({ id: "pink-box", label: "Caixa rosa", style: caps({ size: 52, shadow: soft }), highlight: { box: { color: "#c86ad8", radius: 8, padding: 8, border: "#f5c6fb" } } }),
  t({ id: "blue-box", label: "Caixa azul", style: caps({ size: 52, shadow: soft }), highlight: { box: { color: "#1d4ed8", radius: 8, padding: 8, border: "#22d3ee" } } }),
  t({ id: "blue-solid", label: "Azul", style: caps({ size: 52, shadow: soft }), highlight: { box: { color: "#1e6bff", radius: 10, padding: 8 } } }),
  t({ id: "clean", label: "Simples", group: "lines", maxWords: 12, style: sentence({ size: 54, shadow: soft }), highlight: null, y: 0.75 }),
  t({ id: "typewriter", label: "Digitando", style: caps({ size: 56, italic: true, shadow: drop }), highlight: null, anim: { id: "typewriter", durationUs: 500_000 } }),
  t({ id: "black-pill", label: "Pílula preta", style: caps({ font: "oswald", size: 64, shadow: soft }), highlight: { box: { color: "#000000", radius: 40, padding: 10 } } }),
  t({ id: "orange-duo", label: "Laranja", maxWords: 2, style: caps({ font: "anton", size: 96, shadow: { color: "rgba(0,0,0,0.85)", blur: 12, x: 0, y: 6 } }), highlight: { color: "#ffb300" }, anim: pop, y: 0.6 }),
  t({ id: "yellow-grow", label: "Cresce amarelo", style: sentence({ font: "bebas", size: 88, shadow: drop }), highlight: { color: "#ffd400", scale: 1.35 } }),
  t({ id: "clean-caps", label: "Maiúsculas", group: "lines", maxWords: 12, style: caps({ size: 52, shadow: soft }), highlight: null, y: 0.75 }),
  t({ id: "dim-sentence", label: "Acende", group: "lines", maxWords: 12, style: sentence({ size: 54, shadow: soft }), highlight: null, future: "#8a8a8a", y: 0.75 }),
  word({ id: "cartoon", label: "Desenho", style: caps({ font: "luckiest", size: 88, stroke: { color: "#1a1a1a", width: 12 }, shadow: heavy }) }),
  t({ id: "serif", label: "Elegante", group: "lines", maxWords: 12, style: sentence({ font: "dmserif", size: 64, shadow: soft }), highlight: null, y: 0.72 }),
  word({ id: "bubble", label: "Bolha", style: caps({ font: "lilita", size: 92, shadow: heavy }) }),
  t({ id: "blue-lines", label: "Azul em 2 linhas", style: caps({ font: "black", size: 64, shadow: soft }), highlight: { box: { color: "#0b4fb3", radius: 8, padding: 8 } }, layout: { perLine: 2 } }),
  t({ id: "red-duo", label: "Vermelho", maxWords: 2, style: sentence({ font: "anton", size: 90, shadow: drop }), highlight: { color: "#ff1a1a" }, anim: pop }),
  t({ id: "lime-word", label: "Verde-limão", maxWords: 2, style: caps({ font: "black", size: 74, shadow: drop }), highlight: { color: "#a3e635" }, anim: pop }),
  word({ id: "anton-word", label: "Palavra grande", style: caps({ font: "anton", size: 120, shadow: heavy }) }),
  t({ id: "yellow-plain", label: "Tudo amarelo", maxWords: 2, style: caps({ font: "black", size: 74, color: "#ffe600", shadow: heavy }), highlight: null, anim: pop }),
  t({ id: "yellow-glow-duo", label: "Brilho amarelo", maxWords: 2, style: caps({ font: "black", size: 72, stroke: black(8), glow: glow("rgba(255,214,0,0.6)", 40) }), highlight: { color: "#ffe600" }, anim: pop }),
  t({ id: "lime-box", label: "Caixa limão", style: caps({ size: 50, shadow: soft }), highlight: { color: "#111111", box: { color: "#e6ff00", radius: 6, padding: 6 } } }),
  t({ id: "pink-glow-lines", label: "Rosa brilhante", style: caps({ font: "anton", size: 92, stroke: black(10), glow: glow("rgba(255,79,216,0.55)", 36) }), highlight: { color: "#ff6be0" }, layout: { perLine: 2 }, anim: pop }),
  t({ id: "green-word", label: "Verde", style: caps({ font: "oswald", size: 66, shadow: drop }), highlight: { color: "#39ff14" } }),
  t({ id: "soft-dim", label: "Suave", style: sentence({ font: "inter", size: 56, shadow: soft }), highlight: null, future: "#9ca3af" }),
  t({ id: "future-caps", label: "Aparece", maxWords: 2, style: caps({ font: "black", size: 80, shadow: soft }), highlight: null, future: "#6b6b6b" }),
  word({ id: "outline-word", label: "Contorno grosso", style: caps({ font: "anton", size: 120, stroke: black(16) }) }),
  t({ id: "coral-box", label: "Caixa coral", maxWords: 2, style: caps({ font: "black", size: 74, shadow: soft }), highlight: { box: { color: "#ff5a3c", radius: 14, padding: 10 } }, anim: pop }),
  t({ id: "cream", label: "Creme", group: "lines", maxWords: 12, style: sentence({ font: "poppins", size: 52, color: "#f3f0a8", shadow: soft }), highlight: null, y: 0.75 }),
  t({ id: "yellow-italic", label: "Itálico amarelo", style: sentence({ font: "inter", size: 54, color: "#ffe14d", italic: true, shadow: soft }), highlight: null, reveal: true }),
  t({ id: "serif-italic", label: "Serifa itálica", maxWords: 2, style: sentence({ font: "playfair", size: 88, italic: true, shadow: drop }), highlight: { color: "#22c55e" }, anim: pop }),
  t({ id: "word-pop-in", label: "Palavras pulando", style: caps({ font: "black", size: 60, shadow: drop }), highlight: null, wordPop: true }),
  t({ id: "blue-grow", label: "Cresce azul", style: caps({ font: "black", size: 52, shadow: soft }), highlight: { color: "#1e90ff", scale: 1.35 } }),
  t({ id: "green-lines", label: "Segunda linha verde", style: caps({ font: "black", size: 64, shadow: drop }), highlight: null, wordColors: ["#ffffff", "#ffffff", "#4ade00", "#4ade00"], layout: { perLine: 2 }, anim: pop }),
  word({ id: "emoji-yellow", label: "Emoji amarelo", style: caps({ font: "black", size: 88, color: "#ffe600", shadow: heavy }), emoji: "🤩" }),
  word({ id: "badge", label: "Selo", style: caps({ font: "black", size: 80, stroke: black(10), background: { color: "#e4ff1a", radius: 20, padding: 26 } }), rotation: -8 }),
  t({ id: "white-glow", label: "Brilho branco", style: caps({ font: "black", size: 70, glow: glow("rgba(255,255,255,0.75)", 44) }), highlight: null, layout: { perLine: 2, align: "left" } }),
  t({ id: "red-anton", label: "Vermelho forte", maxWords: 2, style: caps({ font: "anton", size: 100, shadow: heavy }), highlight: { color: "#ff1414" }, anim: pop }),
  t({ id: "type-cursor", label: "Máquina de escrever", group: "lines", maxWords: 12, style: sentence({ font: "dmserif", size: 60 }), highlight: null, cursor: true, anim: { id: "typewriter", durationUs: 900_000 }, y: 0.72 }),
  t({ id: "blue-word", label: "Azul vivo", group: "lines", maxWords: 12, style: caps({ font: "black", size: 50, shadow: soft }), highlight: { color: "#2f80ff" }, y: 0.72 }),
  t({ id: "red-italic-box", label: "Itálico caixa vermelha", style: caps({ font: "black", size: 70, italic: true, shadow: drop }), highlight: { box: { color: "#e11d2a", radius: 10, padding: 8 } }, layout: { perLine: 2 } }),
  t({ id: "yellow-glow-lines", label: "Amarelo 2 linhas", style: caps({ font: "anton", size: 92, shadow: heavy, glow: glow("rgba(255,230,0,0.35)", 40) }), highlight: { color: "#ffe600" }, layout: { perLine: 2 }, anim: pop }),
  t({ id: "red-italic", label: "Itálico vermelho", style: caps({ font: "anton", size: 96, italic: true, shadow: drop }), highlight: { color: "#ff2340" }, layout: { perLine: 2 }, anim: pop }),
  word({ id: "teal-serif", label: "Serifa verde-água", style: sentence({ font: "playfair", size: 110, color: "#1aa7a1", shadow: soft }) }),
  t({ id: "purple-lines", label: "Roxo 2 linhas", style: caps({ font: "black", size: 66, shadow: drop }), highlight: { box: { color: "#7c1cff", radius: 10, padding: 8 } }, layout: { perLine: 2 } }),
  word({ id: "blur-in", label: "Desfoque", style: caps({ font: "black", size: 96, shadow: soft }), anim: { id: "blur", durationUs: 350_000 } }),
  t({ id: "cyan-glow", label: "Ciano brilhante", style: caps({ font: "black", size: 70, stroke: black(6), glow: glow("rgba(0,229,255,0.45)", 36) }), highlight: { color: "#00e5ff" }, layout: { perLine: 2 }, anim: pop }),
  t({ id: "teal-word", label: "Verde-água", group: "lines", maxWords: 12, style: caps({ size: 46, shadow: soft }), highlight: { color: "#5eead4" }, y: 0.72 }),
  word({ id: "magenta-neon", label: "Neon magenta", style: caps({ font: "black", size: 96, color: "#ff2bd6", glow: glow("#ff2bd6", 36) }) }),
  t({ id: "comic-colors", label: "Gibi", style: caps({ font: "chewy", size: 80, shadow: soft }), highlight: null, wordColors: ["#ff6ad5", "#c7a6ff", "#ffffff", "#ffe600"], wordScales: [1.4, 0.8, 1.1, 1], layout: { perLine: 2, align: "left" }, anim: pop }),
  word({ id: "emoji-glow", label: "Emoji brilho", style: caps({ font: "black", size: 96, glow: glow("rgba(255,255,255,0.7)", 40) }), emoji: "🤩" }),
  t({ id: "gold-stack", label: "Dourado", style: caps({ font: "black", size: 70, shadow: drop }), highlight: null, wordColors: ["#ffffff", "#ffffff", "#e0b000", "#d9d9d9"], wordScales: [0.7, 0.7, 1.25, 1.25], layout: { perLine: 2 }, anim: pop }),
  t({ id: "yellow-neon", label: "Neon amarelo", maxWords: 2, style: caps({ font: "anton", size: 96, color: "#fff200", stroke: black(6), glow: glow("rgba(255,242,0,0.55)", 40) }), highlight: null, anim: pop }),
  word({ id: "blue-gradient", label: "Degradê azul", style: caps({ font: "luckiest", size: 100, gradient: ["#ffffff", "#5ab8ff", "#1f6fff"], stroke: { color: "#0a1a3a", width: 12 }, glow: glow("rgba(31,111,255,0.6)", 40) }) }),
  word({ id: "emoji-italic", label: "Emoji itálico", style: caps({ font: "black", size: 90, color: "#ffe600", italic: true, stroke: black(12) }), emoji: "🤩" }),
  t({ id: "red-first", label: "Primeira vermelha", group: "lines", maxWords: 12, style: caps({ font: "oswald", size: 60, shadow: soft }), highlight: { color: "#ff2a2a" }, y: 0.72 }),
  t({ id: "fire-italic", label: "Fogo itálico", maxWords: 2, style: caps({ font: "black", size: 90, color: "#d4e600", italic: true, stroke: { color: "#111111", width: 12 } }), highlight: null, emoji: "🔥", anim: pop }),
  word({ id: "pink-outline", label: "Contorno rosa", style: caps({ font: "bangers", size: 120, stroke: { color: "#f9a8d4", width: 18 }, shadow: soft }) }),
  word({ id: "teal-cartoon", label: "Desenho verde-água", style: caps({ font: "luckiest", size: 90, color: "#5eead4", stroke: { color: "#111111", width: 12 } }) }),
  t({ id: "periwinkle", label: "Lilás", maxWords: 2, style: caps({ font: "black", size: 80, stroke: black(8) }), highlight: { color: "#8b8cff" }, anim: pop }),
  word({ id: "yellow-glow", label: "Brilho dourado", style: caps({ font: "black", size: 96, color: "#ffe600", glow: glow("#ffc800", 36) }) }),
  t({ id: "serif-stack", label: "Serifa em escada", style: sentence({ font: "playfair", size: 80, shadow: drop }), highlight: null, wordColors: ["#ffffff", "#ffffff", "#9bd3ea", "#ffffff"], wordScales: [0.6, 0.6, 1, 1.25], layout: { perLine: 1 }, anim: fade }),
  word({ id: "word-lower", label: "Minúscula", style: sentence({ font: "poppins", size: 72, shadow: drop }) }),
  t({ id: "gold-glow", label: "Ouro", group: "lines", maxWords: 12, style: caps({ font: "black", size: 48, color: "#f5c518", glow: glow("rgba(255,190,0,0.6)", 26) }), highlight: null, y: 0.72 }),
  t({ id: "serif-stack-dim", label: "Serifa aparece", maxWords: 3, style: sentence({ font: "playfair", size: 96, shadow: soft }), highlight: null, future: "#3a3a3a", layout: { perLine: 1, align: "left" } }),
  t({ id: "fire-green", label: "Fogo verde", style: caps({ font: "black", size: 70, glow: glow("rgba(255,255,255,0.45)", 50) }), highlight: { color: "#39ff14" }, layout: { perLine: 2 }, emoji: "🔥" }),
  t({ id: "metal", label: "Metal", maxWords: 2, style: caps({ font: "anton", size: 100, gradient: ["#ffffff", "#9a9a9a", "#f2f2f2"], stroke: { color: "#222222", width: 6 }, glow: glow("rgba(255,255,255,0.3)", 30) }), highlight: null, anim: pop }),
  t({ id: "sport", label: "Esporte", maxWords: 2, style: caps({ font: "bangers", size: 120, stroke: { color: "#0a2a12", width: 8 }, shadow: hard }), highlight: null, wordColors: ["#22e05a", "#e5e5e5"], layout: { perLine: 1, stagger: [-0.5, 0.6] }, anim: pop }),
  t({ id: "red-neon-stack", label: "Neon em escada", style: caps({ font: "black", size: 72, color: "#ff5a36", glow: glow("#ff2a00", 32) }), highlight: null, wordColors: ["#ff5a36", "#ff5a36", "#ff5a36", "#ffe0a0"], layout: { perLine: 1, stagger: [-0.9, 0.3, -0.4, 0.5] }, anim: pop }),
  t({ id: "serif-gray", label: "Serifa cinza", style: sentence({ font: "playfair", size: 70, color: "#bdbdbd" }), highlight: { color: "#8b1a1a" }, layout: { perLine: 2, align: "right" } }),
  word({ id: "marker-glow", label: "Marcador", style: caps({ font: "marker", size: 110, color: "#fff27a", glow: glow("#ffe600", 34) }) }),
  t({ id: "fire-neon", label: "Neon verde", style: caps({ font: "poppins", size: 70, color: "#b6ff9e", glow: glow("#22ff22", 34) }), highlight: null, layout: { perLine: 2 }, emoji: "🔥", anim: pop }),
  // more of ours
  t({ id: "highlight-yellow", label: "Destaque amarelo", maxWords: 3, style: caps({ size: 62, stroke: black(12) }), highlight: { color: "#ffd400" }, anim: pop }),
  t({ id: "green-karaoke", label: "Karaokê verde", maxWords: 3, style: caps({ font: "poppins", size: 60, stroke: black(10) }), highlight: { color: "#39ff14", scale: 1.12 } }),
  t({ id: "red-box", label: "Caixa vermelha", maxWords: 3, style: caps({ font: "anton", size: 72, shadow: soft }), highlight: { box: { color: "#ef4444", radius: 6, padding: 10 } }, anim: pop }),
  t({ id: "rounded", label: "Redonda", style: caps({ font: "poppins", size: 56, shadow: drop }), highlight: null, anim: pop }),
  t({ id: "condensed", label: "Estreita", group: "lines", maxWords: 12, style: caps({ font: "oswald", size: 62, shadow: soft }), highlight: null, y: 0.72 }),
  t({ id: "reveal", label: "Revelar", maxWords: 5, style: caps({ size: 56, shadow: drop }), highlight: null, reveal: true }),
  t({ id: "box", label: "Caixa", group: "lines", maxWords: 12, style: sentence({ font: "inter", size: 48, background: { color: "#000000", radius: 14, padding: 18 } }), highlight: null, anim: fade, y: 0.78 }),
  t({ id: "white-box", label: "Caixa branca", style: sentence({ font: "poppins", size: 50, color: "#111111", background: { color: "#ffffff", radius: 16, padding: 18 } }), highlight: { color: "#7c3aed" }, anim: pop, y: 0.7 }),
  t({ id: "neon", label: "Neon", maxWords: 3, style: caps({ size: 64, color: "#ffe14d", glow: glow("#ff6a00", 28) }), highlight: null, anim: pop, y: 0.55 }),
  word({ id: "neon-pink", label: "Neon rosa", style: caps({ font: "lilita", size: 84, color: "#ffe6fb", glow: glow("#ff2d92", 30) }) }),
  t({ id: "impact", label: "Impacto", maxWords: 2, style: caps({ font: "bebas", size: 104, color: "#ffd400", shadow: { color: "rgba(0,0,0,0.9)", blur: 0, x: 5, y: 6 } }), highlight: { color: "#ffffff" }, anim: pop, y: 0.6 }),
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
