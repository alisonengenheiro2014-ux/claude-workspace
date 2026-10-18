// Drawing a clip's picture into the project frame, over its background: a
// colour, or a blurred, darkened copy of the picture itself filling the frame
// (for a vertical video in a 16:9 project, say).
import type { TimelineDoc } from "../data/db";

export type FrameBg =
  | { kind: "color"; color: string }
  | { kind: "blur" }
  | { kind: "gradient"; colors: [string, string]; angle: number }
  | { kind: "image"; src: CanvasImageSource | null; w: number; h: number };

// images: the background photo, decoded by the caller (preview or export)
export function frameBgOf(doc: TimelineDoc, image?: { src: CanvasImageSource; w: number; h: number } | null): FrameBg {
  const b = doc.canvas.background;
  if (b.type === "blur") return { kind: "blur" };
  if (b.type === "gradient") return { kind: "gradient", colors: b.colors, angle: b.angle };
  if (b.type === "image") return { kind: "image", src: image?.src ?? null, w: image?.w ?? 1, h: image?.h ?? 1 };
  return { kind: "color", color: b.color };
}

// The CSS for the same background, behind the preview.
export function frameBgCss(doc: TimelineDoc | null, imageUrl: string | null): string {
  const b = doc?.canvas.background;
  if (!b) return "#000000";
  if (b.type === "color") return b.color;
  if (b.type === "gradient") return `linear-gradient(${b.angle}deg, ${b.colors[0]}, ${b.colors[1]})`;
  if (b.type === "image" && imageUrl) return `#000000 url("${imageUrl}") center / cover no-repeat`;
  return "#000000";
}

