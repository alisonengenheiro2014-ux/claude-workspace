import * as Dialog from "@radix-ui/react-dialog";
import { Check, ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "./IconButton";

// Bottom sheet for tool panels. The preview stays visible above it, so the
// scrim is light and the sheet never covers more than --layout-sheet-max.
export function Sheet({
  open,
  onOpenChange,
  title,
  onBack,
  modal = true,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onBack?: () => void; // a sub-page of the sheet: back to its main page
  // false: no scrim, and touching the preview does not close it (crop drags there)
  modal?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <Dialog.Portal>
        {modal && <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim/30" />}
        <Dialog.Content
          aria-describedby={undefined}
          onInteractOutside={modal ? undefined : (e) => e.preventDefault()}
          className="pb-safe fixed inset-x-0 bottom-0 z-50 flex max-h-[var(--layout-sheet-max)] flex-col rounded-t-lg bg-surface shadow-sheet outline-none"
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border pl-4 pr-1">
            <div className="flex min-w-0 items-center">
              {onBack && <IconButton label="Voltar" icon={<ChevronLeft className="size-6" />} onClick={onBack} className="-ml-3" />}
              <Dialog.Title className="truncate text-sm font-semibold">{title}</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <IconButton label="Concluir" icon={<Check className="size-6" />} />
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto p-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
