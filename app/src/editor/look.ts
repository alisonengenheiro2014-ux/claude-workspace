// Filters and adjustments (S14). A clip's look is a CSS filter (brightness,
// contrast, saturation, sepia, hue) plus colour washes for temperature and
// tint (soft-light) and a vignette. The preview uses exactly that on the
// <video> element (GPU, HDR-safe); the export uses the canvas `filter` with
// the same string, or the same maths per pixel where canvas filters are
// missing, then the same washes with the same blend mode.
import type { Adjust, MediaClip } from "../data/db";

export interface Look {
  brightness: number; // multipliers, 1 = unchanged
  contrast: number;
  saturate: number;
  sepia: number; // 0..1
  hue: number; // degrees
  temp: number; // -1 cool .. 1 warm
  tint: number; // -1 green .. 1 magenta
  vignette: number; // 0..1
  invert?: number; // 0..1 (effects)
  sharpen?: number; // 0..1
  highlights?: number; // -1..1
  shadows?: number; // -1..1
}

export const NEUTRAL: Look = { brightness: 1, contrast: 1, saturate: 1, sepia: 0, hue: 0, temp: 0, tint: 0, vignette: 0, invert: 0 };

export const FILTERS: { id: string; label: string; look: Partial<Look> }[] = [
  { id: "vivid", label: "Vívido", look: { contrast: 1.15, saturate: 1.45 } },
  { id: "warm", label: "Quente", look: { temp: 0.6, saturate: 1.1 } },
  { id: "cool", label: "Frio", look: { temp: -0.6, contrast: 1.05 } },
  { id: "cinema", label: "Cinema", look: { contrast: 1.25, saturate: 0.8, temp: -0.25, vignette: 0.45 } },
  { id: "sunset", label: "Pôr do sol", look: { temp: 0.9, tint: 0.2, saturate: 1.2, contrast: 1.05 } },
  { id: "retro", label: "Retrô", look: { sepia: 0.35, contrast: 0.92, saturate: 0.85, brightness: 1.05, vignette: 0.3 } },
  { id: "vintage", label: "Vintage", look: { sepia: 0.55, contrast: 1.1, brightness: 0.95, vignette: 0.5 } },
  { id: "bw", label: "P&B", look: { saturate: 0, contrast: 1.1 } },
  { id: "noir", label: "Noir", look: { saturate: 0, contrast: 1.45, brightness: 0.92, vignette: 0.55 } },
  { id: "soft", label: "Suave", look: { contrast: 0.85, brightness: 1.08, saturate: 0.9 } },
  { id: "faded", label: "Desbotado", look: { contrast: 0.78, saturate: 0.7, brightness: 1.1 } },
  { id: "summer", label: "Verão", look: { brightness: 1.06, saturate: 1.3, temp: 0.35 } },
  { id: "winter", label: "Inverno", look: { temp: -0.75, saturate: 0.75, brightness: 1.05 } },
  { id: "rose", label: "Rosé", look: { tint: 0.55, temp: 0.2, contrast: 0.95 } },
  { id: "forest", label: "Floresta", look: { tint: -0.5, saturate: 1.15, contrast: 1.05 } },
  { id: "drama", label: "Drama", look: { contrast: 1.4, saturate: 1.15, brightness: 0.95, vignette: 0.4 } },
  { id: "teal-orange", label: "Laranja e azul", look: { contrast: 1.15, saturate: 1.2, hue: -8, temp: 0.25 } },
];

export const EMPTY_ADJUST: Adjust = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  exposure: 0,
  temperature: 0,
  tint: 0,
  sharpen: 0,
  vignette: 0,
  highlights: 0,
  shadows: 0,
};

// The adjustments shown in "Ajustar", each -50..50 (vinheta 0..100).
export const ADJUSTS: { key: keyof Adjust; label: string; min: number }[] = [
  { key: "brightness", label: "Brilho", min: -50 },
  { key: "contrast", label: "Contraste", min: -50 },
  { key: "saturation", label: "Saturação", min: -50 },
  { key: "exposure", label: "Exposição", min: -50 },
  { key: "temperature", label: "Temperatura", min: -50 },
  { key: "tint", label: "Matiz", min: -50 },
  { key: "highlights", label: "Realces", min: -50 },
  { key: "shadows", label: "Sombras", min: -50 },
  { key: "sharpen", label: "Nitidez", min: 0 },
  { key: "vignette", label: "Vinheta", min: 0 },
];

const mix = (a: number, b: number, k: number) => a + (b - a) * k;

