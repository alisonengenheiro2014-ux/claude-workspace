// Tela dividida: pick a layout; the main video takes the first cell and the
// layers at the cursor the others (missing ones are picked from the phone).
import { useState } from "react";
import { LAYOUTS } from "../editor/layouts";
import { Sheet } from "../ui/Sheet";
import { Slider } from "../ui/Slider";

export interface LayoutLook {
  gap: number; // px in a frame 1080 on its short side
  round: number; // 0..100
}

export function LayoutSheet({
  open,
  aspect,
  layers,
  onPick,
  onClose,
}: {
  open: boolean;
  aspect: number; // frame width / height
  layers: number; // layers at the cursor
  onPick: (id: string, look: LayoutLook) => void;
  onClose: () => void;
}) {
  const [look, setLook] = useState<LayoutLook>({ gap: 0, round: 0 });
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Tela dividida">
      <div className="flex flex-col gap-4">
        <div role="list" aria-label="Modelos de tela dividida" className="grid grid-cols-4 gap-3">
          {LAYOUTS.map((l) => (
            <button key={l.id} type="button" role="listitem" aria-label={l.label} onClick={() => onPick(l.id, look)} className="flex flex-col items-center gap-1">
              <span className="relative block w-full overflow-hidden rounded-sm bg-surface-2" style={{ aspectRatio: aspect, padding: look.gap / 12 }}>
                {l.cells.map((c, i) => (
                  <span
                    key={i}
                    className={`absolute flex items-center justify-center border-bg text-[10px] font-semibold ${i === 0 ? "bg-accent text-on-accent" : "bg-surface-3 text-text-muted"}`}
                    style={{
                      left: `${c.x * 100}%`,
                      top: `${c.y * 100}%`,
                      width: `${c.w * 100}%`,
                      height: `${c.h * 100}%`,
                      borderWidth: Math.max(1, look.gap / 12),
                      borderRadius: look.round / 8,
                    }}
                  >
                    {i + 1}
                  </span>
                ))}
              </span>
              <span className="text-[11px] text-text-muted">{l.label}</span>
            </button>
          ))}
        </div>
        <Slider label="Borda" value={look.gap} min={0} max={60} defaultValue={0} format={(v) => (v ? String(v) : "Sem")} onChange={(gap) => setLook({ ...look, gap })} />
        <Slider label="Cantos" value={look.round} min={0} max={100} defaultValue={0} format={(v) => (v ? `${v}%` : "Retos")} onChange={(round) => setLook({ ...look, round })} />
        <p className="text-xs text-text-muted">
          O 1 é o vídeo principal no cursor; as camadas no cursor ocupam os outros espaços
          {layers ? ` (tem ${layers} agora)` : ""}. Se faltar, você escolhe os vídeos em seguida. Depois dá para ajustar cada um em Recortar. A borda mostra o Plano de fundo (por exemplo branco); para mudar borda ou cantos, toque no modelo de novo.
        </p>
      </div>
    </Sheet>
  );
}
