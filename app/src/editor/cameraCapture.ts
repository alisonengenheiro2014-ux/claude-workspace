// Browser camera capture must report hardware capabilities honestly.
// A canvas digital crop can zoom in, but cannot add a physical ultra-wide lens.
export type CameraZoomRange = { min: number; max: number };

export function targetVideoSize(quality: 720 | 1080 | 1440 | 2160) {
  return quality === 2160 ? { width: 3840, height: 2160 }
    : quality === 1440 ? { width: 2560, height: 1440 }
    : quality === 1080 ? { width: 1920, height: 1080 }
    : { width: 1280, height: 720 };
}

export function actualVideoLabel(width: number, height: number) {
  const w = Math.max(width, height);
  const h = Math.min(width, height);
  if (w >= 3800 && h >= 2100) return "4K";
  if (w >= 2500 && h >= 1400) return "1440p";
  if (w >= 1900 && h >= 1050) return "1080p";
  if (w >= 1260 && h >= 690) return "720p";
  return `${h}p`;
}

export function nativeZoomRange(caps: { zoom?: { min?: number; max?: number } } | null): CameraZoomRange | null {
  const min = caps?.zoom?.min;
  const max = caps?.zoom?.max;
  if (typeof min !== "number" || typeof max !== "number" || !Number.isFinite(min) ||
      !Number.isFinite(max) || min <= 0 || max <= min) return null;
  return { min, max: Math.min(max, 10) };
}

export function boundZoom(zoom: number, caps: CameraZoomRange | null) {
  const min = Math.min(1, caps?.min ?? 1);
  const max = Math.max(5, caps?.max ?? 5);
  return Math.min(max, Math.max(min, Math.round(zoom * 10) / 10));
}

export function digitalZoomFactor(requested: number, appliedNative: number) {
  // When zoom is unavailable/failed, the canvas provides 1x–5x zoom.
  // Never zoom out digitally: <1x requires genuine ultra-wide optical access.
  return Math.max(1, requested / Math.max(0.1, appliedNative));
}

/** Pure pinch math; never assumes the Safari zoom range supports 0.5x. */
export function pinchZoomLevel(
  initialZoom: number,
  initialDistance: number,
  currentDistance: number,
  caps: CameraZoomRange | null,
) {
  if (initialDistance < 8 || currentDistance < 0 || !Number.isFinite(currentDistance)) return boundZoom(initialZoom, caps);
  return boundZoom(initialZoom * currentDistance / initialDistance, caps);
}
