import { MoreHorizontal } from "lucide-react";
import { IconButton } from "./IconButton";
import { formatTime } from "./Transport";

export function DraftCard({
  thumb,
  name,
  durationUs,
  photo,
  updatedAt,
  onOpen,
  onMenu,
}: {
  thumb?: string;
  name: string;
  durationUs: number;
  photo?: boolean;
  updatedAt: number;
  onOpen?: () => void;
  onMenu?: () => void;
}) {
  const date = new Date(updatedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  return (
    <div className="flex items-center gap-3 rounded-md p-1 active:bg-surface">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="relative size-16 shrink-0 overflow-hidden rounded-sm bg-surface-2">
          {thumb && <img src={thumb} alt="" className="size-full object-cover" />}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">{name}</span>
          <span className="text-xs text-text-muted">
            {photo ? "Foto" : formatTime(durationUs)} · {date}
          </span>
        </span>
      </button>
      <IconButton label={`Opções de ${name}`} icon={<MoreHorizontal className="size-5" />} onClick={onMenu} />
    </div>
  );
}
