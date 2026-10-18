// The preview's photos and videos over the main video. Each is a DOM element
// placed with overlayBox; videos follow the playhead (seek while paused, play
// along and correct drift while playing). Placing them is done by the text
// canvas above (TextOverlay), which handles every on-screen gesture.
import { useEffect, useReducer, useRef, useState } from "react";
import type { AssetRow, Id } from "../data/db";
import type { TextBox } from "./text";
import { assetFile } from "../media/import";
import { cssFilter, lookOf } from "./look";
import { LookWashes } from "./LookLayer";
import { overlayAt, overlaysAt } from "./overlay";
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

function Item({
  id,
  asset,
  filter,
  register,
}: {
  id: Id;
  asset: AssetRow | undefined;
  filter: string;
  register: (id: Id, el: HTMLElement | null, loaded?: boolean) => void;
}) {
  const url = useUrl(asset);
  if (!url || !asset) return null;
  const common = {
    ref: (el: HTMLElement | null) => register(id, el),
    className: "absolute left-0 top-0 size-full object-fill",
    style: filter === "none" ? undefined : { filter },
  };
  return asset.kind === "image" ? (
    <img {...common} src={url} alt="" draggable={false} />
  ) : (
    <video {...common} src={url} playsInline muted preload="auto" onLoadedMetadata={() => register(id, null, true)} />
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

export function OverlayMedia({ width, height }: { width: number; height: number }) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const els = useRef(new Map<Id, HTMLElement>());
  const syncRef = useRef<() => void>(() => {});
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
      const wrap = el.parentElement ?? el;
      place(wrap, at.box);
      wrap.style.opacity = String(at.alpha);
      if (!(el instanceof HTMLVideoElement) || el.readyState < 1) continue;
      const target = sourceTimeUs(c, Math.max(0, t - c.startUs)) / 1e6;
      if (s.playing) {
        el.playbackRate = Math.min(16, c.speed);
        if (el.paused) {
          el.currentTime = target;
          el.muted = hit.track.muted || c.volume === 0;
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
  const register = (id: Id, el: HTMLElement | null, loaded = false) => {
    if (el) els.current.set(id, el);
    else if (!loaded) els.current.delete(id);
    syncRef.current();
  };
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[3]">
      {overlaysAt(doc, s.playheadUs).map((c) => {
        const asset = s.assets.get(c.assetId);
        const { box: b } = overlayAt(asset, c, width, height, s.playheadUs);
        const look = lookOf(c);
        return (
          <div
            key={c.id}
            className="absolute overflow-hidden"
            style={{ left: b.cx - b.w / 2, top: b.cy - b.h / 2, width: b.w, height: b.h, transform: `rotate(${b.rotation}deg)` }}
          >
            <Item id={c.id} asset={asset} filter={cssFilter(look)} register={register} />
            <LookWashes look={look} />
          </div>
        );
      })}
    </div>
  );
}
