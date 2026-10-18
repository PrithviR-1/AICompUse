// Button primitive: primary, secondary, ghost and danger variants with loading state (§15.12 a).
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";
import { disabledStyle, focusRing, transition } from "./styles";

const buttonVariants = cva(
  cn(
    "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium",
    "active:scale-[0.98]",
    focusRing,
    transition,
    disabledStyle,
  ),
  {
    variants: {
      variant: {
        primary: "bg-accent-fill text-accent-contrast hover:bg-accent-fill-hover",
        secondary: "border border-border bg-raised text-fg hover:bg-hover hover:border-border-strong active:bg-active",
        ghost: "text-muted hover:bg-hover hover:text-fg active:bg-active",
        danger: "bg-danger-strong text-danger-contrast hover:bg-danger",
        link: "h-auto px-0 text-accent underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-label",
        md: "h-9 px-4 text-label",
        lg: "h-10 px-4 text-body",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading = false, disabled, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), variant === "link" && "h-auto px-0", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner label="Working" />}
      {children}
    </button>
  );
});
