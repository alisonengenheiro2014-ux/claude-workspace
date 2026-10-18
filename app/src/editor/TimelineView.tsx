// The timeline under the preview. The playhead is fixed in the middle and the
// tracks scroll under it: scrollLeft / pxPerSec is the playhead time.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import type { Id, MediaClip } from "../data/db";
import { AddClipButton, Playhead, TimelineClip, TransitionMarker } from "../ui/Timeline";
import { formatTime } from "../ui/Transport";
import { useEditor, type Thumbs } from "./store";
import type { Track } from "../data/db";
import { PEAKS_PER_SEC } from "./audio";
import { audioTracks, durationOf, mainClips, move, moveItem, textTracks, trim, trimItem } from "./timeline";

const TILE = 52; // thumbnail tile width, same as the main track height

function tilesFor(clip: MediaClip, width: number, pxPerSec: number, thumbs: Thumbs | undefined) {
  if (!thumbs?.urls.length) return null;
  const n = Math.max(1, Math.ceil(width / TILE));
  return Array.from({ length: n }, (_, i) => {
    const srcS = (clip.inUs + ((i * TILE) / pxPerSec) * 1e6 * clip.speed) / 1e6;
    let best = 0;
    for (let k = 1; k < thumbs.times.length; k++) {
      if (Math.abs(thumbs.times[k] - srcS) < Math.abs(thumbs.times[best] - srcS)) best = k;
    }
    return (
      <img
        key={i}
        src={thumbs.urls[best]}
        alt=""
        draggable={false}
        className="h-full shrink-0 object-cover"
        style={{ width: TILE }}
      />
    );
  });
}

// The part of an asset's peaks a clip plays, resampled to ~one bar per 4px.
function waveSlice(peaks: number[] | undefined, clip: MediaClip, width: number) {
  if (!peaks?.length) return undefined;
  const bars = Math.max(1, Math.min(200, Math.floor(width / 4)));
  const from = (clip.inUs / 1e6) * PEAKS_PER_SEC;
  const to = (clip.outUs / 1e6) * PEAKS_PER_SEC;
  return Array.from({ length: bars }, (_, i) => {
    const a = Math.floor(from + ((to - from) * i) / bars);
    const b = Math.max(a + 1, Math.floor(from + ((to - from) * (i + 1)) / bars));
    let m = 0;
    for (let j = a; j < b && j < peaks.length; j++) m = Math.max(m, peaks[j]);
    return m;
  });
}

function Ruler({ totalUs, pxPerSec }: { totalUs: number; pxPerSec: number }) {
  // a label every 1, 2, 5, 10... seconds, at least ~70px apart
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300];
  const step = steps.find((s) => s * pxPerSec >= 70) ?? 600;
  const marks = [];
  for (let s = 0; s * 1e6 <= totalUs; s += step) marks.push(s);
  return (
    <div aria-hidden className="relative h-4">
      {marks.map((s) => (
        <span key={s} className="absolute top-0 -translate-x-1/2 font-mono text-2xs text-text-subtle" style={{ left: s * pxPerSec }}>
          {formatTime(s * 1e6)}
        </span>
      ))}
    </div>
  );
}

// Touching the timeline while it plays stops playback at once (as in CapCut),
// so the drag that follows scrubs from there.
function pauseIfPlaying() {
  if (useEditor.getState().playing) useEditor.getState().setPlaying(false);
}

