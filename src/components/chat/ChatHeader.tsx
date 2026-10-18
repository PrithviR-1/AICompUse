// Chat header (§15.6): the current model as a picker button on the left; compare toggle,
// new chat and a "⋯" menu (rename, pin, export, delete, temporary indicator) on the right.
import { useState } from "react";
import { ChevronDown, Columns2, Download, Ellipsis, EyeOff, Pencil, Pin, PinOff, SquarePen, Trash } from "lucide-react";
import { ModelAvatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { focusRing, transition } from "@/components/ui/styles";
import type { Conversation, ExportFormat } from "@/lib/bindings";
import { cn } from "@/lib/utils";

interface ChatHeaderProps {
  conversation: Conversation;
  model: { name: string; vendor: string };
  onPickModel: () => void;
  onToggleCompare: () => void;
  onNewChat: () => void;
  onRename: (title: string) => Promise<boolean>;
  onSetPinned: (pinned: boolean) => void;
  onExport: (format: ExportFormat) => void;
  onDelete: () => void;
}

export function ChatHeader({ conversation, model, onPickModel, onToggleCompare, onNewChat, onRename, onSetPinned, onExport, onDelete }: ChatHeaderProps) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const [deleting, setDeleting] = useState(false);
  const compare = conversation.compare;

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b border-border px-4">
      {compare ? (
        <span className="flex items-center gap-2 px-2 text-label font-medium text-fg">
          <Icon icon={Columns2} size="md" className="text-muted" />
          Comparing {compare.length} models
        </span>
      ) : (
        <button
          type="button"
          onClick={onPickModel}
          aria-label={`Model: ${model.name}. Choose another model`}
          className={cn("flex h-10 min-w-0 items-center gap-2 rounded-control pr-2 pl-1 hover:bg-hover active:bg-active", focusRing, transition)}
        >
          <ModelAvatar name={model.name} vendor={model.vendor} />
          <span className="truncate text-label font-semibold text-fg">{model.name}</span>
          <Icon icon={ChevronDown} size="sm" className="text-muted" />
        </button>
      )}
      {conversation.temporary && (
        <Badge>
          <Icon icon={EyeOff} size="xs" />
          Temporary
        </Badge>
      )}
      <div className="ml-auto flex items-center gap-1">
        <IconButton
          label={compare ? "Stop comparing" : "Compare models"}
          variant={compare ? "active" : "ghost"}
          icon={<Icon icon={Columns2} size="md" />}
          onClick={onToggleCompare}
          tooltipSide="bottom"
        />
        <IconButton label="New chat" icon={<Icon icon={SquarePen} size="md" />} onClick={onNewChat} tooltipSide="bottom" />
        <Menu>
          <MenuTrigger asChild>
            <IconButton label="More chat actions" icon={<Icon icon={Ellipsis} size="md" />} tooltipSide="bottom" />
          </MenuTrigger>
          <MenuContent>
            <MenuItem
              icon={<Icon icon={Pencil} size="sm" />}
              onSelect={() => {
                setTitle(conversation.title);
                setRenaming(true);
              }}
            >
              Rename
            </MenuItem>
            {!conversation.temporary && (
              <MenuItem icon={<Icon icon={conversation.pinned ? PinOff : Pin} size="sm" />} onSelect={() => onSetPinned(!conversation.pinned)}>
                {conversation.pinned ? "Unpin" : "Pin"}
              </MenuItem>
            )}
            <MenuItem icon={<Icon icon={Download} size="sm" />} onSelect={() => onExport("markdown")}>
              Export as Markdown
            </MenuItem>
            <MenuItem icon={<Icon icon={Download} size="sm" />} onSelect={() => onExport("json")}>
              Export as JSON
            </MenuItem>
            {conversation.temporary && (
              <MenuItem disabled icon={<Icon icon={EyeOff} size="sm" />}>
                Temporary chat, not saved
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem danger icon={<Icon icon={Trash} size="sm" />} onSelect={() => setDeleting(true)}>
              Delete
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent
          title="Rename chat"
          footer={
            <>
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <Button
                variant="primary"
                disabled={!title.trim()}
                onClick={async () => {
                  if (await onRename(title.trim())) setRenaming(false);
                }}
              >
                Save
              </Button>
            </>
          }
        >
          <Input
            aria-label="Chat title"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && title.trim() && (await onRename(title.trim()))) setRenaming(false);
            }}
          />
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this chat?"
        description="The chat and all of its replies are removed from this device. This can't be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          setDeleting(false);
          onDelete();
        }}
      />
    </header>
  );
}
