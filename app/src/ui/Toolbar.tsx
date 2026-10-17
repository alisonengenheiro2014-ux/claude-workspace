import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";

export interface ToolbarItemProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export function ToolbarItem({ icon, label, active, disabled, onClick }: ToolbarItemProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-full min-w-16 shrink-0 flex-col items-center justify-center gap-1 px-2",
        "text-text active:bg-surface-2 disabled:opacity-35",
        active && "text-accent",
      )}
    >
      <span aria-hidden className="[&>svg]:size-6">
        {icon}
      </span>
      <span className="text-2xs">{label}</span>
    </button>
  );
}

// Horizontally scrolling tool row. Arrow keys move between tools.
export function Toolbar({ label, leading, children }: { label: string; leading?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[i + (e.key === "ArrowRight" ? 1 : -1)];
    if (next) {
      e.preventDefault();
      next.focus();
      next.scrollIntoView({ inline: "nearest", block: "nearest" });
    }
  }

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex h-[var(--layout-toolbar)] items-stretch border-t border-border bg-surface"
    >
      {leading && <div className="flex shrink-0 items-center border-r border-border">{leading}</div>}
      <div className="no-scrollbar flex flex-1 items-stretch overflow-x-auto">{children}</div>
    </div>
  );
}
