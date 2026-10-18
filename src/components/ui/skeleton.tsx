// Loading placeholder with a soft shimmer; never leave an async area blank (§15.11).
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("animate-shimmer rounded-control bg-active", className)} {...props} />;
}
