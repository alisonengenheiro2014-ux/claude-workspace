// Capa: the exported video's first frame, as CapCut sets it. Slide to a
// moment of the edit (the preview shows it) or pick a photo.
import { ImageIcon, Trash2 } from "lucide-react";
import type { TimelineDoc, Us } from "../data/db";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { Slider } from "../ui/Slider";
import { formatTime } from "../ui/Transport";

export function CoverSheet({
  open,
  cover,
  totalUs,
  playheadUs,
  onSeek,
  onPick,
  onPhoto,
  onClose,
}: {
  open: boolean;
  cover: TimelineDoc["cover"];
  totalUs: Us;
  playheadUs: Us;
  onSeek: (us: Us) => void;
  onPick: (cover: TimelineDoc["cover"]) => void;
  onPhoto: () => void;
  onClose: () => void;
}) {
  const lastUs = Math.max(0, totalUs - 1);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Capa" modal={false}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">
          {cover?.type === "image"
            ? "A capa é uma foto. Ela vira o primeiro quadro do vídeo exportado."
            : cover?.type === "frame"
              ? `A capa é o quadro em ${formatTime(cover.atUs)}. Ele vira o primeiro quadro do vídeo exportado.`
              : "Sem capa: o vídeo começa como está. A capa vira o primeiro quadro do vídeo exportado (o que aparece no feed e na galeria)."}
        </p>
        <Slider
          label="Quadro do vídeo"
          value={Math.round(Math.min(playheadUs, lastUs) / 1e5) / 10}
          min={0}
          max={Math.max(0.1, Math.floor(lastUs / 1e5) / 10)}
          step={0.1}
          format={(s) => formatTime(s * 1e6)}
          onChange={(s) => onSeek(Math.round(s * 1e6))}
        />
        <Button variant="primary" onClick={() => onPick({ type: "frame", atUs: Math.min(playheadUs, lastUs) })}>
          Usar este quadro
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" icon={<ImageIcon aria-hidden className="size-4" />} onClick={onPhoto}>
            Escolher foto
          </Button>
          <Button variant="ghost" className="flex-1" icon={<Trash2 aria-hidden className="size-4" />} disabled={!cover} onClick={() => onPick(null)}>
            Sem capa
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
