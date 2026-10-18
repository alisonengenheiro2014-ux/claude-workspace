// Keyframes (S16): position, size, rotation and opacity that change over a
// clip. A keyframe at a moment stores every property at that moment (one
// Keyframe row per property, same tUs); between two, values ease in and out.
// Without keyframes a clip just has its transform and opacity.
import type { ClipBase, Keyframe, KeyframeProperty, Transform, Us } from "../data/db";

export const KEY_PROPS = ["x", "y", "scale", "rotation", "opacity"] as const satisfies readonly KeyframeProperty[];
export type Animated = { transform: Transform; opacity: number };

// Two keyframes closer than this are the same one (about a frame).
export const KEY_TOLERANCE_US = 40_000;

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function baseValue(c: Pick<ClipBase, "transform" | "opacity">, p: (typeof KEY_PROPS)[number]) {
  return p === "opacity" ? c.opacity : c.transform[p];
}

function valueAt(ks: Keyframe[], p: KeyframeProperty, localUs: Us, base: number) {
  let before: Keyframe | null = null;
  let after: Keyframe | null = null;
  for (const k of ks) {
    if (k.property !== p) continue;
    if (k.tUs <= localUs) before = k;
    else if (!after) after = k;
  }
  if (!before && !after) return base;
  if (!before) return after!.value;
  if (!after) return before.value;
  const t = (localUs - before.tUs) / (after.tUs - before.tUs);
  const k = before.easing === "linear" ? t : easeInOut(t);
  return before.value + (after.value - before.value) * k;
}

export function animatedAt(c: Pick<ClipBase, "transform" | "opacity" | "keyframes">, localUs: Us): Animated {
  if (!c.keyframes.length) return { transform: c.transform, opacity: c.opacity };
  const v = (p: (typeof KEY_PROPS)[number]) => valueAt(c.keyframes, p, localUs, baseValue(c, p));
  return { transform: { x: v("x"), y: v("y"), scale: v("scale"), rotation: v("rotation") }, opacity: v("opacity") };
}

// Video and audio clips: their volume at a moment (keyframes too).
export function volumeAt(c: { volume: number; keyframes: Keyframe[] }, localUs: Us) {
  return c.keyframes?.length ? valueAt(c.keyframes, "volume", localUs, c.volume) : c.volume;
}

export function keyTimes(c: Pick<ClipBase, "keyframes">): Us[] {
  return [...new Set(c.keyframes.map((k) => k.tUs))].sort((a, b) => a - b);
}

export function keyNear(c: Pick<ClipBase, "keyframes">, localUs: Us, tol = KEY_TOLERANCE_US): Us | null {
  let best: Us | null = null;
  for (const t of keyTimes(c)) if (Math.abs(t - localUs) <= tol && (best === null || Math.abs(t - localUs) < Math.abs(best - localUs))) best = t;
  return best;
}

function sorted(ks: Keyframe[]) {
  const order: KeyframeProperty[] = [...KEY_PROPS, "volume"];
  return ks.sort((a, b) => a.tUs - b.tUs || order.indexOf(a.property) - order.indexOf(b.property));
}

// The keyframes with one at localUs holding these values (replacing one
// that was there, and keeping its curve). Video and audio clips pass their
// volume too.
export function withKeyAt(c: Pick<ClipBase, "keyframes">, localUs: Us, a: Animated, volume?: number): Keyframe[] {
  const at = keyNear(c, localUs) ?? Math.round(localUs);
  const easing = c.keyframes.find((k) => k.tUs === at)?.easing ?? "ease-in-out";
  const rest = c.keyframes.filter((k) => k.tUs !== at);
  const values: Record<string, number> = { ...a.transform, opacity: a.opacity };
  const props: KeyframeProperty[] = [...KEY_PROPS];
  if (volume !== undefined) {
    values.volume = volume;
    props.push("volume");
  }
  return sorted([...rest, ...props.map((property) => ({ tUs: at, property, value: values[property], easing }))]);
}

export function withoutKeyAt(c: Pick<ClipBase, "keyframes">, localUs: Us): Keyframe[] {
  const at = keyNear(c, localUs);
  return at === null ? c.keyframes : c.keyframes.filter((k) => k.tUs !== at);
}

// Keyframes of the part of a clip after a cut at offsetUs.
export function shiftKeys(ks: Keyframe[], offsetUs: Us): Keyframe[] {
  return ks.map((k) => ({ ...k, tUs: k.tUs - offsetUs }));
}

// The main video's zoom and pan: picture scaled by `scale` about the frame
// centre and moved by (x - 0.5, y - 0.5) of the frame. Its quarter turns stay
// in transform.rotation (the crop) and are not animated.
export function mainZoom(c: Pick<ClipBase, "transform" | "opacity" | "keyframes">, localUs: Us) {
  const a = animatedAt(c, localUs);
  return { scale: a.transform.scale, dx: a.transform.x - 0.5, dy: a.transform.y - 0.5, opacity: a.opacity };
}
export const isZoomed = (z: ReturnType<typeof mainZoom>) => Math.abs(z.scale - 1) > 1e-4 || Math.abs(z.dx) > 1e-4 || Math.abs(z.dy) > 1e-4 || z.opacity < 0.999;
