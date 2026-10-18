// Toast queue: short confirmations that auto-dismiss after 3 s (§15.11).
import { create } from "zustand";

type ToastTone = "neutral" | "success" | "danger";

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: { label: string; run: () => void };
}

interface ToastState {
  toasts: ToastItem[];
  show: (message: string, options?: { tone?: ToastTone; action?: ToastItem["action"] }) => void;
  dismiss: (id: number) => void;
}

const TOAST_DURATION_MS = 3000;
let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, options) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, tone: options?.tone ?? "neutral", action: options?.action }] }));
    setTimeout(() => get().dismiss(id), TOAST_DURATION_MS);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience for store actions and components. */
export function toast(message: string, options?: { tone?: ToastTone; action?: ToastItem["action"] }) {
  useToasts.getState().show(message, options);
}
