// Home / new chat (§15.1, §15.5): wordmark, model chips, the composer (or the first-run card)
// and the Models row. Generous empty space; nothing competes with the composer.
import { useMemo } from "react";
import { Plus, Search, SquarePen, X } from "lucide-react";
import { ModelAvatar } from "@/components/ui/avatar";
import { Chip } from "@/components/ui/chip";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { Composer } from "@/components/composer/Composer";
import { Wordmark } from "@/components/shell/MachiMark";
import type { ModelInfo } from "@/lib/bindings";
import { navigate } from "@/lib/router";
import { useNewChatModelKey } from "@/hooks/useModelSelection";
import { useApp } from "@/stores/app";
import { NEW_CHAT, useComposer } from "@/stores/composer";
import { useConversation } from "@/stores/conversation";
import { modelLabel, useModels } from "@/stores/models";
import { useUi } from "@/stores/ui";
import { ModelsRow } from "./ModelsRow";
import { SetupCard } from "./SetupCard";

const MAX_TILES = 12;

function ModelChip({ model, modelKey, selected, onClick, models }: { model?: ModelInfo; modelKey: string; selected: boolean; onClick: () => void; models: ModelInfo[] }) {
  const label = model ?? modelLabel(models, modelKey);
  return (
    <Chip size="lg" selected={selected} onClick={onClick} title={label.name} leading={<ModelAvatar name={label.name} vendor={label.vendor} />} className="max-w-56">
      {label.name}
    </Chip>
  );
}

export function HomeView() {
  const hasKey = useApp((s) => s.hasRequiredKey);
  const settings = useApp((s) => s.settings);
  const providers = useApp((s) => s.providers);
  const saveKey = useApp((s) => s.saveKey);
  const models = useModels((s) => s.models);
  const modelsStatus = useModels((s) => s.status);
  const loadModels = useModels((s) => s.load);
  const newChat = useComposer((s) => s.newChat);
  const setNewChat = useComposer((s) => s.setNewChat);
  const openPicker = useUi((s) => s.openPicker);
  const send = useConversation((s) => s.send);
  const selectedKey = useNewChatModelKey();

  const visible = useMemo(() => models.filter((m) => !settings.hiddenModels.includes(m.key)), [models, settings.hiddenModels]);
  const selected = visible.find((m) => m.key === selectedKey) ?? models.find((m) => m.key === selectedKey);
  const recent = settings.recentModels.filter((k) => k !== selectedKey && visible.some((m) => m.key === k)).slice(0, 2);
  const tiles = useMemo(() => {
    const favs = settings.favorites.map((k) => visible.find((m) => m.key === k)).filter((m): m is ModelInfo => Boolean(m));
    const rest = visible.filter((m) => !settings.favorites.includes(m.key));
    return [...favs, ...rest].slice(0, MAX_TILES);
  }, [visible, settings.favorites]);
  const compare = newChat.compare;
  const mixrouteHint = providers.find((p) => p.provider === "mixroute")?.keyHint ?? "Create a key in the Mixroute dashboard at mixroute.ai.";

  const onSaveKey = async (key: string) => {
    const error = await saveKey("mixroute", key);
    if (!error) void loadModels(true);
    return error;
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="absolute top-3 right-4">
        <IconButton label="New chat" icon={<Icon icon={SquarePen} size="md" />} tooltipSide="left" onClick={() => useComposer.getState().resetNewChat()} />
      </div>

      <div className="flex min-h-full flex-col items-center px-6">
        <div className="min-h-12 flex-[1.6_1_0%]" />

        <div className="flex w-full flex-col items-center gap-10">
          <Wordmark />

          {compare ? (
            <div role="group" className="flex max-w-full flex-wrap items-center justify-center gap-3" aria-label="Models to compare">
              <span className="text-label text-muted">Compare</span>
              {compare.map((key, column) => (
                <ModelChip
                  key={`${key}-${column}`}
                  modelKey={key}
                  models={models}
                  model={models.find((m) => m.key === key)}
                  selected
                  onClick={() => openPicker({ kind: "compare-column", conversationId: null, column })}
                />
              ))}
              {compare.length < 3 && (
                <IconButton
                  label="Add a model to compare"
                  icon={<Icon icon={Plus} size="md" />}
                  onClick={() => openPicker({ kind: "compare-column", conversationId: null, column: compare.length })}
                />
              )}
              <IconButton label="Stop comparing" icon={<Icon icon={X} size="md" />} onClick={() => setNewChat({ compare: null })} />
            </div>
          ) : (
            <div role="group" className="flex max-w-full flex-wrap items-center justify-center gap-3" aria-label="Choose a model">
              {selectedKey && <ModelChip modelKey={selectedKey} model={selected} models={models} selected onClick={() => openPicker({ kind: "new-chat" })} />}
              {recent.map((key) => (
                <ModelChip key={key} modelKey={key} models={models} model={models.find((m) => m.key === key)} selected={false} onClick={() => setNewChat({ modelKey: key })} />
              ))}
              <IconButton label="Search models" icon={<Icon icon={Search} size="md" />} onClick={() => openPicker({ kind: "new-chat" })} />
            </div>
          )}

          <div className="-mt-2 w-[55%] max-w-(--column-width) min-w-[min(28rem,100%)]">
            {hasKey ? (
              <Composer
                draftKey={NEW_CHAT}
                placeholder="Start a new chat"
                model={selected}
                models={visible}
                favorites={settings.favorites}
                streaming={false}
                settings={newChat.settings}
                onSettingsChange={(s) => setNewChat({ settings: s })}
                compareActive={Boolean(compare)}
                autoFocus
                onSend={(input) =>
                  send({
                    ...input,
                    compareModels: compare,
                    settings: newChat.settings,
                    temporary: newChat.temporary,
                  })
                }
                onStop={() => undefined}
              />
            ) : (
              <SetupCard hint={mixrouteHint} onSave={onSaveKey} />
            )}
          </div>
        </div>

        <div className="min-h-12 flex-[1_1_0%]" />

        <div className="w-[72%] max-w-(--home-width) min-w-[min(40rem,100%)] pb-10">
          <ModelsRow
            models={tiles}
            status={modelsStatus}
            onSelect={(key) => {
              setNewChat({ modelKey: key, compare: null });
              requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-testid="composer"] textarea')?.focus());
            }}
            onSeeAll={() => navigate({ name: "models" })}
            onRetry={() => void loadModels(true)}
          />
        </div>
      </div>
    </div>
  );
}
