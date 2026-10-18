// Menu primitive (Radix DropdownMenu) for "⋯" menus: icon + label items, danger items, separators.
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";
import { Check } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { cn } from "@/lib/utils";
import { popoverSurface } from "./popover";

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export const MenuContent = forwardRef<
  ElementRef<typeof DropdownMenu.Content>,
  ComponentPropsWithoutRef<typeof DropdownMenu.Content> & { container?: HTMLElement | null }
>(function MenuContent({ className, sideOffset = 6, align = "end", container, ...props }, ref) {
  return (
    <DropdownMenu.Portal container={container ?? undefined}>
      <DropdownMenu.Content
        ref={ref}
        sideOffset={sideOffset}
        align={align}
        collisionPadding={12}
        className={cn("z-40 min-w-48 p-1 outline-none", popoverSurface, className)}
        {...props}
      />
    </DropdownMenu.Portal>
  );
});

interface MenuItemProps extends ComponentPropsWithoutRef<typeof DropdownMenu.Item> {
  icon?: ReactNode;
  danger?: boolean;
  hint?: ReactNode;
}

export const MenuItem = forwardRef<ElementRef<typeof DropdownMenu.Item>, MenuItemProps>(function MenuItem(
  { className, icon, danger, hint, children, ...props },
  ref,
) {
  return (
    <DropdownMenu.Item
      ref={ref}
      className={cn(
        "flex h-9 cursor-pointer select-none items-center gap-3 rounded-control px-3 text-label outline-none",
        "data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
        danger ? "text-danger-text data-[highlighted]:bg-danger-soft" : "text-fg",
        className,
      )}
      {...props}
    >
      {icon && <span className={cn("inline-flex", danger ? "text-danger-text" : "text-muted")}>{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="text-meta text-faint">{hint}</span>}
    </DropdownMenu.Item>
  );
});

export const MenuRadioGroup = DropdownMenu.RadioGroup;

export const MenuRadioItem = forwardRef<ElementRef<typeof DropdownMenu.RadioItem>, ComponentPropsWithoutRef<typeof DropdownMenu.RadioItem>>(
  function MenuRadioItem({ className, children, ...props }, ref) {
    return (
      <DropdownMenu.RadioItem
        ref={ref}
        className={cn(
          "flex h-9 cursor-pointer select-none items-center gap-3 rounded-control pr-3 pl-8 text-label text-fg outline-none relative",
          "data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
          className,
        )}
        {...props}
      >
        <DropdownMenu.ItemIndicator className="absolute left-3 inline-flex text-accent">
          <Check aria-hidden className="icon-sm" strokeWidth={1.75} />
        </DropdownMenu.ItemIndicator>
        <span className="flex-1 truncate">{children}</span>
      </DropdownMenu.RadioItem>
    );
  },
);

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-border" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="px-3 py-2 text-caption font-medium text-faint">{children}</DropdownMenu.Label>;
}
