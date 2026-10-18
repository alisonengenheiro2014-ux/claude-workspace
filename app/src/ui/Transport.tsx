import { DiamondMinus, DiamondPlus, Maximize, Pause, Play, Redo2, Undo2 } from "lucide-react";
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
  keyframe,
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
  // the selected item can have keyframes: is there one at the playhead?
  keyframe?: { on: boolean; onToggle: () => void } | null;
}) {
  return (
    <div className="grid h-[var(--layout-transport)] grid-cols-[1fr_auto_1fr] items-center bg-bg px-2">
      <span className="font-mono text-xs text-text-muted tabular-nums">
        <span className="text-text">{formatTime(currentUs)}</span> / {formatTime(durationUs)}
      </span>
      <IconButton
        label={playing ? "Pausar" : "Reproduzir"}
        icon={playing ? <Pause className="size-6" /> : <Play className="size-6" />}
        onClick={onPlay}
      />
      <div className="flex justify-end">
        {keyframe && (
          <IconButton
            label={keyframe.on ? "Remover keyframe" : "Adicionar keyframe"}
            pressed={keyframe.on}
            icon={keyframe.on ? <DiamondMinus className="size-5 fill-current" /> : <DiamondPlus className="size-5" />}
            onClick={keyframe.onToggle}
          />
        )}
        <IconButton label="Desfazer" icon={<Undo2 className="size-5" />} disabled={!canUndo} onClick={onUndo} />
        <IconButton label="Refazer" icon={<Redo2 className="size-5" />} disabled={!canRedo} onClick={onRedo} />
        <IconButton label="Tela cheia" icon={<Maximize className="size-5" />} onClick={onFullscreen} />
      </div>
    </div>
  );
}
