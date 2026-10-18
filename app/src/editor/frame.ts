// Drawing a clip's picture into the project frame, over its background: a
// colour, or a blurred, darkened copy of the picture itself filling the frame
// (for a vertical video in a 16:9 project, say).
import type { TimelineDoc } from "../data/db";

export type FrameBg = { kind: "color"; color: string } | { kind: "blur" };

export function frameBgOf(doc: TimelineDoc): FrameBg {
  const b = doc.canvas.background;
  return b.type === "blur" ? { kind: "blur" } : { kind: "color", color: b.type === "color" ? b.color : "#000000" };
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
// returns where it went; this function puts the background under it.
export function drawFrame(ctx: Ctx, bg: FrameBg, draw: (c: Ctx) => Rect | null) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  if (bg.kind === "color") {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, W, H);
    draw(ctx);
    return;
  }
  fg = scratch(fg, W, H);
  const f = fg.getContext("2d")!;
  f.clearRect(0, 0, W, H);
  const r = draw(f);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);
  if (r && r.w > 1 && r.h > 1) drawBlurred(ctx, fg, r);
  ctx.drawImage(fg, 0, 0);
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
