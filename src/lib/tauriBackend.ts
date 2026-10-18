// Tauri implementation of MachiBackend over the generated tauri-specta bindings.
import { Channel } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { commands, type ChatEvent, type ErrorInfo } from "./bindings";
import { MachiError } from "./errors";
import type { ChatEventHandler, MachiBackend } from "./machiClient";

type Result<T> = { status: "ok"; data: T } | { status: "error"; error: ErrorInfo };

async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise;
  if (result.status === "error") throw new MachiError(result.error);
  return result.data;
}

function channel(onEvent: ChatEventHandler): Channel<ChatEvent> {
  const ch = new Channel<ChatEvent>();
  ch.onmessage = onEvent;
  return ch;
}

export function createTauriBackend(): MachiBackend {
  return {
    kind: "tauri",
    platformInfo: () => commands.platformInfo(),
    bootstrap: () => unwrap(commands.bootstrap()),
    listModels: (refresh) => unwrap(commands.listModels(refresh)),
    providerStatuses: () => commands.providerStatuses(),
    testApiKey: async (provider, key) => {
      await unwrap(commands.testApiKey(provider, key));
    },
    saveApiKey: (provider, key) => unwrap(commands.saveApiKey(provider, key)),
    deleteApiKey: (provider) => unwrap(commands.deleteApiKey(provider)),
    saveSettings: (settings) => unwrap(commands.saveSettings(settings)),
    listConversations: () => unwrap(commands.listConversations()),
    getConversation: (id) => unwrap(commands.getConversation(id)),
    searchConversations: (query) => unwrap(commands.searchConversations(query)),
    sendMessage: (request, onEvent) => unwrap(commands.sendMessage(request, channel(onEvent))),
    regenerateMessage: (request, onEvent) => unwrap(commands.regenerateMessage(request, channel(onEvent))),
    editMessage: (request, onEvent) => unwrap(commands.editMessage(request, channel(onEvent))),
    stopGeneration: (messageId) => commands.stopGeneration(messageId),
    stopConversation: (conversationId) => commands.stopConversation(conversationId),
    selectBranch: (conversationId, messageId) => unwrap(commands.selectBranch(conversationId, messageId)),
    deleteMessage: (messageId) => unwrap(commands.deleteMessage(messageId)),
    startCompare: (conversationId, models) => unwrap(commands.startCompare(conversationId, models)),
    setCompareModel: (conversationId, column, modelKey) => unwrap(commands.setCompareModel(conversationId, column, modelKey)),
    endCompare: (conversationId, keepColumn) => unwrap(commands.endCompare(conversationId, keepColumn)),
    renameConversation: (id, title) => unwrap(commands.renameConversation(id, title)),
    setConversationPinned: (id, pinned) => unwrap(commands.setConversationPinned(id, pinned)),
    updateChatSettings: (id, settings) => unwrap(commands.updateChatSettings(id, settings)),
    deleteConversation: async (id) => {
      await unwrap(commands.deleteConversation(id));
    },
    exportConversation: (id, format) => unwrap(commands.exportConversation(id, format)),
    exportAll: (format) => unwrap(commands.exportAll(format)),
    deleteAllData: async () => {
      await unwrap(commands.deleteAllData());
    },
    openExternal: (url) => openUrl(url),
  };
}
