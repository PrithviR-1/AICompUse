// Settings (§11.9, §15.11): full-page route with a left sub-navigation and section cards
// (Providers, Models, Appearance, Data, About). Labels above fields, helper text below,
// inline validation.
import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Eye, EyeOff, RefreshCw, Star, X } from "lucide-react";
import { ModelAvatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { focusRing, transition } from "@/components/ui/styles";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShortcutList } from "@/components/shell/ShortcutsDialog";
import type { FontSize, ProviderStatus, Theme } from "@/lib/bindings";
import { navigate, type SettingsSection } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";
import { modelLabel, useModels } from "@/stores/models";
import { toast } from "@/stores/toasts";
import { useUi } from "@/stores/ui";

const SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: "providers", label: "Providers" },
  { id: "models", label: "Models" },
  { id: "appearance", label: "Appearance" },
  { id: "data", label: "Data" },
  { id: "about", label: "About" },
];

function KeyStatusBadge({ status }: { status: ProviderStatus }) {
  if (!status.configured) return <Badge>Not set</Badge>;
  return <Badge variant="success">{status.source === "development" ? "Using .env key" : "Saved in keychain"}</Badge>;
}

function ProviderKeyForm({ status, compact = false }: { status: ProviderStatus; compact?: boolean }) {
  const { saveKey, testKey, deleteKey } = useApp.getState();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const run = async (kind: "test" | "save") => {
    if (kind === "save" && !key.trim()) {
      setError("Paste a key first.");
      return;
    }
    setBusy(kind);
    setError(null);
    setOk(null);
    const result = kind === "save" ? await saveKey(status.provider, key.trim()) : await testKey(status.provider, key.trim() || null);
    setBusy(null);
    if (result) setError(result.message);
    else if (kind === "save") {
      setKey("");
      setOk("Key saved and verified.");
      toast(`${status.name} key saved`, { tone: "success" });
    } else setOk("The key works.");
  };

  return (
    <div className="flex flex-col gap-3">
      <Field label={compact ? `${status.name} API key` : "API key"} helper={ok ?? status.keyHint} error={error}>
        {({ id, describedBy, invalid }) => (
          <div className="flex gap-2">
            <Input
              id={id}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={status.configured ? "•••••••• (saved)" : "Paste your key"}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setError(null);
                setOk(null);
              }}
            />
            <Button loading={busy === "test"} disabled={busy !== null || (!key.trim() && !status.configured)} onClick={() => void run("test")}>
              Test
            </Button>
            <Button variant="primary" loading={busy === "save"} disabled={busy !== null} onClick={() => void run("save")}>
              Save
            </Button>
          </div>
        )}
      </Field>
      {status.configured && status.source === "keychain" && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => void deleteKey(status.provider)}>
            Remove saved key
          </Button>
        </div>
      )}
    </div>
  );
}

function BaseUrlForm({ status }: { status: ProviderStatus }) {
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const slug = "mixroute";
  const [value, setValue] = useState(settings.baseUrls[slug] ?? "");
  const trimmed = value.trim();
  const error = trimmed && !/^https?:\/\/\S+$/.test(trimmed) ? "The base URL must start with https:// or http://." : null;
  const save = async (next: string) => {
    const baseUrls = { ...settings.baseUrls };
    if (next) baseUrls[slug] = next;
    else delete baseUrls[slug];
    if (await updateSettings({ baseUrls })) {
      await useApp.getState().refreshProviders();
      toast("Base URL saved");
    }
  };
  return (
    <Field label="Base URL" helper={`Leave empty to use the default, ${status.defaultBaseUrl}.`} error={error}>
      {({ id, describedBy, invalid }) => (
        <div className="flex gap-2">
          <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} placeholder={status.defaultBaseUrl} value={value} onChange={(e) => setValue(e.target.value)} />
          <Button disabled={Boolean(error) || trimmed === (settings.baseUrls[slug] ?? "")} onClick={() => void save(trimmed)}>
            Save
          </Button>
        </div>
      )}
    </Field>
  );
}

function OptionalProvider({ status }: { status: ProviderStatus }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-border first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn("flex h-12 w-full items-center gap-3 px-6 text-left hover:bg-hover", focusRing, transition)}
      >
        <span className="flex-1 text-label font-medium text-fg">{status.name}</span>
        <KeyStatusBadge status={status} />
        <Icon icon={ChevronDown} size="sm" className={cn("text-muted transition-transform duration-150", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-6 pb-6">
          <ProviderKeyForm status={status} compact />
        </div>
      )}
    </div>
  );
}

