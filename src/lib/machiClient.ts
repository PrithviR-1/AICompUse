// The only gateway from the UI to the backend (§1.1). Stores call `machi()`; components never do.
// Inside Tauri it wraps the generated bindings; in a plain browser (dev server, Playwright,
// Vitest) it uses the in-memory mock backend.
import type {
  AppSettings,
  Bootstrap,
  ChatEvent,
  ChatSettings,
  Conversation,
  ConversationDetail,
  ConversationSummary,
  EditRequest,
  ExportFormat,
  ModelList,
  PlatformInfo,
  ProviderId,
  ProviderStatus,
  RegenerateRequest,
  SearchHit,
  SendRequest,
  SendResult,
} from "./bindings";

export type ChatEventHandler = (event: ChatEvent) => void;

export interface MachiBackend {
  readonly kind: "tauri" | "mock";
  platformInfo(): Promise<PlatformInfo>;
  bootstrap(): Promise<Bootstrap>;
  listModels(refresh: boolean): Promise<ModelList>;
  providerStatuses(): Promise<ProviderStatus[]>;
  testApiKey(provider: ProviderId, key: string | null): Promise<void>;
  saveApiKey(provider: ProviderId, key: string): Promise<ProviderStatus>;
  deleteApiKey(provider: ProviderId): Promise<ProviderStatus>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  listConversations(): Promise<ConversationSummary[]>;
  getConversation(id: string): Promise<ConversationDetail>;
  searchConversations(query: string): Promise<SearchHit[]>;
  sendMessage(request: SendRequest, onEvent: ChatEventHandler): Promise<SendResult>;
  regenerateMessage(request: RegenerateRequest, onEvent: ChatEventHandler): Promise<SendResult>;
  editMessage(request: EditRequest, onEvent: ChatEventHandler): Promise<SendResult>;
  stopGeneration(messageId: string): Promise<boolean>;
  stopConversation(conversationId: string): Promise<number>;
  selectBranch(conversationId: string, messageId: string): Promise<Conversation>;
  deleteMessage(messageId: string): Promise<Conversation>;
  startCompare(conversationId: string, models: string[]): Promise<Conversation>;
  setCompareModel(conversationId: string, column: number, modelKey: string): Promise<Conversation>;
  endCompare(conversationId: string, keepColumn: number | null): Promise<Conversation>;
  renameConversation(id: string, title: string): Promise<Conversation>;
  setConversationPinned(id: string, pinned: boolean): Promise<Conversation>;
  updateChatSettings(id: string, settings: ChatSettings): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;
  exportConversation(id: string, format: ExportFormat): Promise<string>;
  exportAll(format: ExportFormat): Promise<string>;
  deleteAllData(): Promise<void>;
  openExternal(url: string): Promise<void>;
}

let instance: MachiBackend | null = null;

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Picks and caches the backend. Call once before rendering. */
export async function initBackend(): Promise<MachiBackend> {
  if (instance) return instance;
  if (inTauri()) {
    const { createTauriBackend } = await import("./tauriBackend");
    instance = createTauriBackend();
  } else {
    const { createMockBackend, readMockConfig } = await import("./mock/mockBackend");
    instance = createMockBackend(readMockConfig());
  }
  return instance;
}

/** Replaces the backend (tests). */
export function setBackend(backend: MachiBackend) {
  instance = backend;
}

export function machi(): MachiBackend {
  if (!instance) throw new Error("Backend not initialized: call initBackend() first");
  return instance;
}
