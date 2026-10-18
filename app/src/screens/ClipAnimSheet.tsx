// S04 Animação for a video or photo clip (main or overlay): how it comes in
// and goes out, and how long each takes.
import type { MediaClip } from "../data/db";
import { CLIP_ANIM_US, CLIP_ANIMS_IN, CLIP_ANIMS_OUT } from "../editor/keyframes";
import { OptionGrid } from "../ui/OptionGrid";
import { Sheet } from "../ui/Sheet";
import { Slider } from "../ui/Slider";

export function ClipAnimSheet({ clip, onChange, onClose }: { clip: MediaClip | null; onChange: (p: Partial<MediaClip>) => void; onClose: () => void }) {
  const a = clip?.animation;
  const max = clip ? Math.max(200, Math.min(3000, Math.floor(clip.durationUs / 2000))) : 3000;
  return (
    <Sheet open={!!clip} onOpenChange={(o) => !o && onClose()} title="Animação">
      {clip && a && (
        <div className="flex flex-col gap-4">
          <span className="text-xs text-text-muted">Entrada</span>
          <OptionGrid
            label="Animação de entrada"
            value={a.in?.id ?? null}
            onChange={(id) => onChange({ animation: { ...a, in: id ? { id, durationUs: a.in?.durationUs ?? CLIP_ANIM_US } : null } })}
            options={CLIP_ANIMS_IN.map((x) => ({ id: x.id, label: x.label, preview: <span className="text-xs text-text-muted">{x.label}</span> }))}
          />
          {a.in && (
            <Slider
              label="Duração da entrada"
              value={Math.round(a.in.durationUs / 1000)}
              min={200}
              max={max}
              step={100}
              defaultValue={500}
              format={(v) => `${(v / 1000).toFixed(1)} s`}
              onChange={(v) => onChange({ animation: { ...a, in: { ...a.in!, durationUs: v * 1000 } } })}
            />
          )}
          <span className="text-xs text-text-muted">Saída</span>
          <OptionGrid
            label="Animação de saída"
            value={a.out?.id ?? null}
            onChange={(id) => onChange({ animation: { ...a, out: id ? { id, durationUs: a.out?.durationUs ?? CLIP_ANIM_US } : null } })}
            options={CLIP_ANIMS_OUT.map((x) => ({ id: x.id, label: x.label, preview: <span className="text-xs text-text-muted">{x.label}</span> }))}
          />
          {a.out && (
            <Slider
              label="Duração da saída"
              value={Math.round(a.out.durationUs / 1000)}
              min={200}
              max={max}
              step={100}
              defaultValue={500}
              format={(v) => `${(v / 1000).toFixed(1)} s`}
              onChange={(v) => onChange({ animation: { ...a, out: { ...a.out!, durationUs: v * 1000 } } })}
            />
          )}
        </div>
      )}
    </Sheet>
  );
}
