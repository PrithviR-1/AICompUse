// Chat history list (flyout, search palette) and per-chat list actions.
import { create } from "zustand";
import type { Conversation, ConversationSummary, ErrorInfo, ExportFormat, SearchHit } from "@/lib/bindings";
import { toErrorInfo } from "@/lib/errors";
import { machi } from "@/lib/machiClient";
import { shortPath } from "./app";
import { toast } from "./toasts";

interface ChatsState {
  status: "idle" | "loading" | "ready" | "error";
  list: ConversationSummary[];
  error: ErrorInfo | null;
  load: () => Promise<void>;
  upsert: (c: Conversation) => void;
  setTitle: (id: string, title: string) => void;
  forget: (id: string) => void;
  rename: (id: string, title: string) => Promise<Conversation | null>;
  setPinned: (id: string, pinned: boolean) => Promise<Conversation | null>;
  remove: (id: string) => Promise<boolean>;
  exportChat: (id: string, format: ExportFormat) => Promise<void>;
  search: (query: string) => Promise<SearchHit[]>;
}

function sorted(list: ConversationSummary[]): ConversationSummary[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

export const useChats = create<ChatsState>((set, get) => ({
  status: "idle",
  list: [],
  error: null,

  load: async () => {
    set({ status: get().list.length ? "ready" : "loading", error: null });
    try {
      set({ status: "ready", list: await machi().listConversations() });
    } catch (e) {
      set({ status: "error", error: toErrorInfo(e) });
    }
  },

  upsert: (c) => {
    if (c.temporary) return;
    const summary: ConversationSummary = { id: c.id, title: c.title, pinned: c.pinned, createdAt: c.createdAt, updatedAt: c.updatedAt };
    set({ list: sorted([summary, ...get().list.filter((x) => x.id !== c.id)]) });
  },

  setTitle: (id, title) => set({ list: get().list.map((c) => (c.id === id ? { ...c, title } : c)) }),

  forget: (id) => set({ list: get().list.filter((c) => c.id !== id) }),

  rename: async (id, title) => {
    try {
      const c = await machi().renameConversation(id, title);
      get().upsert(c);
      return c;
    } catch (e) {
      toast(toErrorInfo(e).message, { tone: "danger" });
      return null;
    }
  },

  setPinned: async (id, pinned) => {
    try {
      const c = await machi().setConversationPinned(id, pinned);
      get().upsert(c);
      toast(pinned ? "Chat pinned" : "Chat unpinned");
      return c;
    } catch (e) {
      toast(toErrorInfo(e).message, { tone: "danger" });
      return null;
    }
  },

  remove: async (id) => {
    try {
      await machi().deleteConversation(id);
      get().forget(id);
      toast("Chat deleted");
      return true;
    } catch (e) {
      toast(toErrorInfo(e).message, { tone: "danger" });
      return false;
    }
  },

  exportChat: async (id, format) => {
    try {
      const path = await machi().exportConversation(id, format);
      toast(`Exported to ${shortPath(path)}`, { tone: "success" });
    } catch (e) {
      toast(toErrorInfo(e).message, { tone: "danger" });
    }
  },

  search: async (query) => {
    try {
      return await machi().searchConversations(query);
    } catch (e) {
      toast(toErrorInfo(e).message, { tone: "danger" });
      return [];
    }
  },
}));
