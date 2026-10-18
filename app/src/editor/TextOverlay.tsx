// Text drawn over the preview, and the gestures to place it and the photos
// and videos on top (drawn below by OverlayMedia): tap to select, drag to
// move, drag the corner handle (or pinch with two fingers) to scale and
// rotate, double-tap to edit a text. Each gesture is one undo step. A
// selected layer or text also has CapCut's corner buttons: X deletes it
// (top left), the other duplicates it (bottom left).
import { useEffect, useRef, type PointerEvent } from "react";
import type { Id, Transform } from "../data/db";
import { useEditor } from "./store";
import { drawText, hitBox, loadFonts, textsAt, type TextBox } from "./text";
import type { Clip } from "../data/db";
import { containRect, shapedSize, shapeOf } from "./frame";
import { animatedAt, mainZoom } from "./keyframes";
import { displaySize, overlayAt, overlaysAt } from "./overlay";
import { findItem, mainClips, setAnimated, setCaptionTransform } from "./timeline";

const HANDLE = 14; // css px radius of the corner handle
const CORNER_OUT = 12; // css px the delete/duplicate buttons sit past the corners, clear of short text

type Gesture =
  | { kind: "move"; id: Id; x0: number; y0: number; t0: Transform }
  | { kind: "handle"; id: Id; box: TextBox; t0: Transform; d0: number; a0: number }
  | { kind: "pinch"; id: Id; t0: Transform; d0: number; a0: number };

