// Photos and videos over the main video (S12 Sobrepor). The preview shows
// them as DOM elements (a <video> keeps HDR right) and the export draws them;
// both place them with overlayBox, so they land in the same spot.
import type { AssetRow, MediaClip, TimelineDoc, Transform, Us } from "../data/db";
import { animatedAt, clipMotion } from "./keyframes";
import type { TextBox } from "./text";

// Width and height as shown. The import already stores them as displayed
// (an iPhone video filmed upright is stored on its side with a 90° turn, and
// width/height are after that turn): do not turn them again.
export function displaySize(asset: AssetRow | undefined) {
  return { w: asset?.width || 16, h: asset?.height || 9 };
}

// Size the media shows at when not rotated: fitted inside the frame, times
// the clip's scale. A cropped layer is the size of the part that shows.
export function overlayBox(asset: AssetRow | undefined, W: number, H: number, t: Transform, crop?: MediaClip["crop"]): TextBox {
  const { w: sw, h: sh } = displaySize(asset);
  const aw = sw * (crop?.w ?? 1);
  const ah = sh * (crop?.h ?? 1);
  const fit = Math.min(W / aw, H / ah);
  return { cx: t.x * W, cy: t.y * H, w: aw * fit * t.scale, h: ah * fit * t.scale, rotation: t.rotation };
}

// Overlay clips showing at timeline time tUs, bottom lane first.
export function overlaysAt(doc: TimelineDoc, tUs: Us): MediaClip[] {
  const out: MediaClip[] = [];
  for (const t of doc.tracks) {
    if (t.kind !== "overlay" || t.hidden) continue;
    for (const c of t.items) if (c.type === "media" && tUs >= c.startUs && tUs < c.startUs + c.durationUs) out.push(c);
  }
  return out;
}

// Opacity with the clip's fades (fade in / fade out work on the picture too).
export function overlayAlpha(c: MediaClip, tUs: Us) {
  const local = tUs - c.startUs;
  let a = c.opacity;
  if (c.fadeInUs > 0) a *= Math.min(1, local / c.fadeInUs);
  if (c.fadeOutUs > 0) a *= Math.min(1, (c.durationUs - local) / c.fadeOutUs);
  return Math.max(0, a);
}

// Where an overlay is and how visible, at timeline time tUs (keyframes and fades).
// Where the whole picture goes inside a layer's box (0..1 of the box), so
// only the cropped part shows: the box clips the rest.
export function cropPlacement(crop: MediaClip["crop"]) {
  const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  return { x: -c.x / c.w, y: -c.y / c.h, w: 1 / c.w, h: 1 / c.h };
}

export function overlayAt(asset: AssetRow | undefined, c: MediaClip, W: number, H: number, tUs: Us) {
  const a = animatedAt(c, tUs - c.startUs);
  const m = clipMotion(c, tUs - c.startUs);
  const t = { x: a.transform.x + m.dx, y: a.transform.y + m.dy, scale: a.transform.scale * m.scale, rotation: a.transform.rotation + m.rot };
  return { box: overlayBox(asset, W, H, t, c.crop), alpha: overlayAlpha({ ...c, opacity: a.opacity * m.alpha }, tUs) };
}
