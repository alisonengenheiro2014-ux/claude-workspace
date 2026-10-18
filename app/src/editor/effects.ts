// Video effects (S13 Efeitos): items on an effect lane that change the whole
// picture (video and overlays, under the text) while they last. Each effect is
// a function of its own local time giving a few simple numbers; the preview
// turns them into CSS on a box around the picture, the export into canvas
// drawing. Several effects at once combine.
import type { EffectClip, TimelineDoc, Us } from "../data/db";
import { applyLook, cssFilter, NEUTRAL, type Look } from "./look";

export interface FxFrame {
  tx: number; // move, fraction of the frame
  ty: number;
  scale: number;
  look: Look; // colour changes
  blur: number; // px on a 1080-wide frame
  flash: number; // white over the picture, 0..1
  black: number; // black over the picture, 0..1
  vignette: number; // 0..1
  leak: number; // warm light from a corner, 0..1
  bars: number; // cinema bars, fraction of the height each
}

export const NO_FX: FxFrame = { tx: 0, ty: 0, scale: 1, look: NEUTRAL, blur: 0, flash: 0, black: 0, vignette: 0, leak: 0, bars: 0 };

const TAU = Math.PI * 2;

export const EFFECTS: { id: string; label: string; emoji: string; apply: (f: FxFrame, s: number, p: number) => void }[] = [
  // s: seconds since the effect started, p: 0..1 through it
  {
    id: "shake",
    label: "Tremor",
    emoji: "🫨",
    apply: (f, s) => {
      f.tx += 0.012 * Math.sin(s * TAU * 7.3) + 0.006 * Math.sin(s * TAU * 13.1);
      f.ty += 0.012 * Math.cos(s * TAU * 6.1) + 0.006 * Math.sin(s * TAU * 11.7);
      f.scale *= 1.05;
    },
  },
  { id: "pulse", label: "Pulsar", emoji: "💓", apply: (f, s) => (f.scale *= 1 + 0.06 * Math.abs(Math.sin(s * Math.PI * 2))) },
  { id: "zoom-in", label: "Zoom lento", emoji: "🔍", apply: (f, _s, p) => (f.scale *= 1 + 0.18 * p) },
  { id: "flash", label: "Flash", emoji: "⚡", apply: (f, s) => (f.flash = Math.max(f.flash, Math.max(0, 1 - (s % 0.6) / 0.18))) },
  { id: "strobe", label: "Pisca-pisca", emoji: "🚨", apply: (f, s) => (f.black = Math.max(f.black, Math.floor(s / 0.1) % 2 ? 0.85 : 0)) },
  { id: "blur", label: "Desfoque", emoji: "🌫️", apply: (f) => (f.blur = Math.max(f.blur, 14)) },
  { id: "bw", label: "P&B", emoji: "🖤", apply: (f) => (f.look = { ...f.look, saturate: 0, contrast: f.look.contrast * 1.1 }) },
  { id: "sepia", label: "Sépia", emoji: "📜", apply: (f) => (f.look = { ...f.look, sepia: 0.9 }) },
  { id: "invert", label: "Negativo", emoji: "🔄", apply: (f) => (f.look = { ...f.look, invert: 1 }) },
  { id: "vignette", label: "Vinheta", emoji: "⚫", apply: (f) => (f.vignette = Math.max(f.vignette, 0.75)) },
  { id: "warm-leak", label: "Luz quente", emoji: "🌅", apply: (f, s) => (f.leak = Math.max(f.leak, 0.45 + 0.2 * Math.sin(s * 1.7))) },
  { id: "cinema", label: "Cinema", emoji: "🎬", apply: (f) => (f.bars = Math.max(f.bars, 0.12)) },
  { id: "fade-black", label: "Escurecer", emoji: "🌑", apply: (f, _s, p) => (f.black = Math.max(f.black, p)) },
  { id: "fade-white", label: "Clarear", emoji: "🤍", apply: (f, _s, p) => (f.flash = Math.max(f.flash, p)) },
];

export const effectOf = (id: string) => EFFECTS.find((e) => e.id === id);

