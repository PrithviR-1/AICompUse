// Message rendering (§15.6): user bubbles on the right, assistant replies full width with an
// avatar + model label, one row of actions under each reply, branch navigation and inline
// error cards.
import { useState, type ReactNode } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  FileText,
  Pencil,
  Repeat2,
  RotateCcw,
  Share,
  Trash,
} from "lucide-react";
import { ModelAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import type { ErrorInfo, Message, ModelInfo } from "@/lib/bindings";
import { costLabel, durationLabel, tokensLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCopy } from "@/hooks/useCopy";
import { Markdown } from "./Markdown";

export interface BranchInfo {
  index: number;
  count: number;
  onPrev: () => void;
  onNext: () => void;
}

export interface MessageHandlers {
  onRetry: (messageId: string) => void;
  onRetryWith: (messageId: string) => void;
  onDelete: (messageId: string) => void;
  onEdit: (messageId: string, content: string) => Promise<boolean>;
  onLink: (url: string) => void;
  onOpenSettings: () => void;
}

const actionIcon = (icon: typeof Copy) => <Icon icon={icon} size="sm" />;

function BranchNav({ branch }: { branch: BranchInfo }) {
  if (branch.count < 2) return null;
  return (
    <div className="flex items-center text-meta text-muted tabular-nums" aria-label="Versions">
      <IconButton label="Previous version" size="sm" icon={actionIcon(ChevronLeft)} disabled={branch.index === 0} onClick={branch.onPrev} />
      <span className="min-w-8 text-center">
        {branch.index + 1}/{branch.count}
      </span>
      <IconButton label="Next version" size="sm" icon={actionIcon(ChevronRight)} disabled={branch.index >= branch.count - 1} onClick={branch.onNext} />
    </div>
  );
}

function ErrorCard({ error, onRetry, onSwitchModel, onOpenSettings }: { error: ErrorInfo; onRetry: () => void; onSwitchModel: () => void; onOpenSettings: () => void }) {
  const keyProblem = error.kind === "missingKey" || error.kind === "invalidKey";
  return (
    <div role="alert" data-testid="error-card" className="mt-3 flex flex-col gap-3 rounded-menu border border-danger bg-raised p-4">
      <div className="flex items-start gap-3">
        <Icon icon={CircleAlert} size="md" className="text-danger-text" />
        <p className="text-label text-fg">{error.message}</p>
      </div>
      <div className="flex flex-wrap gap-2 pl-8">
        {keyProblem ? (
          <Button size="sm" variant="secondary" onClick={onOpenSettings}>
            Open settings
          </Button>
        ) : (
          <>
            <Button size="sm" variant="secondary" onClick={onRetry}>
              <Icon icon={RotateCcw} size="sm" />
              Retry
            </Button>
            <Button size="sm" variant="ghost" onClick={onSwitchModel}>
              <Icon icon={Repeat2} size="sm" />
              Switch model
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function Attachments({ message }: { message: Message }) {
  if (message.attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {message.attachments.map((a) =>
        a.kind === "image" ? (
          <img key={a.id} src={a.data} alt={a.name} className="max-h-40 max-w-60 rounded-menu border border-border object-cover" />
        ) : (
          <span key={a.id} className="inline-flex h-10 max-w-60 items-center gap-2 rounded-menu border border-border bg-raised px-3 text-meta text-fg">
            <Icon icon={FileText} size="sm" className="text-muted" />
            <span className="truncate">{a.name}</span>
          </span>
        ),
      )}
    </div>
  );
}

export function UserMessage({
  message,
  branch,
  handlers,
  editable,
}: {
  message: Message;
  branch: BranchInfo;
  handlers: MessageHandlers;
  editable: boolean;
}) {
  const [copied, copy] = useCopy();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [saving, setSaving] = useState(false);

  if (editing) {
    return (
      <div className="ml-auto flex w-[80%] flex-col gap-2">
        <Textarea
          aria-label="Edit message"
          value={draft}
          autoFocus
          rows={Math.min(8, Math.max(2, draft.split("\n").length))}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setEditing(false);
            }
          }}
          className="rounded-card px-4 py-3"
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={saving}
            disabled={!draft.trim() && message.attachments.length === 0}
            onClick={async () => {
              setSaving(true);
              const ok = await handlers.onEdit(message.id, draft);
              setSaving(false);
              if (ok) setEditing(false);
            }}
          >
            Save and send
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative flex flex-col items-end gap-2" data-role="user">
      <Attachments message={message} />
      {message.content && (
        <div className="max-w-[80%] rounded-card bg-bubble px-4 py-3 text-body whitespace-pre-wrap break-words text-fg">{message.content}</div>
      )}
      {/* Sits in the gap below the bubble so turns stay 28 px apart (§15.6). */}
      <div
        className={cn(
          "absolute top-full right-0 flex items-center gap-1 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100",
          branch.count > 1 ? "opacity-100" : "opacity-0",
        )}
      >
        <BranchNav branch={branch} />
        <IconButton label={copied ? "Copied" : "Copy"} size="sm" icon={actionIcon(copied ? Check : Copy)} onClick={() => void copy(message.content)} />
        {editable && (
          <IconButton
            label="Edit and resend"
            size="sm"
            icon={actionIcon(Pencil)}
            onClick={() => {
              setDraft(message.content);
              setEditing(true);
            }}
          />
        )}
      </div>
    </div>
  );
}

function StreamingPlaceholder() {
  return (
    <div className="flex flex-col gap-2 pt-1" aria-label="Waiting for the reply">
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  );
}

export function AssistantMessage({
  message,
  model,
  streaming,
  isLast,
  branch,
  handlers,
  compact = false,
  extraActions,
}: {
  message: Message;
  model: { name: string; vendor: string; id?: string } | ModelInfo;
  streaming: boolean;
  isLast: boolean;
  branch: BranchInfo;
  handlers: MessageHandlers;
  compact?: boolean;
  extraActions?: ReactNode;
}) {
  const [copied, copy] = useCopy();
  const [shared, share] = useCopy();
  const elapsed = durationLabel(message.elapsedMs);
  const detail = [
    compact && elapsed,
    message.tokensIn != null && `${tokensLabel(message.tokensIn)} in`,
    message.tokensOut != null && `${tokensLabel(message.tokensOut)} out`,
    costLabel(message.costUsd),
    message.status === "stopped" && "Stopped",
  ]
    .filter(Boolean)
    .join(" · ");
  const markdown = `**${model.name}**\n\n${message.content}`;
  const showActions = !streaming;

  return (
    <article className="group flex flex-col" data-role="assistant" aria-busy={streaming || undefined}>
      {/* Compare columns already name the model in their header. */}
      {!compact && (
        <header className="flex h-7 items-center gap-2">
          <ModelAvatar name={model.name} vendor={model.vendor} />
          <Tooltip content={"id" in model && model.id ? model.id : model.name}>
            <span className="truncate text-meta font-medium text-muted">{model.name}</span>
          </Tooltip>
          {elapsed && <span className="text-meta text-faint tabular-nums">· {elapsed}</span>}
        </header>
      )}
      <div className={cn(!compact && "mt-2")}>
        {streaming && !message.content ? (
          <StreamingPlaceholder />
        ) : (
          message.content && <Markdown content={message.content} onLink={handlers.onLink} className={cn(streaming && "is-streaming")} />
        )}
        {message.error && (
          <ErrorCard
            error={message.error}
            onRetry={() => handlers.onRetry(message.id)}
            onSwitchModel={() => handlers.onRetryWith(message.id)}
            onOpenSettings={handlers.onOpenSettings}
          />
        )}
      </div>
      {showActions && (
        <div
          className={cn(
            "mt-2 flex flex-wrap items-center gap-1 transition-opacity duration-150",
            isLast ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
          )}
          data-testid="message-actions"
        >
          <IconButton label={copied ? "Copied" : "Copy"} size="sm" icon={actionIcon(copied ? Check : Copy)} onClick={() => void copy(message.content)} disabled={!message.content} />
          {copied && <span className="pr-1 text-meta text-muted">Copied</span>}
          <IconButton label="Retry" size="sm" icon={actionIcon(RotateCcw)} onClick={() => handlers.onRetry(message.id)} />
          <IconButton label="Retry with another model" size="sm" icon={actionIcon(Repeat2)} onClick={() => handlers.onRetryWith(message.id)} />
          <IconButton
            label={shared ? "Copied as Markdown" : "Copy as Markdown"}
            size="sm"
            icon={actionIcon(shared ? Check : Share)}
            onClick={() => void share(markdown)}
            disabled={!message.content}
          />
          {shared && <span className="pr-1 text-meta text-muted">Copied</span>}
          <IconButton label="Delete" size="sm" variant="danger" icon={actionIcon(Trash)} onClick={() => handlers.onDelete(message.id)} />
          <BranchNav branch={branch} />
          {extraActions}
        </div>
      )}
      {showActions && detail && <p className="mt-1 text-meta text-faint tabular-nums">{detail}</p>}
    </article>
  );
}
