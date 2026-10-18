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
  it("labels prices per §15.8: Free only when both prices are zero, otherwise Price unknown", () => {
    const tok = (inputPrice: number | null, outputPrice: number | null, free = false) => ({
      free,
      inputPrice,
      outputPrice,
      pricing: "perToken" as const,
      perCallPrice: null,
    });
    expect(priceLabel(tok(0.1, 0.2))).toBe("In $0.10 · Out $0.20 per 1M");
    expect(priceLabel(tok(null, 0.2))).toBe("Price unknown");
    expect(priceLabel(tok(null, null))).toBe("Price unknown");
    expect(priceLabel(tok(0, 0, true))).toBe("Free");
    expect(priceLabel(tok(0, null))).toBe("Price unknown");
    expect(priceLabel(tok(10, 50))).toBe("In $10 · Out $50 per 1M");
    expect(priceLabel(tok(0.05, 0.4))).toBe("In $0.05 · Out $0.40 per 1M");
    expect(priceHint(tok(1.25, 10))).toBe("$1.25 / $10");
    expect(priceHint(tok(null, null))).toBe("Price unknown");
    expect(priceHint(tok(0, 0, true))).toBe("Free");
    const call = { free: false, inputPrice: null, outputPrice: null, pricing: "perCall" as const, perCallPrice: 0.3 };
    expect(priceLabel(call)).toBe("Per call $0.30");
    expect(priceHint(call)).toBe("$0.30 per call");
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
