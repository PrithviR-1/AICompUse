// Store tests against the mock backend: sending, streaming, stop, branching, compare,
// errors and titles flow through the same code the app uses.
import { beforeEach, describe, expect, it } from "vitest";
import { createMockBackend } from "@/lib/mock/mockBackend";
import { setBackend } from "@/lib/machiClient";
import { indexMessages, visiblePath } from "@/lib/tree";
import { useApp } from "./app";
import { useChats } from "./chats";
import { useConversation } from "./conversation";

const NANO = "mixroute:gpt-4.1-nano";
const GEMINI = "mixroute:gemini-2.5-flash";

async function until(check: () => boolean, timeoutMs = 4000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

const idle = () => Object.keys(useConversation.getState().streaming).length === 0;
const visible = () => {
  const s = useConversation.getState();
  return visiblePath(indexMessages(Object.values(s.messages)), s.conversation?.currentLeafId ?? null);
};

beforeEach(async () => {
  window.location.hash = "#/";
  setBackend(createMockBackend({ seed: false, streamDelayMs: 0, firstTokenDelayMs: 5 }));
  useConversation.getState().clear();
  useChats.setState({ list: [], status: "idle" });
  await useApp.getState().init();
});

describe("conversation store", () => {
  it("sends, streams and finishes a reply, then names the chat", async () => {
    const ok = await useConversation.getState().send({ content: "Explain debouncing", attachments: [], modelKey: NANO });
    expect(ok).toBe(true);
    const state = useConversation.getState();
    expect(state.conversation?.title).toBe("Explain debouncing");
    expect(window.location.hash).toBe(`#/chat/${state.conversation?.id}`);
    await until(idle);
    const path = visible();
    expect(path.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(path[1].status).toBe("complete");
    expect(path[1].content).toContain("debounce");
    await until(() => useChats.getState().list[0]?.title === "Explain debouncing");
    expect(useApp.getState().settings.recentModels[0]).toBe(NANO);
  });

  it("stops a streaming reply and keeps the partial text", async () => {
    setBackend(createMockBackend({ seed: false, streamDelayMs: 20, firstTokenDelayMs: 0 }));
    await useConversation.getState().send({ content: "Long answer please", attachments: [], modelKey: NANO });
    await until(() => (visible()[1]?.content.length ?? 0) > 0);
    await useConversation.getState().stop();
    await until(idle);
    const reply = visible()[1];
    expect(reply.status).toBe("stopped");
    expect(reply.content.length).toBeGreaterThan(0);
  });

  it("regenerates with another model as a sibling branch", async () => {
    await useConversation.getState().send({ content: "Hi", attachments: [], modelKey: NANO });
    await until(idle);
    const first = visible()[1];
    await useConversation.getState().regenerate(first.id, GEMINI);
    await until(idle);
    const second = visible()[1];
    expect(second.id).not.toBe(first.id);
    expect(second.modelKey).toBe(GEMINI);
    await useConversation.getState().selectBranch(first.id);
    expect(visible()[1].id).toBe(first.id);
  });

  it("edits a message into a new branch", async () => {
    await useConversation.getState().send({ content: "Tell me a joke", attachments: [], modelKey: NANO });
    await until(idle);
    const original = visible()[0];
    await useConversation.getState().edit(original.id, "Tell me a pun", NANO);
    await until(idle);
    expect(visible()[0].content).toBe("Tell me a pun");
    expect(Object.values(useConversation.getState().messages)).toHaveLength(4);
  });

  it("keeps context when switching models mid-chat", async () => {
    await useConversation.getState().send({ content: "First", attachments: [], modelKey: NANO });
    await until(idle);
    await useConversation.getState().send({ content: "Second", attachments: [], modelKey: GEMINI });
    await until(idle);
    const path = visible();
    expect(path.map((m) => m.content.slice(0, 6))).toEqual(["First", path[1].content.slice(0, 6), "Second", path[3].content.slice(0, 6)]);
    expect(path[3].modelKey).toBe(GEMINI);
  });

  it("runs compare mode and continues with one column", async () => {
    await useConversation.getState().send({ content: "Compare these", attachments: [], modelKey: NANO, compareModels: [NANO, GEMINI] });
    await until(idle);
    const columns = useConversation.getState().conversation?.compare;
    expect(columns).toHaveLength(2);
    expect(columns?.every((c) => c.leafId)).toBe(true);
    await useConversation.getState().endCompare(1);
    const c = useConversation.getState().conversation;
    expect(c?.compare).toBeNull();
    expect(c?.currentLeafId).toBe(columns?.[1].leafId);
  });

  it("shows provider errors inline on the reply", async () => {
    await useConversation.getState().send({ content: "trigger a rate limit", attachments: [], modelKey: NANO });
    await until(idle);
    const reply = visible()[1];
    expect(reply.status).toBe("error");
    expect(reply.error?.kind).toBe("rateLimited");
  });

  it("blocks images for models without vision before sending", async () => {
    const ok = await useConversation.getState().send({
      content: "What is this?",
      attachments: [{ kind: "image", name: "a.png", mime: "image/png", size: 3, data: "data:image/png;base64,AAA" }],
      modelKey: NANO,
    });
    expect(ok).toBe(false);
    expect(useConversation.getState().actionError?.message).toContain("can't read images");
  });

  it("deletes a reply and moves the branch to its parent", async () => {
    await useConversation.getState().send({ content: "Hi", attachments: [], modelKey: NANO });
    await until(idle);
    const [user, reply] = visible();
    await useConversation.getState().deleteMessage(reply.id);
    expect(useConversation.getState().conversation?.currentLeafId).toBe(user.id);
  });
});

describe("app store", () => {
  it("rolls back settings when saving fails", async () => {
    setBackend({ ...createMockBackend({ seed: false }), saveSettings: () => Promise.reject(new Error("disk full")) });
    const before = useApp.getState().settings.theme;
    const ok = await useApp.getState().updateSettings({ theme: before === "dark" ? "light" : "dark" });
    expect(ok).toBe(false);
    expect(useApp.getState().settings.theme).toBe(before);
  });

  it("reports a missing key on first run and accepts a valid one", async () => {
    setBackend(createMockBackend({ seed: false, noKey: true }));
    await useApp.getState().init();
    expect(useApp.getState().hasRequiredKey).toBe(false);
    expect((await useApp.getState().saveKey("mixroute", "short"))?.kind).toBe("invalidKey");
    expect(await useApp.getState().saveKey("mixroute", "sk-valid-key-123")).toBeNull();
    expect(useApp.getState().hasRequiredKey).toBe(true);
  });
});
