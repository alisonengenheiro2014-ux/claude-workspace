// Transitions between main-track clips. Our model: the total length does not
// change. A transition of length d runs from (cut - d/2) to (cut + d/2):
// before the cut, A plays and B waits on its first frame; after the cut, B
// plays and A holds its last frame. Each preset says, for progress p (0..1),
// how the outgoing layer (A) and the incoming layer (B) look. The preview
// applies that as CSS on the <video> and a canvas; the export draws it.

export interface LayerFx {
  opacity: number;
  tx: number; // fraction of the frame width
  ty: number; // fraction of the frame height
  scale: number;
  reveal: number; // 0..1 of the width shown from the left (wipes); 1 = all
}

export interface TransitionFx {
  a: LayerFx;
  b: LayerFx;
  top: "a" | "b";
  dip: { color: string; alpha: number } | null;
}

const show: LayerFx = { opacity: 1, tx: 0, ty: 0, scale: 1, reveal: 1 };
const hide: LayerFx = { ...show, opacity: 0 };

// Our own presets, named for what they do.
export const TRANSITIONS: { id: string; label: string; fx: (p: number) => TransitionFx }[] = [
  { id: "dissolve", label: "Dissolver", fx: (p) => ({ a: show, b: { ...show, opacity: p }, top: "b", dip: null }) },
  {
    id: "dip-black",
    label: "Escurecer",
    fx: (p) => ({ a: p < 0.5 ? show : hide, b: p < 0.5 ? hide : show, top: "b", dip: { color: "#000000", alpha: 1 - Math.abs(2 * p - 1) } }),
  },
  {
    id: "dip-white",
    label: "Clarear",
    fx: (p) => ({ a: p < 0.5 ? show : hide, b: p < 0.5 ? hide : show, top: "b", dip: { color: "#ffffff", alpha: 1 - Math.abs(2 * p - 1) } }),
  },
  { id: "slide-left", label: "Deslizar", fx: (p) => ({ a: { ...show, tx: -p }, b: { ...show, tx: 1 - p }, top: "b", dip: null }) },
  { id: "slide-up", label: "Subir", fx: (p) => ({ a: { ...show, ty: -p }, b: { ...show, ty: 1 - p }, top: "b", dip: null }) },
  { id: "cover-left", label: "Cobrir", fx: (p) => ({ a: show, b: { ...show, tx: 1 - p }, top: "b", dip: null }) },
  { id: "wipe", label: "Cortina", fx: (p) => ({ a: show, b: { ...show, reveal: p }, top: "b", dip: null }) },
  {
    id: "zoom",
    label: "Zoom",
    fx: (p) => ({ a: { ...show, scale: 1 + 0.6 * p, opacity: 1 - p }, b: { ...show, scale: 0.85 + 0.15 * p, opacity: p }, top: "b", dip: null }),
  },
];

export const DEFAULT_TRANSITION_US = 500_000;

const smooth = (p: number) => p * p * (3 - 2 * p);

export function fxOf(type: string, p: number): TransitionFx {
  const t = TRANSITIONS.find((x) => x.id === type) ?? TRANSITIONS[0];
  return t.fx(smooth(Math.max(0, Math.min(1, p))));
}

// CSS for a preview layer (the <video> or a canvas filling the frame).
export function layerCss(fx: LayerFx): Partial<CSSStyleDeclaration> {
  return {
    opacity: String(fx.opacity),
    transform: `translate(${fx.tx * 100}%, ${fx.ty * 100}%) scale(${fx.scale})`,
    clipPath: fx.reveal < 1 ? `inset(0 ${(1 - fx.reveal) * 100}% 0 0)` : "",
  };
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function drawLayer(ctx: Ctx, src: CanvasImageSource, fx: LayerFx, W: number, H: number) {
  if (fx.opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = fx.opacity;
  if (fx.reveal < 1) {
    ctx.beginPath();
    ctx.rect(0, 0, W * fx.reveal, H);
    ctx.clip();
  }
  ctx.translate(W / 2 + fx.tx * W, H / 2 + fx.ty * H);
  ctx.scale(fx.scale, fx.scale);
  ctx.drawImage(src, -W / 2, -H / 2, W, H);
  ctx.restore();
}

// Export: composes two full-frame layers (already letterboxed to W×H).
export function drawTransition(ctx: Ctx, a: CanvasImageSource, b: CanvasImageSource, type: string, p: number, bg: string) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const fx = fxOf(type, p);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const [first, second] = fx.top === "b" ? ([[a, fx.a], [b, fx.b]] as const) : ([[b, fx.b], [a, fx.a]] as const);
  drawLayer(ctx, first[0], first[1], W, H);
  drawLayer(ctx, second[0], second[1], W, H);
  if (fx.dip && fx.dip.alpha > 0) {
    ctx.save();
    ctx.globalAlpha = fx.dip.alpha;
    ctx.fillStyle = fx.dip.color;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}
