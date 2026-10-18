// The open conversation: its message tree, streaming state and every chat action
// (send, stop, regenerate, edit, branch, compare). Streamed events from the backend are
// applied here; events for a chat that is no longer open only update the history list.
import { create } from "zustand";
import type {
  ChatEvent,
  ChatSettings,
  Conversation,
  ErrorInfo,
  ExportFormat,
  Message,
  NewAttachment,
  SendResult,
} from "@/lib/bindings";
import { toErrorInfo } from "@/lib/errors";
import { machi } from "@/lib/machiClient";
import { navigate } from "@/lib/router";
import { useApp } from "./app";
import { useChats } from "./chats";
import { useComposer } from "./composer";
import { toast } from "./toasts";

interface SendInput {
  content: string;
  attachments: NewAttachment[];
  modelKey: string;
  /** The chat's own model when `modelKey` is a one-message "@" override (§15.7). */
  baseModelKey?: string;
  /** New chats only. */
  compareModels?: string[] | null;
  settings?: ChatSettings | null;
  temporary?: boolean;
}

interface ConversationState {
  activeId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  error: ErrorInfo | null;
  conversation: Conversation | null;
  messages: Record<string, Message>;
  streaming: Record<string, true>;
  /** Error from the last send/regenerate call itself (shown by the composer). */
  actionError: ErrorInfo | null;
  open: (id: string) => Promise<void>;
  clear: () => void;
  send: (input: SendInput) => Promise<boolean>;
  regenerate: (messageId: string, modelKey?: string | null) => Promise<void>;
  edit: (messageId: string, content: string, modelKey: string) => Promise<boolean>;
  stop: () => Promise<void>;
  selectBranch: (messageId: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  startCompare: (models: string[]) => Promise<void>;
  setCompareModel: (column: number, modelKey: string) => Promise<void>;
  endCompare: (keepColumn: number | null) => Promise<void>;
  updateChatSettings: (settings: ChatSettings) => Promise<void>;
  setConversation: (c: Conversation) => void;
  exportChat: (format: ExportFormat) => Promise<void>;
  dismissActionError: () => void;
}

/** Deltas and completions that arrived before the call that created their message returned. */
const pendingDeltas = new Map<string, string>();
const pendingFinished = new Map<string, Message>();

/** Deltas waiting for the next animation frame, so a burst of tokens costs one render. */
const queuedDeltas = new Map<string, { conversationId: string; text: string }>();
let flushScheduled = false;

const nextFrame = (fn: () => void) =>
  typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(fn, 16);

export const useConversation = create<ConversationState>((set, get) => {
  function flushDeltas() {
    flushScheduled = false;
    if (queuedDeltas.size === 0) return;
    const state = get();
    let messages: Record<string, Message> | null = null;
    for (const [id, { conversationId, text }] of queuedDeltas) {
      const message = (messages ?? state.messages)[id];
      if (message && state.activeId === conversationId) {
        messages ??= { ...state.messages };
        messages[id] = { ...message, content: message.content + text };
      } else if (!message) {
        pendingDeltas.set(id, (pendingDeltas.get(id) ?? "") + text);
      }
    }
    queuedDeltas.clear();
    if (messages) set({ messages });
  }

  function applyEvent(event: ChatEvent) {
    switch (event.type) {
      case "delta": {
        const queued = queuedDeltas.get(event.messageId);
        queuedDeltas.set(event.messageId, { conversationId: event.conversationId, text: (queued?.text ?? "") + event.text });
        if (!flushScheduled) {
          flushScheduled = true;
          nextFrame(flushDeltas);
        }
        break;
      }
      case "finished": {
        // Apply any queued text first so ordering is preserved, then the final message wins.
        flushDeltas();
        pendingDeltas.delete(event.message.id);
        const state = get();
        if (!state.messages[event.message.id]) {
          // Only a chat still being created can receive a reply it doesn't know yet.
          if (state.activeId === null || state.activeId === event.message.conversationId) {
            pendingFinished.set(event.message.id, event.message);
          }
        } else if (state.activeId === event.message.conversationId) {
          const streaming = { ...state.streaming };
          delete streaming[event.message.id];
          set({ messages: { ...state.messages, [event.message.id]: event.message }, streaming });
        }
        break;
      }
      case "title": {
        useChats.getState().setTitle(event.conversationId, event.title);
        const c = get().conversation;
        if (c && c.id === event.conversationId) set({ conversation: { ...c, title: event.title } });
        break;
      }
    }
  }

  /** Merges messages created by a send/regenerate/edit call into the open chat. */
  function applyResult(result: SendResult) {
    const messages = { ...get().messages };
    const streaming = { ...get().streaming };
    for (const m of result.messages) {
      const finished = pendingFinished.get(m.id);
      if (finished) {
        pendingFinished.delete(m.id);
        pendingDeltas.delete(m.id);
        messages[m.id] = finished;
        continue;
      }
      const early = pendingDeltas.get(m.id);
      pendingDeltas.delete(m.id);
      const existing = messages[m.id];
      // A fast reply may already have finished before this result arrived.
      if (existing && existing.status !== "streaming") continue;
      messages[m.id] = early ? { ...m, content: m.content + early } : m;
      if (m.status === "streaming") streaming[m.id] = true;
    }
    set({ conversation: result.conversation, messages, streaming, actionError: null });
    useChats.getState().upsert(result.conversation);
    useApp.getState().noteRecentModels(result.messages.filter((m) => m.role === "assistant").map((m) => m.modelKey ?? ""));
  }

  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    try {
      return await action();
    } catch (e) {
      const info = toErrorInfo(e);
      set({ actionError: info });
      toast(info.message, { tone: "danger" });
      return null;
    }
  }

  return {
    activeId: null,
    status: "idle",
    error: null,
    conversation: null,
    messages: {},
    streaming: {},
    actionError: null,

    open: async (id) => {
      const state = get();
      if (state.activeId === id && (state.status === "ready" || state.status === "loading")) return;
      set({ activeId: id, status: "loading", error: null, conversation: null, messages: {}, streaming: {}, actionError: null });
      try {
        const detail = await machi().getConversation(id);
        if (get().activeId !== id) return;
        const messages: Record<string, Message> = {};
        const streaming: Record<string, true> = {};
        for (const m of detail.messages) {
          messages[m.id] = m;
          if (m.status === "streaming") streaming[m.id] = true;
        }
        set({ status: "ready", conversation: detail.conversation, messages, streaming });
      } catch (e) {
        if (get().activeId === id) set({ status: "error", error: toErrorInfo(e) });
      }
    },

    clear: () => set({ activeId: null, status: "idle", error: null, conversation: null, messages: {}, streaming: {}, actionError: null }),

    send: async (input) => {
      const conversationId = get().conversation?.id ?? null;
      const result = await run(() =>
        machi().sendMessage(
          {
            conversationId,
            content: input.content,
            attachments: input.attachments,
            modelKey: input.modelKey,
            compareModels: conversationId ? null : (input.compareModels ?? null),
            settings: conversationId ? null : (input.settings ?? null),
            temporary: conversationId ? false : Boolean(input.temporary),
          },
          applyEvent,
        ),
      );
      if (!result) return false;
      if (!conversationId) {
        set({ activeId: result.conversation.id, status: "ready", messages: {}, streaming: {} });
      }
      applyResult(result);
      // Keep the chat on its own model; an "@" model applies to this message only.
      useComposer.getState().setChatModel(result.conversation.id, input.baseModelKey ?? input.modelKey);
      if (!conversationId) navigate({ name: "chat", id: result.conversation.id });
      return true;
    },

    regenerate: async (messageId, modelKey) => {
      const result = await run(() => machi().regenerateMessage({ messageId, modelKey: modelKey ?? null }, applyEvent));
      if (result) applyResult(result);
    },

    edit: async (messageId, content, modelKey) => {
      const result = await run(() => machi().editMessage({ messageId, content, modelKey }, applyEvent));
      if (result) applyResult(result);
      return Boolean(result);
    },

    stop: async () => {
      const id = get().conversation?.id;
      if (id) await machi().stopConversation(id);
    },

    selectBranch: async (messageId) => {
      const id = get().conversation?.id;
      if (!id) return;
      const c = await run(() => machi().selectBranch(id, messageId));
      if (c) set({ conversation: c });
    },

    deleteMessage: async (messageId) => {
      const c = await run(() => machi().deleteMessage(messageId));
      if (!c) return;
      const messages = { ...get().messages };
      const removed = new Set([messageId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const m of Object.values(messages)) {
          if (m.parentId && removed.has(m.parentId) && !removed.has(m.id)) {
            removed.add(m.id);
            grew = true;
          }
        }
      }
      for (const id of removed) delete messages[id];
      set({ conversation: c, messages });
      toast("Message deleted");
    },

    startCompare: async (models) => {
      const id = get().conversation?.id;
      if (!id) return;
      const c = await run(() => machi().startCompare(id, models));
      if (c) set({ conversation: c });
    },

    setCompareModel: async (column, modelKey) => {
      const id = get().conversation?.id;
      if (!id) return;
      const c = await run(() => machi().setCompareModel(id, column, modelKey));
      if (c) set({ conversation: c });
    },

    endCompare: async (keepColumn) => {
      const id = get().conversation?.id;
      if (!id) return;
      const c = await run(() => machi().endCompare(id, keepColumn));
      if (c) set({ conversation: c });
    },

    updateChatSettings: async (settings) => {
      const id = get().conversation?.id;
      if (!id) return;
      const c = await run(() => machi().updateChatSettings(id, settings));
      if (c) set({ conversation: c });
    },

    setConversation: (c) => {
      if (get().conversation?.id === c.id) set({ conversation: c });
    },

    exportChat: async (format) => {
      const id = get().conversation?.id;
      if (id) await useChats.getState().exportChat(id, format);
    },

    dismissActionError: () => set({ actionError: null }),
  };
});
