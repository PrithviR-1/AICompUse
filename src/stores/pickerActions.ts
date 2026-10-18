// What choosing a model in the picker does, per purpose. Kept out of components (§11.1).
import { useApp } from "./app";
import { useComposer } from "./composer";
import { useConversation } from "./conversation";
import type { PickerPurpose } from "./ui";

export function applyPickerChoice(purpose: PickerPurpose, key: string) {
  const composer = useComposer.getState();
  switch (purpose.kind) {
    case "new-chat":
      composer.setNewChat({ modelKey: key });
      break;
    case "chat":
      composer.setChatModel(purpose.conversationId, key);
      break;
    case "mention":
      composer.setMention(purpose.draftKey, key);
      break;
    case "retry":
      void useConversation.getState().regenerate(purpose.messageId, key);
      break;
    case "compare-column":
      if (purpose.conversationId) {
        void useConversation.getState().setCompareModel(purpose.column, key);
      } else {
        const next = [...(composer.newChat.compare ?? [])];
        next[purpose.column] = key;
        composer.setNewChat({ compare: next });
      }
      break;
    case "default-model":
      void useApp.getState().updateSettings({ defaultModel: key });
      break;
  }
}

/** Turns compare on with the current model and another one (picker footer, rail). */
export function startCompareWith(models: [string, string], conversationId: string | null) {
  if (conversationId) void useConversation.getState().startCompare(models);
  else useComposer.getState().setNewChat({ compare: models });
}
