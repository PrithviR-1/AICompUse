// Application shell (§15.2): icon rail + optional chats flyout + main content, global
// shortcuts, and the overlays every screen shares (model picker, search, shortcuts).
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HomeView } from "@/components/home/HomeView";
import { ChatView } from "@/components/chat/ChatView";
import { ModelsPage } from "@/components/models/ModelsPage";
import { ModelPickerDialog } from "@/components/models/ModelPickerDialog";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { SearchPalette } from "@/components/search/SearchPalette";
import { matchShortcut } from "@/lib/shortcuts";
import { navigate, useRoute, type Route } from "@/lib/router";
import { useNewChatModelKey, useChatModelKey } from "@/hooks/useModelSelection";
import { useApp } from "@/stores/app";
import { useChats } from "@/stores/chats";
import { useComposer } from "@/stores/composer";
import { useConversation } from "@/stores/conversation";
import { useModels } from "@/stores/models";
import { startCompareWith } from "@/stores/pickerActions";
import { useUi } from "@/stores/ui";
import { ChatsFlyout } from "./ChatsFlyout";
import { IconRail } from "./IconRail";
import { ShortcutsDialog } from "./ShortcutsDialog";

const GalleryPage = lazy(() => import("@/components/gallery/GalleryPage"));
const NARROW_WINDOW = 1100;

function startNewChat() {
  useComposer.getState().resetNewChat();
  navigate({ name: "home" });
}

/** True when a Radix popover, menu or dialog is open (it handles Esc itself). */
function overlayOpen(): boolean {
  return Boolean(document.querySelector("[data-radix-popper-content-wrapper], [role='dialog'][data-state='open'], [role='alertdialog']"));
}

function Content({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <HomeView />;
    case "chat":
      return <ChatView conversationId={route.id} />;
    case "models":
      return <ModelsPage />;
    case "settings":
      return <SettingsPage section={route.section} />;
    case "gallery":
      return (
        <Suspense fallback={null}>
          <GalleryPage />
        </Suspense>
      );
  }
}

function LoadingShell() {
  return (
    <div className="flex h-full" aria-busy="true" aria-label="Loading Machi">
      <div className="flex w-(--rail-width) flex-col items-center gap-3 border-r border-border py-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="size-8" />
        ))}
      </div>
      <div className="flex flex-1 flex-col items-center gap-10 pt-[24vh]">
        <Skeleton className="h-14 w-72" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-24 w-[55%] rounded-card" />
      </div>
    </div>
  );
}

function StartupError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-heading font-bold">Machi couldn't start</h1>
      <p className="max-w-md text-label text-muted">{message}</p>
      <Button variant="primary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

