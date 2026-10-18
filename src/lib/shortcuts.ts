// Keyboard shortcuts (§11.10, §15.3). One table drives both the handler and the shortcuts list.
type ShortcutId = "picker" | "newChat" | "newChatAlt" | "search" | "toggleChats" | "shortcuts" | "settings" | "escape";

interface Shortcut {
  id: ShortcutId;
  /** Requires Ctrl (Windows) / Cmd (macOS). */
  mod: boolean;
  shift?: boolean;
  key: string;
  label: string;
}

export const SHORTCUTS: Shortcut[] = [
  { id: "picker", mod: true, key: "k", label: "Choose a model" },
  { id: "newChat", mod: true, key: "n", label: "New chat" },
  { id: "newChatAlt", mod: true, shift: true, key: "o", label: "New chat" },
  { id: "search", mod: true, shift: true, key: "f", label: "Search chats" },
  { id: "toggleChats", mod: true, shift: true, key: "s", label: "Show or hide chats" },
  { id: "shortcuts", mod: true, key: "/", label: "Keyboard shortcuts" },
  { id: "settings", mod: true, key: ",", label: "Settings" },
  { id: "escape", mod: false, key: "Escape", label: "Stop generating or close" },
];

/** The shortcut a keyboard event triggers, if any. */
export function matchShortcut(e: KeyboardEvent, isMac: boolean): ShortcutId | null {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  for (const s of SHORTCUTS) {
    if (s.mod !== mod || Boolean(s.shift) !== e.shiftKey || e.altKey) continue;
    if (s.key === key) return s.id;
  }
  return null;
}

/** Key caps for display, e.g. ["⌘", "Shift", "F"]. */
export function shortcutKeys(s: Shortcut, modifierLabel: string): string[] {
  const keys: string[] = [];
  if (s.mod) keys.push(modifierLabel);
  if (s.shift) keys.push("Shift");
  keys.push(s.key === "Escape" ? "Esc" : s.key.toUpperCase());
  return keys;
}
