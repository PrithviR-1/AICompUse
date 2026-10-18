// Range slider (Radix) for numeric chat settings such as temperature.
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { Slider as RadixSlider } from "radix-ui";
import { cn } from "@/lib/utils";
import { focusRing } from "./styles";

export const Slider = forwardRef<ElementRef<typeof RadixSlider.Root>, ComponentPropsWithoutRef<typeof RadixSlider.Root>>(
  function Slider({ className, ...props }, ref) {
    return (
      <RadixSlider.Root
        ref={ref}
        className={cn("relative flex h-6 w-full touch-none select-none items-center data-[disabled]:opacity-45", className)}
        {...props}
      >
        <RadixSlider.Track className="relative h-1 grow overflow-hidden rounded-full bg-active">
          <RadixSlider.Range className="absolute h-full bg-accent" />
        </RadixSlider.Track>
        <RadixSlider.Thumb
          aria-label={props["aria-label"]}
          className={cn("block size-4 rounded-full border-2 border-accent bg-raised hover:scale-110", focusRing)}
        />
      </RadixSlider.Root>
    );
  },
);
