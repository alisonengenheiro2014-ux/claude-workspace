// Text drawn over the preview, and the gestures to place it: tap to select,
// drag to move, drag the corner handle (or pinch with two fingers) to scale
// and rotate, double-tap to edit. Each gesture is one undo step.
import { useEffect, useRef, type PointerEvent } from "react";
import type { Id, Transform } from "../data/db";
import { useEditor } from "./store";
import { drawText, hitBox, loadFonts, textsAt, type TextBox } from "./text";
import { findItem, setText } from "./timeline";

const HANDLE = 14; // css px radius of the corner handle

type Gesture =
  | { kind: "move"; id: Id; x0: number; y0: number; t0: Transform }
  | { kind: "handle"; id: Id; box: TextBox; t0: Transform; d0: number; a0: number }
  | { kind: "pinch"; id: Id; t0: Transform; d0: number; a0: number };

export function TextOverlay({ width, height, onEdit }: { width: number; height: number; onEdit: (id: Id) => void }) {
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
        for (const c of textsAt(doc.tracks, s.playheadUs)) {
          const b = drawText(ctx, c, W, H, s.playheadUs - c.startUs, s.playing);
          if (b) boxes.current.set(c.id, b);
        }
        const sel = s.selectedId && boxes.current.get(s.selectedId);
        if (sel && !s.playing) drawSelection(ctx, sel, dpr);
      });
    };
    draw();
    void loadFonts().then(draw);
    const unsub = useEditor.subscribe((s, p) => {
      if (s.doc !== p.doc || s.draft !== p.draft || s.playheadUs !== p.playheadUs || s.selectedId !== p.selectedId || s.playing !== p.playing)
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

  function textOf(id: Id) {
    const s = useEditor.getState();
    const hit = s.doc && findItem(s.doc, id);
    return hit && hit.clip.type === "text" ? hit.clip : null;
  }

  function apply(id: Id, transform: Transform) {
    const s = useEditor.getState();
    if (s.doc) s.setDraft(setText(s.doc, id, { transform }));
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
      if (t) gesture.current = { kind: "pinch", id, t0: { ...t.transform }, d0: Math.hypot(b.x - a.x, b.y - a.y), a0: Math.atan2(b.y - a.y, b.x - a.x) };
      return;
    }

    // corner handle of the selected text
    const selBox = s.selectedId ? boxes.current.get(s.selectedId) : undefined;
    const t = s.selectedId ? textOf(s.selectedId) : null;
    if (selBox && t) {
      const h = handlePos(selBox);
      if (Math.hypot(p.x - h.x, p.y - h.y) <= HANDLE * dpr * 1.6) {
        gesture.current = {
          kind: "handle",
          id: t.id,
          box: selBox,
          t0: { ...t.transform },
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
      if (lastTap.current?.id === id && now - lastTap.current.at < 350) {
        lastTap.current = null;
        onEdit(id);
        return;
      }
      lastTap.current = { id, at: now };
      s.select(id);
      const tt = textOf(id)!;
      gesture.current = { kind: "move", id, x0: p.x / W, y0: p.y / H, t0: { ...tt.transform } };
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
      apply(g.id, { ...g.t0, scale: clampScale(g.t0.scale * (d / g.d0)), rotation: snapAngle(g.t0.rotation + ((a - g.a0) * 180) / Math.PI) });
    } else if (g.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      apply(g.id, { ...g.t0, scale: clampScale(g.t0.scale * (d / g.d0)), rotation: snapAngle(g.t0.rotation + ((ang - g.a0) * 180) / Math.PI) });
    }
  }

  function onUp(e: PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) return;
    const g = gesture.current;
    gesture.current = null;
    const s = useEditor.getState();
    if (g && s.draft) s.commit(s.draft, g.kind === "move" ? "Mover texto" : "Ajustar texto");
  }

  return (
    <canvas
      ref={canvas}
      aria-hidden
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className="absolute inset-0 size-full touch-none"
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

function handlePos(b: TextBox) {
  const a = (b.rotation * Math.PI) / 180;
  const hx = b.w / 2;
  const hy = b.h / 2;
  return { x: b.cx + hx * Math.cos(a) - hy * Math.sin(a), y: b.cy + hx * Math.sin(a) + hy * Math.cos(a) };
}

// Selection frame: a light dashed box and the corner handle. Raw colours on
// purpose: it sits on video, so it needs white with a dark edge.
function drawSelection(ctx: CanvasRenderingContext2D, b: TextBox, dpr: number) {
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
}
