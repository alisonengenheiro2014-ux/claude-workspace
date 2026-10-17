import { cn } from "./cn";
import { formatTime } from "./Transport";

// One item in the media picker. `order` is the 1-based selection number.
export function MediaTile({
  thumb,
  name,
  durationUs,
  order,
  onToggle,
}: {
  thumb?: string;
  name: string;
  durationUs?: number;
  order?: number;
  onToggle?: () => void;
}) {
  const selected = order !== undefined;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={`${name}${durationUs ? `, ${formatTime(durationUs)}` : ""}${selected ? `, selecionado ${order}` : ""}`}
      onClick={onToggle}
      className="relative aspect-square overflow-hidden bg-surface-2"
    >
      {thumb && <img src={thumb} alt="" className="size-full object-cover" />}
      {selected && <span aria-hidden className="absolute inset-0 bg-scrim/35 ring-2 ring-inset ring-accent" />}
      <span
        aria-hidden
        className={cn(
          "absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-pill border-2 text-xs font-semibold",
          selected ? "border-accent bg-accent text-on-accent" : "border-text bg-scrim/30",
        )}
      >
        {order}
      </span>
      {durationUs !== undefined && (
        <span aria-hidden className="absolute bottom-1 right-1.5 font-mono text-2xs text-text [text-shadow:0_1px_2px_#000]">
          {formatTime(durationUs)}
        </span>
      )}
    </button>
  );
}
