// In-memory MachiBackend for the browser dev server, Vitest and Playwright (§15.12: "mock
// adapter, no real API calls"). It mirrors the Rust chat service: message trees, compare
// columns, branching, streaming with stop, inline errors and generated titles.
import type {
  AppSettings,
  Attachment,
  ChatSettings,
  CompareColumn,
  Conversation,
  ConversationDetail,
  ErrorInfo,
  ErrorKind,
  Message,
  ModelInfo,
  NewAttachment,
  ProviderId,
  ProviderStatus,
  SearchHit,
  SendResult,
  Theme,
} from "../bindings";
import { MachiError } from "../errors";
import type { ChatEventHandler, MachiBackend } from "../machiClient";
import { MOCK_DEFAULT_MODEL, MOCK_MODELS, RICH_ANSWER, SEED_CHATS } from "./fixtures";

interface MockConfig {
  /** First run: no Mixroute key configured. */
  noKey?: boolean;
  theme?: Theme;
  /** Populate history with sample chats (default true). */
  seed?: boolean;
  /** Delay between streamed chunks (default 16 ms). */
  streamDelayMs?: number;
  /** Delay before the first token (default 350 ms). */
  firstTokenDelayMs?: number;
  /** Delay before model and chat lists resolve (default 0). */
  loadDelayMs?: number;
  /** Prompts containing this text fail with a rate limit (default "rate limit"). */
  failPhrase?: string;
  /** Make the model list fail so the cached/seeded fallback and its error show. */
  modelsError?: boolean;
}

declare global {
  interface Window {
    __MACHI_MOCK__?: MockConfig;
  }
}

/** Reads the config from `window.__MACHI_MOCK__` and `?mock=nokey,noseed,…` URL flags. */
export function readMockConfig(): MockConfig {
  const fromWindow = typeof window !== "undefined" ? (window.__MACHI_MOCK__ ?? {}) : {};
  const flags = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("mock")?.split(",") ?? [] : [];
  return {
    ...fromWindow,
    ...(flags.includes("nokey") ? { noKey: true } : {}),
    ...(flags.includes("noseed") ? { seed: false } : {}),
    ...(flags.includes("light") ? { theme: "light" as Theme } : {}),
    ...(flags.includes("dark") ? { theme: "dark" as Theme } : {}),
  };
}

const PROVIDER_NAMES: Record<ProviderId, string> = {
  mixroute: "Mixroute",
  openAi: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  deepSeek: "DeepSeek",
  openRouter: "OpenRouter",
};

const DEFAULT_URLS: Record<ProviderId, string> = {
  mixroute: "https://api.mixroute.ai/v1",
  openAi: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  deepSeek: "https://api.deepseek.com/v1",
  openRouter: "https://openrouter.ai/api/v1",
};

const SLUGS: Record<ProviderId, string> = {
  mixroute: "mixroute",
  openAi: "openai",
  anthropic: "anthropic",
  gemini: "gemini",
  deepSeek: "deepseek",
  openRouter: "openrouter",
};

const err = (kind: ErrorKind, message: string, retryAfterMs: number | null = null): ErrorInfo => ({ kind, message, retryAfterMs });
const invalid = (message: string) => new MachiError(err("invalid", message));
const notFound = (what: string) => new MachiError(err("notFound", `That ${what} no longer exists.`));

let idCounter = 0;
const newId = () => `m${Date.now().toString(36)}${(idCounter++).toString(36)}`;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}

/** Splits text into small streaming chunks (keeps whitespace). */
function chunks(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [text];
}

function provisionalTitle(content: string, attachments: NewAttachment[]): string {
  const line = content.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (!line) return attachments[0]?.name ?? "New chat";
  return line.length > 60 ? `${line.slice(0, 57).replace(/\s+\S*$/, "")}…` : line;
}

function generatedTitle(content: string): string {
  const words = content.replace(/[?!.]+$/g, "").split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  return words ? words[0].toUpperCase() + words.slice(1) : "New chat";
}

