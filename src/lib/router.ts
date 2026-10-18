// Minimal hash router: the app has five screens, so a dependency isn't warranted.
// Routes: #/ (new chat), #/chat/:id, #/models, #/settings/:section, #/gallery (dev only).
import { useSyncExternalStore } from "react";

const SETTINGS_SECTIONS = ["providers", "models", "appearance", "data", "about"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export type Route =
  | { name: "home" }
  | { name: "chat"; id: string }
  | { name: "models" }
  | { name: "settings"; section: SettingsSection }
  | { name: "gallery" };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/^\/+/, "").split("?")[0] ?? "";
  const [head, arg] = path.split("/");
  switch (head) {
    case "chat":
      return arg ? { name: "chat", id: decodeURIComponent(arg) } : { name: "home" };
    case "models":
      return { name: "models" };
    case "settings": {
      const section = SETTINGS_SECTIONS.find((s) => s === arg) ?? "providers";
      return { name: "settings", section };
    }
    case "gallery":
      return import.meta.env.DEV ? { name: "gallery" } : { name: "home" };
    default:
      return { name: "home" };
  }
}

export function formatRoute(route: Route): string {
  switch (route.name) {
    case "home":
      return "#/";
    case "chat":
      return `#/chat/${encodeURIComponent(route.id)}`;
    case "models":
      return "#/models";
    case "settings":
      return `#/settings/${route.section}`;
    case "gallery":
      return "#/gallery";
  }
}

export function navigate(route: Route, options?: { replace?: boolean }) {
  const next = formatRoute(route);
  if (window.location.hash === next) return;
  if (options?.replace) {
    window.history.replaceState(null, "", next);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = next;
  }
}

function subscribe(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

let cachedHash = "";
let cachedRoute: Route = { name: "home" };

function snapshot(): Route {
  const hash = window.location.hash;
  if (hash !== cachedHash) {
    cachedHash = hash;
    cachedRoute = parseRoute(hash);
  }
  return cachedRoute;
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
