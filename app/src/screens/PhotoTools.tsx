// Editar foto's tools, laid out like CapCut's photo editor: tabs at the
// bottom (Filtros, Ajustar, Elementos; Ajustar first), and above them a row
// of round buttons, or, in Filtros, the filters on the photo itself.
import { useState, type ReactNode } from "react";
import type { MediaClip } from "../data/db";
import { FILTERS } from "../editor/look";
import { cn } from "../ui/cn";
import { Swatch } from "./LookSheets";

type Tab = "filters" | "adjust" | "elements";
const TABS: { id: Tab; label: string }[] = [
  { id: "filters", label: "Filtros" },
  { id: "adjust", label: "Ajustar" },
  { id: "elements", label: "Elementos" },
];

export interface PhotoTool {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

function Round({ icon, label, onClick, disabled }: PhotoTool) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex w-[76px] shrink-0 flex-col items-center gap-1.5 disabled:opacity-35">
      <span aria-hidden className="flex size-[60px] items-center justify-center rounded-full bg-surface-2 text-text active:brightness-125 [&>svg]:size-6">
        {icon}
      </span>
      <span className="text-center text-[11px] leading-tight text-text">{label}</span>
    </button>
  );
}

export function PhotoTools({
  adjust,
  elements,
  thumb,
  filter,
  onFilter,
  onFilterMore,
}: {
  adjust: PhotoTool[];
  elements: PhotoTool[];
  thumb: string | undefined;
  filter: MediaClip["filter"];
  onFilter: (id: string | null) => void;
  onFilterMore: () => void; // the chosen filter tapped again: its strength
}) {
  const [tab, setTab] = useState<Tab>("adjust");
  return (
    <div role="toolbar" aria-label="Ferramentas da foto" className="flex shrink-0 flex-col bg-bg">
      <div className="no-scrollbar flex h-[104px] items-start gap-1 overflow-x-auto px-3 pt-3">
        {tab === "filters" ? (
          <>
            <FilterChip label="Nenhum" on={!filter} onClick={() => onFilter(null)}>
              <Swatch thumb={thumb} filter={null} />
            </FilterChip>
            {FILTERS.map((f) => (
              <FilterChip key={f.id} label={f.label} on={filter?.id === f.id} onClick={() => (filter?.id === f.id ? onFilterMore() : onFilter(f.id))}>
                <Swatch thumb={thumb} filter={{ id: f.id, intensity: 100 }} />
              </FilterChip>
            ))}
          </>
        ) : (
          (tab === "adjust" ? adjust : elements).map((t) => <Round key={t.label} {...t} />)
        )}
      </div>
      <div role="tablist" aria-label="Seções" className="flex h-14 border-t border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn("relative flex-1 text-xs", tab === t.id ? "text-text" : "text-text-muted")}
          >
            {t.label}
            {tab === t.id && <span aria-hidden className="absolute bottom-1.5 left-1/2 h-1 w-6 -translate-x-1/2 rounded-pill bg-accent" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterChip({ label, on, onClick, children }: { label: string; on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} aria-label={label} onClick={onClick} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
      <span className={cn("block size-14 overflow-hidden rounded-md", on && "outline-2 outline-offset-1 outline-accent")}>{children}</span>
      <span className={cn("text-[11px] leading-tight", on ? "text-accent" : "text-text")}>{label}</span>
    </button>
  );
}
