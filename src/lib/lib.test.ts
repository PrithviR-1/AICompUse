// Unit tests for the pure UI helpers: routing, formatting, tree walks, avatars, shortcuts.
import { describe, expect, it } from "vitest";
import type { Message } from "./bindings";
import { avatarColorIndex, monogram } from "./avatar";
import { contextLabel, costLabel, dateGroup, durationLabel, priceHint, priceLabel } from "./format";
import { resolveLanguage } from "./highlight";
import { formatRoute, parseRoute } from "./router";
import { matchShortcut, shortcutKeys, SHORTCUTS } from "./shortcuts";
import { indexMessages, lastModelOnPath, siblingInfo, visiblePath } from "./tree";

function msg(id: string, parentId: string | null, role: "user" | "assistant", createdAt: number, modelKey: string | null = null): Message {
  return {
    id,
    conversationId: "c",
    parentId,
    role,
    content: id,
    modelKey,
    status: "complete",
    error: null,
    tokensIn: null,
    tokensOut: null,
    costUsd: null,
    elapsedMs: null,
    createdAt,
    attachments: [],
  };
}

describe("router", () => {
  it("round-trips every route", () => {
    for (const hash of ["#/", "#/chat/abc%20d", "#/models", "#/settings/data"]) {
      expect(formatRoute(parseRoute(hash))).toBe(hash);
    }
  });

  it("falls back safely", () => {
    expect(parseRoute("#/settings/nope")).toEqual({ name: "settings", section: "providers" });
    expect(parseRoute("#/chat/")).toEqual({ name: "home" });
    expect(parseRoute("")).toEqual({ name: "home" });
  });
});

describe("format", () => {
  it("labels prices per §15.8", () => {
    expect(priceLabel({ free: false, inputPrice: 0.1, outputPrice: 0.2 })).toBe("In $0.10 · Out $0.20 per 1M");
    expect(priceLabel({ free: false, inputPrice: null, outputPrice: 0.2 })).toBe("Price unknown");
    expect(priceLabel({ free: true, inputPrice: 0, outputPrice: 0 })).toBe("Free");
    expect(priceLabel({ free: false, inputPrice: 0.05, outputPrice: 0.4 })).toBe("In $0.05 · Out $0.40 per 1M");
    expect(priceHint({ free: false, inputPrice: null, outputPrice: null })).toBe("n/a");
  });

  it("labels context, cost and duration", () => {
    expect(contextLabel(1047576)).toBe("1M");
    expect(contextLabel(1_000_000)).toBe("1M");
    expect(contextLabel(400000)).toBe("400K");
    expect(contextLabel(null)).toBeNull();
    expect(costLabel(0.00004)).toBe("<$0.0001");
    expect(costLabel(0.0042)).toBe("$0.0042");
    expect(costLabel(null)).toBeNull();
    expect(durationLabel(850)).toBe("850ms");
    expect(durationLabel(2400)).toBe("2.4s");
    expect(durationLabel(65_000)).toBe("1m 05s");
  });

  it("groups chats by local day", () => {
    const now = new Date(2026, 9, 18, 15).getTime();
    const day = 86_400_000;
    expect(dateGroup(now - 1000, false, now)).toBe("Today");
    expect(dateGroup(now - day, false, now)).toBe("Yesterday");
    expect(dateGroup(now - 3 * day, false, now)).toBe("Previous 7 days");
    expect(dateGroup(now - 20 * day, false, now)).toBe("Previous 30 days");
    expect(dateGroup(now - 90 * day, false, now)).toBe("Older");
    expect(dateGroup(now - 90 * day, true, now)).toBe("Pinned");
  });
});

describe("tree", () => {
  const messages = [
    msg("u1", null, "user", 1),
    msg("a1", "u1", "assistant", 2, "mixroute:a"),
    msg("a2", "u1", "assistant", 3, "mixroute:b"),
    msg("u2", "a2", "user", 4),
  ];

  it("walks the visible branch", () => {
    const path = visiblePath(indexMessages(messages), "u2");
    expect(path.map((m) => m.id)).toEqual(["u1", "a2", "u2"]);
    expect(lastModelOnPath(path)).toBe("mixroute:b");
    expect(visiblePath(indexMessages(messages), null)).toEqual([]);
  });

  it("finds siblings in creation order", () => {
    const info = siblingInfo(messages, messages[2]);
    expect(info.siblings.map((m) => m.id)).toEqual(["a1", "a2"]);
    expect(info.index).toBe(1);
  });
});

describe("avatars", () => {
  it("uses one stable color per vendor", () => {
    expect(avatarColorIndex("OpenAI")).toBe(avatarColorIndex("openai "));
    const index = avatarColorIndex("Google");
    expect(index).toBeGreaterThanOrEqual(1);
    expect(index).toBeLessThanOrEqual(12);
  });

  it("takes the first letter or digit", () => {
    expect(monogram("gpt-4.1")).toBe("G");
    expect(monogram("  (Kimi)")).toBe("K");
    expect(monogram("")).toBe("?");
  });
});

describe("shortcuts", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("uses Cmd on macOS and Ctrl elsewhere", () => {
    expect(matchShortcut(key({ key: "k", metaKey: true }), true)).toBe("picker");
    expect(matchShortcut(key({ key: "k", ctrlKey: true }), true)).toBeNull();
    expect(matchShortcut(key({ key: "k", ctrlKey: true }), false)).toBe("picker");
    expect(matchShortcut(key({ key: "F", ctrlKey: true, shiftKey: true }), false)).toBe("search");
    expect(matchShortcut(key({ key: "Escape" }), false)).toBe("escape");
  });

  it("renders key caps", () => {
    const search = SHORTCUTS.find((s) => s.id === "search");
    expect(search && shortcutKeys(search, "⌘")).toEqual(["⌘", "Shift", "F"]);
  });
});

describe("highlight", () => {
  it("resolves aliases and rejects unknown languages", () => {
    expect(resolveLanguage("ts")).toBe("typescript");
    expect(resolveLanguage("SH")).toBe("bash");
    expect(resolveLanguage("brainfuck")).toBeNull();
    expect(resolveLanguage(undefined)).toBeNull();
  });
});
