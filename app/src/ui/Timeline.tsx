import { AlertTriangle, ArrowLeftRight, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export type TrackKind = "main" | "overlay" | "audio" | "text" | "effect" | "caption";

const trackBg: Record<TrackKind, string> = {
  main: "bg-track-video",
  overlay: "bg-track-overlay",
  audio: "bg-track-audio",
  text: "bg-track-text",
  effect: "bg-track-effect",
  caption: "bg-track-caption",
};

// A clip drawn on the timeline. Selected clips get white trim handles.
// `keyframes` are positions 0..1 inside the clip.
export function TimelineClip({
  kind,
  width,
  label,
  selected,
  missing,
  keyframes = [],
  thumbs,
  waveform,
  onSelect,
}: {
  kind: TrackKind;
  width: number;
  label?: string;
  selected?: boolean;
  missing?: boolean;
  keyframes?: number[];
  thumbs?: ReactNode;
  waveform?: number[];
  onSelect?: () => void;
}) {
  const tall = kind === "main";
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${label ?? kind}${missing ? ", mídia ausente" : ""}`}
      onClick={onSelect}
      style={{ width }}
      className={cn(
        "relative shrink-0 overflow-hidden rounded-xs text-left text-on-track",
        tall ? "h-[var(--layout-track-main)]" : "h-[var(--layout-track-sub)]",
        trackBg[kind],
        selected && "outline-2 outline-selection",
      )}
    >
      {thumbs && <span className="absolute inset-0 flex">{thumbs}</span>}
      {waveform && (
        <span aria-hidden className="absolute inset-x-0 bottom-0 flex h-1/2 items-end gap-px px-1 opacity-50">
          {waveform.map((p, i) => (
            <span key={i} className="flex-1 bg-on-track" style={{ height: `${Math.max(6, p * 100)}%` }} />
          ))}
        </span>
      )}
      {label && <span className="relative block truncate px-2 pt-0.5 text-2xs">{label}</span>}
      {missing && (
        <span className="absolute inset-0 flex items-center justify-center gap-1 bg-scrim/60 text-2xs text-warning">
          <AlertTriangle aria-hidden className="size-3.5" /> Mídia ausente
        </span>
      )}
      {keyframes.map((k, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute bottom-1 size-2 -translate-x-1/2 rotate-45 bg-text"
          style={{ left: `${k * 100}%` }}
        />
      ))}
      {selected && (
        <>
          <span aria-hidden className="absolute inset-y-0 left-0 w-3 rounded-l-xs bg-selection" />
          <span aria-hidden className="absolute inset-y-0 right-0 w-3 rounded-r-xs bg-selection" />
        </>
      )}
    </button>
  );
}

export function TransitionMarker({ active, onClick }: { active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label={active ? "Editar transição" : "Adicionar transição"}
      onClick={onClick}
      className="relative z-10 -mx-2.5 flex size-11 shrink-0 items-center justify-center"
    >
      <span
        className={cn(
          "flex size-5 items-center justify-center rounded-xs",
          active ? "bg-accent text-on-accent" : "bg-text text-bg",
        )}
      >
        <ArrowLeftRight aria-hidden className="size-3" />
      </span>
    </button>
  );
}

export function AddClipButton({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label="Adicionar mídia"
      onClick={onClick}
      className="ml-2 flex size-[var(--layout-track-main)] shrink-0 items-center justify-center rounded-xs bg-text text-bg"
    >
      <Plus aria-hidden className="size-6" />
    </button>
  );
}

// The fixed centre line. The timeline scrolls under it.
export function Playhead() {
  return <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 z-20 w-0.5 -translate-x-1/2 bg-playhead" />;
}
