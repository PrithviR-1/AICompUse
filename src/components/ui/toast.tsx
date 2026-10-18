// Toast viewport: bottom-center, above the composer (its offset comes from --toast-bottom,
// set by the composer dock), auto-dismissed by the toast store (§15.11).
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { Icon } from "./icon";
import { cn } from "@/lib/utils";
import { useToasts, type ToastItem } from "@/stores/toasts";
import { focusRing } from "./styles";

export function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss?: () => void }) {
  return (
    <div
      role={toast.tone === "danger" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex min-h-10 max-w-[min(30rem,calc(100vw-2rem))] items-center gap-3 rounded-menu border bg-raised py-2 pr-2 pl-4 text-label text-fg shadow-popover animate-pop-in",
        toast.tone === "danger" ? "border-danger" : "border-border",
      )}
    >
      {toast.tone === "success" && <Icon icon={CircleCheck} size="sm" className="text-success" />}
      {toast.tone === "danger" && <Icon icon={CircleAlert} size="sm" className="text-danger-text" />}
      <span className="flex-1">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={toast.action.run}
          className={cn("rounded-control px-2 py-1 text-label font-medium text-accent hover:bg-hover", focusRing)}
        >
          {toast.action.label}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className={cn("inline-flex size-7 items-center justify-center rounded-control text-muted hover:bg-hover hover:text-fg", focusRing)}
        >
          <Icon icon={X} size="sm" />
        </button>
      )}
    </div>
  );
}

export function ToastViewport() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2 bottom-[var(--toast-bottom,1.5rem)]"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}
