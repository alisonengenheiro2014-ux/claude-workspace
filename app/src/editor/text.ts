// Text items: fonts, defaults, animation and drawing. The same drawText()
// paints the preview overlay and the exported frames, so what you see while
// editing is what the file gets.
import "@fontsource/montserrat/latin-800.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/bebas-neue/latin-400.css";
import "@fontsource/anton/latin-400.css";
import "@fontsource/oswald/latin-700.css";
import "@fontsource/pacifico/latin-400.css";
import "@fontsource/permanent-marker/latin-400.css";
import "@fontsource/montserrat/latin-800-italic.css";
import "@fontsource/poppins/latin-800.css";
import "@fontsource/poppins/latin-800-italic.css";
import "@fontsource/lilita-one/latin-400.css";
import "@fontsource/luckiest-guy/latin-400.css";
import "@fontsource/dm-serif-display/latin-400.css";
import type { AnimRef, CaptionClip, TextClip, TextStyle, Track, Us } from "../data/db";
import { captionPreset, type WordHighlight } from "./presets";

// Open fonts shipped with the app (OFL / Apache), latin subset only.
export const FONTS: { id: string; label: string; family: string; weight: number }[] = [
  { id: "montserrat", label: "Montserrat", family: "Montserrat", weight: 800 },
  { id: "inter", label: "Inter", family: "Inter", weight: 700 },
  { id: "bebas", label: "Bebas", family: "Bebas Neue", weight: 400 },
  { id: "anton", label: "Anton", family: "Anton", weight: 400 },
  { id: "oswald", label: "Oswald", family: "Oswald", weight: 700 },
  { id: "pacifico", label: "Pacifico", family: "Pacifico", weight: 400 },
  { id: "marker", label: "Marker", family: "Permanent Marker", weight: 400 },
  { id: "poppins", label: "Poppins", family: "Poppins", weight: 800 },
  { id: "lilita", label: "Lilita", family: "Lilita One", weight: 400 },
  { id: "luckiest", label: "Luckiest", family: "Luckiest Guy", weight: 400 },
  { id: "dmserif", label: "Serifa", family: "DM Serif Display", weight: 400 },
];

