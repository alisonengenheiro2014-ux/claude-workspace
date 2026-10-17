import { cn } from "./cn";

export function ProgressBar({ value, label, error }: { value: number; label: string; error?: boolean }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-1 w-full overflow-hidden rounded-pill bg-surface-3"
    >
      <div className={cn("h-full", error ? "bg-danger" : "bg-accent")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ProgressRing({ value, label, size = 96 }: { value: number; label: string; size?: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-surface-3)" strokeWidth="6" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
        />
      </svg>
      <span className="font-mono text-lg tabular-nums">{pct}%</span>
    </div>
  );
}
