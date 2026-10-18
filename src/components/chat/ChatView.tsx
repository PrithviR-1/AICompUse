// Chat screen (§15.6): header, the conversation (single column or compare columns) and the
// composer fixed at the bottom.
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Composer } from "@/components/composer/Composer";
import { indexMessages, visiblePath } from "@/lib/tree";
import { navigate } from "@/lib/router";
import { useChatModelKey } from "@/hooks/useModelSelection";
import { useApp } from "@/stores/app";
import { useChats } from "@/stores/chats";
import { useComposer } from "@/stores/composer";
import { useConversation } from "@/stores/conversation";
import { modelLabel, useModels } from "@/stores/models";
import { startCompareWith } from "@/stores/pickerActions";
import { useUi } from "@/stores/ui";
import { ChatHeader } from "./ChatHeader";
import { CompareView } from "./CompareView";
import { MessageList } from "./MessageList";
import type { MessageHandlers } from "./Messages";

function ChatSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-(--column-width) flex-col gap-7 px-6 pt-6" aria-label="Loading chat">
      <Skeleton className="ml-auto h-12 w-1/2 rounded-card" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}

export function ChatView({ conversationId }: { conversationId: string }) {
  const status = useConversation((s) => s.status);
  const error = useConversation((s) => s.error);
  const conversation = useConversation((s) => s.conversation);
  const messages = useConversation((s) => s.messages);
  const streaming = useConversation((s) => s.streaming);
  const actions = useConversation.getState();
  const models = useModels((s) => s.models);
  const settings = useApp((s) => s.settings);
  const openLink = useApp((s) => s.openLink);
  const openPicker = useUi((s) => s.openPicker);
  const rememberScroll = useUi((s) => s.rememberScroll);
  const initialScroll = useUi.getState().scroll[conversationId];
  const modelKey = useChatModelKey();
  const [deleting, setDeleting] = useState<string | null>(null);

  const allMessages = useMemo(() => Object.values(messages), [messages]);
  const byId = useMemo(() => indexMessages(allMessages), [allMessages]);
  const path = useMemo(() => visiblePath(byId, conversation?.currentLeafId ?? null), [byId, conversation?.currentLeafId]);
  const visibleModels = useMemo(() => models.filter((m) => !settings.hiddenModels.includes(m.key)), [models, settings.hiddenModels]);
  const model = models.find((m) => m.key === modelKey);
  const label = model ?? modelLabel(models, modelKey);
  const isStreaming = Object.keys(streaming).length > 0;

  if (status === "loading" || (status === "idle" && !conversation)) {
    return (
      <div className="flex h-full flex-col">
        <div className="h-(--header-height) border-b border-border" />
        <ChatSkeleton />
      </div>
    );
  }
  if (status === "error" || !conversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-heading font-bold">This chat couldn't be opened</h1>
        <p className="max-w-md text-label text-muted">{error?.message ?? "It may have been deleted."}</p>
        <div className="flex gap-2">
          <Button onClick={() => void actions.open(conversationId)}>Try again</Button>
          <Button variant="primary" onClick={() => navigate({ name: "home" })}>
            New chat
          </Button>
        </div>
      </div>
    );
  }

  const handlers: MessageHandlers = {
    onRetry: (id) => void actions.regenerate(id),
    onRetryWith: (id) => openPicker({ kind: "retry", messageId: id }),
    onDelete: (id) => setDeleting(id),
    onEdit: (id, content) => actions.edit(id, content, modelKey),
    onLink: openLink,
    onOpenSettings: () => navigate({ name: "settings", section: "providers" }),
  };

  const compare = conversation.compare;
  const otherModel = settings.recentModels.find((k) => k !== modelKey && visibleModels.some((m) => m.key === k)) ?? visibleModels.find((m) => m.key !== modelKey)?.key;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatHeader
        conversation={conversation}
        model={label}
        onPickModel={() => openPicker({ kind: "chat", conversationId: conversation.id })}
        onToggleCompare={() => {
          if (compare) void actions.endCompare(null);
          else if (otherModel) startCompareWith([modelKey, otherModel], conversation.id);
        }}
        onNewChat={() => {
          useComposer.getState().resetNewChat();
          navigate({ name: "home" });
        }}
        onRename={async (title) => {
          const c = await useChats.getState().rename(conversation.id, title);
          if (c) actions.setConversation(c);
          return Boolean(c);
        }}
        onSetPinned={(pinned) => {
          void useChats.getState().setPinned(conversation.id, pinned).then((c) => c && actions.setConversation(c));
        }}
        onExport={(format) => void actions.exportChat(format)}
        onDelete={() => {
          void useChats.getState().remove(conversation.id).then((ok) => ok && navigate({ name: "home" }));
        }}
      />
      <div className="min-h-0 flex-1">
        {compare ? (
          <CompareView
            columns={compare}
            byId={byId}
            allMessages={allMessages}
            streaming={streaming}
            models={models}
            handlers={handlers}
            onSelectBranch={(id) => void actions.selectBranch(id)}
            onPickColumnModel={(column) => openPicker({ kind: "compare-column", conversationId: conversation.id, column })}
            onContinueWith={(column) => void actions.endCompare(column)}
          />
        ) : (
          <MessageList
            conversationId={conversation.id}
            path={path}
            allMessages={allMessages}
            streaming={streaming}
            models={models}
            handlers={handlers}
            onSelectBranch={(id) => void actions.selectBranch(id)}
            editable
            initialScrollTop={initialScroll}
            onScrollTopChange={(top) => rememberScroll(conversation.id, top)}
          />
        )}
      </div>
      <div className="mx-auto w-full max-w-(--column-width) shrink-0 px-6 pb-6">
        <Composer
          draftKey={conversation.id}
          placeholder={compare ? "Message all models" : `Message ${label.name}`}
          model={model}
          models={visibleModels}
          favorites={settings.favorites}
          streaming={isStreaming}
          settings={conversation.settings}
          onSettingsChange={(s) => void actions.updateChatSettings(s)}
          compareActive={Boolean(compare)}
          autoFocus
          onSend={(input) => actions.send(input)}
          onStop={() => void actions.stop()}
        />
      </div>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this message?"
        description="The message and any replies after it are removed from this chat. This can't be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleting) void actions.deleteMessage(deleting);
          setDeleting(null);
        }}
      />
    </div>
  );
}
