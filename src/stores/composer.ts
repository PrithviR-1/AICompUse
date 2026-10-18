// Composer state: per-chat drafts and attachments, the one-shot "@" model, and the choices
// for a chat that doesn't exist yet (model, compare models, settings, temporary).
import { create } from "zustand";
import type { ChatSettings, NewAttachment } from "@/lib/bindings";

/** Draft key for the new-chat composer on the home screen. */
export const NEW_CHAT = "new";

const EMPTY_CHAT_SETTINGS: ChatSettings = { systemPrompt: null, temperature: null, maxTokens: null, reasoningEffort: null };

interface NewChatChoices {
  modelKey: string | null;
  compare: string[] | null;
  settings: ChatSettings;
  temporary: boolean;
}

interface ComposerState {
  drafts: Record<string, string>;
  attachments: Record<string, NewAttachment[]>;
  /** "@" model for the next message only, per draft key. */
  mention: Record<string, string | null>;
  /** Model picked in the chat header, per conversation. */
  chatModels: Record<string, string>;
  newChat: NewChatChoices;
  setDraft: (key: string, text: string) => void;
  addAttachments: (key: string, items: NewAttachment[]) => void;
  removeAttachment: (key: string, index: number) => void;
  setMention: (key: string, modelKey: string | null) => void;
  setChatModel: (conversationId: string, modelKey: string) => void;
  clearDraft: (key: string) => void;
  setNewChat: (patch: Partial<NewChatChoices>) => void;
  resetNewChat: () => void;
}

const freshNewChat = (): NewChatChoices => ({ modelKey: null, compare: null, settings: EMPTY_CHAT_SETTINGS, temporary: false });

export const useComposer = create<ComposerState>((set, get) => ({
  drafts: {},
  attachments: {},
  mention: {},
  chatModels: {},
  newChat: freshNewChat(),
  setDraft: (key, text) => set({ drafts: { ...get().drafts, [key]: text } }),
  addAttachments: (key, items) => set({ attachments: { ...get().attachments, [key]: [...(get().attachments[key] ?? []), ...items] } }),
  removeAttachment: (key, index) =>
    set({ attachments: { ...get().attachments, [key]: (get().attachments[key] ?? []).filter((_, i) => i !== index) } }),
  setMention: (key, modelKey) => set({ mention: { ...get().mention, [key]: modelKey } }),
  setChatModel: (conversationId, modelKey) => set({ chatModels: { ...get().chatModels, [conversationId]: modelKey } }),
  clearDraft: (key) =>
    set({
      drafts: { ...get().drafts, [key]: "" },
      attachments: { ...get().attachments, [key]: [] },
      mention: { ...get().mention, [key]: null },
    }),
  setNewChat: (patch) => set({ newChat: { ...get().newChat, ...patch } }),
  resetNewChat: () => set({ newChat: { ...freshNewChat(), modelKey: get().newChat.modelKey } }),
}));
