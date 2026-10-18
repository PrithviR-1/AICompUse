// Small status pill ("NEW", "Free", "Connected"…).
import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex h-5 items-center gap-1 rounded-full px-2 text-caption font-semibold whitespace-nowrap", {
  variants: {
    variant: {
      neutral: "bg-active text-muted",
      outline: "border border-border bg-raised text-fg",
      success: "bg-active text-success",
      danger: "bg-danger-soft text-danger-text",
    },
  },
  defaultVariants: { variant: "neutral" },
});

interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
