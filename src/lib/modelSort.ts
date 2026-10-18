// Model ordering and filtering shared by the picker, the home tiles and the Models page.
// The default order mirrors the Rust catalog: frontier by output price, then the rest by
// output price (ties: input price, then name), then unknown prices, then free models.
import type { ModelInfo, ModelKind } from "./bindings";

export type ModelSort = "priceDesc" | "priceAsc" | "name" | "provider";

export const SORT_LABELS: Record<ModelSort, string> = {
  priceDesc: "Price: high to low",
  priceAsc: "Price: low to high",
  name: "Name: A to Z",
  provider: "Provider",
};

export const KIND_LABELS: Record<ModelKind, string> = {
  chat: "Chat",
  image: "Image",
  video: "Video",
  audio: "Audio",
  embedding: "Embedding",
  rerank: "Rerank",
  transcription: "Transcription",
  other: "Other",
};

const byName = (a: ModelInfo, b: ModelInfo) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);

function desc(a: number | null, b: number | null): number {
  if (a != null && b != null) return b - a;
  if (a != null) return -1;
  if (b != null) return 1;
  return 0;
}

function group(m: ModelInfo): number {
  if (m.free) return 3;
  if (m.frontier) return 0;
  return m.outputPrice != null ? 1 : 2;
}

export function compareDefault(a: ModelInfo, b: ModelInfo): number {
  return group(a) - group(b) || desc(a.outputPrice, b.outputPrice) || desc(a.inputPrice, b.inputPrice) || byName(a, b);
}

/** Cheapest first: free, then priced ascending, unknown prices last. */
function compareAsc(a: ModelInfo, b: ModelInfo): number {
  const g = (m: ModelInfo) => (m.free ? 0 : m.outputPrice != null ? 1 : 2);
  const asc = (x: number | null, y: number | null) => (x != null && y != null ? x - y : 0);
  return g(a) - g(b) || asc(a.outputPrice, b.outputPrice) || asc(a.inputPrice, b.inputPrice) || byName(a, b);
}

export function sortModels(models: ModelInfo[], sort: ModelSort = "priceDesc"): ModelInfo[] {
  const list = [...models];
  switch (sort) {
    case "priceDesc":
      return list.sort(compareDefault);
    case "priceAsc":
      return list.sort(compareAsc);
    case "name":
      return list.sort(byName);
    case "provider":
      return list.sort((a, b) => a.vendor.localeCompare(b.vendor, undefined, { sensitivity: "base" }) || compareDefault(a, b));
  }
}

export type Capability = "vision" | "reasoning" | "tools" | "structuredOutput";
export type Modality = "image" | "audio" | "video" | "file";

export interface ModelFilters {
  query: string;
  provider: string | null;
  kind: ModelKind | null;
  capability: Capability | null;
  modality: Modality | null;
  freeOnly: boolean;
  favoritesOnly: boolean;
}

export const NO_FILTERS: ModelFilters = {
  query: "",
  provider: null,
  kind: null,
  capability: null,
  modality: null,
  freeOnly: false,
  favoritesOnly: false,
};

export function filterModels(models: ModelInfo[], f: ModelFilters, favorites: string[]): ModelInfo[] {
  const q = f.query.trim().toLowerCase();
  return models.filter(
    (m) =>
      (!q || `${m.name} ${m.id} ${m.vendor}`.toLowerCase().includes(q)) &&
      (!f.provider || m.vendor === f.provider) &&
      (!f.kind || m.kind === f.kind) &&
      (!f.capability || m.caps[f.capability]) &&
      (!f.modality || m.inputModalities.includes(f.modality) || m.outputModalities.includes(f.modality)) &&
      (!f.freeOnly || m.free) &&
      (!f.favoritesOnly || favorites.includes(m.key)),
  );
}

/** Models a chat can use, in default order with favorites first (home tiles, compare). */
export function chatModels(models: ModelInfo[], favorites: string[] = []): ModelInfo[] {
  const usable = sortModels(models.filter((m) => m.chatSupported));
  const fav = favorites.map((k) => usable.find((m) => m.key === k)).filter((m): m is ModelInfo => Boolean(m));
  return [...fav, ...usable.filter((m) => !favorites.includes(m.key))];
}
