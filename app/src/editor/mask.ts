// Masks for overlays (S12 Máscara): a shape that keeps part of the picture.
// The mask is drawn once on a small canvas: the preview uses it as a CSS
// mask image, the export as a destination-in layer, so both cut the same.
import type { MediaClip } from "../data/db";

export type Mask = NonNullable<MediaClip["mask"]>;
export type MaskShape = Mask["shape"];

export const MASKS: { id: MaskShape; label: string }[] = [
  { id: "linear", label: "Linear" },
  { id: "mirror", label: "Espelho" },
  { id: "circle", label: "Círculo" },
  { id: "rect", label: "Retângulo" },
  { id: "heart", label: "Coração" },
  { id: "star", label: "Estrela" },
];

// params: x, y (centre, 0..1 of the picture), size (0..1), angle (degrees)
export function newMask(shape: MaskShape): Mask {
  return { shape, params: { x: 0.5, y: 0.5, size: shape === "linear" ? 1 : 0.6, angle: 0 }, invert: false, feather: 0.1 };
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function shapePath(m: Mask, w: number, h: number): Path2D {
  const p = new Path2D();
  const s = m.params.size ?? 0.6;
  const big = Math.hypot(w, h) * 2;
  const r = (Math.min(w, h) / 2) * s;
  switch (m.shape) {
    case "linear": // keeps the side above the line
      p.rect(-big, -big, big * 2, big);
      break;
    case "mirror": // a band along the line
      p.rect(-big, (-h * s) / 2, big * 2, h * s);
      break;
    case "circle":
      p.ellipse(0, 0, (w / 2) * s, (h / 2) * s, 0, 0, Math.PI * 2);
      break;
    case "rect":
      p.roundRect((-w / 2) * s, (-h / 2) * s, w * s, h * s, r * 0.08);
      break;
    case "heart": {
      const k = r / 16;
      for (let i = 0; i <= 64; i++) {
        const t = (i / 64) * Math.PI * 2;
        const x = 16 * Math.sin(t) ** 3 * k;
        const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * k;
        if (i) p.lineTo(x, y);
        else p.moveTo(x, y);
      }
      p.closePath();
      break;
    }
    case "star":
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.45 : r;
        if (i) p.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else p.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      p.closePath();
      break;
  }
  return p;
}

// White where the picture stays, on a w×h canvas.
export function drawMask(ctx: Ctx, w: number, h: number, m: Mask) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  if (m.invert) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "destination-out";
  }
  const feather = m.feather * Math.min(w, h) * 0.25;
  ctx.translate((m.params.x ?? 0.5) * w, (m.params.y ?? 0.5) * h);
  ctx.rotate(((m.params.angle ?? 0) * Math.PI) / 180);
  const path = shapePath(m, w, h);
  if (feather > 0.5) {
    // soft edge: only the shadow of the shape, moved back under it
    const t = ctx.getTransform();
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = feather;
    ctx.shadowOffsetX = t.a * 10000;
    ctx.shadowOffsetY = t.b * 10000;
    ctx.translate(-10000, 0);
  }
  ctx.fillStyle = "#ffffff";
  ctx.fill(path);
  ctx.restore();
}

// A small image of the mask for CSS (cached by its settings and aspect).
const cache = new Map<string, string>();
export function maskUrl(m: Mask, aspect: number): string {
  const key = JSON.stringify([m, Math.round(aspect * 100)]);
  let url = cache.get(key);
  if (!url) {
    const w = 256;
    const h = Math.max(2, Math.round(256 / aspect));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    drawMask(c.getContext("2d")!, w, h, m);
    url = c.toDataURL("image/png");
    if (cache.size > 50) cache.clear();
    cache.set(key, url);
  }
  return url;
}
