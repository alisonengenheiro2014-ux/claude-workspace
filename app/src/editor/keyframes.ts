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

export function animatedAt(c: Pick<ClipBase, "transform" | "opacity" | "keyframes">, localUs: Us): Animated {
  if (!c.keyframes.length) return { transform: c.transform, opacity: c.opacity };
  const v = (p: (typeof KEY_PROPS)[number]) => {
    let before: Keyframe | null = null;
    let after: Keyframe | null = null;
    for (const k of c.keyframes) {
      if (k.property !== p) continue;
      if (k.tUs <= localUs) before = k;
      else if (!after) after = k;
    }
    if (!before && !after) return baseValue(c, p);
    if (!before) return after!.value;
    if (!after) return before.value;
    const t = (localUs - before.tUs) / (after.tUs - before.tUs);
    const k = before.easing === "linear" ? t : easeInOut(t);
    return before.value + (after.value - before.value) * k;
  };
  return { transform: { x: v("x"), y: v("y"), scale: v("scale"), rotation: v("rotation") }, opacity: v("opacity") };
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
  return ks.sort((a, b) => a.tUs - b.tUs || KEY_PROPS.indexOf(a.property as never) - KEY_PROPS.indexOf(b.property as never));
}

// The keyframes with one at localUs holding these values (replacing one
// that was there).
export function withKeyAt(c: Pick<ClipBase, "keyframes">, localUs: Us, a: Animated): Keyframe[] {
  const at = keyNear(c, localUs) ?? Math.round(localUs);
  const rest = c.keyframes.filter((k) => k.tUs !== at);
  const values: Record<(typeof KEY_PROPS)[number], number> = { ...a.transform, opacity: a.opacity };
  return sorted([...rest, ...KEY_PROPS.map((property) => ({ tUs: at, property, value: values[property], easing: "ease-in-out" as const }))]);
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
