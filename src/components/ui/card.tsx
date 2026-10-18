// Card surface: raised background, 1 px border, no shadow (§15.10 elevation).
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Card({ className, ...props }, ref) {
  return <div ref={ref} className={cn("rounded-dialog border border-border bg-raised", className)} {...props} />;
});

export function CardHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 pt-6">
      <div className="min-w-0">
        <h2 className="text-title font-semibold text-fg">{title}</h2>
        {description && <p className="mt-1 text-label text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-6 p-6", className)} {...props} />;
}
