// The preview's photos and videos over the main video. Each is a DOM element
// placed with overlayBox; videos follow the playhead (seek while paused, play
// along and correct drift while playing). Placing them is done by the text
// canvas above (TextOverlay), which handles every on-screen gesture.
import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties } from "react";
import { blendOf } from "./blend";
import { keyImage, type Chroma } from "./chroma";
import { maskUrl } from "./mask";
import type { AssetRow, Id } from "../data/db";
import type { TextBox } from "./text";
import { assetFile } from "../media/import";
import { lookFilter, lookOf } from "./look";
import { LookSvg, LookWashes } from "./LookLayer";
import { cropPlacement, overlayAt, overlaysAt } from "./overlay";
import { useEditor } from "./store";
import { findItem, sourceTimeUs } from "./timeline";

const urls = new Map<Id, Promise<string | null>>();
function urlOf(asset: AssetRow) {
  let u = urls.get(asset.id);
  if (!u) {
    u = assetFile(asset).then((f) => (f ? URL.createObjectURL(f) : null));
    urls.set(asset.id, u);
  }
  return u;
}

function useUrl(asset: AssetRow | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (asset) void urlOf(asset).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [asset]);
  return url;
}

// A green-screen overlay: the media plays hidden and each frame is drawn on a
// canvas with its key colour taken out (the same function as the export).
function Keyed({ source, chroma, filter }: { source: HTMLVideoElement | HTMLImageElement; chroma: Chroma; filter: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    let lastTime = -1;
    const paint = () => {
      raf = requestAnimationFrame(paint);
      const c = ref.current;
      const video = source instanceof HTMLVideoElement ? source : null;
      const ready = video ? video.readyState >= 2 : (source as HTMLImageElement).complete;
      if (!c || !ready) return;
      const t = video ? video.currentTime : 0;
      if (t === lastTime && c.width > 0 && !video?.seeking) return; // same frame
      lastTime = t;
      const sw = video ? video.videoWidth : (source as HTMLImageElement).naturalWidth;
      const sh = video ? video.videoHeight : (source as HTMLImageElement).naturalHeight;
      if (!sw || !sh) return;
      const k = Math.min(1, 540 / Math.max(sw, sh)); // a preview size keeps it fast
      const w = Math.max(2, Math.round(sw * k));
      const h = Math.max(2, Math.round(sh * k));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(source, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      keyImage(img, chroma);
      ctx.putImageData(img, 0, 0);
    };
    paint();
    return () => cancelAnimationFrame(raf);
  }, [source, chroma]);
  return <canvas ref={ref} className="absolute left-0 top-0 size-full" style={filter === "none" ? undefined : { filter }} />;
}

function Item({
  id,
  asset,
  filter,
  chroma,
  register,
}: {
  id: Id;
  asset: AssetRow | undefined;
  filter: string;
  chroma: Chroma | null;
  register: (id: Id, el: HTMLElement | null, loaded?: boolean) => void;
}) {
  const url = useUrl(asset);
  const [source, setSource] = useState<HTMLVideoElement | HTMLImageElement | null>(null);
  const ref = useCallback(
    (el: HTMLVideoElement | HTMLImageElement | null) => {
      register(id, el);
      setSource(el);
    },
    [id, register],
  );
  if (!url || !asset) return null;
  const common = {
    ref,
    className: "absolute left-0 top-0 size-full object-fill",
    // keyed: the element keeps playing but the canvas shows it
    style: chroma ? { opacity: 0 } : filter === "none" ? undefined : { filter },
  };
  return (
    <>
      {asset.kind === "image" ? (
        <img {...common} src={url} alt="" draggable={false} />
      ) : (
        <video {...common} src={url} playsInline muted preload="auto" onLoadedMetadata={() => register(id, null, true)} />
      )}
      {chroma && source && <Keyed source={source} chroma={chroma} filter={filter} />}
    </>
  );
}

function place(el: HTMLElement, b: TextBox) {
  const st = el.style;
  st.left = `${b.cx - b.w / 2}px`;
  st.top = `${b.cy - b.h / 2}px`;
  st.width = `${b.w}px`;
  st.height = `${b.h}px`;
  st.transform = `rotate(${b.rotation}deg)`;
}

