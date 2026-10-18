// Small indeterminate spinner used for loading buttons and inline progress.
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return <LoaderCircle role="status" aria-label={label} className={cn("icon-sm animate-spin", className)} strokeWidth={1.75} />;
}
