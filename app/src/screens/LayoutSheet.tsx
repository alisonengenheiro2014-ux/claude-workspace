// Tela dividida: pick a layout; the main video takes the first cell and the
// layers at the cursor the others (missing ones are picked from the phone).
import { LAYOUTS } from "../editor/layouts";
import { Sheet } from "../ui/Sheet";

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
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Tela dividida">
      <div className="flex flex-col gap-4">
        <div role="list" aria-label="Modelos de tela dividida" className="grid grid-cols-4 gap-3">
          {LAYOUTS.map((l) => (
            <button key={l.id} type="button" role="listitem" aria-label={l.label} onClick={() => onPick(l.id)} className="flex flex-col items-center gap-1">
              <span className="relative block w-full overflow-hidden rounded-sm bg-surface-2" style={{ aspectRatio: aspect }}>
                {l.cells.map((c, i) => (
                  <span
                    key={i}
                    className={`absolute flex items-center justify-center border border-bg text-[10px] font-semibold ${i === 0 ? "bg-accent text-on-accent" : "bg-surface-3 text-text-muted"}`}
                    style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}
                  >
                    {i + 1}
                  </span>
                ))}
              </span>
              <span className="text-[11px] text-text-muted">{l.label}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-text-muted">
          O 1 é o vídeo principal no cursor; as camadas no cursor ocupam os outros espaços
          {layers ? ` (tem ${layers} agora)` : ""}. Se faltar, você escolhe os vídeos em seguida. Depois dá para ajustar cada um em Recortar.
        </p>
      </div>
    </Sheet>
  );
}
