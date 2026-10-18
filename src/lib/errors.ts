// Error shape shared by both backends: the Rust ErrorInfo (kind + plain-language message).
import type { ErrorInfo } from "./bindings";

export class MachiError extends Error {
  readonly info: ErrorInfo;

  constructor(info: ErrorInfo) {
    super(info.message);
    this.name = "MachiError";
    this.info = info;
  }
}

/** Normalizes anything thrown into an ErrorInfo the UI can render. */
export function toErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof MachiError) return error.info;
  if (error && typeof error === "object" && "kind" in error && "message" in error) {
    const e = error as ErrorInfo;
    return { kind: e.kind, message: String(e.message), retryAfterMs: e.retryAfterMs ?? null };
  }
  return { kind: "internal", message: "Something went wrong. Try again.", retryAfterMs: null };
}
