// Which model a new message goes to (§15.0 item 12: remember the last-used model).
import { useMemo } from "react";
import type { ModelInfo } from "@/lib/bindings";
import { lastModelOnPath, indexMessages, visiblePath } from "@/lib/tree";
import { useApp } from "@/stores/app";
import { useComposer } from "@/stores/composer";
import { useConversation } from "@/stores/conversation";
import { useModels } from "@/stores/models";

/** First candidate that is a known chat model; before models load, the first candidate. */
function resolve(candidates: Array<string | null | undefined>, models: ModelInfo[]): string {
  const keys = candidates.filter((k): k is string => Boolean(k));
  if (models.length === 0) return keys[0] ?? "";
  const usable = models.filter((m) => m.chatSupported);
  return keys.find((k) => usable.some((m) => m.key === k)) ?? usable[0]?.key ?? keys[0] ?? "";
}

/** Model for a chat that hasn't started: chip choice, then last used, then the default. */
export function useNewChatModelKey(): string {
  const chosen = useComposer((s) => s.newChat.modelKey);
  const recent = useApp((s) => s.settings.recentModels);
  const defaultModel = useApp((s) => s.settings.defaultModel);
  const fallback = useApp((s) => s.defaultModel);
  const models = useModels((s) => s.models);
  return useMemo(() => resolve([chosen, recent[0], defaultModel, fallback], models), [chosen, recent, defaultModel, fallback, models]);
}

/** Model for the open chat: header choice, then the model of the latest reply. */
export function useChatModelKey(): string {
  const conversation = useConversation((s) => s.conversation);
  const messages = useConversation((s) => s.messages);
  const picked = useComposer((s) => (conversation ? s.chatModels[conversation.id] : undefined));
  const newChatModel = useNewChatModelKey();
  const models = useModels((s) => s.models);
  return useMemo(() => {
    const path = visiblePath(indexMessages(Object.values(messages)), conversation?.currentLeafId ?? null);
    return resolve([picked, lastModelOnPath(path), newChatModel], models);
  }, [conversation?.currentLeafId, messages, picked, newChatModel, models]);
}
