// Searchable model list (cmdk, §11.4): Favorites, Free (when any), then models grouped by
// vendor, with capability icons, context size and a price hint; raw ID on hover.
import type { ReactNode } from "react";
import { Command } from "cmdk";
import { Check, Search } from "lucide-react";
import { ModelAvatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icon";
import { Tooltip } from "@/components/ui/tooltip";
import type { ModelInfo, ModelKind } from "@/lib/bindings";
import { KIND_LABELS, sortModels } from "@/lib/modelSort";
import { contextLabel, priceHint } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CapabilityIcons } from "./CapabilityIcons";

interface ModelPickerListProps {
  models: ModelInfo[];
  favorites: string[];
  selectedKey?: string | null;
  onSelect: (key: string) => void;
  /** A reason a model can't be chosen right now (e.g. images attached, no vision). */
  unavailableReason?: (model: ModelInfo) => string | null;
  /** Controlled search text (the composer's "@" mention passes what was typed). */
  query?: string;
  onQueryChange?: (query: string) => void;
  hideInput?: boolean;
  footer?: ReactNode;
  className?: string;
  listClassName?: string;
}

interface Group {
  heading: string;
  models: ModelInfo[];
}

const NON_CHAT_ORDER: ModelKind[] = ["image", "video", "audio", "transcription", "embedding", "rerank", "other"];

/** Favorites, then chat models in default order, then each non-chat type (§15 model list). */
export function groupModels(models: ModelInfo[], favorites: string[]): Group[] {
  const sorted = sortModels(models);
  const groups: Group[] = [];
  const favs = favorites.map((k) => sorted.find((m) => m.key === k)).filter((m): m is ModelInfo => Boolean(m));
  if (favs.length) groups.push({ heading: "Favorites", models: favs });
  const chat = sorted.filter((m) => m.kind === "chat");
  if (chat.length) groups.push({ heading: "Models", models: chat });
  for (const kind of NON_CHAT_ORDER) {
    const list = sorted.filter((m) => m.kind === kind);
    if (list.length) groups.push({ heading: `${KIND_LABELS[kind]} models`, models: list });
  }
  return groups;
}

function ModelRow({ model, selected, reason }: { model: ModelInfo; selected: boolean; reason: string | null }) {
  const meta = [model.vendor, contextLabel(model.contextWindow) && `${contextLabel(model.contextWindow)} context`, priceHint(model)]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <ModelAvatar name={model.name} vendor={model.vendor} size="md" />
      <div className="min-w-0 flex-1">
        <Tooltip content={model.id}>
          <span className="block truncate text-label font-medium text-fg">{model.name}</span>
        </Tooltip>
        <span className="block truncate text-meta text-muted tabular-nums">{reason ?? meta}</span>
      </div>
      <CapabilityIcons caps={model.caps} withTooltips={false} />
      <span className="inline-flex w-5 justify-end text-accent">{selected && <Icon icon={Check} size="sm" />}</span>
    </div>
  );
}

export function ModelPickerList({
  models,
  favorites,
  selectedKey,
  onSelect,
  unavailableReason,
  query,
  onQueryChange,
  hideInput,
  footer,
  className,
  listClassName,
}: ModelPickerListProps) {
  const groups = groupModels(models, favorites);
  return (
    <Command
      label="Choose a model"
      loop
      className={cn("flex min-h-0 flex-col", className)}
      filter={(value, search, keywords) => {
        const hay = [value, ...(keywords ?? [])].join(" ").toLowerCase();
        const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
        return terms.every((t) => hay.includes(t)) ? 1 : 0;
      }}
    >
      {!hideInput && (
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Icon icon={Search} size="md" className="text-faint" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={onQueryChange}
            placeholder="Search models"
            className="h-12 flex-1 bg-transparent text-body text-fg outline-none placeholder:text-faint"
          />
        </div>
      )}
      {hideInput && query !== undefined && <Command.Input value={query} onValueChange={onQueryChange} className="sr-only" aria-label="Search models" />}
      <Command.List className={cn("max-h-[min(26rem,60vh)] overflow-y-auto p-2", listClassName)}>
        <Command.Empty className="px-3 py-8 text-center text-label text-muted">No models match your search.</Command.Empty>
        {groups.map((group) => (
          <Command.Group
            key={group.heading}
            heading={group.heading}
            className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint"
          >
            {group.models.map((model) => {
              const reason = model.chatSupported ? (unavailableReason?.(model) ?? null) : model.unavailableReason;
              return (
                <Command.Item
                  key={`${group.heading}-${model.key}`}
                  value={`${group.heading}:${model.key}`}
                  keywords={[model.name, model.id, model.vendor]}
                  disabled={Boolean(reason)}
                  onSelect={() => onSelect(model.key)}
                  className={cn(
                    "flex cursor-pointer items-center rounded-control px-3 py-2 outline-none",
                    "data-[selected=true]:bg-hover data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-45",
                  )}
                >
                  <ModelRow model={model} selected={model.key === selectedKey} reason={reason} />
                </Command.Item>
              );
            })}
          </Command.Group>
        ))}
      </Command.List>
      {footer}
    </Command>
  );
}
