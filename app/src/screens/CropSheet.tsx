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

// Which ratio and zoom a crop was made with (for the sheet's controls).
function describe(crop: Crop | null, sw: number, sh: number) {
  if (!crop) return { ratio: RATIOS[0], zoom: 1, cx: 0.5, cy: 0.5 };
  const r = (crop.w * sw) / (crop.h * sh);
  const ratio = RATIOS.slice(1).find((x) => Math.abs(x.r! - r) / x.r! < 0.02) ?? RATIOS[0];
  const b = baseOf(ratio.r ?? sw / sh, sw, sh);
  return { ratio, zoom: b.w / crop.w, cx: crop.x + crop.w / 2, cy: crop.y + crop.h / 2 };
}

export function CropSheet({
  clip,
  asset,
  onChange,
  onClose,
}: {
  clip: MediaClip | null;
  asset: AssetRow | undefined;
  onChange: (p: Partial<CropPatch>) => void;
  onClose: () => void;
}) {
  const { w: sw, h: sh } = displaySize(asset);
  const d = clip ? describe(clip.crop, sw, sh) : null;
  return (
    <Sheet open={!!clip} onOpenChange={(o) => !o && onClose()} title="Recortar" modal={false}>
      {clip && d && (
        <div className="flex flex-col gap-4">
          <div role="radiogroup" aria-label="Formato do recorte" className="flex flex-wrap gap-2">
            {RATIOS.map((x) => (
              <button
                key={x.id}
                type="button"
                role="radio"
                aria-checked={x.id === d.ratio.id}
                onClick={() => onChange({ crop: cropFor(x.r, d.zoom, d.cx, d.cy, sw, sh) })}
                className={cn("h-9 min-w-12 rounded-pill border px-3 text-sm", x.id === d.ratio.id ? "border-accent bg-accent text-on-accent" : "border-border-input")}
              >
                {x.label}
              </button>
            ))}
          </div>
          <Slider
            label="Zoom"
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
          <p className="text-xs text-text-muted">Arraste o vídeo na prévia para escolher a parte que aparece.</p>
        </div>
      )}
    </Sheet>
  );
}

// Over the preview while cropping: drag to move the picture inside the crop.
export function CropPan({
  clip,
  asset,
  width,
  height,
  onChange,
  onDone,
}: {
  clip: MediaClip;
  asset: AssetRow | undefined;
  width: number;
  height: number;
  onChange: (p: Partial<CropPatch>) => void;
  onDone: () => void;
}) {
  const start = useRef<{ x: number; y: number; crop: Crop } | null>(null);
  const { w: sw, h: sh } = displaySize(asset);
  const shape = shapeOf(clip);
  const size = shapedSize(sw, sh, shape);
  const r = containRect(size.w, size.h, width, height);

  function down(e: PointerEvent) {
    if (!clip.crop) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, crop: clip.crop };
  }
  function move(e: PointerEvent) {
    const s = start.current;
    if (!s) return;
    // the finger's move in the picture's own (unturned, unmirrored) axes
    let dx = e.clientX - s.x;
    let dy = e.clientY - s.y;
    const a = (-shape.rotation * Math.PI) / 180;
    [dx, dy] = [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
    if (shape.flip) dx = -dx;
    const turned = shape.rotation % 180 !== 0;
    const pxW = turned ? r.h : r.w; // screen px across the crop's width
    const pxH = turned ? r.w : r.h;
    const c = s.crop;
    onChange({
      crop: { ...c, x: clamp(c.x - (dx / pxW) * c.w, 0, 1 - c.w), y: clamp(c.y - (dy / pxH) * c.h, 0, 1 - c.h) },
    });
  }
  function up() {
    if (start.current) onDone();
    start.current = null;
  }
  return (
    <div
      aria-hidden
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      className="absolute inset-0 z-[5] touch-none"
    >
      <div className="pointer-events-none absolute border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,.5)]" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
        <div className="absolute inset-y-0 left-1/3 w-px bg-white/50" />
        <div className="absolute inset-y-0 left-2/3 w-px bg-white/50" />
        <div className="absolute inset-x-0 top-1/3 h-px bg-white/50" />
        <div className="absolute inset-x-0 top-2/3 h-px bg-white/50" />
      </div>
    </div>
  );
}
