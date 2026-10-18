// Capability icons for a model: vision, reasoning, tools, file input (§11.4, §15.8).
import { Brain, Eye, FileText, Wrench, type LucideIcon } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { Tooltip } from "@/components/ui/tooltip";
import type { ModelCaps } from "@/lib/bindings";
import { cn } from "@/lib/utils";

const CAPS: Array<{ key: keyof ModelCaps; icon: LucideIcon; label: string }> = [
  { key: "vision", icon: Eye, label: "Reads images" },
  { key: "reasoning", icon: Brain, label: "Reasoning" },
  { key: "tools", icon: Wrench, label: "Tool use" },
  { key: "fileInput", icon: FileText, label: "Reads files" },
];

export function CapabilityIcons({ caps, className, withTooltips = true }: { caps: ModelCaps; className?: string; withTooltips?: boolean }) {
  const present = CAPS.filter((c) => caps[c.key]);
  if (present.length === 0) return null;
  return (
    <span className={cn("inline-flex items-center gap-2 text-faint", className)} aria-label={present.map((c) => c.label).join(", ")}>
      {present.map((c) =>
        withTooltips ? (
          <Tooltip key={c.key} content={c.label}>
            <span className="inline-flex" tabIndex={-1}>
              <Icon icon={c.icon} size="sm" />
            </span>
          </Tooltip>
        ) : (
          <Icon key={c.key} icon={c.icon} size="sm" />
        ),
      )}
    </span>
  );
}
