import { ChevronDown, X } from "lucide-react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

export function TopBar({
  resolution,
  onClose,
  onSettings,
  onExport,
  exporting,
  action = "Exportar",
}: {
  resolution: string | null; // null: no export settings (Editar foto)
  action?: string;
  onClose?: () => void;
  onSettings?: () => void;
  onExport?: () => void;
  exporting?: boolean;
}) {
  return (
    <header className="flex h-[var(--layout-topbar)] items-center justify-between bg-bg px-2">
      <IconButton label="Fechar projeto" icon={<X className="size-6" />} onClick={onClose} />
      <div className="flex items-center gap-1">
        {resolution !== null && (
        <button
          type="button"
          onClick={onSettings}
          aria-label={`Configurações de exportação, ${resolution}`}
          className="inline-flex h-11 items-center gap-1 rounded-sm px-2 text-xs text-text"
        >
          {resolution}
          <ChevronDown aria-hidden className="size-4" />
        </button>
        )}
        <Button variant="primary" size="sm" onClick={onExport} loading={exporting}>
          {action}
        </Button>
      </div>
    </header>
  );
}
