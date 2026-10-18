// Models page (§15.8): search, filter chips and a grid of model cards with capabilities,
// context window, price from config/models.toml, a Chat button and a favorite star.
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import type { ModelInfo } from "@/lib/bindings";
import { contextLabel, priceLabel } from "@/lib/format";
import { navigate } from "@/lib/router";
import { useApp } from "@/stores/app";
import { useComposer } from "@/stores/composer";
import { useModels } from "@/stores/models";
import { CapabilityIcons } from "./CapabilityIcons";

const FILTERS = ["All", "Free", "Vision", "Reasoning", "Tools", "Favorites"] as const;
type Filter = (typeof FILTERS)[number];

function matches(model: ModelInfo, filter: Filter, favorites: string[]): boolean {
  switch (filter) {
    case "All":
      return true;
    case "Free":
      return model.free;
    case "Vision":
      return model.caps.vision;
    case "Reasoning":
      return model.caps.reasoning;
    case "Tools":
      return model.caps.tools;
    case "Favorites":
      return favorites.includes(model.key);
  }
}

function ModelCard({ model, favorite, onChat, onToggleFavorite }: { model: ModelInfo; favorite: boolean; onChat: () => void; onToggleFavorite: () => void }) {
  const context = contextLabel(model.contextWindow);
  return (
    <Card className="flex flex-col gap-4 p-4" data-testid="model-card">
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
      <div className="flex min-h-5 items-center justify-between gap-3 text-meta text-muted">
        <CapabilityIcons caps={model.caps} />
        {context && <span className="tabular-nums">{context} context</span>}
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4">
        <span className={model.inputPrice == null && !model.free ? "text-meta text-faint" : "text-meta text-fg tabular-nums"}>{priceLabel(model)}</span>
        <Button size="sm" onClick={onChat}>
          Chat
        </Button>
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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [refreshing, setRefreshing] = useState(false);

  const visible = useMemo(() => models.filter((m) => !settings.hiddenModels.includes(m.key)), [models, settings.hiddenModels]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visible.filter(
      (m) => matches(m, filter, settings.favorites) && (!q || `${m.name} ${m.id} ${m.vendor}`.toLowerCase().includes(q)),
    );
  }, [visible, query, filter, settings.favorites]);
  const hiddenCount = models.length - visible.length;

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
              {visible.length} models through Mixroute{hiddenCount > 0 && ` · ${hiddenCount} hidden`}
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
              Refresh
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
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-80">
            <Icon icon={Search} size="sm" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
            <Input aria-label="Search models" placeholder="Search models" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter models">
            {FILTERS.map((f) => (
              <Chip key={f} selected={filter === f} onClick={() => setFilter(f)}>
                {f}
              </Chip>
            ))}
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
              {filter === "Favorites" && !query ? "No favorites yet. Star a model to keep it here." : "No models match. Try another search or filter."}
            </p>
            {(query || filter !== "All") && (
              <Button
                size="sm"
                onClick={() => {
                  setQuery("");
                  setFilter("All");
                }}
              >
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
