// Models page (§15.8): every model Mixroute's /models returns, sorted most advanced and
// expensive first by default, with search, a sort control and provider / type / modality /
// capability / Free filters. Non-chat models are listed with their type and can't be chatted.
import { useMemo, useState } from "react";
import { RefreshCw, Search, Star } from "lucide-react";
import { ModelAvatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { SelectMenu, type SelectOption } from "@/components/ui/select-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import type { ModelInfo, ModelKind } from "@/lib/bindings";
import { contextLabel, priceLabel } from "@/lib/format";
import {
  KIND_LABELS,
  NO_FILTERS,
  SORT_LABELS,
  filterModels,
  sortModels,
  type Capability,
  type Modality,
  type ModelFilters,
  type ModelSort,
} from "@/lib/modelSort";
import { navigate } from "@/lib/router";
import { useApp } from "@/stores/app";
import { useComposer } from "@/stores/composer";
import { useModels } from "@/stores/models";
import { CapabilityIcons } from "./CapabilityIcons";

const ALL = "all";
const CAPABILITIES: Array<{ value: Capability; label: string }> = [
  { value: "vision", label: "Vision" },
  { value: "reasoning", label: "Reasoning" },
  { value: "tools", label: "Tools" },
  { value: "structuredOutput", label: "Structured output" },
];
const MODALITIES: Array<SelectOption<Modality | typeof ALL>> = [
  { value: ALL, label: "Any" },
  { value: "image", label: "Image" },
  { value: "audio", label: "Audio" },
  { value: "video", label: "Video" },
  { value: "file", label: "File" },
];

function usd(n: number) {
  return n < 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(2).replace(/\.00$/, "")}`;
}

function ModelCard({ model, favorite, onChat, onToggleFavorite }: { model: ModelInfo; favorite: boolean; onChat: () => void; onToggleFavorite: () => void }) {
  const context = contextLabel(model.contextWindow);
  const known = model.free || model.inputPrice != null || model.perCallPrice != null;
  return (
    <Card className="flex flex-col gap-4 p-4" data-testid="model-card" data-model-id={model.id}>
      <div className="flex items-start gap-3">
        <ModelAvatar name={model.name} vendor={model.vendor} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Tooltip content={model.id}>
              <h3 className="truncate text-title font-semibold text-fg">{model.name}</h3>
            </Tooltip>
            {model.isNew && <Badge variant="outline">NEW</Badge>}
          </div>
          <p className="truncate text-meta text-muted">{model.vendor}</p>
        </div>
        <IconButton
          label={favorite ? "Remove from favorites" : "Add to favorites"}
          icon={<Icon icon={Star} size="md" fill={favorite ? "currentColor" : "none"} />}
          variant={favorite ? "active" : "ghost"}
          className={favorite ? "text-accent" : undefined}
          aria-pressed={favorite}
          onClick={onToggleFavorite}
        />
      </div>
      <div className="flex min-h-5 flex-wrap items-center gap-2 text-meta text-muted">
        {model.frontier && <Badge variant="outline">Frontier</Badge>}
        {model.kind !== "chat" && <Badge>{KIND_LABELS[model.kind]}</Badge>}
        <CapabilityIcons caps={model.caps} />
        {context && <span className="ml-auto tabular-nums">{context} context</span>}
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4">
        <div className="min-w-0">
          <p className={known ? "text-meta text-fg tabular-nums" : "text-meta text-faint"}>{priceLabel(model)}</p>
          {model.cachedInputPrice != null && <p className="text-caption text-faint tabular-nums">Cached input {usd(model.cachedInputPrice)} per 1M</p>}
        </div>
        {model.chatSupported ? (
          <Button size="sm" onClick={onChat}>
            Chat
          </Button>
        ) : (
          <Tooltip content={model.unavailableReason ?? "Chat isn't supported for this model yet."}>
            <span tabIndex={0} className="inline-flex" aria-label={model.unavailableReason ?? undefined}>
              <Button size="sm" disabled>
                Chat
              </Button>
            </span>
          </Tooltip>
        )}
      </div>
    </Card>
  );
}

export function ModelsPage() {
  const models = useModels((s) => s.models);
  const status = useModels((s) => s.status);
  const refreshError = useModels((s) => s.refreshError);
  const load = useModels((s) => s.load);
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const [filters, setFilters] = useState<ModelFilters>(NO_FILTERS);
  const [sort, setSort] = useState<ModelSort>("priceDesc");
  const [refreshing, setRefreshing] = useState(false);

  const visible = useMemo(() => models.filter((m) => !settings.hiddenModels.includes(m.key)), [models, settings.hiddenModels]);
  const shown = useMemo(() => sortModels(filterModels(visible, filters, settings.favorites), sort), [visible, filters, settings.favorites, sort]);
  const providers = useMemo(() => [...new Set(visible.map((m) => m.vendor))].sort((a, b) => a.localeCompare(b)), [visible]);
  const kinds = useMemo(() => (Object.keys(KIND_LABELS) as ModelKind[]).filter((k) => visible.some((m) => m.kind === k)), [visible]);
  const hiddenCount = models.length - visible.length;
  const chatCount = visible.filter((m) => m.chatSupported).length;
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const set = (patch: Partial<ModelFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const toggleFavorite = (key: string) => {
    const favorites = settings.favorites.includes(key) ? settings.favorites.filter((k) => k !== key) : [...settings.favorites, key];
    void updateSettings({ favorites });
  };
  const chatWith = (key: string) => {
    useComposer.getState().setNewChat({ modelKey: key, compare: null });
    navigate({ name: "home" });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-(--home-width) flex-col gap-6 px-8 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-page font-bold text-fg">Models</h1>
            <p className="mt-1 text-label text-muted">
              {visible.length} models from Mixroute · {chatCount} can chat{hiddenCount > 0 && ` · ${hiddenCount} hidden`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              loading={refreshing}
              onClick={async () => {
                setRefreshing(true);
                await load(true);
                setRefreshing(false);
              }}
            >
              {!refreshing && <Icon icon={RefreshCw} size="sm" />}
              Refresh models
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate({ name: "settings", section: "models" })}>
              Manage models
            </Button>
          </div>
        </div>
        {refreshError && (
          <p role="status" className="text-meta text-muted">
            Showing the last known list. {refreshError.message}
          </p>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-72">
              <Icon icon={Search} size="sm" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
              <Input aria-label="Search models" placeholder="Search models" className="h-9 pl-9" value={filters.query} onChange={(e) => set({ query: e.target.value })} />
            </div>
            <SelectMenu
              label="Sort"
              value={sort}
              onChange={setSort}
              options={(Object.keys(SORT_LABELS) as ModelSort[]).map((value) => ({ value, label: SORT_LABELS[value] }))}
            />
            <SelectMenu
              label="Provider"
              value={filters.provider ?? ALL}
              onChange={(v) => set({ provider: v === ALL ? null : v })}
              options={[{ value: ALL, label: "All" }, ...providers.map((p) => ({ value: p, label: p }))]}
            />
            <SelectMenu
              label="Type"
              value={filters.kind ?? ALL}
              onChange={(v) => set({ kind: v === ALL ? null : (v as ModelKind) })}
              options={[{ value: ALL, label: "All" }, ...kinds.map((k) => ({ value: k, label: KIND_LABELS[k] }))]}
            />
            <SelectMenu
              label="Modality"
              value={filters.modality ?? ALL}
              onChange={(v) => set({ modality: v === ALL ? null : (v as Modality) })}
              options={MODALITIES}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter models">
            {CAPABILITIES.map((c) => (
              <Chip key={c.value} selected={filters.capability === c.value} onClick={() => set({ capability: filters.capability === c.value ? null : c.value })}>
                {c.label}
              </Chip>
            ))}
            <Chip selected={filters.freeOnly} onClick={() => set({ freeOnly: !filters.freeOnly })}>
              Free
            </Chip>
            <Chip selected={filters.favoritesOnly} onClick={() => set({ favoritesOnly: !filters.favoritesOnly })}>
              Favorites
            </Chip>
            {filtered && (
              <Button variant="link" size="sm" onClick={() => setFilters(NO_FILTERS)}>
                Clear filters
              </Button>
            )}
          </div>
        </div>

        {status === "loading" || (status === "idle" && models.length === 0) ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-4" aria-label="Loading models">
            {Array.from({ length: 6 }, (_, i) => (
              <Card key={i} className="flex flex-col gap-4 p-4">
                <div className="flex gap-3">
                  <Skeleton className="size-10" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-8 w-full" />
              </Card>
            ))}
          </div>
        ) : status === "error" && models.length === 0 ? (
          <div className="flex flex-col items-start gap-3 py-8">
            <p className="text-label text-muted">The model list couldn't be loaded.</p>
            <Button onClick={() => void load(true)}>Try again</Button>
          </div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-start gap-3 py-8">
            <p className="text-label text-muted">
              {filters.favoritesOnly && !filters.query ? "No favorites yet. Star a model to keep it here." : "No models match. Try another search or filter."}
            </p>
            {filtered && (
              <Button size="sm" onClick={() => setFilters(NO_FILTERS)}>
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-4">
            {shown.map((m) => (
              <ModelCard key={m.key} model={m} favorite={settings.favorites.includes(m.key)} onChat={() => chatWith(m.key)} onToggleFavorite={() => toggleFavorite(m.key)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
