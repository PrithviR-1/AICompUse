// Display formatting: prices, context windows, token counts, costs, durations, chat dates.
import type { ModelInfo } from "./bindings";

const usd = (n: number) => {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(3)}`;
  if (n >= 100) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2).replace(/\.00$/, "")}`;
};

type Priced = Pick<ModelInfo, "free" | "inputPrice" | "outputPrice" | "pricing" | "perCallPrice">;

/** "In $0.10 · Out $0.20 per 1M", "Per call $0.30", "Free" or "Price unknown" (§15.8). */
export function priceLabel(model: Priced): string {
  if (model.free) return "Free";
  if (model.pricing === "perCall") return model.perCallPrice != null ? `Per call ${usd(model.perCallPrice)}` : "Price unknown";
  if (model.inputPrice == null || model.outputPrice == null) return "Price unknown";
  return `In ${usd(model.inputPrice)} · Out ${usd(model.outputPrice)} per 1M`;
}

/** Compact price for picker rows and chips: "$1.25 / $10", "$0.30 per call", "Free" or "Price unknown". */
export function priceHint(model: Priced): string {
  if (model.free) return "Free";
  if (model.pricing === "perCall") return model.perCallPrice != null ? `${usd(model.perCallPrice)} per call` : "Price unknown";
  if (model.inputPrice == null || model.outputPrice == null) return "Price unknown";
  return `${usd(model.inputPrice)} / ${usd(model.outputPrice)}`;
}

/** "1M", "400K", "128K". */
export function contextLabel(tokens: number | null): string | null {
  if (tokens == null) return null;
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

export function tokensLabel(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function costLabel(cost: number | null): string | null {
  if (cost == null) return null;
  if (cost === 0) return "$0";
  if (cost < 0.0001) return "<$0.0001";
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(3)}`;
}

/** "2.4s", "850ms", "1m 05s". */
export function durationLabel(ms: number | null): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

type DateGroup = "Pinned" | "Today" | "Yesterday" | "Previous 7 days" | "Previous 30 days" | "Older";
export const DATE_GROUPS: DateGroup[] = ["Pinned", "Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];

/** History grouping (§11.3/§15.4) by local calendar day. */
export function dateGroup(updatedAt: number, pinned: boolean, now: number = Date.now()): DateGroup {
  if (pinned) return "Pinned";
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const t = startOfToday.getTime();
  if (updatedAt >= t) return "Today";
  if (updatedAt >= t - day) return "Yesterday";
  if (updatedAt >= t - 7 * day) return "Previous 7 days";
  if (updatedAt >= t - 30 * day) return "Previous 30 days";
  return "Older";
}
