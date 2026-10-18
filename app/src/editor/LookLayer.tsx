// The preview's filter and adjustments for the main clip under the playhead:
// a CSS filter on the <video> (and the photo canvas), and the colour washes
// and vignette as layers over the picture's rectangle. Overlays get theirs in
// OverlayMedia. Same look as the export (see look.ts).
import { useEffect, useState, type RefObject } from "react";
import { containRect, shapedSize, shapeOf } from "./frame";
import { cssFilter, lookOf, NEUTRAL, vignetteCss, washes, type Look } from "./look";
import { displaySize } from "./overlay";
import { useEditor } from "./store";
import { clipAt } from "./timeline";

export function LookWashes({ look }: { look: Look }) {
  return (
    <>
      {washes(look).map((w, i) => (
        <div key={i} className="absolute inset-0" style={{ background: w.color, opacity: w.alpha, mixBlendMode: "soft-light" }} />
      ))}
      {look.vignette > 0 && <div className="absolute inset-0" style={{ background: vignetteCss(look.vignette) }} />}
    </>
  );
}

export function LookLayer({
  video,
  image,
  width,
  height,
}: {
  video: RefObject<HTMLVideoElement | null>;
  image: RefObject<HTMLCanvasElement | null>;
  width: number;
  height: number;
}) {
  const [shown, setShown] = useState<{ look: Look; rect: { x: number; y: number; w: number; h: number } } | null>(null);
  useEffect(() => {
    let key = "";
    const update = () => {
      const s = useEditor.getState();
      const doc = s.draft ?? s.doc;
      const hit = doc ? clipAt(doc, s.playheadUs) : null;
      const look = hit ? lookOf(hit.clip) : NEUTRAL;
      const css = cssFilter(look);
      const f = css === "none" ? "" : css;
      if (video.current && video.current.style.filter !== f) video.current.style.filter = f;
      if (image.current && image.current.style.filter !== f) image.current.style.filter = f;
      const src = displaySize(hit ? s.assets.get(hit.clip.assetId) : undefined);
      const size = hit ? shapedSize(src.w, src.h, shapeOf(hit.clip)) : src;
      const rect = containRect(size.w, size.h, width, height);
      const k = JSON.stringify([look, rect]);
      if (k !== key) {
        key = k;
        setShown({ look, rect });
      }
    };
    update();
    return useEditor.subscribe(update);
  }, [video, image, width, height]);
  if (!shown || (!washes(shown.look).length && !shown.look.vignette)) return null;
  const { rect } = shown;
  return (
    <div aria-hidden className="pointer-events-none absolute" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
      <LookWashes look={shown.look} />
    </div>
  );
}