export function lookOf(clip: Pick<MediaClip, "filter" | "adjust">): Look {
  const l = { ...NEUTRAL };
  const f = clip.filter && FILTERS.find((x) => x.id === clip.filter!.id);
  if (f) {
    const k = clip.filter!.intensity / 100;
    for (const key of Object.keys(f.look) as (keyof Look)[]) l[key] = mix(NEUTRAL[key] ?? 0, f.look[key]!, k);
  }
  const a = clip.adjust;
  if (a) {
    l.brightness *= (1 + a.brightness / 150) * 2 ** (a.exposure / 50);
    l.contrast *= 1 + a.contrast / 100;
    l.saturate *= 1 + a.saturation / 50;
    l.temp = Math.max(-1, Math.min(1, l.temp + a.temperature / 50));
    l.tint = Math.max(-1, Math.min(1, l.tint + a.tint / 50));
    l.vignette = Math.min(1, l.vignette + a.vignette / 100);
    if (a.sharpen) l.sharpen = a.sharpen / 100;
    if (a.highlights) l.highlights = a.highlights / 50;
    if (a.shadows) l.shadows = a.shadows / 50;
  }
  return l;
}

export function isNeutral(l: Look) {
  return !hasDetail(l) && (Object.keys(NEUTRAL) as (keyof Look)[]).every((k) => Math.abs((l[k] ?? 0) - (NEUTRAL[k] ?? 0)) < 1e-3);
}

// ---- detail: highlights/shadows (a tone curve) and sharpen (a 3x3 kernel).
// CSS has no such functions, so the preview uses an SVG filter with exactly
// these numbers (feComponentTransfer table, feConvolveMatrix) and the export
// does the same arithmetic per pixel.

export const hasDetail = (l: Look) => !!(l.sharpen || l.highlights || l.shadows);

// 17 points of the tone curve, 0..1
export function toneTable(l: Look): number[] {
  const s = l.shadows ?? 0;
  const h = l.highlights ?? 0;
  return Array.from({ length: 17 }, (_, i) => {
    const x = i / 16;
    const v = x + s * 0.35 * x * Math.pow(1 - x, 2) * 3 + h * 0.35 * Math.pow(x, 2) * (1 - x) * 3;
    return Math.max(0, Math.min(1, v));
  });
}

export function sharpenKernel(l: Look): number[] {
  const a = (l.sharpen ?? 0) * 0.8;
  return [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0];
}

export function detailId(l: Look) {
  return `look-${toneTable(l).map((v) => Math.round(v * 1000)).join("-")}-${Math.round((l.sharpen ?? 0) * 100)}`;
}

// The CSS filter, with the SVG detail filter first when there is one.
export function lookFilter(l: Look): string {
  const css = cssFilter(l);
  if (!hasDetail(l)) return css;
  return `url(#${detailId(l)})${css === "none" ? "" : ` ${css}`}`;
}

export function cssFilter(l: Look): string {
  const parts: string[] = [];
  if (l.brightness !== 1) parts.push(`brightness(${l.brightness.toFixed(3)})`);
  if (l.contrast !== 1) parts.push(`contrast(${l.contrast.toFixed(3)})`);
  if (l.saturate !== 1) parts.push(`saturate(${l.saturate.toFixed(3)})`);
  if (l.sepia) parts.push(`sepia(${l.sepia.toFixed(3)})`);
  if (l.hue) parts.push(`hue-rotate(${l.hue.toFixed(1)}deg)`);
  if (l.invert) parts.push(`invert(${l.invert.toFixed(3)})`);
  return parts.join(" ") || "none";
}

// The colour washes over the picture, blended with soft-light.
export function washes(l: Look): { color: string; alpha: number }[] {
  const out: { color: string; alpha: number }[] = [];
  if (l.temp) out.push({ color: l.temp > 0 ? "#ff8a1f" : "#1f7bff", alpha: Math.abs(l.temp) * 0.55 });
  if (l.tint) out.push({ color: l.tint > 0 ? "#ff1fc8" : "#1fff5e", alpha: Math.abs(l.tint) * 0.4 });
  return out;
}

export const vignetteCss = (v: number) => `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${(v * 0.8).toFixed(3)}) 100%)`;

// ---- export ----

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Rect = { x: number; y: number; w: number; h: number };

