// Model ordering and filtering (§ model list): frontier first by output price, then the rest
// by output price, unknown prices after, free last; plus the other sort modes and filters.
import { describe, expect, it } from "vitest";
import { MOCK_MODELS } from "./mock/fixtures";
import { NO_FILTERS, chatModels, compareDefault, filterModels, sortModels } from "./modelSort";

const ids = (list: { id: string }[]) => list.map((m) => m.id);

describe("default order (price high to low)", () => {
  const sorted = sortModels(MOCK_MODELS);

  it("puts frontier models first, by output price", () => {
    const frontierCount = sorted.findIndex((m) => !m.frontier);
    expect(frontierCount).toBeGreaterThan(0);
    expect(sorted.slice(0, frontierCount).every((m) => m.frontier)).toBe(true);
    const prices = sorted.slice(0, frontierCount).map((m) => m.outputPrice ?? -1);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
    expect(ids(sorted.slice(0, 2)).sort()).toEqual(["claude-fable-5-1", "gpt-6-astra"]);
  });

  it("then priced models by output price, then unknown prices, then free models", () => {
    const rest = sorted.filter((m) => !m.frontier);
    const priced = rest.filter((m) => !m.free && m.outputPrice != null);
    const unknown = rest.filter((m) => !m.free && m.outputPrice == null);
    const free = rest.filter((m) => m.free);
    expect(rest).toEqual([...priced, ...unknown, ...free]);
    const out = priced.map((m) => m.outputPrice ?? 0);
    expect(out).toEqual([...out].sort((a, b) => b - a));
    expect(ids(unknown)).toEqual(expect.arrayContaining(["brand-new-model-x", "sora-2"]));
    expect(ids(free)).toEqual(["glm-4-flash"]);
  });

  it("matches the order the Rust catalog produced", () => {
    expect(ids(sorted)).toEqual(ids(MOCK_MODELS));
    expect([...MOCK_MODELS].sort(compareDefault)).toEqual(sorted);
  });
});

describe("other sort modes and filters", () => {
  it("price low to high starts with free models and ends with unknown prices", () => {
    const asc = sortModels(MOCK_MODELS, "priceAsc");
    expect(asc[0].id).toBe("glm-4-flash");
    expect(asc.at(-1)?.outputPrice).toBeNull();
  });

  it("sorts by name and by provider", () => {
    const byName = sortModels(MOCK_MODELS, "name").map((m) => m.name.toLowerCase());
    expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b)));
    const vendors = sortModels(MOCK_MODELS, "provider").map((m) => m.vendor.toLowerCase());
    expect(vendors).toEqual([...vendors].sort((a, b) => a.localeCompare(b)));
  });

  it("filters by provider, type, capability, modality and Free", () => {
    expect(filterModels(MOCK_MODELS, { ...NO_FILTERS, provider: "Anthropic" }, []).every((m) => m.vendor === "Anthropic")).toBe(true);
    expect(ids(filterModels(MOCK_MODELS, { ...NO_FILTERS, kind: "video" }, []))).toEqual(["sora-2"]);
    expect(filterModels(MOCK_MODELS, { ...NO_FILTERS, capability: "vision" }, []).every((m) => m.caps.vision)).toBe(true);
    expect(filterModels(MOCK_MODELS, { ...NO_FILTERS, modality: "audio" }, []).length).toBeGreaterThan(0);
    expect(ids(filterModels(MOCK_MODELS, { ...NO_FILTERS, freeOnly: true }, []))).toEqual(["glm-4-flash"]);
  });

  it("chat models exclude non-chat types and keep favorites first", () => {
    const list = chatModels(MOCK_MODELS, ["mixroute:gpt-4.1-nano"]);
    expect(list[0].id).toBe("gpt-4.1-nano");
    expect(list.every((m) => m.chatSupported)).toBe(true);
    expect(ids(list)).not.toContain("sora-2");
  });
});
