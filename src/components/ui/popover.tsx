// Popover primitive (Radix): raised surface, border, single soft shadow, 12 px radius (§15.10).
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { Popover as RadixPopover } from "radix-ui";
import { cn } from "@/lib/utils";

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverAnchor = RadixPopover.Anchor;

export const popoverSurface = "rounded-menu border border-border bg-raised text-fg shadow-popover animate-pop-in";

export const PopoverContent = forwardRef<
  ElementRef<typeof RadixPopover.Content>,
  ComponentPropsWithoutRef<typeof RadixPopover.Content> & { container?: HTMLElement | null }
>(function PopoverContent({ className, sideOffset = 8, align = "start", container, ...props }, ref) {
  return (
    <RadixPopover.Portal container={container ?? undefined}>
      <RadixPopover.Content
        ref={ref}
        sideOffset={sideOffset}
        align={align}
        collisionPadding={12}
        className={cn("z-40 outline-none", popoverSurface, className)}
        {...props}
      />
    </RadixPopover.Portal>
  );
});
