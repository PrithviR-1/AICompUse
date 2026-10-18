// On/off switch (Radix) for boolean settings.
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { Switch as RadixSwitch } from "radix-ui";
import { cn } from "@/lib/utils";
import { disabledStyle, focusRing, transition } from "./styles";

export const Switch = forwardRef<ElementRef<typeof RadixSwitch.Root>, ComponentPropsWithoutRef<typeof RadixSwitch.Root>>(
  function Switch({ className, ...props }, ref) {
    return (
      <RadixSwitch.Root
        ref={ref}
        className={cn(
          "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-border bg-active p-1",
          "hover:border-border-strong data-[state=checked]:border-transparent data-[state=checked]:bg-accent-fill",
          focusRing,
          transition,
          disabledStyle,
          className,
        )}
        {...props}
      >
        <RadixSwitch.Thumb
          className={cn(
            "block size-4 rounded-full bg-fg transition-transform duration-150 ease-out",
            "data-[state=checked]:translate-x-4 data-[state=checked]:bg-accent-contrast",
          )}
        />
      </RadixSwitch.Root>
    );
  },
);