function maskCss(url: string): CSSProperties {
  const v = `url(${url})`;
  return { maskImage: v, WebkitMaskImage: v, maskSize: "100% 100%", WebkitMaskSize: "100% 100%", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat" };
}

export function OverlayMedia({ width, height }: { width: number; height: number }) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const els = useRef(new Map<Id, HTMLElement>());
  const syncRef = useRef<() => void>(() => {});
  // stable, so the items' ref callbacks do not change on every render
  const register = useCallback((id: Id, el: HTMLElement | null, loaded = false) => {
    if (el) els.current.set(id, el);
    else if (!loaded) els.current.delete(id);
    syncRef.current();
  }, []);
  const sizeRef = useRef({ w: width, h: height });
  sizeRef.current = { w: width, h: height };

  // keep every video at the playhead's source time, and fades on the picture
  syncRef.current = () => {
    const s = useEditor.getState();
    const doc = s.draft ?? s.doc;
    if (!doc) return;
    const t = s.playheadUs;
    for (const [id, el] of els.current) {
      const hit = findItem(doc, id);
      if (!hit || hit.clip.type !== "media") continue;
      const c = hit.clip;
      // the wrapper holds picture and washes: it moves (keyframes) and fades
      const at = overlayAt(s.assets.get(c.assetId), c, sizeRef.current.w, sizeRef.current.h, t);
      // the layer's box is three levels up (box > mirror > crop > picture)
      const wrap = el.parentElement?.parentElement?.parentElement ?? el;
      place(wrap, at.box);
      wrap.style.opacity = String(at.alpha);
      if (!(el instanceof HTMLVideoElement) || el.readyState < 1) continue;
      const target = (c.freeze ? c.inUs : sourceTimeUs(c, Math.max(0, t - c.startUs))) / 1e6; // a held frame stays on it
      if (s.playing && !c.freeze) { // a held frame stays still
        el.playbackRate = Math.min(16, c.speed);
        if (el.paused) {
          el.currentTime = target;
          el.muted = hit.track.muted || hit.track.hidden || c.volume === 0;
          // unmuted play can be refused outside a tap: then play it silent
          el.play().catch(() => {
            el.muted = true;
            void el.play().catch(() => {});
          });
        } else if (Math.abs(el.currentTime - target) > 0.3) el.currentTime = target;
      } else {
        if (!el.paused) el.pause();
        if (!el.seeking && Math.abs(el.currentTime - target) > 0.02) el.currentTime = target;
      }
    }
  };

  useEffect(() => {
    let key = "";
    const keyOf = () => {
      const s = useEditor.getState();
      const doc = s.draft ?? s.doc;
      return doc ? overlaysAt(doc, s.playheadUs).map((c) => c.id).join(",") : "";
    };
    key = keyOf();
    const unsub = useEditor.subscribe((s, p) => {
      const k = keyOf();
      if (k !== key || s.doc !== p.doc || s.draft !== p.draft || s.assets !== p.assets) {
        key = k;
        rerender();
      }
      syncRef.current();
    });
    return () => {
      unsub();
      for (const el of els.current.values()) if (el instanceof HTMLVideoElement) el.pause();
    };
  }, []);

  // object URLs live as long as the editor
  useEffect(
    () => () => {
      for (const u of urls.values()) void u.then((x) => x && URL.revokeObjectURL(x));
      urls.clear();
    },
    [],
  );

  const s = useEditor.getState();
  const doc = s.draft ?? s.doc;
  if (!doc || !width) return null;
  return (
    // no z-index on this container: it would isolate the overlays, and blend
    // modes must reach the video below; each overlay carries the z-index
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {overlaysAt(doc, s.playheadUs).map((c) => {
        const asset = s.assets.get(c.assetId);
        const { box: b } = overlayAt(asset, c, width, height, s.playheadUs);
        const look = lookOf(c);
        const pl = cropPlacement(c.crop);
        const pct = (v: number) => `${(v * 100).toFixed(4)}%`;
        return (
          <div
            key={c.id}
            className="absolute overflow-hidden"
            style={{
              left: b.cx - b.w / 2,
              top: b.cy - b.h / 2,
              width: b.w,
              height: b.h,
              transform: `rotate(${b.rotation}deg)`,
              zIndex: 3,
              mixBlendMode: blendOf(c.blendMode).css as CSSProperties["mixBlendMode"],
              ...(c.mask ? maskCss(maskUrl(c.mask, b.w / Math.max(1, b.h))) : {}),
            }}
          >
            {/* crop: the whole picture, placed so the chosen part fills the box; mirror after it */}
            <div className="absolute inset-0" style={c.flip ? { transform: "scaleX(-1)" } : undefined}>
              <div className="absolute" style={{ left: pct(pl.x), top: pct(pl.y), width: pct(pl.w), height: pct(pl.h) }}>
                <Item id={c.id} asset={asset} filter={lookFilter(look)} chroma={c.chroma} register={register} />
              </div>
            </div>
            <LookWashes look={look} />
            <LookSvg look={look} />
          </div>
        );
      })}
    </div>
  );
}
