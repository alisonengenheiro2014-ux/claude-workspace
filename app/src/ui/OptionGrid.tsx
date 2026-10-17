import { Ban } from "lucide-react";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";

export interface Option {
  id: string;
  label: string;
  preview?: ReactNode; // a swatch, a rendered sample, an icon
}

// Grid of presets (filters, transitions, effects, fonts). Radio semantics:
// one value, arrow keys move, the first tile is always "Nenhum".
export function OptionGrid({
  label,
  options,
  value,
  onChange,
  loading,
}: {
  label: string;
  options: Option[];
  value: string | null;
  onChange: (id: string | null) => void;
  loading?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const all: (Option & { none?: boolean })[] = [
    { id: "__none", label: "Nenhum", preview: <Ban aria-hidden className="size-6 text-text-muted" />, none: true },
    ...options,
  ];

  function onKeyDown(e: KeyboardEvent) {
    const step = { ArrowRight: 1, ArrowDown: 4, ArrowLeft: -1, ArrowUp: -4 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = Math.max(0, all.findIndex((o) => (o.none ? value === null : o.id === value)));
    const next = all[Math.min(all.length - 1, Math.max(0, i + step))];
    onChange(next.none ? null : next.id);
    ref.current?.querySelector<HTMLButtonElement>(`[data-id="${next.id}"]`)?.focus();
  }

  if (loading) {
    return (
      <div aria-busy className="grid grid-cols-4 gap-3" aria-label={label}>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="aspect-square animate-pulse rounded-md bg-surface-2" />
        ))}
      </div>
    );
  }

  return (
    <div ref={ref} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className="grid grid-cols-4 gap-3">
      {all.map((o) => {
        const checked = o.none ? value === null : o.id === value;
        return (
          <button
            key={o.id}
            data-id={o.id}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(o.none ? null : o.id)}
            className="flex flex-col items-center gap-1"
          >
            <span
              className={cn(
                "flex aspect-square w-full items-center justify-center overflow-hidden rounded-md bg-surface-2",
                checked && "ring-2 ring-accent",
              )}
            >
              {o.preview}
            </span>
            <span className={cn("w-full truncate text-center text-2xs", checked ? "text-accent" : "text-text-muted")}>
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