export function fontOf(id: string) {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

// Canvas text only uses a web font once it has loaded.
let fontsReady: Promise<unknown> | null = null;
export function loadFonts() {
  fontsReady ??= Promise.all([
    ...FONTS.map((f) => document.fonts.load(`${f.weight} 48px "${f.family}"`)),
    document.fonts.load(`italic 800 48px "Montserrat"`),
    document.fonts.load(`italic 800 48px "Poppins"`),
  ]);
  return fontsReady;
}

// Captions: bold, white with a dark outline, readable over any video.
export const CAPTION_STYLE: TextStyle = {
  font: "montserrat",
  size: 56,
  color: "#ffffff",
  stroke: { color: "#000000", width: 10 },
  shadow: null,
  background: null,
  align: "center",
  bold: true,
  italic: false,
};
export const CAPTION_Y = 0.78; // a little above the bottom, clear of app UI on Reels/TikTok

export const TEXT_COLORS = ["#ffffff", "#000000", "#ffd400", "#ff3b30", "#ff9500", "#34c759", "#0a84ff", "#bf5af2", "#ff2d92"];

export const DEFAULT_TEXT_US: Us = 3_000_000;

export const DEFAULT_STYLE: TextStyle = {
  font: "montserrat",
  size: 72, // px for a 1080-wide frame; scales with the frame
  color: "#ffffff",
  stroke: null,
  shadow: { color: "#000000", blur: 12, x: 0, y: 4 },
  background: null,
  align: "center",
  bold: true,
  italic: false,
};

// Our own animation presets. "in" plays at the start, "out" at the end.
export const ANIMS_IN = [
  { id: "fade", label: "Surgir" },
  { id: "slide-up", label: "Subir" },
  { id: "pop", label: "Pular" },
  { id: "typewriter", label: "Digitar" },
];
export const ANIMS_OUT = [
  { id: "fade", label: "Sumir" },
  { id: "slide-down", label: "Descer" },
  { id: "pop", label: "Encolher" },
];
export const ANIM_US: Us = 500_000;

const ease = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

interface AnimState {
  alpha: number;
  dy: number; // fraction of the font size
  scale: number;
  chars: number; // 0..1 of the text shown
}

function animState(clip: TextClip, localUs: Us): AnimState {
  const s: AnimState = { alpha: 1, dy: 0, scale: 1, chars: 1 };
  const apply = (a: AnimRef | null, p: number, entering: boolean) => {
    if (!a) return;
    const k = ease(p); // 0 = hidden, 1 = fully shown
    if (a.id === "fade") s.alpha *= k;
    else if (a.id === "slide-up") {
      s.alpha *= k;
      s.dy += (1 - k) * 0.8;
    } else if (a.id === "slide-down") {
      s.alpha *= k;
      s.dy += (1 - k) * 0.8;
    } else if (a.id === "pop") {
      s.alpha *= Math.min(1, k * 2);
      s.scale *= entering ? 0.4 + 0.6 * k + Math.sin(k * Math.PI) * 0.15 : 0.4 + 0.6 * k;
    } else if (a.id === "typewriter") s.chars = Math.min(s.chars, p);
  };
  const { in: aIn, out: aOut } = clip.animation;
  if (aIn) apply(aIn, localUs / aIn.durationUs, true);
  if (aOut) apply(aOut, (clip.durationUs - localUs) / aOut.durationUs, false);
  return s;
}

export interface TextBox {
  cx: number; // centre, frame pixels
  cy: number;
  w: number; // unrotated size, frame pixels
  h: number;
  rotation: number; // degrees
}

function fontCss(style: TextStyle, px: number) {
  const f = fontOf(style.font);
  return `${style.italic ? "italic " : ""}${f.weight} ${px}px "${f.family}"`;
}

// Draws one text item onto a frame of size W×H at local time localUs (from
// the item's start). Returns its box for hit-testing, or null if hidden.
// animate=false draws it fully shown: the paused preview, so a text sitting
// at the start of its entrance animation is still visible while you edit.
export type DrawableText = TextClip & {
  // captions: the word being spoken (index across all lines) and how it stands
  // out; reveal hides the words not spoken yet
  highlight?: WordHighlight & { index: number; reveal?: boolean };
};

export function drawText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  clip: DrawableText,
  W: number,
  H: number,
  localUs: Us,
  animate = true,
): TextBox | null {
  const st = clip.style;
  const anim = animate ? animState(clip, localUs) : { alpha: 1, dy: 0, scale: 1, chars: 1 };
  const unit = Math.min(W, H) / 1080;
  const px = Math.max(4, st.size * unit * clip.transform.scale);
  const shape = (t: string) => (st.uppercase ? t.toLocaleUpperCase("pt-BR") : t);
  const full = shape(clip.text || " ");
  const shown = anim.chars < 1 ? full.slice(0, Math.ceil(full.length * anim.chars)) : full;
  const lines = full.split("\n");
  const shownLines = shown.split("\n");

  ctx.save();
  ctx.font = fontCss(st, px);
  const lineH = px * 1.2;
  const hl = clip.highlight;
  const space = ctx.measureText(" ").width;
  // captions are laid out word by word: the spoken word may be bigger
  let wordIndex = 0;
  const layout = lines.map((line) =>
    line
      .split(" ")
      .filter(Boolean)
      .map((text) => {
        const index = wordIndex++;
        const scale = hl && hl.index === index && hl.scale ? hl.scale : 1;
        if (scale !== 1) ctx.font = fontCss(st, px * scale);
        const width = ctx.measureText(text).width;
        if (scale !== 1) ctx.font = fontCss(st, px);
        return { text, index, scale, width };
      }),
  );
  const widths = hl
    ? layout.map((ws) => ws.reduce((n, x) => n + x.width, 0) + space * Math.max(0, ws.length - 1))
    : lines.map((l) => ctx.measureText(l || " ").width);
  const pad = st.background ? st.background.padding * unit * clip.transform.scale : 0;
  const w = Math.max(...widths) + pad * 2;
  const h = lineH * lines.length + pad * 2;
  const cx = clip.transform.x * W;
  const cy = clip.transform.y * H;
  const box: TextBox = { cx, cy, w, h, rotation: clip.transform.rotation };

  const alpha = clip.opacity * anim.alpha;
  if (alpha <= 0.001) {
    ctx.restore();
    return box;
  }
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy + anim.dy * px);
  ctx.rotate((clip.transform.rotation * Math.PI) / 180);
  ctx.scale(anim.scale, anim.scale);

  if (st.background) {
    ctx.fillStyle = st.background.color;
    const r = st.background.radius * unit * clip.transform.scale;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, r);
    ctx.fill();
  }

  // one run of text with every layer of the style: glow, shadow, outline, fill
  const paint = (t: string, x: number, y: number, color: string, k = 1) => {
    if (st.glow) {
      ctx.shadowColor = st.glow.color;
      ctx.shadowBlur = st.glow.blur * unit;
      ctx.fillStyle = st.glow.color;
      ctx.fillText(t, x, y);
      ctx.fillText(t, x, y);
    }
    if (st.shadow && !st.background) {
      ctx.shadowColor = st.shadow.color;
      ctx.shadowBlur = st.shadow.blur * unit;
      ctx.shadowOffsetX = st.shadow.x * unit;
      ctx.shadowOffsetY = st.shadow.y * unit;
    } else ctx.shadowColor = "transparent";
    if (st.stroke) {
      ctx.lineJoin = "round";
      ctx.lineWidth = st.stroke.width * unit * clip.transform.scale * k;
      ctx.strokeStyle = st.stroke.color;
      ctx.strokeText(t, x, y);
      ctx.shadowColor = "transparent";
    }
    ctx.fillStyle = color;
    ctx.fillText(t, x, y);
    ctx.shadowColor = "transparent";
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  };

  ctx.textBaseline = "middle";
  const xStart = (lw: number) => (st.align === "left" ? -w / 2 + pad : st.align === "right" ? w / 2 - pad - lw : -lw / 2);
  if (!hl) {
    ctx.textAlign = st.align;
    shownLines.forEach((line, i) => {
      const y = -h / 2 + pad + lineH * (i + 0.5);
      paint(line, st.align === "left" ? -w / 2 + pad : st.align === "right" ? w / 2 - pad : 0, y, st.color);
    });
  } else {
    // word by word, so the spoken word can stand out
    ctx.textAlign = "left";
    let charsLeft = anim.chars < 1 ? shown.length : Infinity;
    layout.forEach((ws, i) => {
      const y = -h / 2 + pad + lineH * (i + 0.5);
      let x = xStart(widths[i]);
      for (const word of ws) {
        const on = word.index === hl.index;
        const visible = !(hl.reveal && word.index > hl.index) && charsLeft > 0;
        const text = charsLeft < word.text.length ? word.text.slice(0, charsLeft) : word.text;
        charsLeft -= word.text.length + 1;
        if (visible) {
          if (word.scale !== 1) ctx.font = fontCss(st, px * word.scale);
          if (on && hl.box) {
            const b = hl.box;
            const bp = b.padding * unit * clip.transform.scale * word.scale;
            const bh = px * word.scale * 1.12 + bp;
            ctx.beginPath();
            ctx.roundRect(x - bp, y - bh / 2, word.width + bp * 2, bh, b.radius * unit * clip.transform.scale);
            ctx.fillStyle = b.color;
            ctx.fill();
            if (b.border) {
              ctx.lineWidth = 4 * unit * clip.transform.scale;
              ctx.strokeStyle = b.border;
              ctx.stroke();
            }
          }
          paint(text, x, y, on && hl.color ? hl.color : st.color, word.scale);
          if (word.scale !== 1) ctx.font = fontCss(st, px);
        }
        x += word.width + space;
      }
    });
  }
  ctx.restore();
  return box;
}

