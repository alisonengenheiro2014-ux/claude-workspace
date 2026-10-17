import { Maximize, Pause, Play, Redo2, Undo2 } from "lucide-react";
import { IconButton } from "./IconButton";

export function formatTime(us: number) {
  const total = Math.max(0, Math.floor(us / 1_000_000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function Transport({
  playing,
  currentUs,
  durationUs,
  canUndo,
  canRedo,
  onPlay,
  onUndo,
  onRedo,
  onFullscreen,
}: {
  playing: boolean;
  currentUs: number;
  durationUs: number;
  canUndo: boolean;
  canRedo: boolean;
  onPlay?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onFullscreen?: () => void;
}) {
  return (
    <div className="flex h-[var(--layout-transport)] items-center justify-between bg-bg px-2">
      <span className="w-28 font-mono text-xs text-text-muted tabular-nums">
        <span className="text-text">{formatTime(currentUs)}</span> / {formatTime(durationUs)}
      </span>
      <IconButton
        label={playing ? "Pausar" : "Reproduzir"}
        icon={playing ? <Pause className="size-6" /> : <Play className="size-6" />}
        onClick={onPlay}
      />
      <div className="flex w-28 justify-end">
        <IconButton label="Desfazer" icon={<Undo2 className="size-5" />} disabled={!canUndo} onClick={onUndo} />
        <IconButton label="Refazer" icon={<Redo2 className="size-5" />} disabled={!canRedo} onClick={onRedo} />
        <IconButton label="Tela cheia" icon={<Maximize className="size-5" />} onClick={onFullscreen} />
      </div>
    </div>
  );
}
