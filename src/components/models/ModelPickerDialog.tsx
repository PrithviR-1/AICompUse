// The model picker as a command palette (Ctrl/Cmd+K, header button, home search chip,
// "Retry with another model", compare columns). What a choice does depends on who opened it.
import { useMemo } from "react";
import { Dialog as RadixDialog } from "radix-ui";
import { Columns2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { ModelInfo } from "@/lib/bindings";
import { navigate } from "@/lib/router";
import { useApp } from "@/stores/app";
import { NEW_CHAT, useComposer } from "@/stores/composer";
import { useConversation } from "@/stores/conversation";
import { useModels } from "@/stores/models";
import { applyPickerChoice, startCompareWith } from "@/stores/pickerActions";
import { useUi, type PickerPurpose } from "@/stores/ui";
import { useChatModelKey, useNewChatModelKey } from "@/hooks/useModelSelection";
import { ModelPickerList } from "./ModelPickerList";

const noVision = (m: ModelInfo) => (m.caps.vision ? null : "Can't read images");

function titleFor(purpose: PickerPurpose): string {
  switch (purpose.kind) {
    case "retry":
      return "Retry with another model";
    case "compare-column":
      return "Choose a model to compare";
    case "mention":
      return "Use a model for this message";
    case "default-model":
      return "Default model for new chats";
    default:
      return "Choose a model";
  }
}

export function ModelPickerDialog() {
  const picker = useUi((s) => s.picker);
  const close = useUi((s) => s.closePicker);
  const models = useModels((s) => s.models);
  const settings = useApp((s) => s.settings);
  const newChatKey = useNewChatModelKey();
  const chatKey = useChatModelKey();
  const messages = useConversation((s) => s.messages);
  const conversation = useConversation((s) => s.conversation);
  const attachments = useComposer((s) => s.attachments);
  const newChat = useComposer((s) => s.newChat);

  const visible = useMemo(() => models.filter((m) => !settings.hiddenModels.includes(m.key)), [models, settings.hiddenModels]);

  if (!picker) return null;

  const draftKey = picker.kind === "new-chat" ? NEW_CHAT : picker.kind === "chat" ? picker.conversationId : picker.kind === "mention" ? picker.draftKey : null;
  const draftHasImage = draftKey ? (attachments[draftKey] ?? []).some((a) => a.kind === "image") : false;
  const retryHasImage =
    picker.kind === "retry"
      ? (() => {
          const parentId = messages[picker.messageId]?.parentId;
          return Boolean(parentId && messages[parentId]?.attachments.some((a) => a.kind === "image"));
        })()
      : false;
  const needsVision = draftHasImage || retryHasImage;

  let selectedKey: string | null = null;
  if (picker.kind === "new-chat") selectedKey = newChatKey;
  if (picker.kind === "chat") selectedKey = chatKey;
  if (picker.kind === "default-model") selectedKey = settings.defaultModel;
  if (picker.kind === "compare-column") {
    selectedKey = picker.conversationId ? (conversation?.compare?.[picker.column]?.modelKey ?? null) : (newChat.compare?.[picker.column] ?? null);
  }

  const choose = (key: string) => {
    applyPickerChoice(picker, key);
    close();
  };

  const canCompare = picker.kind === "new-chat" || picker.kind === "chat";
  const startCompare = () => {
    const current = picker.kind === "chat" ? chatKey : newChatKey;
    const other = settings.recentModels.find((k) => k !== current && visible.some((m) => m.key === k)) ?? visible.find((m) => m.key !== current)?.key;
    if (!other) return;
    startCompareWith([current, other], picker.kind === "chat" ? picker.conversationId : null);
    close();
  };

  return (
    <RadixDialog.Root open onOpenChange={(open) => !open && close()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-overlay animate-fade-in" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="fixed top-[12vh] left-1/2 z-50 w-[min(var(--dialog-wide),calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-dialog border border-border bg-raised shadow-popover outline-none animate-pop-in"
        >
          <RadixDialog.Title className="sr-only">{titleFor(picker)}</RadixDialog.Title>
          <ModelPickerList
            models={visible}
            favorites={settings.favorites}
            selectedKey={selectedKey}
            onSelect={choose}
            unavailableReason={needsVision ? noVision : undefined}
            footer={
              <div className="flex items-center gap-2 border-t border-border px-3 py-2">
                {canCompare && (
                  <Button variant="ghost" size="sm" onClick={startCompare}>
                    <Icon icon={Columns2} size="sm" />
                    Compare models
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    close();
                    navigate({ name: "settings", section: "models" });
                  }}
                >
                  <Icon icon={Settings2} size="sm" />
                  Manage models
                </Button>
                <span className="ml-auto truncate text-caption text-faint">Enter to choose · Esc to close</span>
              </div>
            }
          />
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
