// Tooltip primitive (Radix): 400 ms delay, plain text label, optional side (§15.3).
import type { ReactNode } from "react";
import { Tooltip as RadixTooltip } from "radix-ui";
import { cn } from "@/lib/utils";

export const TooltipProvider = RadixTooltip.Provider;

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  /** Render the bubble open (gallery only). */
  forceOpen?: boolean;
  disabled?: boolean;
}

export function Tooltip({ content, children, side = "top", forceOpen, disabled }: TooltipProps) {
  if (disabled) return <>{children}</>;
  return (
    <RadixTooltip.Root delayDuration={400} open={forceOpen}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={8}
          collisionPadding={8}
          className={cn(
            "z-50 max-w-72 rounded-control border border-border bg-raised px-2 py-1 text-meta text-fg shadow-popover",
            "animate-fade-in",
          )}
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