// A caption drawn like a text item, in its track's style.
export function captionAsText(c: CaptionClip, style: TextStyle | undefined): TextClip {
  return {
    id: c.id,
    type: "text",
    text: c.text,
    style: style ?? CAPTION_STYLE,
    startUs: c.startUs,
    durationUs: c.durationUs,
    transform: c.transform,
    opacity: c.opacity,
    blendMode: c.blendMode,
    animation: c.animation,
    keyframes: c.keyframes,
  };
}

// Every text item and caption visible at timeline time tUs, bottom track first.
export function textsAt(tracks: Track[], tUs: Us): DrawableText[] {
  const out: DrawableText[] = [];
  for (const t of tracks) {
    if ((t.kind !== "text" && t.kind !== "caption") || t.hidden) continue;
    for (const c of t.items) {
      if (tUs < c.startUs || tUs >= c.startUs + c.durationUs) continue;
      if (c.type === "text") out.push(c);
      else if (c.type === "caption") out.push(captionDrawable(c, t.style, t.preset, tUs - c.startUs));
    }
  }
  return out;
}

// A caption at localUs from its start, with its template's word highlight.
export function captionDrawable(c: CaptionClip, style: TextStyle | undefined, presetId: string | undefined, localUs: Us): DrawableText {
  const item: DrawableText = captionAsText(c, style);
  const p = captionPreset(presetId);
  if ((p.highlight || p.reveal) && c.words.length) {
    let index = 0;
    c.words.forEach((w, i) => {
      if (localUs >= w.startUs) index = i;
    });
    item.highlight = { ...p.highlight, index, reveal: p.reveal };
  }
  return item;
}

// Is a frame point inside a (rotated) text box?
export function hitBox(b: TextBox, x: number, y: number, slack = 0) {
  const a = (-b.rotation * Math.PI) / 180;
  const dx = x - b.cx;
  const dy = y - b.cy;
  const rx = dx * Math.cos(a) - dy * Math.sin(a);
  const ry = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(rx) <= b.w / 2 + slack && Math.abs(ry) <= b.h / 2 + slack;
}