export function AppShell(): ReactNode {
  const route = useRoute();
  const status = useApp((s) => s.status);
  const error = useApp((s) => s.error);
  const init = useApp((s) => s.init);
  const pinned = useApp((s) => s.settings.flyoutPinned);
  const isMac = useApp((s) => s.platform.os === "macOs");
  const updateSettings = useApp((s) => s.updateSettings);
  const flyoutOpen = useUi((s) => s.flyoutOpen);
  const setFlyoutOpen = useUi((s) => s.setFlyoutOpen);
  const chats = useChats();
  const activeConversation = useConversation((s) => s.conversation);
  const newChatCompare = useComposer((s) => s.newChat.compare);
  const newChatModel = useNewChatModelKey();
  const chatModel = useChatModelKey();
  const showFlyout = pinned || flyoutOpen;

  useEffect(() => {
    void init().then(() => {
      if (useApp.getState().status === "ready") {
        void useModels.getState().load();
        void useChats.getState().load();
      }
    });
  }, [init]);

  // Keep the open conversation in step with the route.
  useEffect(() => {
    if (route.name === "chat") {
      void useConversation.getState().open(route.id);
      if (!useApp.getState().settings.flyoutPinned && window.innerWidth < NARROW_WINDOW) setFlyoutOpen(false);
    } else if (route.name === "home") {
      useConversation.getState().clear();
    }
  }, [route, setFlyoutOpen]);

  // Global shortcuts (§11.10, §15.3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = matchShortcut(e, isMac);
      if (!id) return;
      const ui = useUi.getState();
      const conversation = useConversation.getState().conversation;
      if (id === "escape") {
        if (e.defaultPrevented || overlayOpen()) return;
        if (ui.flyoutOpen && !useApp.getState().settings.flyoutPinned) {
          ui.setFlyoutOpen(false);
          return;
        }
        if (conversation && Object.keys(useConversation.getState().streaming).length > 0) void useConversation.getState().stop();
        return;
      }
      e.preventDefault();
      switch (id) {
        case "picker":
          ui.openPicker(conversation ? { kind: "chat", conversationId: conversation.id } : { kind: "new-chat" });
          break;
        case "newChat":
        case "newChatAlt":
          startNewChat();
          break;
        case "search":
          ui.setSearchOpen(true);
          break;
        case "toggleChats":
          if (useApp.getState().settings.flyoutPinned) void updateSettings({ flyoutPinned: false });
          ui.setFlyoutOpen(!ui.flyoutOpen);
          break;
        case "shortcuts":
          ui.setShortcutsOpen(true);
          break;
        case "settings":
          navigate({ name: "settings", section: "providers" });
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMac, updateSettings]);

  if (route.name === "gallery") return <Content route={route} />;
  if (status === "loading") return <LoadingShell />;
  if (status === "error") return <StartupError message={error?.message ?? "Something went wrong."} onRetry={() => void init()} />;

  const toggleChats = () => {
    if (showFlyout) {
      if (pinned) void updateSettings({ flyoutPinned: false });
      setFlyoutOpen(false);
    } else {
      setFlyoutOpen(true);
    }
  };

  const onCompare = () => {
    if (route.name === "chat" && activeConversation) {
      if (activeConversation.compare) void useConversation.getState().endCompare(null);
      else startCompareWith([chatModel, pickOther(chatModel)], activeConversation.id);
      return;
    }
    navigate({ name: "home" });
    if (newChatCompare) useComposer.getState().setNewChat({ compare: null });
    else startCompareWith([newChatModel, pickOther(newChatModel)], null);
  };

  return (
    <div className="flex h-full min-h-0">
      <IconRail
        actions={{
          onHome: startNewChat,
          onNewChat: startNewChat,
          onSearch: () => useUi.getState().setSearchOpen(true),
          onToggleChats: toggleChats,
          onModels: () => navigate({ name: "models" }),
          onCompare,
          onSettings: () => navigate({ name: "settings", section: "providers" }),
          onProfile: () => navigate({ name: "settings", section: "providers" }),
        }}
        state={{
          newChatActive: route.name === "home" && !newChatCompare,
          chatsOpen: showFlyout,
          modelsActive: route.name === "models",
          compareActive: route.name === "chat" ? Boolean(activeConversation?.compare) : route.name === "home" && Boolean(newChatCompare),
          settingsActive: route.name === "settings",
        }}
      />
      {showFlyout && (
        <ChatsFlyout
          chats={chats.list}
          status={chats.status}
          activeId={route.name === "chat" ? route.id : null}
          pinned={pinned}
          onOpenChat={(id) => navigate({ name: "chat", id })}
          onNewChat={startNewChat}
          onClose={() => {
            if (pinned) void updateSettings({ flyoutPinned: false });
            setFlyoutOpen(false);
          }}
          onTogglePinned={() => {
            void updateSettings({ flyoutPinned: !pinned });
            setFlyoutOpen(true);
          }}
          onRetry={() => void chats.load()}
          onRename={(id, title) => {
            void chats.rename(id, title).then((c) => c && useConversation.getState().setConversation(c));
          }}
          onSetPinned={(id, p) => {
            void chats.setPinned(id, p).then((c) => c && useConversation.getState().setConversation(c));
          }}
          onExport={(id) => void chats.exportChat(id, "markdown")}
          onDelete={(id) => {
            void chats.remove(id).then((ok) => {
              if (ok && route.name === "chat" && route.id === id) startNewChat();
            });
          }}
        />
      )}
      <main className="relative min-w-0 flex-1">
        <Content route={route} />
      </main>
      <ModelPickerDialog />
      <SearchPalette />
      <ShortcutsDialog />
    </div>
  );
}

/** A second model for compare: the most recent other model, else the next in the catalog. */
function pickOther(current: string): string {
  const { settings } = useApp.getState();
  const models = useModels.getState().models.filter((m) => m.chatSupported && !settings.hiddenModels.includes(m.key));
  return settings.recentModels.find((k) => k !== current && models.some((m) => m.key === k)) ?? models.find((m) => m.key !== current)?.key ?? current;
}