// Fills the frame with a colour, a gradient or a photo (cover).
function fillBg(ctx: Ctx, bg: FrameBg) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  if (bg.kind === "gradient") {
    // the same line as CSS linear-gradient(angle): through the centre, long enough to reach the corners
    const a = (bg.angle * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const half = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
    const g = ctx.createLinearGradient(W / 2 - dx * half, H / 2 - dy * half, W / 2 + dx * half, H / 2 + dy * half);
    g.addColorStop(0, bg.colors[0]);
    g.addColorStop(1, bg.colors[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else if (bg.kind === "image") {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, H);
    if (bg.src) {
      const s = Math.max(W / bg.w, H / bg.h);
      ctx.drawImage(bg.src, (W - bg.w * s) / 2, (H - bg.h * s) / 2, bg.w * s, bg.h * s);
    }
  } else {
    ctx.fillStyle = bg.kind === "color" ? bg.color : "#000000";
    ctx.fillRect(0, 0, W, H);
  }
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Rect = { x: number; y: number; w: number; h: number };

export function containRect(srcW: number, srcH: number, W: number, H: number): Rect {
  const s = Math.min(W / srcW, H / srcH);
  const w = srcW * s;
  const h = srcH * s;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

// Scratch canvases, reused between frames (resized when the frame changes).
let fg: OffscreenCanvas | null = null;
let small: OffscreenCanvas | null = null;
let tiny: OffscreenCanvas | null = null;
function scratch(c: OffscreenCanvas | null, w: number, h: number) {
  if (!c) return new OffscreenCanvas(w, h);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

// Blur by shrinking twice and stretching back with smoothing: cheap, and
// works in every browser (canvas `filter` is not everywhere).
function drawBlurred(ctx: Ctx, src: CanvasImageSource, r: Rect) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  small = scratch(small, Math.max(2, Math.ceil(W / 8)), Math.max(2, Math.ceil(H / 8)));
  tiny = scratch(tiny, Math.max(2, Math.ceil(W / 40)), Math.max(2, Math.ceil(H / 40)));
  const sctx = small.getContext("2d")!;
  // cover: the picture's own rectangle scaled to fill the whole frame
  const s = Math.max(small.width / r.w, small.height / r.h);
  const w = r.w * s;
  const h = r.h * s;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(src, r.x, r.y, r.w, r.h, (small.width - w) / 2, (small.height - h) / 2, w, h);
  const tctx = tiny.getContext("2d")!;
  tctx.imageSmoothingQuality = "high";
  tctx.drawImage(small, 0, 0, tiny.width, tiny.height);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(tiny, 0, 0, W, H);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// draw() paints the picture letterboxed onto the context it is given and
// returns where it went; this function puts the background under it and
// returns the picture's rectangle too (filters apply there).
export function drawFrame(ctx: Ctx, bg: FrameBg, draw: (c: Ctx) => Rect | null): Rect | null {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  if (bg.kind !== "blur") {
    fillBg(ctx, bg);
    return draw(ctx);
  }
  fg = scratch(fg, W, H);
  const f = fg.getContext("2d")!;
  f.clearRect(0, 0, W, H);
  const r = draw(f);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);
  if (r && r.w > 1 && r.h > 1) drawBlurred(ctx, fg, r);
  ctx.drawImage(fg, 0, 0);
  return r;
}

// Letterboxed image (bitmap, canvas...) — the common case of draw().
export function containDraw(src: CanvasImageSource, srcW: number, srcH: number) {
  return (c: Ctx) => {
    if (!srcW || !srcH) return null;
    const r = containRect(srcW, srcH, c.canvas.width, c.canvas.height);
    c.drawImage(src, r.x, r.y, r.w, r.h);
    return r;
  };
}

// A clip's crop, quarter turns and mirror (S04 Recortar). crop is 0..1 of the
// picture as shown; the turn and the mirror apply after the crop.
export interface Shape {
  crop: { x: number; y: number; w: number; h: number } | null;
  rotation: number; // 0, 90, 180, 270
  flip: boolean;
}

export function shapeOf(c: { crop: Shape["crop"]; transform: { rotation: number }; flip?: boolean }): Shape {
  return { crop: c.crop, rotation: ((Math.round(c.transform.rotation / 90) * 90) % 360 + 360) % 360, flip: !!c.flip };
}

export const plainShape = (s: Shape) => !s.crop && !s.rotation && !s.flip;

// Size of the shaped picture, in source pixels.
export function shapedSize(srcW: number, srcH: number, s: Shape) {
  const w = srcW * (s.crop?.w ?? 1);
  const h = srcH * (s.crop?.h ?? 1);
  return s.rotation % 180 ? { w: h, h: w } : { w, h };
}

// Like containDraw, with the crop, turn and mirror.
export function shapedDraw(src: CanvasImageSource, srcW: number, srcH: number, s: Shape) {
  return (c: Ctx) => {
    if (!srcW || !srcH) return null;
    const size = shapedSize(srcW, srcH, s);
    const r = containRect(size.w, size.h, c.canvas.width, c.canvas.height);
    const crop = s.crop ?? { x: 0, y: 0, w: 1, h: 1 };
    const turned = s.rotation % 180 !== 0;
    const dw = turned ? r.h : r.w;
    const dh = turned ? r.w : r.h;
    c.save();
    c.translate(r.x + r.w / 2, r.y + r.h / 2);
    c.rotate((s.rotation * Math.PI) / 180);
    if (s.flip) c.scale(-1, 1);
    c.drawImage(src, crop.x * srcW, crop.y * srcH, crop.w * srcW, crop.h * srcH, -dw / 2, -dh / 2, dw, dh);
    c.restore();
    return r;
  };
}

// CSS for a <video> (showing the whole picture with object-fit: fill) so
// that only the shaped picture shows, fitted in a W×H frame.
export function shapedCss(srcW: number, srcH: number, s: Shape, W: number, H: number) {
  const size = shapedSize(srcW, srcH, s);
  const r = containRect(size.w, size.h, W, H);
  const crop = s.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const turned = s.rotation % 180 !== 0;
  const k = (turned ? r.h : r.w) / (crop.w * srcW); // css px per source px
  const ew = srcW * k;
  const eh = srcH * k;
  const ox = (crop.x + crop.w / 2) * ew; // crop centre inside the element
  const oy = (crop.y + crop.h / 2) * eh;
  const pct = (v: number) => `${(v * 100).toFixed(4)}%`;
  return {
    rect: r,
    style: {
      left: `${r.x + r.w / 2 - ox}px`,
      top: `${r.y + r.h / 2 - oy}px`,
      width: `${ew}px`,
      height: `${eh}px`,
      maxWidth: "none", // the base CSS keeps videos within their box
      objectFit: "fill",
      clipPath: s.crop ? `inset(${pct(crop.y)} ${pct(1 - crop.x - crop.w)} ${pct(1 - crop.y - crop.h)} ${pct(crop.x)})` : "",
      transformOrigin: `${ox}px ${oy}px`,
      transform: `${s.rotation ? `rotate(${s.rotation}deg)` : ""}${s.flip ? " scaleX(-1)" : ""}`.trim(),
    },
  };
}
