import {
  Children, Fragment, isValidElement, useEffect, useMemo, useRef, useState,
  type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode,
} from "react";
import { Check, ChevronLeft, ChevronRight, GripVertical, RotateCcw } from "lucide-react";
import { cn } from "./cn";
import { loadToolbarOrder, moveTool, orderedToolIds, saveToolbarOrder } from "./toolbarOrder";

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
      <span aria-hidden className="[&>svg]:size-6">{icon}</span>
      <span className="text-2xs">{label}</span>
    </button>
  );
}

// Flatten React fragments (e.g., track actions) before sorting the tools.
function toolChildren(children: ReactNode): ReactElement<ToolbarItemProps>[] {
  const items: ReactElement<ToolbarItemProps>[] = [];
  const visit = (nodes: ReactNode) => {
    Children.forEach(nodes, (child) => {
      if (!isValidElement<{ children?: ReactNode }>(child)) return;
      if (child.type === Fragment) visit(child.props.children);
      else if (child.type === ToolbarItem) items.push(child as ReactElement<ToolbarItemProps>);
    });
  };
  visit(children);
  return items;
}

// Hold an icon for ~0.6 s to activate customization; drag to reorder.
// Stored PER toolbar on the iPhone, never on the VPS.
export function Toolbar({ label, leading, children }: { label: string; leading?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ id: string; pointerId: number; x: number; y: number } | null>(null);
  const dragging = useRef<string | null>(null);
  const suppressClick = useRef(false);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>(() => loadToolbarOrder(label));

  useEffect(() => {
    setEditing(false);
    setSelected(null);
    setSaved(loadToolbarOrder(label));
  }, [label]);
  useEffect(() => () => { if (hold.current) clearTimeout(hold.current); }, []);

  const tools = useMemo(() => {
    const counts = new Map<string, number>();
    return toolChildren(children).map((element) => {
      const name = element.props.label;
      const nth = counts.get(name) ?? 0;
      counts.set(name, nth + 1);
      return { id: name + "#" + nth, element };
    });
  }, [children]);

  const ids = tools.map((t) => t.id);
  const ordered = orderedToolIds(ids, saved);
  const byId = new Map(tools.map((t) => [t.id, t.element]));
  const setOrder = (order: string[]) => {
    setSaved(order);
    saveToolbarOrder(label, order);
  };
  const move = (from: string, to: string) => setOrder(moveTool(ordered, from, to));

  const cancelHold = () => {
    if (hold.current) clearTimeout(hold.current);
    hold.current = null;
    start.current = null;
  };
  const onDown = (e: PointerEvent<HTMLDivElement>, id: string) => {
    if (e.target instanceof Element && e.target.closest("[data-order-control]")) return;
    cancelHold();
    if (editing) {
      e.preventDefault();
      dragging.current = id;
      setSelected(id);
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* WebKit fallback */ }
      return;
    }
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
    start.current = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    const element = e.currentTarget;
    hold.current = setTimeout(() => {
      if (!start.current || start.current.pointerId !== e.pointerId) return;
      suppressClick.current = true;
      setEditing(true);
      setSelected(id);
      dragging.current = id;
      try { element.setPointerCapture(e.pointerId); } catch { /* iOS may cancel capture */ }
      if ("vibrate" in navigator) navigator.vibrate?.(12);
    }, 580);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!editing && start.current && e.pointerId === start.current.pointerId &&
      Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 9) cancelHold();
    if (!dragging.current || !editing) return;
    e.preventDefault();
    const area = strip.current;
    if (!area) return;
    const bounds = area.getBoundingClientRect();
    if (e.clientX < bounds.left + 34) area.scrollLeft -= 18;
    else if (e.clientX > bounds.right - 34) area.scrollLeft += 18;
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-toolbar-tool]");
    if (target && area.contains(target)) {
      const to = target.dataset.toolbarTool;
      if (to && to !== dragging.current) move(dragging.current, to);
    }
  };
  const onUp = () => { cancelHold(); dragging.current = null; };
  const onToolClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editing && !suppressClick.current) return;
    e.preventDefault();
    e.stopPropagation();
    if (editing && e.target instanceof Element) {
      const id = e.target.closest<HTMLElement>("[data-toolbar-tool]")?.dataset.toolbarTool;
      if (id) setSelected(id);
    }
    suppressClick.current = false;
  };
  const adjust = (delta: number) => {
    if (!selected) return;
    const i = ordered.indexOf(selected);
    const target = ordered[i + delta];
    if (target) move(selected, target);
  };

  function onKeyDown(e: KeyboardEvent) {
    if (editing && selected && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      adjust(e.key === "ArrowLeft" ? -1 : 1);
      return;
    }
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
      className="relative flex h-[var(--layout-toolbar)] items-stretch border-t border-border bg-surface"
    >
      {editing && (
        <div className="absolute bottom-full left-0 right-0 z-50 flex min-h-12 items-center justify-between gap-1 border-t border-border bg-surface px-2 text-xs shadow-lg" role="group" aria-label="Reorganizar ferramentas">
          <span className="min-w-0 flex-1 truncate">Arraste os ícones para organizar</span>
          <button type="button" aria-label="Mover selecionado para esquerda" disabled={!selected || ordered.indexOf(selected) <= 0} onClick={() => adjust(-1)} className="rounded-md p-2 disabled:opacity-30"><ChevronLeft className="size-5" /></button>
          <button type="button" aria-label="Mover selecionado para direita" disabled={!selected || ordered.indexOf(selected) >= ordered.length - 1} onClick={() => adjust(1)} className="rounded-md p-2 disabled:opacity-30"><ChevronRight className="size-5" /></button>
          <button type="button" aria-label="Restaurar ordem original" onClick={() => { setOrder([]); setSelected(null); }} className="rounded-md p-2"><RotateCcw className="size-4" /></button>
          <button type="button" onClick={() => { setEditing(false); setSelected(null); dragging.current = null; }} className="flex items-center gap-1 rounded-md bg-accent px-2 py-2 font-semibold text-on-accent"><Check className="size-4" />Concluir</button>
        </div>
      )}
      {leading && <div className="flex shrink-0 items-center border-r border-border">{leading}</div>}
      <div
        ref={strip}
        className="no-scrollbar flex min-w-0 flex-1 items-stretch overflow-x-auto"
        onClickCapture={onToolClick}
      >
        {ordered.map((id) => {
          const item = byId.get(id);
          return item && (
            <div
              key={id}
              data-toolbar-tool={id}
              onPointerDown={(e) => onDown(e, id)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onContextMenu={(e) => e.preventDefault()}
              className={cn("relative min-w-16 shrink-0 select-none", editing ? "touch-none" : "touch-pan-x", editing && selected === id && "rounded-md outline outline-2 outline-accent")}
              style={{ WebkitTouchCallout: "none" }}
            >
              <div className={editing ? "pointer-events-none opacity-85" : ""}>{item}</div>
              {editing && <GripVertical aria-hidden className="pointer-events-none absolute right-0 top-0 size-4 text-accent" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
