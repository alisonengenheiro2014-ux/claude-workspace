// S14 Filtros e Ajustar: a filter (with its strength) and fine adjustments
// for one clip, previewed live on the video. Each sheet edits the draft;
// closing it is one undo step.
import type { Adjust, MediaClip } from "../data/db";
import { LookWashes } from "../editor/LookLayer";
import { ADJUSTS, cssFilter, EMPTY_ADJUST, FILTERS, lookOf } from "../editor/look";
import { Button } from "../ui/Button";
import { OptionGrid } from "../ui/OptionGrid";
import { Sheet } from "../ui/Sheet";
import { Slider } from "../ui/Slider";

function Swatch({ thumb, filter }: { thumb: string | undefined; filter: MediaClip["filter"] }) {
  const look = lookOf({ filter, adjust: null });
  return (
    <span className="relative block size-full">
      {thumb ? (
        <img src={thumb} alt="" className="size-full object-cover" style={{ filter: cssFilter(look) }} />
      ) : (
        <span className="block size-full bg-gradient-to-br from-[#d98a4a] via-[#4a8ad9] to-[#3aa36a]" style={{ filter: cssFilter(look) }} />
      )}
      <LookWashes look={look} />
    </span>
  );
}

export function FilterSheet({
  clip,
  thumb,
  onChange,
  onApplyAll,
  onClose,
}: {
  clip: MediaClip | null;
  thumb: string | undefined;
  onChange: (patch: Partial<MediaClip>) => void;
  onApplyAll?: () => void; // main clips only
  onClose: () => void;
}) {
  return (
    <Sheet open={!!clip} onOpenChange={(o) => !o && onClose()} title="Filtros">
      {clip && (
        <div className="flex flex-col gap-4">
          <OptionGrid
            label="Filtros"
            value={clip.filter?.id ?? null}
            onChange={(id) => onChange({ filter: id ? { id, intensity: clip.filter?.intensity ?? 100 } : null })}
            options={FILTERS.map((f) => ({ id: f.id, label: f.label, preview: <Swatch thumb={thumb} filter={{ id: f.id, intensity: 100 }} /> }))}
          />
          {clip.filter && (
            <Slider
              label="Intensidade"
              value={clip.filter.intensity}
              min={0}
              max={100}
              defaultValue={100}
              onChange={(v) => onChange({ filter: { ...clip.filter!, intensity: v } })}
            />
          )}
          {onApplyAll && (
            <Button variant="secondary" onClick={onApplyAll}>
              Aplicar a todos os clipes
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}

export function AdjustSheet({
  clip,
  onChange,
  onApplyAll,
  onClose,
}: {
  clip: MediaClip | null;
  onChange: (patch: Partial<MediaClip>) => void;
  onApplyAll?: () => void;
  onClose: () => void;
}) {
  const a: Adjust = clip?.adjust ?? EMPTY_ADJUST;
  const set = (key: keyof Adjust, v: number) => {
    const next = { ...a, [key]: v };
    const empty = (Object.keys(next) as (keyof Adjust)[]).every((k) => next[k] === 0);
    onChange({ adjust: empty ? null : next });
  };
  return (
    <Sheet open={!!clip} onOpenChange={(o) => !o && onClose()} title="Ajustar">
      {clip && (
        <div className="flex flex-col gap-4">
          {ADJUSTS.map((x) => (
            <Slider
              key={x.key}
              label={x.label}
              value={a[x.key]}
              min={x.min}
              max={x.min === 0 ? 100 : 50}
              defaultValue={0}
              format={(v) => (v > 0 && x.min < 0 ? `+${v}` : String(v))}
              onChange={(v) => set(x.key, v)}
            />
          ))}
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" disabled={!clip.adjust} onClick={() => onChange({ adjust: null })}>
              Redefinir
            </Button>
            {onApplyAll && (
              <Button variant="secondary" className="flex-1" onClick={onApplyAll}>
                Aplicar a todos
              </Button>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
