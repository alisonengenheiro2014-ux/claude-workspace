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
import type { AnimRef, CaptionClip, TextClip, TextStyle, Track, Us } from "../data/db";

// Open fonts shipped with the app (OFL / Apache), latin subset only.
export const FONTS: { id: string; label: string; family: string; weight: number }[] = [
  { id: "montserrat", label: "Montserrat", family: "Montserrat", weight: 800 },
  { id: "inter", label: "Inter", family: "Inter", weight: 700 },
  { id: "bebas", label: "Bebas", family: "Bebas Neue", weight: 400 },
  { id: "anton", label: "Anton", family: "Anton", weight: 400 },
  { id: "oswald", label: "Oswald", family: "Oswald", weight: 700 },
  { id: "pacifico", label: "Pacifico", family: "Pacifico", weight: 400 },
  { id: "marker", label: "Marker", family: "Permanent Marker", weight: 400 },
];

export function fontOf(id: string) {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

// Canvas text only uses a web font once it has loaded.
let fontsReady: Promise<unknown> | null = null;
export function loadFonts() {
  fontsReady ??= Promise.all(FONTS.map((f) => document.fonts.load(`${f.weight} 48px "${f.family}"`)));
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
export function drawText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  clip: TextClip,
  W: number,
  H: number,
  localUs: Us,
  animate = true,
): TextBox | null {
  const st = clip.style;
  const anim = animate ? animState(clip, localUs) : { alpha: 1, dy: 0, scale: 1, chars: 1 };
  const unit = Math.min(W, H) / 1080;
  const px = Math.max(4, st.size * unit * clip.transform.scale);
  let text = clip.text || " ";
  if (anim.chars < 1) text = text.slice(0, Math.ceil(text.length * anim.chars));
  const lines = (clip.text || " ").split("\n");
  const shownLines = text.split("\n");

  ctx.save();
  ctx.font = fontCss(st, px);
  const lineH = px * 1.2;
  const widths = lines.map((l) => ctx.measureText(l || " ").width);
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

  ctx.textBaseline = "middle";
  ctx.textAlign = st.align;
  const x = st.align === "left" ? -w / 2 + pad : st.align === "right" ? w / 2 - pad : 0;
  shownLines.forEach((line, i) => {
    const y = -h / 2 + pad + lineH * (i + 0.5);
    if (st.shadow && !st.background) {
      ctx.shadowColor = st.shadow.color;
      ctx.shadowBlur = st.shadow.blur * unit;
      ctx.shadowOffsetX = st.shadow.x * unit;
      ctx.shadowOffsetY = st.shadow.y * unit;
    }
    if (st.stroke) {
      ctx.lineJoin = "round";
      ctx.lineWidth = st.stroke.width * unit * clip.transform.scale;
      ctx.strokeStyle = st.stroke.color;
      ctx.strokeText(line, x, y);
      ctx.shadowColor = "transparent";
    }
    ctx.fillStyle = st.color;
    ctx.fillText(line, x, y);
    ctx.shadowColor = "transparent";
  });
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
export function textsAt(tracks: Track[], tUs: Us): TextClip[] {
  const out: TextClip[] = [];
  for (const t of tracks) {
    if ((t.kind !== "text" && t.kind !== "caption") || t.hidden) continue;
    for (const c of t.items) {
      if (tUs < c.startUs || tUs >= c.startUs + c.durationUs) continue;
      if (c.type === "text") out.push(c);
      else if (c.type === "caption") out.push(captionAsText(c, t.style));
    }
  }
  return out;
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