function ProvidersSection() {
  const providers = useApp((s) => s.providers);
  const mixroute = providers.find((p) => p.provider === "mixroute");
  const optional = providers.filter((p) => p.provider !== "mixroute");
  return (
    <>
      {mixroute && (
        <Card>
          <CardHeader title="Mixroute" description="Required. Every model in Machi is reached through your Mixroute key." actions={<KeyStatusBadge status={mixroute} />} />
          <CardBody>
            <ProviderKeyForm status={mixroute} />
            <BaseUrlForm status={mixroute} />
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="Direct providers" description="Optional. Add a key to use a provider's own models alongside Mixroute." />
        <div className="mt-4 pb-2">
          {optional.map((p) => (
            <OptionalProvider key={p.provider} status={p} />
          ))}
        </div>
      </Card>
    </>
  );
}

function ModelsSection() {
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const models = useModels((s) => s.models);
  const fetchedAt = useModels((s) => s.fetchedAt);
  const refreshError = useModels((s) => s.refreshError);
  const load = useModels((s) => s.load);
  const openPicker = useUi((s) => s.openPicker);
  const [refreshing, setRefreshing] = useState(false);
  const defaultModel = modelLabel(models, settings.defaultModel);
  const favorites = settings.favorites;

  const move = (index: number, delta: number) => {
    const next = [...favorites];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    void updateSettings({ favorites: next });
  };
  const toggle = (list: "favorites" | "hiddenModels", key: string) => {
    const current = settings[list];
    void updateSettings({ [list]: current.includes(key) ? current.filter((k) => k !== key) : [...current, key] });
  };

  return (
    <>
      <Card>
        <CardHeader title="Defaults" />
        <CardBody>
          <Field label="Default model for new chats" helper="New chats start with your last-used model; this is used when there isn't one.">
            {({ id }) => (
              <button
                id={id}
                type="button"
                onClick={() => openPicker({ kind: "default-model" })}
                className={cn("flex h-10 w-full items-center gap-2 rounded-control border border-border bg-raised px-2 text-left hover:border-border-strong", focusRing, transition)}
              >
                <ModelAvatar name={defaultModel.name} vendor={defaultModel.vendor} />
                <span className="flex-1 truncate text-body text-fg">{defaultModel.name}</span>
                <Icon icon={ChevronDown} size="sm" className="text-muted" />
              </button>
            )}
          </Field>
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-label font-medium text-fg">Name chats automatically</p>
              <p className="mt-1 text-meta text-muted">After the first reply, a low-cost model writes a short title.</p>
            </div>
            <Switch aria-label="Name chats automatically" checked={settings.autoTitle} onCheckedChange={(v) => void updateSettings({ autoTitle: v })} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Favorites" description="Shown first in the model picker and on the home screen, in this order." />
        <CardBody className="gap-2">
          {favorites.length === 0 ? (
            <p className="text-label text-muted">No favorites yet. Star models below or on the Models page.</p>
          ) : (
            favorites.map((key, i) => {
              const m = modelLabel(models, key);
              return (
                <div key={key} className="flex h-12 items-center gap-3 rounded-control border border-border px-3">
                  <ModelAvatar name={m.name} vendor={m.vendor} />
                  <span className="flex-1 truncate text-label text-fg">{m.name}</span>
                  <IconButton label="Move up" size="sm" icon={<Icon icon={ArrowUp} size="sm" />} disabled={i === 0} onClick={() => move(i, -1)} />
                  <IconButton label="Move down" size="sm" icon={<Icon icon={ArrowDown} size="sm" />} disabled={i === favorites.length - 1} onClick={() => move(i, 1)} />
                  <IconButton label="Remove from favorites" size="sm" icon={<Icon icon={X} size="sm" />} onClick={() => toggle("favorites", key)} />
                </div>
              );
            })
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="All models"
          description={fetchedAt ? `Live list from Mixroute, updated ${new Date(fetchedAt).toLocaleString()}.` : "Built-in list; Mixroute hasn't been reached yet."}
          actions={
            <Button
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
          }
        />
        <CardBody className="gap-1">
          {refreshError && <p className="pb-2 text-meta text-danger-text">{refreshError.message}</p>}
          {models.map((m) => {
            const hidden = settings.hiddenModels.includes(m.key);
            const fav = favorites.includes(m.key);
            return (
              <div key={m.key} className={cn("flex h-12 items-center gap-3 rounded-control px-2 hover:bg-hover", hidden && "opacity-60")}>
                <ModelAvatar name={m.name} vendor={m.vendor} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-label text-fg">{m.name}</p>
                  <p className="truncate text-caption text-faint">{m.id}</p>
                </div>
                <IconButton
                  label={fav ? "Remove from favorites" : "Add to favorites"}
                  size="sm"
                  aria-pressed={fav}
                  className={fav ? "text-accent" : undefined}
                  icon={<Icon icon={Star} size="sm" fill={fav ? "currentColor" : "none"} />}
                  onClick={() => toggle("favorites", m.key)}
                />
                <IconButton
                  label={hidden ? "Show in picker" : "Hide from picker"}
                  size="sm"
                  aria-pressed={!hidden}
                  icon={<Icon icon={hidden ? EyeOff : Eye} size="sm" />}
                  onClick={() => toggle("hiddenModels", m.key)}
                />
              </div>
            );
          })}
        </CardBody>
      </Card>
    </>
  );
}

function AppearanceSection() {
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  return (
    <Card>
      <CardHeader title="Appearance" />
      <CardBody>
        <div className="flex flex-col gap-2">
          <span className="text-label font-medium text-fg">Theme</span>
          <Tabs value={settings.theme} onValueChange={(v) => void updateSettings({ theme: v as Theme })}>
            <TabsList>
              <TabsTrigger value="system">System</TabsTrigger>
              <TabsTrigger value="light">Light</TabsTrigger>
              <TabsTrigger value="dark">Dark</TabsTrigger>
            </TabsList>
          </Tabs>
          <p className="text-meta text-muted">System follows your computer's light or dark setting.</p>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-label font-medium text-fg">Text size</span>
          <Tabs value={settings.fontSize} onValueChange={(v) => void updateSettings({ fontSize: v as FontSize })}>
            <TabsList>
              <TabsTrigger value="small">Small</TabsTrigger>
              <TabsTrigger value="default">Default</TabsTrigger>
              <TabsTrigger value="large">Large</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardBody>
    </Card>
  );
}

function DataSection() {
  const exportAll = useApp((s) => s.exportAll);
  const deleteAllData = useApp((s) => s.deleteAllData);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Card>
        <CardHeader title="Export" description="Save every chat to your Downloads folder." />
        <CardBody className="flex-row flex-wrap gap-2">
          <Button onClick={() => void exportAll("markdown")}>Export as Markdown</Button>
          <Button onClick={() => void exportAll("json")}>Export as JSON</Button>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Delete all data" description="Removes every chat, your settings and the API keys saved by Machi. This can't be undone." />
        <CardBody>
          <div>
            <Button variant="danger" onClick={() => setConfirming(true)}>
              Delete all data
            </Button>
          </div>
        </CardBody>
      </Card>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete all data?"
        description="Every chat, your settings and saved API keys will be removed from this device. You'll need to add your Mixroute key again."
        confirmLabel="Delete everything"
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          const ok = await deleteAllData();
          setBusy(false);
          setConfirming(false);
          if (ok) {
            toast("All data deleted");
            navigate({ name: "home" });
          }
        }}
      />
    </>
  );
}

function AboutSection() {
  const platform = useApp((s) => s.platform);
  const rows: Array<[string, ReactNode]> = [
    ["Version", __APP_VERSION__],
    ["Platform", `${platform.os === "macOs" ? "macOS" : platform.os === "windows" ? "Windows" : "Other"} · ${platform.arch || "unknown"}`],
    ["Privacy", "Chats and keys stay on this device. Messages go only to the providers you use."],
    ["License", "Proprietary. All rights reserved."],
  ];
  return (
    <>
      <Card>
        <CardHeader title="Machi" />
        <CardBody className="gap-3">
          {rows.map(([k, v]) => (
            <div key={k} className="flex gap-6">
              <span className="w-24 shrink-0 text-label text-muted">{k}</span>
              <span className="text-label text-fg">{v}</span>
            </div>
          ))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Keyboard shortcuts" />
        <CardBody>
          <ShortcutList />
        </CardBody>
      </Card>
    </>
  );
}

export function SettingsPage({ section }: { section: SettingsSection }) {
  return (
    <div className="flex h-full min-h-0">
      <nav aria-label="Settings sections" className="flex w-56 shrink-0 flex-col gap-1 border-r border-border px-3 py-8">
        <h1 className="px-3 pb-4 text-heading font-bold text-fg">Settings</h1>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-current={s.id === section ? "page" : undefined}
            onClick={() => navigate({ name: "settings", section: s.id })}
            className={cn(
              "flex h-9 items-center rounded-control px-3 text-left text-label",
              s.id === section ? "bg-active font-medium text-fg" : "text-muted hover:bg-hover hover:text-fg",
              focusRing,
              transition,
            )}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-(--settings-width) flex-col gap-6 px-8 py-8">
          <h2 className="text-page font-bold text-fg">{SECTIONS.find((s) => s.id === section)?.label}</h2>
          {section === "providers" && <ProvidersSection />}
          {section === "models" && <ModelsSection />}
          {section === "appearance" && <AppearanceSection />}
          {section === "data" && <DataSection />}
          {section === "about" && <AboutSection />}
        </div>
      </div>
    </div>
  );
}
