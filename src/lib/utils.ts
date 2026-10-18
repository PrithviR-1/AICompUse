// Class-name helper used by every presentational component (shadcn/ui convention).
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge needs to know the custom token-based font-size and radius names,
 * otherwise it treats `text-body` and `text-muted` as conflicting classes.
 */
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["caption", "meta", "label", "body", "title", "heading", "page", "display"] }],
      rounded: [{ rounded: ["control", "menu", "dialog", "card", "tile", "avatar", "full"] }],
      shadow: [{ shadow: ["popover"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
