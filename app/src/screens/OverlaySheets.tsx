// S12 Máscara and Chroma key for the selected overlay. Both edit the draft;
// closing the sheet is one undo step.
import type { MediaClip } from "../data/db";
import { KEY_COLORS } from "../editor/chroma";
import { MASKS, newMask, type Mask } from "../editor/mask";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { OptionGrid } from "../ui/OptionGrid";
import { Sheet } from "../ui/Sheet";
import { Slider } from "../ui/Slider";

function MaskIcon({ shape }: { shape: Mask["shape"] }) {
  const d: Record<Mask["shape"], string> = {
    linear: "M2 13h20v9H2z",
    mirror: "M2 8h20v8H2z",
    circle: "M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16z",
    rect: "M5 5h14v14H5z",
    heart: "M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z",
    star: "M12 2l3 7h7l-5.6 4.3L18.5 21 12 16.8 5.5 21l2.1-7.7L2 9h7z",
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-8 fill-text-muted">
      <path d={d[shape]} />
    </svg>
  );
}

export function MaskSheet({ clip, onChange, onClose }: { clip: MediaClip | null; onChange: (p: Partial<MediaClip>) => void; onClose: () => void }) {
  const m = clip?.mask ?? null;
  const set = (patch: Partial<Mask> & { params?: Partial<Mask["params"]> }) =>
    m && onChange({ mask: { ...m, ...patch, params: { ...m.params, ...patch.params } } });
  return (
    <Sheet open={!!clip} onOpenChange={(o) => !o && onClose()} title="Máscara">
      {clip && (
        <div className="flex flex-col gap-4">
          <OptionGrid
            label="Formato da máscara"
            value={m?.shape ?? null}
            onChange={(id) => onChange({ mask: id ? (m ? { ...m, shape: id as Mask["shape"] } : newMask(id as Mask["shape"])) : null })}
            options={MASKS.map((x) => ({ id: x.id, label: x.label, preview: <MaskIcon shape={x.id} /> }))}
          />
          {m && (
            <>
              <Slider label="Tamanho" value={Math.round((m.params.size ?? 0.6) * 100)} min={5} max={150} defaultValue={60} format={(v) => `${v}%`} onChange={(v) => set({ params: { size: v / 100 } })} />
              <Slider label="Suavizar borda" value={Math.round(m.feather * 100)} min={0} max={100} defaultValue={10} format={(v) => `${v}%`} onChange={(v) => set({ feather: v / 100 })} />
              <Slider label="Girar" value={Math.round(m.params.angle ?? 0)} min={-180} max={180} defaultValue={0} format={(v) => `${v}°`} onChange={(v) => set({ params: { angle: v } })} />
              <Slider label="Posição horizontal" value={Math.round((m.params.x ?? 0.5) * 100)} min={0} max={100} defaultValue={50} format={(v) => `${v}%`} onChange={(v) => set({ params: { x: v / 100 } })} />
              <Slider label="Posição vertical" value={Math.round((m.params.y ?? 0.5) * 100)} min={0} max={100} defaultValue={50} format={(v) => `${v}%`} onChange={(v) => set({ params: { y: v / 100 } })} />
              <Button variant="secondary" aria-pressed={m.invert} onClick={() => set({ invert: !m.invert })}>
                {m.invert ? "Inverter: ligado" : "Inverter"}
              </Button>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

export function ChromaSheet({ clip, onChange, onClose }: { clip: MediaClip | null; onChange: (p: Partial<MediaClip>) => void; onClose: () => void }) {
  const c = clip?.chroma ?? null;
  return (
    <Sheet open={!!clip} onOpenChange={(o) => !o && onClose()} title="Chroma key">
      {clip && (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-text-muted">Escolha a cor do fundo para apagar (fundo verde ou azul).</p>
          <div role="radiogroup" aria-label="Cor para apagar" className="flex flex-wrap gap-3">
            <button
              type="button"
              role="radio"
              aria-checked={!c}
              onClick={() => onChange({ chroma: null })}
              className={cn("h-9 rounded-pill border px-3 text-sm", !c ? "border-accent bg-accent text-on-accent" : "border-border-input")}
            >
              Desligado
            </button>
            {KEY_COLORS.map((k) => (
              <button
                key={k.color}
                type="button"
                role="radio"
                aria-checked={c?.color === k.color}
                aria-label={k.label}
                onClick={() => onChange({ chroma: { color: k.color, intensity: c?.intensity ?? 0.4, shadow: c?.shadow ?? 0.5 } })}
                className={cn("flex h-9 items-center gap-2 rounded-pill border px-3 text-sm", c?.color === k.color ? "border-accent" : "border-border-input")}
              >
                <span className="size-4 rounded-pill border border-border-input" style={{ background: k.color }} />
                {k.label}
              </button>
            ))}
          </div>
          {c && (
            <>
              <Slider label="Intensidade" value={Math.round(c.intensity * 100)} min={0} max={100} defaultValue={40} format={(v) => `${v}%`} onChange={(v) => onChange({ chroma: { ...c, intensity: v / 100 } })} />
              <Slider label="Tirar a cor das bordas" value={Math.round(c.shadow * 100)} min={0} max={100} defaultValue={50} format={(v) => `${v}%`} onChange={(v) => onChange({ chroma: { ...c, shadow: v / 100 } })} />
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
