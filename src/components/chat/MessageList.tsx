// Virtualized conversation column (§11.12: smooth with 200+ messages). Auto-scrolls while
// streaming only when the reader is near the bottom; otherwise a "↓" button appears (§15.6).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import type { Message, ModelInfo } from "@/lib/bindings";
import { siblingInfo } from "@/lib/tree";
import { modelLabel } from "@/stores/models";
import { AssistantMessage, UserMessage, type BranchInfo, type MessageHandlers } from "./Messages";

const NEAR_BOTTOM_PX = 96;

interface MessageListProps {
  conversationId: string;
  path: Message[];
  allMessages: Message[];
  streaming: Record<string, true>;
  models: ModelInfo[];
  handlers: MessageHandlers;
  onSelectBranch: (messageId: string) => void;
  editable: boolean;
  initialScrollTop: number | undefined;
  onScrollTopChange: (top: number) => void;
}

export function branchFor(allMessages: Message[], message: Message, onSelect: (id: string) => void): BranchInfo {
  const { siblings, index } = siblingInfo(allMessages, message);
  return {
    index,
    count: siblings.length,
    onPrev: () => siblings[index - 1] && onSelect(siblings[index - 1].id),
    onNext: () => siblings[index + 1] && onSelect(siblings[index + 1].id),
  };
}

export function MessageList({
  conversationId,
  path,
  allMessages,
  streaming,
  models,
  handlers,
  onSelectBranch,
  editable,
  initialScrollTop,
  onScrollTopChange,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(initialScrollTop === undefined);
  const [atBottom, setAtBottom] = useState(true);
  const lastAssistantIndex = path.map((m) => m.role).lastIndexOf("assistant");

  const virtualizer = useVirtualizer({
    count: path.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (path[i]?.role === "user" ? 96 : 260),
    getItemKey: (i) => path[i]?.id ?? i,
    overscan: 6,
    paddingStart: 24,
    paddingEnd: 32,
  });

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    stick.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Restore the remembered position when a chat opens (§15.0 item 12).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && initialScrollTop !== undefined) el.scrollTop = initialScrollTop;
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // A message just sent always brings the view to the bottom.
  const lastId = path.at(-1)?.id;
  const lastIsUser = path.at(-1)?.role === "user" || (path.at(-2)?.role === "user" && path.at(-1)?.status === "streaming");
  useEffect(() => {
    if (lastIsUser) stick.current = true;
  }, [lastId, lastIsUser]);

  // Follow growing content while pinned to the bottom.
  const lastContentLength = path.at(-1)?.content.length ?? 0;
  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lastContentLength, totalSize, path.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    stick.current = near;
    setAtBottom(near);
    onScrollTopChange(el.scrollTop);
  };

  return (
    <div className="relative h-full min-h-0">
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto" data-testid="message-list">
        <div className="relative mx-auto w-full max-w-(--column-width)" style={{ height: totalSize }}>
          {virtualizer.getVirtualItems().map((item) => {
            const message = path[item.index];
            if (!message) return null;
            const branch = branchFor(allMessages, message, onSelectBranch);
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full px-6 pb-7"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {message.role === "user" ? (
                  <UserMessage message={message} branch={branch} handlers={handlers} editable={editable} />
                ) : (
                  <AssistantMessage
                    message={message}
                    model={models.find((m) => m.key === message.modelKey) ?? modelLabel(models, message.modelKey)}
                    streaming={Boolean(streaming[message.id])}
                    isLast={item.index === lastAssistantIndex}
                    branch={branch}
                    handlers={handlers}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {!atBottom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <IconButton
            label="Jump to latest"
            variant="outline"
            size="lg"
            className="pointer-events-auto"
            icon={<Icon icon={ArrowDown} size="md" />}
            onClick={() => scrollToBottom(true)}
          />
        </div>
      )}
    </div>
  );
}
