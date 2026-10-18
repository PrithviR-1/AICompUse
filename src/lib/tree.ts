// Message-tree helpers for the UI: the visible branch and sibling navigation (‹ 2/3 ›).
import type { Message } from "./bindings";

export function indexMessages(messages: Message[]): Map<string, Message> {
  return new Map(messages.map((m) => [m.id, m]));
}

/** Root-to-leaf path of the branch ending at `leafId`. */
export function visiblePath(byId: Map<string, Message>, leafId: string | null): Message[] {
  const path: Message[] = [];
  const seen = new Set<string>();
  let cursor = leafId ? byId.get(leafId) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    path.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return path.reverse();
}

/** Siblings of a message (same parent), oldest first, with its position. */
export function siblingInfo(messages: Message[], message: Message): { siblings: Message[]; index: number } {
  const siblings = messages
    .filter((m) => m.parentId === message.parentId && m.role === message.role)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return { siblings, index: siblings.findIndex((m) => m.id === message.id) };
}

/** Model of the last assistant reply on a branch, if any. */
export function lastModelOnPath(path: Message[]): string | null {
  for (let i = path.length - 1; i >= 0; i--) {
    const key = path[i].modelKey;
    if (path[i].role === "assistant" && key) return key;
  }
  return null;
}
