// Form field layout: label above, control, helper text or inline error below (§15.11 settings).
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FieldProps {
  label: string;
  helper?: ReactNode;
  error?: string | null;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

export function Field({ label, helper, error, className, children }: FieldProps) {
  const id = useId();
  const helperId = `${id}-help`;
  const hasHelp = Boolean(error || helper);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-label font-medium text-fg">
        {label}
      </label>
      {children({ id, describedBy: hasHelp ? helperId : undefined, invalid: Boolean(error) })}
      {error ? (
        <p id={helperId} role="alert" className="text-meta text-danger-text">
          {error}
        </p>
      ) : helper ? (
        <p id={helperId} className="text-meta text-muted">
          {helper}
        </p>
      ) : null}
    </div>
  );
}
