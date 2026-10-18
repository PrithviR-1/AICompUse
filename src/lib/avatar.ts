// Monogram avatars (§15.9): letters from the model name, color from a hash of the vendor so
// every model of one vendor shares a color. No logos are bundled or fetched.

/** Number of avatar colors defined in tokens.css (--avatar-1 … --avatar-12). */
export const AVATAR_COLORS = 12;

/** FNV-1a over UTF-16 code units: stable across sessions and platforms. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 1-based palette index for a vendor name. */
export function avatarColorIndex(vendor: string): number {
  return (hash(vendor.trim().toLowerCase()) % AVATAR_COLORS) + 1;
}

/** First letter of the model's name, skipping punctuation. */
export function monogram(name: string): string {
  const letter = [...name.trim()].find((c) => /[\p{L}\p{N}]/u.test(c));
  return (letter ?? "?").toUpperCase();
}
