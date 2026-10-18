// S06 Transição: the effect at one cut, its length, and "apply to all".
import { Repeat } from "lucide-react";
import type { Id } from "../data/db";
import { useEditor } from "../editor/store";
import { DEFAULT_TRANSITION_US, TRANSITIONS } from "../editor/transitions";
import { maxTransitionUs, setTransition, setTransitionAll } from "../editor/timeline";
import { Button } from "../ui/Button";
import { OptionGrid } from "../ui/OptionGrid";
import { Sheet } from "../ui/Sheet";
import { Slider } from "../ui/Slider";

export function TransitionSheet({
  fromId,
  onPreview,
  onClose,
}: {
  fromId: Id | null;
  onPreview: (fromId: Id) => void;
  onClose: () => void;
}) {
  const doc = useEditor((s) => s.draft ?? s.doc);
  const current = doc && fromId ? doc.transitions.find((t) => t.fromClipId === fromId) : undefined;
  const max = doc && fromId ? maxTransitionUs(doc, fromId) : 0;
  const durUs = current?.durationUs ?? Math.min(DEFAULT_TRANSITION_US, max);

  function apply(type: string | null, d: number) {
    const s = useEditor.getState();
    if (!s.doc || !fromId) return;
    s.setDraft(setTransition(s.doc, fromId, type, d));
    if (type) onPreview(fromId);
  }

  return (
    <Sheet open={!!fromId} onOpenChange={(o) => !o && onClose()} title="Transição">
      {fromId && (
        <div className="flex flex-col gap-4">
          <OptionGrid
            label="Transição"
            value={current?.type ?? null}
            onChange={(t) => apply(t, durUs)}
            options={TRANSITIONS.map((t) => ({ id: t.id, label: t.label, preview: <span className="text-xs text-text-muted">{t.label}</span> }))}
          />
          <Slider
            label="Duração"
            value={Math.round(durUs / 100_000) / 10}
            min={0.1}
            max={Math.max(0.1, Math.floor(max / 100_000) / 10)}
            step={0.1}
            defaultValue={0.5}
            disabled={!current}
            format={(v) => `${v.toFixed(1)} s`}
            onChange={(v) => current && apply(current.type, Math.round(v * 1e6))}
          />
          <Button
            icon={<Repeat aria-hidden className="size-4" />}
            disabled={!current}
            onClick={() => {
              const s = useEditor.getState();
              if (!s.doc || !current) return;
              s.setDraft(setTransitionAll(s.doc, current.type, current.durationUs));
            }}
          >
            Aplicar em todos os cortes
          </Button>
          <p className="text-xs text-text-muted">
            A transição acontece em volta do corte e não muda a duração do vídeo. Cada uma pode ter no máximo metade do clipe mais curto.
          </p>
        </div>
      )}
    </Sheet>
  );
}
