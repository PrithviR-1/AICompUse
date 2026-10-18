// Tabs primitive (Radix), styled as a segmented control.
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { Tabs as RadixTabs } from "radix-ui";
import { cn } from "@/lib/utils";
import { focusRing, transition } from "./styles";

export const Tabs = RadixTabs.Root;

export const TabsList = forwardRef<ElementRef<typeof RadixTabs.List>, ComponentPropsWithoutRef<typeof RadixTabs.List>>(
  function TabsList({ className, ...props }, ref) {
    return (
      <RadixTabs.List
        ref={ref}
        className={cn("inline-flex h-10 items-center gap-1 rounded-control border border-border bg-bg p-1", className)}
        {...props}
      />
    );
  },
);

export const TabsTrigger = forwardRef<ElementRef<typeof RadixTabs.Trigger>, ComponentPropsWithoutRef<typeof RadixTabs.Trigger>>(
  function TabsTrigger({ className, ...props }, ref) {
    return (
      <RadixTabs.Trigger
        ref={ref}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-control px-3 text-label font-medium text-muted",
          "hover:text-fg data-[state=active]:bg-active data-[state=active]:text-fg disabled:opacity-45",
          focusRing,
          transition,
          className,
        )}
        {...props}
      />
    );
  },
);
