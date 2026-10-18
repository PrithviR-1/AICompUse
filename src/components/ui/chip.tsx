// Chip primitive: rounded control with optional leading visual; "selected" gets the filled
// active treatment, everything else stays ghost (§15.0 item 9, §15.5 chips, §15.8 filters).
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { disabledStyle, focusRing, transition } from "./styles";

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  leading?: ReactNode;
  size?: "md" | "lg";
}

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected = false, leading, size = "md", className, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={cn(
        "inline-flex min-w-0 shrink-0 items-center gap-2 rounded-control font-medium active:scale-[0.98]",
        size === "lg" ? "h-10 pr-3 pl-2 text-body" : "h-8 px-3 text-label",
        selected
          ? "bg-active text-fg hover:bg-active"
          : "border border-transparent text-muted hover:bg-hover hover:text-fg active:bg-active",
        focusRing,
        transition,
        disabledStyle,
        className,
      )}
      {...props}
    >
      {leading}
      <span className="truncate">{children}</span>
    </button>
  );
});