// 4x5 colour matrices from the Filter Effects spec, in the order CSS applies
// them. CSS clamps to 0..1 after each one, so they are applied one by one.
function stepsOf(l: Look): number[][] {
  const out: number[][] = [];
  const b = l.brightness;
  if (b !== 1) out.push([b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0]);
  const c = l.contrast;
  const o = 0.5 - 0.5 * c;
  if (c !== 1) out.push([c, 0, 0, 0, o, 0, c, 0, 0, o, 0, 0, c, 0, o, 0, 0, 0, 1, 0]);
  const s = l.saturate;
  if (s !== 1)
    out.push(
    [
      0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0,
      0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0,
      0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0,
      0, 0, 0, 1, 0,
    ]);
  if (l.sepia) {
    const k = 1 - l.sepia;
    out.push(
      [
        0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k, 0, 0,
        0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k, 0, 0,
        0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k, 0, 0,
        0, 0, 0, 1, 0,
    ]);
  }
  if (l.hue) {
    const a = (l.hue * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    out.push([
        0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928, 0, 0,
        0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283, 0, 0,
        0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072, 0, 0,
        0, 0, 0, 1, 0,
    ]);
  }
  if (l.invert) {
    const a = l.invert;
    const k = 1 - 2 * a;
    out.push([k, 0, 0, 0, a, 0, k, 0, 0, a, 0, 0, k, 0, a, 0, 0, 0, 1, 0]);
  }
  return out;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
// out is reused per pixel: no allocation in the export's pixel loop
function run(steps: number[][], r: number, g: number, b: number, out: number[] = [0, 0, 0]) {
  for (const m of steps) {
    const nr = clamp01(m[0] * r + m[1] * g + m[2] * b + m[4]);
    const ng = clamp01(m[5] * r + m[6] * g + m[7] * b + m[9]);
    const nb = clamp01(m[10] * r + m[11] * g + m[12] * b + m[14]);
    r = nr;
    g = ng;
    b = nb;
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
  return out;
}

// For tests and for canvases without `filter`: the look on one RGB value (0..255).
export function applyMatrix(l: Look, r: number, g: number, b: number): [number, number, number] {
  const [x, y, z] = run(stepsOf(l), r / 255, g / 255, b / 255);
  return [Math.round(x * 255), Math.round(y * 255), Math.round(z * 255)];
}

// Same as the SVG filter: table transfer per channel (piecewise linear over
// the 17 points), then the 3x3 kernel with edges repeated, alpha untouched.
function applyDetail(ctx: Ctx, x: number, y: number, w: number, h: number, l: Look) {
  const img = ctx.getImageData(x, y, w, h);
  const d = img.data;
  if (l.highlights || l.shadows) {
    const t = toneTable(l);
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      const p = (i / 255) * 16;
      const k = Math.min(15, Math.floor(p));
      lut[i] = Math.round((t[k] + (t[k + 1] - t[k]) * (p - k)) * 255);
    }
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lut[d[i]];
      d[i + 1] = lut[d[i + 1]];
      d[i + 2] = lut[d[i + 2]];
    }
  }
  if (l.sharpen) {
    const k = sharpenKernel(l);
    const src = new Uint8ClampedArray(d);
    const at = (xx: number, yy: number) => (Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, xx))) * 4;
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const o = (yy * w + xx) * 4;
        const up = at(xx, yy - 1);
        const dn = at(xx, yy + 1);
        const lf = at(xx - 1, yy);
        const rt = at(xx + 1, yy);
        for (let c = 0; c < 3; c++) d[o + c] = k[4] * src[o + c] + k[1] * (src[up + c] + src[dn + c] + src[lf + c] + src[rt + c]);
      }
  }
  ctx.putImageData(img, x, y);
}

let canvasFilter: boolean | null = null;
function hasCanvasFilter(ctx: Ctx) {
  canvasFilter ??= typeof (ctx as { filter?: unknown }).filter === "string";
  return canvasFilter;
}

let scratch: OffscreenCanvas | null = null;

// Applies a look to the picture already drawn in rect (frame pixels).
export function applyLook(ctx: Ctx, rect: Rect, l: Look) {
  if (isNeutral(l)) return;
  // the part of rect inside the canvas (a zoomed picture can stick out)
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const w = Math.min(ctx.canvas.width, Math.ceil(rect.x + rect.w)) - x;
  const h = Math.min(ctx.canvas.height, Math.ceil(rect.y + rect.h)) - y;
  if (w < 1 || h < 1) return;
  if (hasDetail(l)) applyDetail(ctx, x, y, w, h, l);
  const css = cssFilter(l);
  if (css !== "none") {
    if (hasCanvasFilter(ctx)) {
      if (!scratch || scratch.width !== w || scratch.height !== h) scratch = new OffscreenCanvas(w, h);
      const s = scratch.getContext("2d")!;
      s.clearRect(0, 0, w, h);
      s.drawImage(ctx.canvas, x, y, w, h, 0, 0, w, h);
      ctx.save();
      ctx.filter = css;
      ctx.drawImage(scratch, x, y); // the picture is opaque: it covers the unfiltered one
      ctx.restore();
    } else {
      const steps = stepsOf(l);
      const img = ctx.getImageData(x, y, w, h);
      const d = img.data;
      const k = 1 / 255;
      const px = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) {
        run(steps, d[i] * k, d[i + 1] * k, d[i + 2] * k, px);
        d[i] = px[0] * 255;
        d[i + 1] = px[1] * 255;
        d[i + 2] = px[2] * 255;
      }
      ctx.putImageData(img, x, y);
    }
  }
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  for (const wsh of washes(l)) {
    ctx.globalAlpha = wsh.alpha;
    ctx.fillStyle = wsh.color;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
  if (l.vignette > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    // an ellipse filling the rect, like CSS "ellipse at center" (farthest corner)
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2); // the whole picture, even where it sticks out
    ctx.scale(rect.w / Math.SQRT2 / 100, rect.h / Math.SQRT2 / 100);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 100);
    g.addColorStop(0.45, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${(l.vignette * 0.8).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(-100, -100, 200, 200);
    ctx.restore();
  }
}
