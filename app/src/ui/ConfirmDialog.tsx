import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Button } from "./Button";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  danger,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-scrim/60" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(320px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-surface-2 p-5 shadow-pop">
          <AlertDialog.Title className="text-lg">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-text-muted">{description}</AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Cancelar</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