export function TimelineView({
  onAddMedia,
  onTransition,
  missing,
}: {
  onAddMedia: () => void;
  onTransition: (fromId: Id) => void;
  missing: Set<Id>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // Trim handles: drag shows a live draft, release commits one undo step.
  const drag = useRef<{ mode: "start" | "end" | "move"; x: number; clipId: Id; overlay: boolean; moved: boolean } | null>(null);
  const programmatic = useRef(false);
  // Long-press reorder of main clips: hold ~0.4 s, drag, drop.
  const [reorder, setReorder] = useState<{ id: Id; x: number; y: number; index: number } | null>(null);
  const press = useRef<{ id: Id; x: number; y: number; pointerId: number; el: HTMLElement; timer: ReturnType<typeof setTimeout> } | null>(null);
  const clipEls = useRef(new Map<Id, HTMLElement>());
  const [viewW, setViewW] = useState(0);
  const doc = useEditor((s) => s.draft ?? s.doc);
  const assets = useEditor((s) => s.assets);
  const thumbs = useEditor((s) => s.thumbs);
  const waves = useEditor((s) => s.waves);
  const selectedId = useEditor((s) => s.selectedId);
  const playheadUs = useEditor((s) => s.playheadUs);
  const pxPerSec = useEditor((s) => s.pxPerSec);
  const playing = useEditor((s) => s.playing);
  const { select, setPlayhead, setZoom, setDraft, commit } = useEditor.getState();
  // the scroller only exists once the doc has loaded; effects re-run then
  const hasDoc = !!doc;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasDoc]);

  // playhead -> scroll position (playback, undo, zoom)
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const want = (playheadUs / 1e6) * pxPerSec;
    if (Math.abs(el.scrollLeft - want) > 0.5) {
      programmatic.current = true;
      el.scrollLeft = want;
    }
  }, [playheadUs, pxPerSec, viewW, hasDoc]);

  // pinch to zoom: Safari gesture events on iPhone, ctrl+wheel on trackpads
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let start = 0;
    const onStart = (e: Event) => {
      e.preventDefault();
      start = useEditor.getState().pxPerSec;
    };
    const onChange = (e: Event) => {
      e.preventDefault();
      setZoom(start * (e as Event & { scale: number }).scale);
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) {
        pauseIfPlaying();
        return;
      }
      e.preventDefault();
      setZoom(useEditor.getState().pxPerSec * Math.exp(-e.deltaY / 200));
    };
    el.addEventListener("gesturestart", onStart);
    el.addEventListener("gesturechange", onChange);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("gesturestart", onStart);
      el.removeEventListener("gesturechange", onChange);
      el.removeEventListener("wheel", onWheel);
    };
  }, [setZoom, hasDoc]);

  if (!doc) return null;
  const clips = mainClips(doc);
  const totalUs = durationOf(doc);
  const pad = viewW / 2;
  const px = (us: number) => (us / 1e6) * pxPerSec;

  function onScroll() {
    if (programmatic.current) {
      programmatic.current = false;
      return;
    }
    if (useEditor.getState().playing) return;
    setPlayhead((scroller.current!.scrollLeft / pxPerSec) * 1e6);
  }

  function onKeyDown(e: KeyboardEvent) {
    const step = e.shiftKey ? 100_000 : 1_000_000;
    if (e.key === "ArrowRight") setPlayhead(useEditor.getState().playheadUs + step);
    else if (e.key === "ArrowLeft") setPlayhead(useEditor.getState().playheadUs - step);
    else if (e.key === "Home") setPlayhead(0);
    else if (e.key === "End") setPlayhead(totalUs);
    else return;
    e.preventDefault();
  }

  const base = useEditor.getState().doc;
  function onHandleDown(e: PointerEvent, edge: "start" | "end" | "move", clipId: Id, overlay = false) {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode: edge, x: e.clientX, clipId, overlay, moved: false };
  }
  function onHandleMove(e: PointerEvent) {
    const d = drag.current;
    if (!d || !base) return;
    const deltaUs = ((e.clientX - d.x) / pxPerSec) * 1e6;
    if (Math.abs(e.clientX - d.x) > 3) d.moved = true;
    if (d.overlay) {
      const item = base.tracks.flatMap((t) => t.items).find((c) => c.id === d.clipId);
      if (!item) return;
      const a = item.type === "media" ? assets.get(item.assetId) : undefined;
      const mediaUs = a && a.kind !== "image" ? a.durationUs : null;
      setDraft(d.mode === "move" ? moveItem(base, d.clipId, item.startUs + deltaUs) : trimItem(base, d.clipId, d.mode, deltaUs, mediaUs));
      return;
    }
    const clip = mainClips(base).find((c) => c.id === d.clipId);
    if (!clip) return;
    const asset = assets.get(clip.assetId);
    const mediaUs = asset?.kind === "video" ? asset.durationUs : null;
    if (d.mode !== "move") setDraft(trim(base, d.clipId, d.mode, deltaUs, mediaUs));
  }
  function onHandleUp() {
    const d = drag.current;
    const draft = useEditor.getState().draft;
    drag.current = null;
    if (draft && d?.moved) commit(draft, d.mode === "move" ? "Mover" : "Aparar");
    else if (draft) setDraft(null);
  }

  const selected = clips.find((c) => c.id === selectedId);

  function dropIndex(id: Id, clientX: number) {
    const others = clips.filter((c) => c.id !== id);
    let i = 0;
    for (const c of others) {
      const r = clipEls.current.get(c.id)?.getBoundingClientRect();
      if (r && r.left + r.width / 2 < clientX) i++;
    }
    return i;
  }
  function onPressDown(e: PointerEvent, id: Id) {
    if (playing || (e.target as HTMLElement).closest("[data-handle]")) return;
    const el = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    const start = { x: e.clientX, y: e.clientY };
    press.current = {
      id,
      ...start,
      pointerId,
      el,
      timer: setTimeout(() => {
        el.setPointerCapture?.(pointerId);
        navigator.vibrate?.(10);
        setReorder({ id, ...start, index: dropIndex(id, start.x) });
      }, 400),
    };
  }
  function onPressMove(e: PointerEvent) {
    const p = press.current;
    if (!p) return;
    if (!reorder) {
      // moved before the hold finished: it's a scroll, not a reorder
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) {
        clearTimeout(p.timer);
        press.current = null;
      }
      return;
    }
    setReorder({ ...reorder, x: e.clientX, y: e.clientY, index: dropIndex(reorder.id, e.clientX) });
  }
  function onPressUp() {
    const p = press.current;
    if (p) clearTimeout(p.timer);
    press.current = null;
    if (!reorder) return;
    const from = clips.findIndex((c) => c.id === reorder.id);
    setReorder(null);
    const d = useEditor.getState().doc;
    if (d && from !== reorder.index) commit(move(d, reorder.id, reorder.index), "Mover clipe");
  }

  // One row of overlay items (text or audio): tap selects; a selected item
  // can be dragged in time and trimmed by its edges.
  const lane = (track: Track) => (
    <div key={track.id} className="relative h-[var(--layout-track-sub)] shrink-0">
      {track.items.map((c) => {
        const sel = c.id === selectedId;
        const w = Math.max(2, px(c.durationUs));
        const media = c.type === "media" ? c : null;
        const asset = media ? assets.get(media.assetId) : undefined;
        const label = c.type === "text" || c.type === "caption" ? c.text.split("\n")[0] || "Texto" : (asset?.name ?? "Áudio");
        return (
          <div
            key={c.id}
            className="absolute inset-y-0"
            style={{ left: px(c.startUs), width: w }}
            onPointerDown={sel ? (e) => onHandleDown(e, "move", c.id, true) : undefined}
            onPointerMove={sel ? onHandleMove : undefined}
            onPointerUp={sel ? onHandleUp : undefined}
            onPointerCancel={sel ? onHandleUp : undefined}
          >
            <TimelineClip
              kind={track.kind === "audio" ? "audio" : track.kind === "caption" ? "caption" : "text"}
              width={w}
              label={label}
              selected={sel}
              missing={!!media && (missing.has(media.assetId) || !asset)}
              waveform={media ? waveSlice(waves.get(media.assetId), media, w) : undefined}
              onSelect={() => !drag.current?.moved && select(sel ? null : c.id)}
            />
            {sel &&
              (["start", "end"] as const).map((edge) => (
                <div
                  key={edge}
                  role="presentation"
                  data-handle
                  onPointerDown={(e) => onHandleDown(e, edge, c.id, true)}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleUp}
                  onPointerCancel={onHandleUp}
                  className={`absolute inset-y-0 z-20 w-6 cursor-ew-resize touch-none ${edge === "start" ? "-left-3" : "-right-3"}`}
                />
              ))}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="relative h-[var(--layout-timeline)] bg-bg">
      {reorder &&
        createPortal(
          <div
            aria-hidden
            className="pointer-events-none fixed z-50 h-[var(--layout-track-main)] w-[var(--layout-track-main)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-sm shadow-pop outline-2 outline-selection"
            style={{ left: reorder.x, top: reorder.y - 30 }}
          >
            {(() => {
              const c = clips.find((x) => x.id === reorder.id);
              const t = c && thumbs.get(c.assetId);
              return t?.urls[0] ? <img src={t.urls[0]} alt="" className="size-full object-cover" /> : <span className="block size-full bg-track-video" />;
            })()}
          </div>,
          document.body,
        )}
      <Playhead />
      <div
        ref={scroller}
        role="slider"
        tabIndex={0}
        aria-label="Linha do tempo"
        aria-valuemin={0}
        aria-valuemax={Math.round(totalUs / 1e6)}
        aria-valuenow={Math.round(playheadUs / 1e6)}
        aria-valuetext={`${formatTime(playheadUs)} de ${formatTime(totalUs)}`}
        onScroll={onScroll}
        onPointerDownCapture={pauseIfPlaying}
        onKeyDown={onKeyDown}
        onClick={(e) => !(e.target as HTMLElement).closest("button") && select(null)}
        className="no-scrollbar h-full overflow-auto"
        style={{ touchAction: reorder ? "none" : "pan-x pan-y" }}
      >
        <div className="relative flex min-h-full flex-col justify-center gap-2 py-2" style={{ width: pad * 2 + px(totalUs) + 80, paddingLeft: pad }}>
          <Ruler totalUs={totalUs} pxPerSec={pxPerSec} />
          {doc.tracks.filter((t) => t.kind === "caption").map(lane)}
          {[...textTracks(doc)].reverse().map(lane)}
          <div className="relative flex items-center">
            {clips.map((clip, i) => {
              const w = Math.max(2, px(clip.durationUs));
              const asset = assets.get(clip.assetId);
              const dragging = reorder?.id === clip.id;
              return (
                <div
                  key={clip.id}
                  ref={(el) => {
                    if (el) clipEls.current.set(clip.id, el);
                    else clipEls.current.delete(clip.id);
                  }}
                  className={`relative flex items-center ${dragging ? "opacity-40" : ""}`}
                  onPointerDown={(e) => onPressDown(e, clip.id)}
                  onPointerMove={onPressMove}
                  onPointerUp={onPressUp}
                  onPointerCancel={onPressUp}
                >
                  {reorder && !dragging && reorder.index === clips.filter((c) => c.id !== reorder.id).indexOf(clip) && (
                    <span aria-hidden className="absolute -left-1 inset-y-[-6px] z-30 w-1 rounded-pill bg-accent" />
                  )}
                  <TimelineClip
                    kind="main"
                    width={w}
                    label={asset?.name}
                    selected={clip.id === selectedId}
                    missing={missing.has(clip.assetId) || !asset}
                    thumbs={tilesFor(clip, w, pxPerSec, thumbs.get(clip.assetId))}
                    onSelect={() => select(clip.id === selectedId ? null : clip.id)}
                  />
                  {i < clips.length - 1 && (
                    <div className="absolute -right-[22px] z-10">
                      <TransitionMarker
                        active={doc.transitions.some((t) => t.fromClipId === clip.id)}
                        onClick={() => onTransition(clip.id)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {reorder && reorder.index >= clips.length - 1 && <span aria-hidden className="z-30 -ml-1 h-[calc(var(--layout-track-main)+12px)] w-1 rounded-pill bg-accent" />}
            <AddClipButton onClick={onAddMedia} />
            {selected && (
              <>
                <div
                  role="presentation"
                  data-handle
                  onPointerDown={(e) => onHandleDown(e, "start", selected.id)}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleUp}
                  onPointerCancel={onHandleUp}
                  className="absolute inset-y-0 z-20 w-6 -translate-x-1/2 cursor-ew-resize touch-none"
                  style={{ left: px(selected.startUs) + 6 }}
                />
                <div
                  role="presentation"
                  data-handle
                  onPointerDown={(e) => onHandleDown(e, "end", selected.id)}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleUp}
                  onPointerCancel={onHandleUp}
                  className="absolute inset-y-0 z-20 w-6 -translate-x-1/2 cursor-ew-resize touch-none"
                  style={{ left: px(selected.startUs + selected.durationUs) - 6 }}
                />
              </>
            )}
          </div>
          {audioTracks(doc).map(lane)}
        </div>
      </div>
    </div>
  );
}
