import * as Dialog from "@radix-ui/react-dialog";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "./IconButton";

// Bottom sheet for tool panels. The preview stays visible above it, so the
// scrim is light and the sheet never covers more than --layout-sheet-max.
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-scrim/30" />
        <Dialog.Content
          aria-describedby={undefined}
          className="pb-safe fixed inset-x-0 bottom-0 flex max-h-[var(--layout-sheet-max)] flex-col rounded-t-lg bg-surface shadow-sheet outline-none"
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border pl-4 pr-1">
            <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
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
