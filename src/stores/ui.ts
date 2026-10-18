// Transient UI state: the chats flyout, the model picker, palettes and per-chat scroll memory.
import { create } from "zustand";

export type PickerPurpose =
  | { kind: "new-chat" }
  | { kind: "chat"; conversationId: string }
  | { kind: "mention"; draftKey: string }
  | { kind: "retry"; messageId: string }
  | { kind: "compare-column"; conversationId: string | null; column: number }
  | { kind: "default-model" };

interface UiState {
  flyoutOpen: boolean;
  picker: PickerPurpose | null;
  searchOpen: boolean;
  shortcutsOpen: boolean;
  scroll: Record<string, number>;
  setFlyoutOpen: (open: boolean) => void;
  openPicker: (purpose: PickerPurpose) => void;
  closePicker: () => void;
  setSearchOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  rememberScroll: (conversationId: string, top: number) => void;
}

export const useUi = create<UiState>((set, get) => ({
  flyoutOpen: false,
  picker: null,
  searchOpen: false,
  shortcutsOpen: false,
  scroll: {},
  setFlyoutOpen: (open) => set({ flyoutOpen: open }),
  openPicker: (purpose) => set({ picker: purpose }),
  closePicker: () => set({ picker: null }),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  rememberScroll: (conversationId, top) => set({ scroll: { ...get().scroll, [conversationId]: top } }),
}));