export function TextOverlay({
  width,
  height,
  onEdit,
  onRemove,
  onDuplicate,
}: {
  width: number;
  height: number;
  onEdit: (id: Id) => void;
  onRemove: () => void; // the selected item
  onDuplicate: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const boxes = useRef(new Map<Id, TextBox>());
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastTap = useRef<{ id: Id; at: number } | null>(null);
  const dpr = Math.min(3, window.devicePixelRatio || 1);

  // redraw whenever anything visible changes
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = canvas.current;
        const s = useEditor.getState();
        const doc = s.draft ?? s.doc;
        if (!el || !doc) return;
        const W = Math.round(width * dpr);
        const H = Math.round(height * dpr);
        if (el.width !== W || el.height !== H) {
          el.width = W;
          el.height = H;
        }
        const ctx = el.getContext("2d")!;
        ctx.clearRect(0, 0, W, H);
        boxes.current.clear();
        // the main video, when selected, can be zoomed and moved too
        const main = s.selectedId ? mainClips(doc).find((c) => c.id === s.selectedId) : undefined;
        if (main && s.playheadUs >= main.startUs && s.playheadUs < main.startUs + main.durationUs) {
          const src = displaySize(s.assets.get(main.assetId));
          const size = shapedSize(src.w, src.h, shapeOf(main));
          const r = containRect(size.w, size.h, W, H);
          const z = mainZoom(main, s.playheadUs - main.startUs);
          boxes.current.set(main.id, { cx: W / 2 + z.dx * W, cy: H / 2 + z.dy * H, w: r.w * z.scale, h: r.h * z.scale, rotation: 0 });
        }
        for (const c of overlaysAt(doc, s.playheadUs)) boxes.current.set(c.id, overlayAt(s.assets.get(c.assetId), c, W, H, s.playheadUs).box);
        for (const c of textsAt(doc.tracks, s.playheadUs)) {
          const b = drawText(ctx, c, W, H, s.playheadUs - c.startUs, s.playing);
          if (b) boxes.current.set(c.id, b);
        }
        const sel = s.selectedId && boxes.current.get(s.selectedId);
        if (sel && !s.playing) drawSelection(ctx, sel, dpr, hasCorners(s.selectedId!));
      });
    };
    draw();
    void loadFonts().then(draw);
    const unsub = useEditor.subscribe((s, p) => {
      if (
        s.doc !== p.doc ||
        s.draft !== p.draft ||
        s.playheadUs !== p.playheadUs ||
        s.selectedId !== p.selectedId ||
        s.playing !== p.playing ||
        s.assets !== p.assets
      )
        draw();
    });
    return () => {
      unsub();
      cancelAnimationFrame(raf);
    };
  }, [width, height, dpr]);

  const toCanvas = (e: PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
  };

  // text items, captions and overlay media can be placed; captions all move together
  function textOf(id: Id) {
    const s = useEditor.getState();
    const hit = s.doc && findItem(s.doc, id);
    if (!hit) return null;
    if (hit.clip.type === "text" || hit.clip.type === "caption" || hit.track.kind === "overlay" || hit.track.kind === "main") return hit.clip;
    return null;
  }
  // layers and texts get the delete and duplicate corners (not the main
  // video, captions, or anything on a locked lane)
  function hasCorners(id: Id) {
    const d = useEditor.getState().doc;
    const hit = d && findItem(d, id);
    return !!hit && !hit.track.locked && (hit.track.kind === "overlay" || hit.clip.type === "text");
  }
  const isMain = (id: Id) => {
    const d = useEditor.getState().doc;
    return !!d && mainClips(d).some((c) => c.id === id);
  };

  // where the item is at the playhead (keyframes included)
  function nowTransform(c: Clip): Transform {
    if (c.type === "caption") return { ...c.transform };
    return { ...animatedAt(c, useEditor.getState().playheadUs - c.startUs).transform };
  }

  function apply(id: Id, transform: Transform) {
    const s = useEditor.getState();
    if (!s.doc) return;
    const c = textOf(id);
    s.setDraft(c?.type === "caption" ? setCaptionTransform(s.doc, transform) : setAnimated(s.doc, id, s.playheadUs, { transform }));
  }

  function onDown(e: PointerEvent) {
    const s = useEditor.getState();
    if (s.playing) return;
    const p = toCanvas(e);
    pointers.current.set(e.pointerId, p);
    canvas.current!.setPointerCapture(e.pointerId);
    const W = canvas.current!.width;
    const H = canvas.current!.height;

    // second finger on a selected text: pinch
    if (pointers.current.size === 2 && gesture.current) {
      const id = gesture.current.id;
      const t = textOf(id);
      const [a, b] = [...pointers.current.values()];
      if (t) gesture.current = { kind: "pinch", id, t0: nowTransform(t), d0: Math.hypot(b.x - a.x, b.y - a.y), a0: Math.atan2(b.y - a.y, b.x - a.x) };
      return;
    }

    // corner handle of the selected text
    const selBox = s.selectedId ? boxes.current.get(s.selectedId) : undefined;
    if (selBox && s.selectedId && hasCorners(s.selectedId)) {
      const near = (c: { x: number; y: number }) => Math.hypot(p.x - c.x, p.y - c.y) <= HANDLE * dpr * 1.6;
      if (near(cornerPos(selBox, -1, -1, CORNER_OUT * dpr))) {
        pointers.current.delete(e.pointerId);
        onRemove();
        return;
      }
      if (near(cornerPos(selBox, -1, 1, CORNER_OUT * dpr))) {
        pointers.current.delete(e.pointerId);
        onDuplicate();
        return;
      }
    }
    const t = s.selectedId ? textOf(s.selectedId) : null;
    if (selBox && t && !(s.doc && findItem(s.doc, t.id)?.track.locked)) {
      const h = handlePos(selBox);
      if (Math.hypot(p.x - h.x, p.y - h.y) <= HANDLE * dpr * 1.6) {
        gesture.current = {
          kind: "handle",
          id: t.id,
          box: selBox,
          t0: nowTransform(t),
          d0: Math.hypot(p.x - selBox.cx, p.y - selBox.cy),
          a0: Math.atan2(p.y - selBox.cy, p.x - selBox.cx),
        };
        return;
      }
    }

    // a text under the finger (topmost first)
    const hits = [...boxes.current.entries()].reverse().find(([, b]) => hitBox(b, p.x, p.y, 8 * dpr));
    if (hits) {
      const [id] = hits;
      const now = performance.now();
      if (lastTap.current?.id === id && now - lastTap.current.at < 350 && textOf(id)?.type !== "media" && !isMain(id)) {
        lastTap.current = null;
        onEdit(id);
        return;
      }
      lastTap.current = { id, at: now };
      s.select(id);
      if (s.doc && findItem(s.doc, id)?.track.locked) return; // locked lane: select only
      const tt = textOf(id)!;
      gesture.current = { kind: "move", id, x0: p.x / W, y0: p.y / H, t0: nowTransform(tt) };
      return;
    }
    if (s.selectedId && textOf(s.selectedId)) s.select(null);
  }

  function onMove(e: PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    const p = toCanvas(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    const W = canvas.current!.width;
    const H = canvas.current!.height;
    if (g.kind === "move") {
      const x = Math.min(1, Math.max(0, g.t0.x + p.x / W - g.x0));
      const y = Math.min(1, Math.max(0, g.t0.y + p.y / H - g.y0));
      apply(g.id, { ...g.t0, x, y });
    } else if (g.kind === "handle") {
      const d = Math.hypot(p.x - g.box.cx, p.y - g.box.cy);
      const a = Math.atan2(p.y - g.box.cy, p.x - g.box.cx);
      const rotation = isMain(g.id) ? g.t0.rotation : snapAngle(g.t0.rotation + ((a - g.a0) * 180) / Math.PI);
      apply(g.id, { ...g.t0, scale: clampScale(g.t0.scale * (d / g.d0)), rotation });
    } else if (g.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const rotation = isMain(g.id) ? g.t0.rotation : snapAngle(g.t0.rotation + ((ang - g.a0) * 180) / Math.PI);
      apply(g.id, { ...g.t0, scale: clampScale(g.t0.scale * (d / g.d0)), rotation });
    }
  }

  function onUp(e: PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) return;
    const g = gesture.current;
    gesture.current = null;
    const s = useEditor.getState();
    if (g && s.draft) s.commit(s.draft, g.kind === "move" ? "Mover" : "Ajustar tamanho");
  }

  return (
    <canvas
      ref={canvas}
      aria-hidden
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className="absolute inset-0 z-[4] size-full touch-none"
    />
  );
}

