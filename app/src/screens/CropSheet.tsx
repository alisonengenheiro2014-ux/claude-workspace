// S04 Recortar: crop to a shape (with zoom), turn by quarters, mirror. While
// the sheet is open, dragging the preview picks which part shows (CropPan).
import { FlipHorizontal2, RotateCw } from "lucide-react";
import { useRef, type PointerEvent } from "react";
import type { AssetRow, MediaClip } from "../data/db";
import { containRect, shapedSize, shapeOf, type Shape } from "../editor/frame";
import { displaySize } from "../editor/overlay";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { Sheet } from "../ui/Sheet";
import { Slider } from "../ui/Slider";

type Crop = NonNullable<Shape["crop"]>;
export type CropPatch = Pick<MediaClip, "crop" | "flip" | "transform">;

const RATIOS: { id: string; label: string; r: number | null }[] = [
  { id: "original", label: "Original", r: null },
  { id: "1:1", label: "1:1", r: 1 },
  { id: "9:16", label: "9:16", r: 9 / 16 },
  { id: "16:9", label: "16:9", r: 16 / 9 },
  { id: "4:5", label: "4:5", r: 4 / 5 },
  { id: "3:4", label: "3:4", r: 3 / 4 },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// The biggest window of ratio r inside the picture, 0..1 units.
function baseOf(r: number, sw: number, sh: number) {
  return sw / sh > r ? { w: (sh * r) / sw, h: 1 } : { w: 1, h: sw / r / sh };
}

export function cropFor(r: number | null, zoom: number, cx: number, cy: number, sw: number, sh: number): Crop | null {
  if (r === null && zoom <= 1.001) return null;
  const b = baseOf(r ?? sw / sh, sw, sh);
  const w = b.w / zoom;
  const h = b.h / zoom;
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
}

// a cut of any shape, made by dragging the sides on the preview
const FREE = { id: "free", label: "Livre", r: null };

// Which ratio and zoom a crop was made with (for the sheet's controls).
function describe(crop: Crop | null, sw: number, sh: number) {
  if (!crop) return { ratio: RATIOS[0], zoom: 1, cx: 0.5, cy: 0.5 };
  const r = (crop.w * sw) / (crop.h * sh);
  const ratio = RATIOS.find((x) => Math.abs((x.r ?? sw / sh) - r) / (x.r ?? sw / sh) < 0.02);
  if (!ratio) return { ratio: FREE, zoom: 1, cx: crop.x + crop.w / 2, cy: crop.y + crop.h / 2 };
  const b = baseOf(ratio.r ?? sw / sh, sw, sh);
  return { ratio, zoom: b.w / crop.w, cx: crop.x + crop.w / 2, cy: crop.y + crop.h / 2 };
}

export function CropSheet({
  clip,
  layer = false,
  asset,
  onChange,
  onClose,
  onHeight,
}: {
  onHeight?: (px: number) => void;
  clip: MediaClip | null;
  layer?: boolean; // a layer: its box takes the cropped size and it has no drag to pan
  asset: AssetRow | undefined;
  onChange: (p: Partial<CropPatch>) => void;
  onClose: () => void;
}) {
  const { w: sw, h: sh } = displaySize(asset);
  const d = clip ? describe(clip.crop, sw, sh) : null;
  return (
    <Sheet open={!!clip} onOpenChange={(o) => !o && onClose()} title="Recortar" modal={false} onHeight={onHeight}>
      {clip && d && (
        <div className="flex flex-col gap-4">
          <div role="radiogroup" aria-label="Formato do recorte" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {(layer ? RATIOS : [FREE, ...RATIOS]).map((x) => (
              <button
                key={x.id}
                type="button"
                role="radio"
                aria-checked={x.id === d.ratio.id}
                // Livre: the cut is made by dragging its sides on the preview
                onClick={() => x.id !== "free" && onChange({ crop: cropFor(x.r, d.zoom, d.cx, d.cy, sw, sh) })}
                className={cn("h-9 min-w-12 shrink-0 rounded-pill border px-3 text-sm", x.id === d.ratio.id ? "border-accent bg-accent text-on-accent" : "border-border-input")}
              >
                {x.label}
              </button>
            ))}
          </div>
          {/* kept in Livre too (disabled), so the sheet does not change height mid-drag */}
          <Slider
            label="Zoom"
            disabled={d.ratio.id === "free"}
            value={Math.round(d.zoom * 100)}
            min={100}
            max={300}
            defaultValue={100}
            format={(v) => `${v}%`}
            onChange={(v) => onChange({ crop: cropFor(d.ratio.r, v / 100, d.cx, d.cy, sw, sh) })}
          />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              icon={<RotateCw className="size-4" />}
              onClick={() => onChange({ transform: { ...clip.transform, rotation: (shapeOf(clip).rotation + 90) % 360 } })}
            >
              Girar
            </Button>
            <Button variant="secondary" className="flex-1" icon={<FlipHorizontal2 className="size-4" />} onClick={() => onChange({ flip: !clip.flip })}>
              Espelhar
            </Button>
          </div>
          <Button variant="ghost" disabled={!clip.crop && !clip.flip && !shapeOf(clip).rotation} onClick={() => onChange({ crop: null, flip: false, transform: { ...clip.transform, rotation: 0 } })}>
            Redefinir
          </Button>
          <p className="text-xs text-text-muted">
            {layer
              ? "A camada fica do tamanho da parte recortada; arraste e gire na prévia como sempre."
              : "Na prévia: arraste os cantos e as linhas brancas para cortar do jeito que quiser, e o meio para mover o corte."}
          </p>
        </div>
      )}
    </Sheet>
  );
}

// Over the preview while cropping a main clip, CapCut's free crop: the
// whole picture shows (the editor takes the crop off while the sheet is
// open), the chosen part is clear and the rest dimmed. Drag a corner or a
// side to cut, the middle to move. Works in screen space, then maps back to
// the picture's own (unturned, unmirrored) 0..1 units.
type Box = { x: number; y: number; w: number; h: number };
type Grip = "tl" | "t" | "tr" | "r" | "br" | "b" | "bl" | "l" | "move";
const GRIPS: { id: Exclude<Grip, "move">; x: number; y: number }[] = [
  { id: "tl", x: 0, y: 0 },
  { id: "t", x: 0.5, y: 0 },
  { id: "tr", x: 1, y: 0 },
  { id: "r", x: 1, y: 0.5 },
  { id: "br", x: 1, y: 1 },
  { id: "b", x: 0.5, y: 1 },
  { id: "bl", x: 0, y: 1 },
  { id: "l", x: 0, y: 0.5 },
];
const MIN = 32; // css px, the smallest cut

export function CropPan({
  clip,
  asset,
  width,
  height,
  cut,
  onCut,
}: {
  clip: MediaClip; // shown uncropped
  asset: AssetRow | undefined;
  width: number;
  height: number;
  cut: Crop | null;
  onCut: (crop: Crop | null) => void;
}) {
  const start = useRef<{ x: number; y: number; box: Box; grip: Grip } | null>(null);
  const { w: sw, h: sh } = displaySize(asset);
  const shape = { ...shapeOf(clip), crop: null };
  const size = shapedSize(sw, sh, shape);
  const r = containRect(size.w, size.h, width, height);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const turned = shape.rotation % 180 !== 0;
  const pw = turned ? r.h : r.w; // screen px across the picture's own width
  const ph = turned ? r.w : r.h;
  const a = (shape.rotation * Math.PI) / 180;
  const toScreen = (u: number, v: number) => {
    let dx = (u - 0.5) * pw;
    const dy = (v - 0.5) * ph;
    if (shape.flip) dx = -dx;
    return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
  };
  const toPicture = (x: number, y: number) => {
    const dx = x - cx;
    const dy = y - cy;
    let ux = dx * Math.cos(a) + dy * Math.sin(a);
    const uy = -dx * Math.sin(a) + dy * Math.cos(a);
    if (shape.flip) ux = -ux;
    return { u: 0.5 + ux / pw, v: 0.5 + uy / ph };
  };
  const c = cut ?? { x: 0, y: 0, w: 1, h: 1 };
  const p1 = toScreen(c.x, c.y);
  const p2 = toScreen(c.x + c.w, c.y + c.h);
  const box: Box = { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y) };

  function toCrop(b: Box): Crop | null {
    const q1 = toPicture(b.x, b.y);
    const q2 = toPicture(b.x + b.w, b.y + b.h);
    const x = clamp(Math.min(q1.u, q2.u), 0, 1);
    const y = clamp(Math.min(q1.v, q2.v), 0, 1);
    const w = clamp(Math.abs(q2.u - q1.u), 0, 1 - x);
    const h = clamp(Math.abs(q2.v - q1.v), 0, 1 - y);
    return w > 0.995 && h > 0.995 ? null : { x, y, w, h };
  }
  function down(e: PointerEvent, grip: Grip) {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, box, grip };
  }
  function move(e: PointerEvent) {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    const b = s.box;
    let l = b.x;
    let t = b.y;
    let rr = b.x + b.w;
    let bb = b.y + b.h;
    if (s.grip === "move") {
      const nx = clamp(b.x + dx, r.x, r.x + r.w - b.w);
      const ny = clamp(b.y + dy, r.y, r.y + r.h - b.h);
      onCut(toCrop({ x: nx, y: ny, w: b.w, h: b.h }));
      return;
    }
    if (s.grip.includes("l")) l = clamp(b.x + dx, r.x, rr - MIN);
    if (s.grip.includes("r")) rr = clamp(b.x + b.w + dx, l + MIN, r.x + r.w);
    if (s.grip.includes("t")) t = clamp(b.y + dy, r.y, bb - MIN);
    if (s.grip.includes("b")) bb = clamp(b.y + b.h + dy, t + MIN, r.y + r.h);
    onCut(toCrop({ x: l, y: t, w: rr - l, h: bb - t }));
  }
  function up() {
    start.current = null;
  }
  const handlers = { onPointerMove: move, onPointerUp: up, onPointerCancel: up };
  return (
    <div aria-label="Área do recorte" className="absolute inset-0 z-[5] touch-none">
      {/* the rest of the picture, dimmed */}
      <div className="pointer-events-none absolute overflow-hidden" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
        <div
          className="absolute shadow-[0_0_0_9999px_rgba(0,0,0,.55)]"
          style={{ left: box.x - r.x, top: box.y - r.y, width: box.w, height: box.h }}
        />
      </div>
      <div
        role="presentation"
        onPointerDown={(e) => down(e, "move")}
        {...handlers}
        className="absolute border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.5)]"
        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      >
        <div className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/50" />
        <div className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/50" />
        <div className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/50" />
        <div className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/50" />
        {GRIPS.map((g) => {
          const corner = g.x !== 0.5 && g.y !== 0.5;
          return (
            <div
              key={g.id}
              role="presentation"
              data-grip={g.id}
              onPointerDown={(e) => down(e, g.id)}
              {...handlers}
              // inside the cut, so a side at the panel's edge can still be grabbed
              className="absolute flex size-10 items-center justify-center"
              style={{ left: `${g.x * 100}%`, top: `${g.y * 100}%`, transform: `translate(${-g.x * 100}%, ${-g.y * 100}%)` }}
            >
              {/* CapCut's marks: an L in each corner, a bar mid-side, on the edge */}
              <span
                className="absolute border-white drop-shadow-[0_0_1px_rgba(0,0,0,.8)]"
                style={
                  corner
                    ? {
                        width: 22,
                        height: 22,
                        [g.x === 0 ? "left" : "right"]: -2,
                        [g.y === 0 ? "top" : "bottom"]: -2,
                        [g.x === 0 ? "borderLeftWidth" : "borderRightWidth"]: 4,
                        [g.y === 0 ? "borderTopWidth" : "borderBottomWidth"]: 4,
                      }
                    : g.y === 0.5
                      ? { width: 4, height: 24, background: "white", [g.x === 0 ? "left" : "right"]: -2 }
                      : { width: 24, height: 4, background: "white", [g.y === 0 ? "top" : "bottom"]: -2 }
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
