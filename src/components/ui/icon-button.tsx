// Icon-only button with a required label used for its tooltip and accessible name (§15.12 a).
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";
import { disabledStyle, focusRing, transition } from "./styles";
import { Tooltip } from "./tooltip";

const iconButtonVariants = cva(
  cn("inline-flex shrink-0 items-center justify-center rounded-control active:scale-95", focusRing, transition, disabledStyle),
  {
    variants: {
      variant: {
        ghost: "text-muted hover:bg-hover hover:text-fg active:bg-active",
        active: "bg-active text-fg hover:bg-active",
        filled: "rounded-full bg-accent-fill text-accent-contrast hover:bg-accent-fill-hover disabled:bg-active disabled:text-faint disabled:opacity-100",
        outline: "rounded-full border border-border bg-raised text-fg shadow-popover hover:bg-hover",
        danger: "text-muted hover:bg-danger-soft hover:text-danger-text",
      },
      size: {
        sm: "size-7",
        md: "size-8",
        lg: "size-9",
        xl: "size-10",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    VariantProps<typeof iconButtonVariants> {
  /** Accessible name and tooltip text. */
  label: string;
  icon: ReactNode;
  tooltipSide?: "top" | "right" | "bottom" | "left";
  /** Tooltip text when it should differ from the accessible name (e.g. "Coming soon"). */
  tooltip?: ReactNode;
  showTooltip?: boolean;
  loading?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant, size, className, tooltipSide = "top", tooltip, showTooltip = true, loading, disabled, type = "button", ...props },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cn(iconButtonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner label={label} /> : icon}
    </button>
  );
  if (!showTooltip) return button;
  // Disabled buttons don't fire pointer events, so wrap them for the tooltip.
  const trigger = disabled ? (
    <span className="inline-flex" tabIndex={0} aria-label={typeof tooltip === "string" ? tooltip : label}>
      {button}
    </span>
  ) : (
    button
  );
  return (
    <Tooltip content={tooltip ?? label} side={tooltipSide}>
      {trigger}
    </Tooltip>
  );
});