const clampScale = (s: number) => Math.min(8, Math.max(0.15, s));
// snaps to 0/90/180/270 when within 4 degrees, so straight text is easy
function snapAngle(deg: number) {
  const r = ((deg % 360) + 360) % 360;
  for (const s of [0, 90, 180, 270, 360]) if (Math.abs(r - s) < 4) return s % 360;
  return Math.round(r * 10) / 10;
}

// a corner of the (turned) box: sx, sy are -1 (left/top) or 1 (right/bottom);
// `out` moves it that far further out, past the corner
function cornerPos(b: TextBox, sx: number, sy: number, out = 0) {
  const a = (b.rotation * Math.PI) / 180;
  const hx = sx * (b.w / 2 + out);
  const hy = sy * (b.h / 2 + out);
  return { x: b.cx + hx * Math.cos(a) - hy * Math.sin(a), y: b.cy + hx * Math.sin(a) + hy * Math.cos(a) };
}
const handlePos = (b: TextBox) => cornerPos(b, 1, 1);

// CapCut's corner buttons: a dark round button with a white sign
function drawCornerButton(ctx: CanvasRenderingContext2D, at: { x: number; y: number }, dpr: number, sign: "x" | "copy") {
  const r = HANDLE * dpr * 0.85;
  ctx.save();
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(20,20,20,.85)";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.6 * dpr;
  ctx.lineCap = "round";
  const k = r * 0.38;
  if (sign === "x") {
    ctx.beginPath();
    ctx.moveTo(at.x - k, at.y - k);
    ctx.lineTo(at.x + k, at.y + k);
    ctx.moveTo(at.x + k, at.y - k);
    ctx.lineTo(at.x - k, at.y + k);
    ctx.stroke();
  } else {
    // two overlapping squares
    const q = k * 1.25;
    ctx.strokeRect(at.x - q * 0.8, at.y - q * 0.3, q * 1.1, q * 1.1);
    ctx.strokeRect(at.x - q * 0.3, at.y - q * 0.8, q * 1.1, q * 1.1);
  }
  ctx.restore();
}

// Selection frame: a light dashed box and the corner handle. Raw colours on
// purpose: it sits on video, so it needs white with a dark edge.
function drawSelection(ctx: CanvasRenderingContext2D, b: TextBox, dpr: number, corners: boolean) {
  ctx.save();
  ctx.translate(b.cx, b.cy);
  ctx.rotate((b.rotation * Math.PI) / 180);
  ctx.lineWidth = 1.5 * dpr;
  ctx.setLineDash([6 * dpr, 4 * dpr]);
  ctx.strokeStyle = "rgba(0,0,0,.6)";
  ctx.strokeRect(-b.w / 2 - 6 * dpr, -b.h / 2 - 6 * dpr, b.w + 12 * dpr, b.h + 12 * dpr);
  ctx.setLineDash([]);
  ctx.strokeStyle = "#ffffff";
  ctx.strokeRect(-b.w / 2 - 5 * dpr, -b.h / 2 - 5 * dpr, b.w + 10 * dpr, b.h + 10 * dpr);
  ctx.restore();
  const h = handlePos(b);
  ctx.beginPath();
  ctx.arc(h.x, h.y, HANDLE * dpr * 0.7, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 1.5 * dpr;
  ctx.strokeStyle = "rgba(0,0,0,.5)";
  ctx.stroke();
  // little rotate arrow
  ctx.beginPath();
  ctx.arc(h.x, h.y, HANDLE * dpr * 0.35, 0.3, Math.PI * 1.6);
  ctx.strokeStyle = "#000000";
  ctx.stroke();
  if (corners) {
    drawCornerButton(ctx, cornerPos(b, -1, -1, CORNER_OUT * dpr), dpr, "x");
    drawCornerButton(ctx, cornerPos(b, -1, 1, CORNER_OUT * dpr), dpr, "copy");
  }
}