export function createMockBackend(config: MockConfig = {}): MachiBackend {
  const streamDelay = config.streamDelayMs ?? 16;
  const firstTokenDelay = config.firstTokenDelayMs ?? 350;
  const loadDelay = config.loadDelayMs ?? 0;
  const failPhrase = (config.failPhrase ?? "rate limit").toLowerCase();

  let settings: AppSettings = {
    theme: config.theme ?? "system",
    fontSize: "default",
    defaultModel: MOCK_DEFAULT_MODEL,
    recentModels: [],
    favorites: [],
    hiddenModels: [],
    flyoutPinned: false,
    baseUrls: {},
    autoTitle: true,
  };
  const keys: Record<ProviderId, boolean> = {
    mixroute: !config.noKey,
    openAi: false,
    anthropic: false,
    gemini: false,
    deepSeek: false,
    openRouter: false,
  };
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, Message>();
  const active = new Map<string, { controller: AbortController; conversationId: string }>();

  const models = (): ModelInfo[] => MOCK_MODELS;
  const findModel = (key: string) => models().find((m) => m.key === key);

  function status(provider: ProviderId): ProviderStatus {
    return {
      provider,
      name: PROVIDER_NAMES[provider],
      required: provider === "mixroute",
      configured: keys[provider],
      source: keys[provider] ? (provider === "mixroute" && !config.noKey ? "development" : "keychain") : null,
      baseUrl: settings.baseUrls[SLUGS[provider]] || DEFAULT_URLS[provider],
      defaultBaseUrl: DEFAULT_URLS[provider],
      keyHint: provider === "mixroute" ? "Create a key in the Mixroute dashboard at mixroute.ai." : `Create a key in your ${PROVIDER_NAMES[provider]} account.`,
    };
  }
  const allStatuses = () => (Object.keys(PROVIDER_NAMES) as ProviderId[]).map(status);

  function conversationMessages(id: string): Message[] {
    return [...messages.values()].filter((m) => m.conversationId === id).sort((a, b) => a.createdAt - b.createdAt);
  }

  function getConversation(id: string): Conversation {
    const c = conversations.get(id);
    if (!c) throw notFound("chat");
    return c;
  }

  function save(c: Conversation): Conversation {
    const copy = structuredClone(c);
    conversations.set(c.id, copy);
    return structuredClone(copy);
  }

  function noteRecent(keysUsed: string[]) {
    for (const key of [...keysUsed].reverse()) {
      settings.recentModels = [key, ...settings.recentModels.filter((m) => m !== key)].slice(0, 8);
    }
  }

  function userMessage(conversationId: string, parentId: string | null, content: string, attachments: NewAttachment[], at: number): Message {
    return {
      id: newId(),
      conversationId,
      parentId,
      role: "user",
      content,
      modelKey: null,
      status: "complete",
      error: null,
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      elapsedMs: null,
      createdAt: at,
      attachments: attachments.map((a): Attachment => ({ id: newId(), ...a })),
    };
  }

  function assistantMessage(conversationId: string, parentId: string, modelKey: string, at: number): Message {
    return {
      id: newId(),
      conversationId,
      parentId,
      role: "assistant",
      content: "",
      modelKey,
      status: "streaming",
      error: null,
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      elapsedMs: null,
      createdAt: at,
      attachments: [],
    };
  }

  function checkImages(hasImage: boolean, modelKey: string) {
    const m = findModel(modelKey);
    if (hasImage && !m?.caps.vision) {
      throw invalid(`${m?.name ?? modelKey} can't read images. Choose a model with image support, or remove the image.`);
    }
  }

  function pathTo(id: string | null): Message[] {
    const out: Message[] = [];
    let cursor = id ? messages.get(id) : undefined;
    while (cursor) {
      out.unshift(cursor);
      cursor = cursor.parentId ? messages.get(cursor.parentId) : undefined;
    }
    return out;
  }

  /** Simulates one streamed completion. */
  function generate(message: Message, onEvent: ChatEventHandler) {
    const controller = new AbortController();
    active.set(message.id, { controller, conversationId: message.conversationId });
    const started = Date.now();
    const prompt = pathTo(message.parentId).at(-1)?.content ?? "";
    const fails = prompt.toLowerCase().includes(failPhrase);
    const answer = fails ? "Let me look into that. " : RICH_ANSWER;
    void (async () => {
      let content = "";
      let outcome: "complete" | "stopped" | "error" = "complete";
      try {
        await sleep(firstTokenDelay, controller.signal);
        for (const piece of chunks(answer)) {
          content += piece;
          onEvent({ type: "delta", conversationId: message.conversationId, messageId: message.id, text: piece });
          await sleep(streamDelay, controller.signal);
        }
        if (fails) outcome = "error";
      } catch {
        outcome = "stopped";
      }
      active.delete(message.id);
      const model = findModel(message.modelKey ?? "");
      const tokensIn = outcome === "error" ? null : 412;
      const tokensOut = outcome === "error" ? null : Math.max(1, Math.round(content.length / 4));
      const finished: Message = {
        ...message,
        content,
        status: outcome,
        error:
          outcome === "error"
            ? err("rateLimited", "This model is rate limited right now. Retry in a moment or switch to another model.", 2000)
            : null,
        tokensIn,
        tokensOut,
        costUsd:
          tokensIn !== null && tokensOut !== null && model?.inputPrice != null && model.outputPrice != null
            ? (tokensIn * model.inputPrice + tokensOut * model.outputPrice) / 1_000_000
            : null,
        elapsedMs: Date.now() - started,
      };
      if (messages.has(message.id)) messages.set(message.id, finished);
      onEvent({ type: "finished", message: structuredClone(finished) });
      const conversation = conversations.get(message.conversationId);
      if (outcome === "complete" && conversation?.titleSource === "auto" && settings.autoTitle) {
        await sleep(150);
        const first = conversationMessages(conversation.id).find((m) => m.role === "user" && m.parentId === null);
        const title = generatedTitle(first?.content ?? conversation.title);
        const latest = conversations.get(conversation.id);
        if (latest && latest.titleSource === "auto") {
          save({ ...latest, title, titleSource: "generated" });
          onEvent({ type: "title", conversationId: conversation.id, title });
        }
      }
    })();
  }

  function compareColumns(keysWanted: string[], leaf: string | null): CompareColumn[] {
    if (keysWanted.length < 2 || keysWanted.length > 3) throw invalid("Compare shows two or three models.");
    return keysWanted.map((modelKey) => ({ modelKey, leafId: leaf }));
  }

  function seed() {
    const now = Date.now();
    SEED_CHATS.forEach((chat, index) => {
      const at = now - chat.ageDays * 86_400_000 - index * 60_000;
      const id = `seed-${index}`;
      const user = userMessage(id, null, chat.prompt, [], at);
      const reply: Message = {
        ...assistantMessage(id, user.id, chat.model, at + 1),
        content: chat.answer,
        status: "complete",
        tokensIn: 380,
        tokensOut: 260,
        elapsedMs: 2400,
      };
      messages.set(user.id, user);
      messages.set(reply.id, reply);
      conversations.set(id, {
        id,
        title: chat.title,
        titleSource: "generated",
        pinned: chat.pinned ?? false,
        temporary: false,
        currentLeafId: reply.id,
        compare: null,
        settings: { systemPrompt: null, temperature: null, maxTokens: null, reasoningEffort: null },
        createdAt: at,
        updatedAt: at,
      });
    });
  }
  if (config.seed !== false) seed();

  function download(name: string, content: string, type: string): string {
    if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return name;
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return name;
  }

  function markdown(c: Conversation): string {
    const lines = [`# ${c.title}`, ""];
    for (const m of pathTo(c.currentLeafId)) {
      lines.push(`### ${m.role === "user" ? "You" : (findModel(m.modelKey ?? "")?.name ?? "Assistant")}`, "", m.content, "");
    }
    return lines.join("\n");
  }

  const backend: MachiBackend = {
    kind: "mock",
    platformInfo: async () => ({
      os: /Mac/i.test(typeof navigator !== "undefined" ? navigator.platform : "") ? "macOs" : "windows",
      modifierLabel: /Mac/i.test(typeof navigator !== "undefined" ? navigator.platform : "") ? "⌘" : "Ctrl",
      arch: "x86_64",
    }),
    bootstrap: async () => ({
      settings: structuredClone(settings),
      providers: allStatuses(),
      hasRequiredKey: keys.mixroute,
      defaultModel: MOCK_DEFAULT_MODEL,
    }),
    listModels: async (refresh) => {
      if (loadDelay) await sleep(loadDelay);
      if (config.modelsError && refresh) {
        return { models: models(), fetchedAt: null, refreshError: err("network", "Machi couldn't reach the provider. Check your internet connection and retry.") };
      }
      return { models: models(), fetchedAt: keys.mixroute ? Date.now() : null, refreshError: null };
    },
    providerStatuses: async () => allStatuses(),
    testApiKey: async (_provider, key) => {
      await sleep(300);
      if (key !== null && key.trim().length < 8) {
        throw new MachiError(err("invalidKey", "The provider rejected your API key. Check it in Settings → Providers."));
      }
    },
    saveApiKey: async (provider, key) => {
      await backend.testApiKey(provider, key);
      keys[provider] = true;
      return { ...status(provider), source: "keychain" };
    },
    deleteApiKey: async (provider) => {
      keys[provider] = false;
      return status(provider);
    },
    saveSettings: async (next) => {
      settings = structuredClone(next);
      return structuredClone(settings);
    },
    listConversations: async () => {
      if (loadDelay) await sleep(loadDelay);
      return [...conversations.values()]
        .filter((c) => !c.temporary)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
        .map((c) => ({ id: c.id, title: c.title, pinned: c.pinned, createdAt: c.createdAt, updatedAt: c.updatedAt }));
    },
    getConversation: async (id): Promise<ConversationDetail> => {
      const conversation = getConversation(id);
      return structuredClone({ conversation, messages: conversationMessages(id) });
    },
    searchConversations: async (query): Promise<SearchHit[]> => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const hits: SearchHit[] = [];
      for (const c of conversations.values()) {
        if (c.temporary) continue;
        const hit = conversationMessages(c.id).find((m) => m.content.toLowerCase().includes(q));
        if (c.title.toLowerCase().includes(q) || hit) {
          const text = hit?.content ?? c.title;
          const at = text.toLowerCase().indexOf(q);
          const start = Math.max(0, at - 40);
          const snippet = `${start > 0 ? "…" : ""}${text.slice(start, at + q.length + 80).replace(/\s+/g, " ")}`;
          hits.push({ conversationId: c.id, title: c.title, snippet, updatedAt: c.updatedAt });
        }
      }
      return hits.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    sendMessage: async (request, onEvent): Promise<SendResult> => {
      const content = request.content.trimEnd();
      if (!content.trim() && request.attachments.length === 0) throw invalid("Type a message or attach a file first.");
      const now = Date.now();
      let conversation: Conversation;
      if (request.conversationId) {
        conversation = getConversation(request.conversationId);
      } else {
        const compare = request.compareModels ? compareColumns(request.compareModels, null) : null;
        conversation = {
          id: newId(),
          title: provisionalTitle(content, request.attachments),
          titleSource: "auto",
          pinned: false,
          temporary: request.temporary,
          currentLeafId: null,
          compare,
          settings: request.settings ?? { systemPrompt: null, temperature: null, maxTokens: null, reasoningEffort: null },
          createdAt: now,
          updatedAt: now,
        };
      }
      const targets: Array<[string, string | null]> = conversation.compare
        ? conversation.compare.map((c) => [c.modelKey, c.leafId])
        : [[request.modelKey, conversation.currentLeafId]];
      const hasImage = request.attachments.some((a) => a.kind === "image");
      for (const [key] of targets) checkImages(hasImage, key);
      conversations.set(conversation.id, conversation);

      const created: Message[] = [];
      const userFor = new Map<string | null, string>();
      const leaves: string[] = [];
      for (const [modelKey, parent] of targets) {
        let userId = userFor.get(parent);
        if (!userId) {
          const user = userMessage(conversation.id, parent, content, request.attachments, now);
          messages.set(user.id, user);
          userFor.set(parent, user.id);
          created.push(user);
          userId = user.id;
        }
        const reply = assistantMessage(conversation.id, userId, modelKey, now + 1);
        messages.set(reply.id, reply);
        leaves.push(reply.id);
        created.push(reply);
      }
      const compare = conversation.compare?.map((c, i) => ({ ...c, leafId: leaves[i] ?? c.leafId })) ?? null;
      const saved = save({ ...conversation, compare, currentLeafId: leaves[0] ?? null, updatedAt: now });
      noteRecent(targets.map(([k]) => k));
      for (const m of created.filter((m) => m.role === "assistant")) generate(m, onEvent);
      return { conversation: saved, messages: structuredClone(created) };
    },
    regenerateMessage: async (request, onEvent) => {
      const old = messages.get(request.messageId);
      if (!old) throw notFound("message");
      if (old.role !== "assistant" || !old.parentId) throw invalid("Only replies can be regenerated.");
      const modelKey = request.modelKey ?? old.modelKey ?? MOCK_DEFAULT_MODEL;
      const parent = messages.get(old.parentId);
      checkImages(Boolean(parent?.attachments.some((a) => a.kind === "image")), modelKey);
      const conversation = getConversation(old.conversationId);
      const reply = assistantMessage(conversation.id, old.parentId, modelKey, Date.now());
      messages.set(reply.id, reply);
      let moved = false;
      const compare =
        conversation.compare?.map((c) => {
          if (c.leafId !== old.id) return c;
          moved = true;
          return { modelKey, leafId: reply.id };
        }) ?? null;
      const currentLeafId = !moved || conversation.currentLeafId === old.id ? reply.id : conversation.currentLeafId;
      const saved = save({ ...conversation, compare, currentLeafId, updatedAt: Date.now() });
      noteRecent([modelKey]);
      generate(reply, onEvent);
      return { conversation: saved, messages: [structuredClone(reply)] };
    },
    editMessage: async (request, onEvent) => {
      const original = messages.get(request.messageId);
      if (!original) throw notFound("message");
      if (original.role !== "user") throw invalid("Only your own messages can be edited.");
      const conversation = getConversation(original.conversationId);
      if (conversation.compare) throw invalid("Leave compare mode to edit a message.");
      checkImages(original.attachments.some((a) => a.kind === "image"), request.modelKey);
      const now = Date.now();
      const user: Message = { ...structuredClone(original), id: newId(), content: request.content.trimEnd(), createdAt: now };
      user.attachments = user.attachments.map((a) => ({ ...a, id: newId() }));
      const reply = assistantMessage(conversation.id, user.id, request.modelKey, now + 1);
      messages.set(user.id, user);
      messages.set(reply.id, reply);
      const saved = save({ ...conversation, currentLeafId: reply.id, updatedAt: now });
      noteRecent([request.modelKey]);
      generate(reply, onEvent);
      return { conversation: saved, messages: structuredClone([user, reply]) };
    },
    stopGeneration: async (messageId) => {
      const run = active.get(messageId);
      run?.controller.abort();
      return Boolean(run);
    },
    stopConversation: async (conversationId) => {
      let count = 0;
      for (const run of active.values()) {
        if (run.conversationId === conversationId) {
          run.controller.abort();
          count++;
        }
      }
      return count;
    },
    selectBranch: async (conversationId, messageId) => {
      const conversation = getConversation(conversationId);
      if (!messages.has(messageId)) throw notFound("message");
      let leaf = messageId;
      for (;;) {
        const children = [...messages.values()].filter((m) => m.parentId === leaf).sort((a, b) => b.createdAt - a.createdAt);
        if (!children[0]) break;
        leaf = children[0].id;
      }
      return save({ ...conversation, currentLeafId: leaf });
    },
    deleteMessage: async (messageId) => {
      const message = messages.get(messageId);
      if (!message) throw notFound("message");
      const removed = new Set([messageId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const m of messages.values()) {
          if (m.parentId && removed.has(m.parentId) && !removed.has(m.id)) {
            removed.add(m.id);
            grew = true;
          }
        }
      }
      for (const id of removed) {
        active.get(id)?.controller.abort();
        messages.delete(id);
      }
      const conversation = getConversation(message.conversationId);
      const fix = (leaf: string | null) => (leaf && removed.has(leaf) ? message.parentId : leaf);
      return save({
        ...conversation,
        currentLeafId: fix(conversation.currentLeafId),
        compare: conversation.compare?.map((c) => ({ ...c, leafId: fix(c.leafId) })) ?? null,
        updatedAt: Date.now(),
      });
    },
    startCompare: async (conversationId, keysWanted) => {
      const conversation = getConversation(conversationId);
      return save({ ...conversation, compare: compareColumns(keysWanted, conversation.currentLeafId) });
    },
    setCompareModel: async (conversationId, column, modelKey) => {
      const conversation = getConversation(conversationId);
      if (!conversation.compare?.[column]) throw invalid("No such compare column.");
      const compare = conversation.compare.map((c, i) => (i === column ? { ...c, modelKey } : c));
      return save({ ...conversation, compare });
    },
    endCompare: async (conversationId, keepColumn) => {
      const conversation = getConversation(conversationId);
      const chosen = conversation.compare?.[keepColumn ?? 0];
      return save({ ...conversation, compare: null, currentLeafId: chosen?.leafId ?? conversation.currentLeafId });
    },
    renameConversation: async (id, title) => {
      if (!title.trim()) throw invalid("A chat title can't be empty.");
      return save({ ...getConversation(id), title: title.trim(), titleSource: "user" });
    },
    setConversationPinned: async (id, pinned) => save({ ...getConversation(id), pinned }),
    updateChatSettings: async (id, chatSettings: ChatSettings) => save({ ...getConversation(id), settings: chatSettings }),
    deleteConversation: async (id) => {
      getConversation(id);
      await backend.stopConversation(id);
      for (const m of conversationMessages(id)) messages.delete(m.id);
      conversations.delete(id);
    },
    exportConversation: async (id, format) => {
      const c = getConversation(id);
      return format === "markdown"
        ? download(`${c.title}.md`, markdown(c), "text/markdown")
        : download(`${c.title}.json`, JSON.stringify({ conversation: c, messages: conversationMessages(id) }, null, 2), "application/json");
    },
    exportAll: async (format) => {
      const all = [...conversations.values()].filter((c) => !c.temporary);
      return format === "markdown"
        ? download("Machi chats.md", all.map(markdown).join("\n---\n\n"), "text/markdown")
        : download("Machi chats.json", JSON.stringify(all.map((c) => ({ conversation: c, messages: conversationMessages(c.id) })), null, 2), "application/json");
    },
    deleteAllData: async () => {
      for (const run of active.values()) run.controller.abort();
      conversations.clear();
      messages.clear();
      (Object.keys(keys) as ProviderId[]).forEach((p) => (keys[p] = false));
      settings = { ...settings, recentModels: [], favorites: [], hiddenModels: [], flyoutPinned: false, baseUrls: {} };
    },
    openExternal: async (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
  };
  return backend;
}

