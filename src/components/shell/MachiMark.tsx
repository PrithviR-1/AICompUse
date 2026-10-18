// Machi's own mark: a geometric "M" drawn as one stroke in a rounded accent square (§15.3).
import { cn } from "@/lib/utils";

export function MachiMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-(--mark-size) shrink-0", className)}>
      <rect width="32" height="32" rx="8" className="fill-accent-fill" />
      <path
        d="M9.5 21.5V11l6.5 6.5 6.5-6.5v10.5"
        fill="none"
        className="stroke-accent-contrast"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Mark + "Machi" wordmark, used large on the home screen (§15.5). */
export function Wordmark() {
  return (
    <div className="flex items-center justify-center gap-4">
      <MachiMark className="size-14" />
      <span className="text-display font-bold tracking-tight text-fg">Machi</span>
    </div>
  );
}
