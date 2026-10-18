// Keyboard key cap for shortcut hints.
import type { ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-control border border-border bg-raised px-2 font-sans text-caption font-medium text-muted">
      {children}
    </kbd>
  );
}
