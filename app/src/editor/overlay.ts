// Photos and videos over the main video (S12 Sobrepor). The preview shows
// them as DOM elements (a <video> keeps HDR right) and the export draws them;
// both place them with overlayBox, so they land in the same spot.
import type { AssetRow, MediaClip, TimelineDoc, Transform, Us } from "../data/db";
import type { TextBox } from "./text";

// Width and height as shown (phone videos are often stored turned).
export function displaySize(asset: AssetRow | undefined) {
  const turned = asset?.rotation === 90 || asset?.rotation === 270;
  return { w: (turned ? asset?.height : asset?.width) || 16, h: (turned ? asset?.width : asset?.height) || 9 };
}

// Size the media shows at when not rotated: fitted inside the frame, times
// the clip's scale.
export function overlayBox(asset: AssetRow | undefined, W: number, H: number, t: Transform): TextBox {
  const { w: aw, h: ah } = displaySize(asset);
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
