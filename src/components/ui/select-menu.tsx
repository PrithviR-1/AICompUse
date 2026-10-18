// Compact select: a button showing the current choice that opens a radio menu (sort and
// filter controls on the Models page).
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./menu";
import { disabledStyle, focusRing, transition } from "./styles";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectMenuProps<T extends string> {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  /** Data attribute passthrough for the gallery's forced states. */
  "data-force"?: string;
  disabled?: boolean;
}

export function SelectMenu<T extends string>({ label, value, options, onChange, className, disabled, ...rest }: SelectMenuProps<T>) {
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <Menu>
      <MenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={`${label}: ${current}`}
          data-force={rest["data-force"]}
          className={cn(
            "inline-flex h-9 max-w-64 items-center gap-2 rounded-control border border-border bg-raised px-3 text-label",
            "hover:border-border-strong hover:bg-hover active:bg-active data-[state=open]:border-border-strong",
            focusRing,
            transition,
            disabledStyle,
            className,
          )}
        >
          <span className="text-muted">{label}</span>
          <span className="truncate font-medium text-fg">{current}</span>
          <Icon icon={ChevronDown} size="sm" className="text-muted" />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="max-h-80 overflow-y-auto">
        <MenuRadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
          {options.map((o) => (
            <MenuRadioItem key={o.value} value={o.value}>
              {o.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