export function effectsAt(doc: TimelineDoc, tUs: Us): FxFrame | null {
  let f: FxFrame | null = null;
  for (const t of doc.tracks) {
    if (t.kind !== "effect" || t.hidden) continue;
    for (const c of t.items) {
      if (c.type !== "effect" || tUs < c.startUs || tUs >= c.startUs + c.durationUs) continue;
      const e = effectOf(c.effectId);
      if (!e) continue;
      f ??= { ...NO_FX, look: { ...NEUTRAL } };
      e.apply(f, (tUs - c.startUs) / 1e6, (tUs - c.startUs) / Math.max(1, c.durationUs));
    }
  }
  return f;
}

// ---- preview ----

export function fxCss(f: FxFrame | null, W: number) {
  if (!f) return { transform: "", filter: "" };
  const t = f.tx || f.ty || f.scale !== 1 ? `translate(${(f.tx * 100).toFixed(3)}%, ${(f.ty * 100).toFixed(3)}%) scale(${f.scale.toFixed(4)})` : "";
  const parts = [cssFilter(f.look)].filter((x) => x !== "none");
  if (f.blur) parts.push(`blur(${((f.blur * W) / 1080).toFixed(2)}px)`);
  return { transform: t, filter: parts.join(" ") };
}

export const leakCss = (a: number) =>
  `radial-gradient(circle at 0% 0%, rgba(255,150,40,${a.toFixed(3)}) 0%, rgba(255,90,20,${(a * 0.5).toFixed(3)}) 35%, rgba(0,0,0,0) 70%)`;

// ---- export ----

type Ctx = OffscreenCanvasRenderingContext2D;
let scratch: OffscreenCanvas | null = null;
let small: OffscreenCanvas | null = null;

// Applies the effects to everything already drawn on ctx.
export function applyEffects(ctx: Ctx, f: FxFrame, bg: string) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  if (f.tx || f.ty || f.scale !== 1 || f.blur) {
    if (!scratch || scratch.width !== W || scratch.height !== H) scratch = new OffscreenCanvas(W, H);
    const s = scratch.getContext("2d")!;
    s.clearRect(0, 0, W, H);
    s.drawImage(ctx.canvas, 0, 0);
    let src: CanvasImageSource = scratch;
    if (f.blur) {
      // blur by shrinking and stretching back (canvas filters are not everywhere)
      const k = Math.max(2, Math.round((f.blur * W) / 1080 / 2));
      const sw = Math.max(2, Math.round(W / k));
      const sh = Math.max(2, Math.round(H / k));
      if (!small || small.width !== sw || small.height !== sh) small = new OffscreenCanvas(sw, sh);
      const sc = small.getContext("2d")!;
      sc.imageSmoothingQuality = "high";
      sc.drawImage(scratch, 0, 0, sw, sh);
      src = small;
    }
    ctx.save();
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(W / 2 + f.tx * W, H / 2 + f.ty * H);
    ctx.scale(f.scale, f.scale);
    ctx.drawImage(src, -W / 2, -H / 2, W, H);
    ctx.restore();
  }
  applyLook(ctx, { x: 0, y: 0, w: W, h: H }, { ...f.look, vignette: Math.max(f.look.vignette, f.vignette) });
  if (f.leak) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.hypot(W, H) * 0.7);
    g.addColorStop(0, `rgba(255,150,40,${f.leak})`);
    g.addColorStop(0.5, `rgba(255,90,20,${f.leak * 0.5})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  if (f.flash) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, f.flash)})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (f.black) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, f.black)})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (f.bars) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, H * f.bars);
    ctx.fillRect(0, H * (1 - f.bars), W, H * f.bars);
  }
}

export function newEffect(effectId: string, startUs: Us, durationUs: Us): Omit<EffectClip, "id"> {
  return {
    type: "effect",
    effectId,
    params: {},
    startUs,
    durationUs,
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
    opacity: 1,
    blendMode: "normal",
    animation: { in: null, out: null, loop: null },
    keyframes: [],
  };
}
