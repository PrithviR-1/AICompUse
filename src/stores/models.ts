// Model catalog state (§11.4): live list merged with seeds by the backend, cached 24 h there.
import { create } from "zustand";
import type { ErrorInfo, ModelInfo } from "@/lib/bindings";
import { toErrorInfo } from "@/lib/errors";
import { machi } from "@/lib/machiClient";

interface ModelsState {
  status: "idle" | "loading" | "ready" | "error";
  models: ModelInfo[];
  fetchedAt: number | null;
  refreshError: ErrorInfo | null;
  error: ErrorInfo | null;
  load: (refresh?: boolean) => Promise<void>;
}

export const useModels = create<ModelsState>((set, get) => ({
  status: "idle",
  models: [],
  fetchedAt: null,
  refreshError: null,
  error: null,
  load: async (refresh = false) => {
    if (get().status === "loading") return;
    set({ status: get().models.length ? "ready" : "loading", error: null });
    try {
      const list = await machi().listModels(refresh);
      set({ status: "ready", models: list.models, fetchedAt: list.fetchedAt, refreshError: list.refreshError });
    } catch (e) {
      set({ status: get().models.length ? "ready" : "error", error: toErrorInfo(e) });
    }
  },
}));

export function findModel(models: ModelInfo[], key: string | null | undefined): ModelInfo | undefined {
  return key ? models.find((m) => m.key === key) : undefined;
}

/** Display fallback for a key the catalog doesn't know (e.g. a model that went away). */
export function modelLabel(models: ModelInfo[], key: string | null | undefined): { name: string; vendor: string } {
  const m = findModel(models, key);
  if (m) return { name: m.name, vendor: m.vendor };
  const id = key?.split(":").slice(1).join(":") || "Unknown model";
  return { name: id, vendor: key?.split(":")[0] ?? "" };
}
