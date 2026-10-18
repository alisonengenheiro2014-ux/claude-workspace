// The timeline under the preview. The playhead is fixed in the middle and the
// tracks scroll under it: scrollLeft / pxPerSec is the playhead time.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import type { Id, MediaClip } from "../data/db";
import { AddClipButton, Playhead, TimelineClip, TransitionMarker } from "../ui/Timeline";
import { formatTime } from "../ui/Transport";
import { useEditor, type Thumbs } from "./store";
import type { Track } from "../data/db";
import { PEAKS_PER_SEC } from "./audio";
import { keyTimes } from "./keyframes";
import { effectOf } from "./effects";
import { audioTracks, durationOf, mainClips, move, moveItem, overlayTracks, textTracks, effectTracks, snapTargets, snapShift, sourceTimeUs, offsetForSource, trim, trimItem } from "./timeline";

const TILE = 52; // thumbnail tile width, same as the main track height

function tilesFor(clip: MediaClip, width: number, pxPerSec: number, thumbs: Thumbs | undefined) {
  if (!thumbs?.urls.length) return null;
  const n = Math.max(1, Math.ceil(width / TILE));
  return Array.from({ length: n }, (_, i) => {
    // a freeze frame shows its one frame all along
    const srcS = (clip.freeze ? clip.inUs : sourceTimeUs(clip, ((i * TILE) / pxPerSec) * 1e6)) / 1e6;
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
// Reorder: the clips shown as squares in a row (CapCut's long-press view).
type Reorder = { id: Id; x: number; y: number; left: number; top: number; index: number };
const SQ = 52; // --layout-track-main
const STEP = SQ + 6;

// where the held clip would go, from the finger and the row's left edge
function slotAt(x: number, left: number, others: number) {
  return Math.max(0, Math.min(others, Math.round((x - SQ / 2 - left) / STEP)));
}

function Square({ url, x, held = false }: { url: string | undefined; x: number; held?: boolean }) {
  return (
    <span
      className={`absolute top-0 block overflow-hidden rounded-sm ${held ? "z-10 scale-110 shadow-pop outline-2 outline-selection" : "transition-[left] duration-150"}`}
      style={{ left: x, width: SQ, height: SQ }}
    >
      {url ? <img src={url} alt="" className="size-full object-cover" /> : <span className="block size-full bg-track-video" />}
    </span>
  );
}

function AddLane({ label, width, onClick }: { label: string; width: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[var(--layout-track-sub)] shrink-0 items-center gap-1.5 rounded-xs bg-surface-2 px-3 text-xs text-text-muted"
      style={{ width: Math.max(width, 140) }}
    >
      <Plus aria-hidden className="size-3.5" />
      {label}
    </button>
  );
}

function pauseIfPlaying() {
  if (useEditor.getState().playing) useEditor.getState().setPlaying(false);
}

export function TimelineView({
  onAddMedia,
  onAddAudio,
  onAddText,
  onTransition,
  missing,
}: {
  onAddMedia: () => void;
  onAddAudio: () => void;
  onAddText: () => void;
  onTransition: (fromId: Id) => void;
  missing: Set<Id>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // Trim handles: drag shows a live draft, release commits one undo step.
  const drag = useRef<{ mode: "start" | "end" | "move"; x: number; clipId: Id; overlay: boolean; moved: boolean } | null>(null);
  const programmatic = useRef(false);
  // Long-press reorder of main clips, like CapCut: hold ~0.4 s and the clips
  // become squares; drag the held one sideways, release to drop it there.
  const [reorder, setReorderState] = useState<Reorder | null>(null);
  const reorderRef = useRef<Reorder | null>(null);
  const setReorder = (r: Reorder | null) => {
    reorderRef.current = r;
    setReorderState(r);
  };
  const press = useRef<{ id: Id; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
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

  // While reordering, the page must not scroll: Safari picks scrolling on the
  // first finger move and ignores touch-action changed mid-touch, so the
  // touch moves are cancelled here instead (needs a non-passive listener).
  useEffect(() => {
    const block = (e: TouchEvent) => {
      if (reorderRef.current) e.preventDefault();
    };
    window.addEventListener("touchmove", block, { passive: false });
    return () => window.removeEventListener("touchmove", block);
  }, []);

  // the drag itself follows the window, so nothing under the finger can lose it
  const reordering = !!reorder;
  useEffect(() => {
    if (!reordering) return;
    let raf = 0;
    const count = mainClips(useEditor.getState().doc!).length - 1;
    const at = (r: Reorder, x: number, left = r.left) => ({ ...r, x, left, index: slotAt(x, left, count) });
    const onMove = (e: globalThis.PointerEvent) => {
      const r = reorderRef.current;
      if (r) setReorder({ ...at(r, e.clientX), y: e.clientY });
    };
    const onUp = (e: globalThis.PointerEvent) => {
      const r = reorderRef.current;
      setReorder(null);
      if (!r || e.type === "pointercancel") return;
      const d = useEditor.getState().doc;
      const from = d ? mainClips(d).findIndex((c) => c.id === r.id) : -1;
      if (d && from >= 0 && from !== r.index) commit(move(d, r.id, r.index), "Mover clipe");
    };
    // near a screen edge the row slides, to reach clips off screen
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const r = reorderRef.current;
      if (!r) return;
      const edge = 48;
      const v = r.x < edge ? 6 : r.x > window.innerWidth - edge ? -6 : 0;
      if (!v) return;
      const min = Math.min(r.x - SQ / 2 - count * STEP, r.left);
      const max = Math.max(r.x - SQ / 2, r.left);
      const left = Math.max(min, Math.min(max, r.left + v));
      if (left !== r.left) setReorder(at(r, r.x, left));
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [reordering, commit]);

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
    // magnetic: edges stick to the playhead, other items' edges and beat marks
    const tol = (10 / pxPerSec) * 1e6;
    const targets = snapTargets(base, useEditor.getState().playheadUs, d.clipId);
    if (d.overlay) {
      const item = base.tracks.flatMap((t) => t.items).find((c) => c.id === d.clipId);
      if (!item) return;
      const a = item.type === "media" ? assets.get(item.assetId) : undefined;
      const mediaUs = a && a.kind !== "image" ? a.durationUs : null;
      const start = item.startUs + deltaUs;
      const end = item.startUs + item.durationUs + deltaUs;
      const snapped = deltaUs + snapShift(d.mode === "move" ? [start, end] : d.mode === "start" ? [start] : [end], targets, tol);
      setDraft(d.mode === "move" ? moveItem(base, d.clipId, item.startUs + snapped) : trimItem(base, d.clipId, d.mode, snapped, mediaUs));
      return;
    }
    const clip = mainClips(base).find((c) => c.id === d.clipId);
    if (!clip) return;
    const asset = assets.get(clip.assetId);
    const mediaUs = asset?.kind === "video" ? asset.durationUs : null;
    // the end of a main clip snaps too (its start moves everything after it)
    const snapped = d.mode === "end" ? deltaUs + snapShift([clip.startUs + clip.durationUs + deltaUs], targets, tol) : deltaUs;
    if (d.mode !== "move") setDraft(trim(base, d.clipId, d.mode, snapped, mediaUs));
  }
  function onHandleUp() {
    const d = drag.current;
    const draft = useEditor.getState().draft;
    drag.current = null;
    if (draft && d?.moved) commit(draft, d.mode === "move" ? "Mover" : "Aparar");
    else if (draft) setDraft(null);
  }

  const selected = clips.find((c) => c.id === selectedId);

  function onPressDown(e: PointerEvent, id: Id) {
    // only the clip itself: not its trim handles or the transition button
    const btn = (e.target as HTMLElement).closest("button, [data-handle]");
    if (playing || e.button > 0 || !btn?.hasAttribute("aria-pressed")) return;
    const start = { x: e.clientX, y: e.clientY };
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    press.current = {
      id,
      ...start,
      timer: setTimeout(() => {
        press.current = null;
        const from = clips.findIndex((c) => c.id === id);
        navigator.vibrate?.(10);
        // the held square starts under the finger, the others around it
        const left = start.x - SQ / 2 - from * STEP;
        setReorder({ id, ...start, left, top: rect.top + rect.height / 2, index: from });
      }, 400),
    };
  }
  function onPressMove(e: PointerEvent) {
    const p = press.current;
    // moved before the hold finished: it's a scroll, not a reorder
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) {
      clearTimeout(p.timer);
      press.current = null;
    }
  }
  function onPressUp() {
    const p = press.current;
    if (p) clearTimeout(p.timer);
    press.current = null;
  }

  // One row of overlay items (text or audio): tap selects; a selected item
  // can be dragged in time and trimmed by its edges.
  const lane = (track: Track) => (
    <div key={track.id} className={`relative h-[var(--layout-track-sub)] shrink-0 ${track.hidden ? "opacity-35" : ""}`}>
      {track.items.map((c) => {
        const sel = c.id === selectedId;
        const w = Math.max(2, px(c.durationUs));
        const media = c.type === "media" ? c : null;
        const asset = media ? assets.get(media.assetId) : undefined;
        const fx = c.type === "effect" ? effectOf(c.effectId) : undefined;
        const label =
          c.type === "text" || c.type === "caption"
            ? c.text.split("\n")[0] || "Texto"
            : c.type === "effect"
              ? `${fx?.emoji ?? ""} ${fx?.label ?? "Efeito"}`
              : (asset?.name ?? "Áudio");
        const thumb = track.kind === "overlay" && media ? thumbs.get(media.assetId)?.urls[0] : undefined;
        return (
          <div
            key={c.id}
            // selected: the finger moves the item, the timeline must not scroll
            className={`absolute inset-y-0 ${sel && !track.locked ? "touch-none" : ""}`}
            style={{ left: px(c.startUs), width: w }}
            onPointerDown={sel && !track.locked ? (e) => onHandleDown(e, "move", c.id, true) : undefined}
            onPointerMove={sel && !track.locked ? onHandleMove : undefined}
            onPointerUp={sel && !track.locked ? onHandleUp : undefined}
            onPointerCancel={sel && !track.locked ? onHandleUp : undefined}
          >
            <TimelineClip
              kind={track.kind === "audio" || track.kind === "caption" || track.kind === "overlay" || track.kind === "effect" ? track.kind : "text"}
              width={w}
              label={track.locked ? `🔒 ${label}` : label}
              selected={sel}
              missing={!!media && (missing.has(media.assetId) || !asset)}
              keyframes={keyTimes(c).map((t) => t / Math.max(1, c.durationUs))}
              marks={media?.beats?.filter((b) => b >= media.inUs && b <= media.outUs).map((b) => offsetForSource(media, b) / Math.max(1, media.durationUs))}
              thumbs={
                thumb
                  ? Array.from({ length: Math.min(40, Math.ceil(w / 36)) }, (_, i) => (
                      <img key={i} src={thumb} alt="" className="h-full w-9 shrink-0 object-cover" />
                    ))
                  : undefined
              }
              waveform={media && track.kind === "audio" ? waveSlice(waves.get(media.assetId), media, w) : undefined}
              onSelect={() => !drag.current?.moved && select(sel ? null : c.id)}
            />
            {sel &&
              !track.locked &&
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
          <div aria-hidden className="pointer-events-none fixed inset-x-0 z-50" style={{ top: reorder.top - SQ / 2, height: SQ }}>
            {clips
              .filter((c) => c.id !== reorder.id)
              .map((c, j) => (
                <Square key={c.id} url={thumbs.get(c.assetId)?.urls[0]} x={reorder.left + (j < reorder.index ? j : j + 1) * STEP} />
              ))}
            {(() => {
              const c = clips.find((x) => x.id === reorder.id);
              return c && <Square url={thumbs.get(c.assetId)?.urls[0]} x={reorder.x - SQ / 2} held />;
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
        style={{ touchAction: reorder ? "none" : "pan-x pan-y", WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="relative flex min-h-full flex-col justify-center gap-2 py-2" style={{ width: pad * 2 + px(totalUs) + 80, paddingLeft: pad }}>
          <Ruler totalUs={totalUs} pxPerSec={pxPerSec} />
          {[...effectTracks(doc)].reverse().map(lane)}
          {doc.tracks.filter((t) => t.kind === "caption").map(lane)}
          {[...textTracks(doc)].reverse().map(lane)}
          <div className="relative flex items-center">
            {clips.map((clip, i) => {
              const w = Math.max(2, px(clip.durationUs));
              const asset = assets.get(clip.assetId);
              return (
                <div
                  key={clip.id}
                  className={`relative flex items-center ${reorder ? "invisible" : ""}`}
                  onPointerDown={(e) => onPressDown(e, clip.id)}
                  onPointerMove={onPressMove}
                  onPointerUp={onPressUp}
                  onPointerCancel={onPressUp}
                >
                  <TimelineClip
                    kind="main"
                    width={w}
                    label={asset?.name}
                    selected={clip.id === selectedId}
                    missing={missing.has(clip.assetId) || !asset}
                    thumbs={tilesFor(clip, w, pxPerSec, thumbs.get(clip.assetId))}
                    keyframes={keyTimes(clip).map((t) => t / Math.max(1, clip.durationUs))}
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
          {/* layers under the video, like CapCut's Camada: the bottom layer nearest it */}
          {overlayTracks(doc).map(lane)}
          {audioTracks(doc).map(lane)}
          {/* empty rows under the video, like CapCut: a tap adds the first one */}
          {audioTracks(doc).every((t) => !t.items.length) && <AddLane label="Adicionar áudio" width={px(totalUs)} onClick={onAddAudio} />}
          {textTracks(doc).every((t) => !t.items.length) && <AddLane label="Adicionar texto" width={px(totalUs)} onClick={onAddText} />}
        </div>
      </div>
    </div>
  );
}
