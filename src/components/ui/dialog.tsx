// Dialog primitive (Radix): centered, 420 px, 16 px radius, actions on the right with the
// destructive action last in the danger color (§15.11).
import type { ReactNode } from "react";
import { Dialog as RadixDialog } from "radix-ui";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export const Dialog = RadixDialog.Root;

interface DialogContentProps {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Wider dialogs (shortcuts list) opt out of the 420 px default. */
  wide?: boolean;
  container?: HTMLElement | null;
}

export function DialogContent({ title, description, children, footer, className, wide, container }: DialogContentProps) {
  return (
    <RadixDialog.Portal container={container ?? undefined}>
      <RadixDialog.Overlay className="fixed inset-0 z-50 bg-overlay animate-fade-in" />
      <RadixDialog.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto",
          "rounded-dialog border border-border bg-raised p-6 text-fg shadow-popover outline-none animate-pop-in",
          wide ? "w-[min(var(--dialog-wide),calc(100vw-2rem))]" : "w-[min(var(--dialog-width),calc(100vw-2rem))]",
          className,
        )}
      >
        <div className="flex flex-col gap-2">
          <RadixDialog.Title className="text-title font-semibold">{title}</RadixDialog.Title>
          {description ? (
            <RadixDialog.Description className="text-label text-muted">{description}</RadixDialog.Description>
          ) : (
            <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
          )}
        </div>
        {children}
        {footer && <div className="flex justify-end gap-2 pt-2">{footer}</div>}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export const DialogClose = RadixDialog.Close;

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
  busy?: boolean;
}

/** Cancel + confirm dialog; used for every delete. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, destructive = true, busy }: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        description={description}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant={destructive ? "danger" : "primary"} loading={busy} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </>
        }
      />
    </Dialog>
  );
}
