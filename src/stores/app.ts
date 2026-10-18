// App-wide state: bootstrap facts, persisted settings, provider key status and data actions.
import { create } from "zustand";
import type { AppSettings, ErrorInfo, ExportFormat, PlatformInfo, ProviderId, ProviderStatus } from "@/lib/bindings";
import { toErrorInfo } from "@/lib/errors";
import { machi } from "@/lib/machiClient";
import { toast } from "./toasts";

const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  fontSize: "default",
  defaultModel: "mixroute:gpt-4.1-nano",
  recentModels: [],
  favorites: [],
  hiddenModels: [],
  flyoutPinned: false,
  baseUrls: {},
  autoTitle: true,
};

interface AppState {
  status: "loading" | "ready" | "error";
  error: ErrorInfo | null;
  settings: AppSettings;
  providers: ProviderStatus[];
  hasRequiredKey: boolean;
  defaultModel: string;
  platform: PlatformInfo;
  init: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<boolean>;
  noteRecentModels: (keys: string[]) => void;
  refreshProviders: () => Promise<void>;
  testKey: (provider: ProviderId, key: string | null) => Promise<ErrorInfo | null>;
  saveKey: (provider: ProviderId, key: string) => Promise<ErrorInfo | null>;
  deleteKey: (provider: ProviderId) => Promise<void>;
  exportAll: (format: ExportFormat) => Promise<void>;
  deleteAllData: () => Promise<boolean>;
  openLink: (url: string) => void;
}

export const useApp = create<AppState>((set, get) => ({
  status: "loading",
  error: null,
  settings: DEFAULT_SETTINGS,
  providers: [],
  hasRequiredKey: true,
  defaultModel: DEFAULT_SETTINGS.defaultModel,
  platform: { os: "other", modifierLabel: "Ctrl", arch: "" },

  init: async () => {
    set({ status: "loading", error: null });
    try {
      const [boot, platform] = await Promise.all([machi().bootstrap(), machi().platformInfo()]);
      set({
        status: "ready",
        settings: boot.settings,
        providers: boot.providers,
        hasRequiredKey: boot.hasRequiredKey,
        defaultModel: boot.defaultModel,
        platform,
      });
    } catch (e) {
      set({ status: "error", error: toErrorInfo(e) });
    }
  },

  updateSettings: async (patch) => {
    const previous = get().settings;
    const next = { ...previous, ...patch };
    set({ settings: next });
    try {
      const saved = await machi().saveSettings(next);
      set({ settings: saved });
      return true;
    } catch (e) {
      set({ settings: previous });
      toast(toErrorInfo(e).message, { tone: "danger" });
      return false;
    }
  },

  noteRecentModels: (keys) => {
    let recent = get().settings.recentModels;
    for (const key of [...keys].reverse()) recent = [key, ...recent.filter((k) => k !== key)].slice(0, 8);
    set({ settings: { ...get().settings, recentModels: recent } });
  },

  refreshProviders: async () => {
    const providers = await machi().providerStatuses();
    set({ providers, hasRequiredKey: providers.some((p) => p.required && p.configured) });
  },

  testKey: async (provider, key) => {
    try {
      await machi().testApiKey(provider, key);
      return null;
    } catch (e) {
      return toErrorInfo(e);
    }
  },

  saveKey: async (provider, key) => {
    try {
      await machi().saveApiKey(provider, key);
      await get().refreshProviders();
      return null;
    } catch (e) {
      return toErrorInfo(e);
    }
  },

  deleteKey: async (provider) => {
    try {
      await machi().deleteApiKey(provider);
      await get().refreshProviders();
      toast("Key removed");
    } catch (e) {
      toast(toErrorInfo(e).message, { tone: "danger" });
    }
  },

  exportAll: async (format) => {
    try {
      const path = await machi().exportAll(format);
      toast(`Exported to ${shortPath(path)}`, { tone: "success" });
    } catch (e) {
      toast(toErrorInfo(e).message, { tone: "danger" });
    }
  },

  openLink: (url) => {
    machi()
      .openExternal(url)
      .catch(() => toast("Couldn't open the link.", { tone: "danger" }));
  },

  deleteAllData: async () => {
    try {
      await machi().deleteAllData();
      await get().init();
      return true;
    } catch (e) {
      toast(toErrorInfo(e).message, { tone: "danger" });
      return false;
    }
  },
}));

/** "~/Downloads/x.md" style display of an export path. */
export function shortPath(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts.length > 2 ? parts.slice(-2).join("/") : path;
}
