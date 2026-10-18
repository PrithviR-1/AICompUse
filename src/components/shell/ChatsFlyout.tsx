// Chats flyout (§15.4): pinnable panel beside the rail with a filter field and date-grouped
// history rows; each row has a hover "⋯" menu (rename, pin, export, delete).
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Download, Ellipsis, Pencil, Pin, PinOff, Search, SquarePen, Trash, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import { focusRing, transition } from "@/components/ui/styles";
import type { ConversationSummary } from "@/lib/bindings";
import { DATE_GROUPS, dateGroup } from "@/lib/format";
import { cn } from "@/lib/utils";

interface FlyoutProps {
  chats: ConversationSummary[];
  status: "idle" | "loading" | "ready" | "error";
  activeId: string | null;
  pinned: boolean;
  onOpenChat: (id: string) => void;
  onNewChat: () => void;
  onClose: () => void;
  onTogglePinned: () => void;
  onRetry: () => void;
  onRename: (id: string, title: string) => void;
  onSetPinned: (id: string, pinned: boolean) => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
}

function ChatRow({
  chat,
  active,
  onOpen,
  onRename,
  onSetPinned,
  onExport,
  onRequestDelete,
}: {
  chat: ConversationSummary;
  active: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onSetPinned: (pinned: boolean) => void;
  onExport: () => void;
  onRequestDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chat.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const finish = (save: boolean) => {
    setEditing(false);
    const title = draft.trim();
    if (save && title && title !== chat.title) onRename(title);
    else setDraft(chat.title);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") {
      e.stopPropagation();
      finish(false);
    }
  };

  if (editing) {
    return (
      <div className="px-2">
        <Input
          ref={inputRef}
          aria-label="Chat title"
          className="h-9 text-label"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => finish(true)}
        />
      </div>
    );
  }

  return (
    <div className={cn("group relative mx-2 flex h-9 items-center rounded-control", active ? "bg-active" : "hover:bg-hover", menuOpen && !active && "bg-hover")}>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "page" : undefined}
        title={chat.title}
        className={cn(
          "h-full min-w-0 flex-1 truncate rounded-control pr-9 pl-3 text-left text-label",
          active ? "text-fg" : "text-muted group-hover:text-fg",
          focusRing,
          transition,
        )}
      >
        {chat.title || "New chat"}
      </button>
      <Menu open={menuOpen} onOpenChange={setMenuOpen}>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label={`More actions for ${chat.title}`}
            className={cn(
              "absolute right-1 inline-flex size-7 items-center justify-center rounded-control text-muted hover:bg-active hover:text-fg",
              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
              focusRing,
            )}
          >
            <Icon icon={Ellipsis} size="sm" />
          </button>
        </MenuTrigger>
        <MenuContent align="start">
          <MenuItem icon={<Icon icon={Pencil} size="sm" />} onSelect={() => setEditing(true)}>
            Rename
          </MenuItem>
          <MenuItem icon={<Icon icon={chat.pinned ? PinOff : Pin} size="sm" />} onSelect={() => onSetPinned(!chat.pinned)}>
            {chat.pinned ? "Unpin" : "Pin"}
          </MenuItem>
          <MenuItem icon={<Icon icon={Download} size="sm" />} onSelect={onExport}>
            Export as Markdown
          </MenuItem>
          <MenuSeparator />
          <MenuItem danger icon={<Icon icon={Trash} size="sm" />} onSelect={onRequestDelete}>
            Delete
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}

export function ChatsFlyout(props: FlyoutProps) {
  const { chats, status, activeId, pinned } = props;
  const [filter, setFilter] = useState("");
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null);
  // Grouping reference time, fixed when the panel opens.
  const [now] = useState(() => Date.now());

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const visible = q ? chats.filter((c) => c.title.toLowerCase().includes(q)) : chats;
    return DATE_GROUPS.map((group) => ({ group, items: visible.filter((c) => dateGroup(c.updatedAt, c.pinned, now) === group) })).filter(
      (g) => g.items.length > 0,
    );
  }, [chats, filter, now]);

  return (
    <aside aria-label="Chats" className="flex h-full w-(--flyout-width) shrink-0 animate-slide-in flex-col border-r border-border bg-bg">
      <div className="flex h-(--header-height) shrink-0 items-center gap-1 pr-2 pl-4">
        <h2 className="flex-1 text-title font-semibold text-fg">Chats</h2>
        <IconButton
          label={pinned ? "Unpin panel" : "Pin panel open"}
          variant={pinned ? "active" : "ghost"}
          icon={<Icon icon={pinned ? PinOff : Pin} size="md" />}
          onClick={props.onTogglePinned}
          tooltipSide="bottom"
        />
        <IconButton label="Close chats" icon={<Icon icon={X} size="md" />} onClick={props.onClose} tooltipSide="bottom" />
      </div>
      <div className="px-4 pb-3">
        <div className="relative">
          <Icon icon={Search} size="sm" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <Input
            aria-label="Filter chats"
            placeholder="Search chats"
            className="h-9 pl-9 text-label"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && filter) {
                e.stopPropagation();
                setFilter("");
              }
            }}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {status === "loading" && (
          <div className="flex flex-col gap-2 px-4 pt-2" aria-label="Loading chats">
            {[70, 90, 60, 80, 50].map((w) => (
              <Skeleton key={w} className="h-5" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}
        {status === "error" && (
          <div className="flex flex-col items-start gap-3 px-4 pt-2">
            <p className="text-label text-muted">Your chats couldn't be loaded.</p>
            <Button size="sm" onClick={props.onRetry}>
              Try again
            </Button>
          </div>
        )}
        {status === "ready" && chats.length === 0 && (
          <div className="flex flex-col items-start gap-3 px-4 pt-2">
            <p className="text-label text-muted">No chats yet</p>
            <Button size="sm" onClick={props.onNewChat}>
              <Icon icon={SquarePen} size="sm" />
              New chat
            </Button>
          </div>
        )}
        {status === "ready" && chats.length > 0 && groups.length === 0 && (
          <p className="px-4 pt-2 text-label text-muted">No chats match "{filter.trim()}".</p>
        )}
        {groups.map(({ group, items }) => (
          <section key={group} className="pt-3" aria-label={group}>
            <h3 className="px-5 pb-1 text-caption font-medium text-faint">{group}</h3>
            {items.map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                active={chat.id === activeId}
                onOpen={() => props.onOpenChat(chat.id)}
                onRename={(title) => props.onRename(chat.id, title)}
                onSetPinned={(p) => props.onSetPinned(chat.id, p)}
                onExport={() => props.onExport(chat.id)}
                onRequestDelete={() => setDeleting(chat)}
              />
            ))}
          </section>
        ))}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this chat?"
        description={`"${deleting?.title ?? ""}" and all of its replies are removed from this device. This can't be undone.`}
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleting) props.onDelete(deleting.id);
          setDeleting(null);
        }}
      />
    </aside>
  );
}
