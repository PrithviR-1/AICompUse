// Compare mode (§11.7, §15.6): shared history once, then 2–3 side-by-side columns that stream
// independently, each with its model header and "Continue with this one".
import { Fragment } from "react";
import { ModelAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { focusRing, transition } from "@/components/ui/styles";
import type { CompareColumn, Message, ModelInfo } from "@/lib/bindings";
import { visiblePath } from "@/lib/tree";
import { cn } from "@/lib/utils";
import { modelLabel } from "@/stores/models";
import { branchFor } from "./MessageList";
import { AssistantMessage, UserMessage, type MessageHandlers } from "./Messages";

interface CompareViewProps {
  columns: CompareColumn[];
  byId: Map<string, Message>;
  allMessages: Message[];
  streaming: Record<string, true>;
  models: ModelInfo[];
  handlers: MessageHandlers;
  onSelectBranch: (id: string) => void;
  onPickColumnModel: (column: number) => void;
  onContinueWith: (column: number) => void;
}

const GRID = ["", "grid-cols-1", "grid-cols-2", "grid-cols-3"];

export function CompareView({ columns, byId, allMessages, streaming, models, handlers, onSelectBranch, onPickColumnModel, onContinueWith }: CompareViewProps) {
  const paths = columns.map((c) => visiblePath(byId, c.leafId));
  let shared = 0;
  while (paths.every((p) => p[shared] && p[shared].id === paths[0][shared].id)) shared++;
  const sharedPath = paths[0]?.slice(0, shared) ?? [];
  const anyStreaming = paths.some((p) => p.some((m) => streaming[m.id]));

  const render = (message: Message, isLast: boolean, compact: boolean) =>
    message.role === "user" ? (
      <UserMessage message={message} branch={branchFor(allMessages, message, onSelectBranch)} handlers={handlers} editable={false} />
    ) : (
      <AssistantMessage
        message={message}
        model={models.find((m) => m.key === message.modelKey) ?? modelLabel(models, message.modelKey)}
        streaming={Boolean(streaming[message.id])}
        isLast={isLast}
        branch={{ index: 0, count: 1, onPrev: () => undefined, onNext: () => undefined }}
        handlers={handlers}
        compact={compact}
      />
    );

  return (
    <div className="h-full overflow-y-auto" data-testid="compare-view">
      {sharedPath.length > 0 && (
        <div className="mx-auto flex w-full max-w-(--column-width) flex-col gap-7 px-6 pt-6">
          {sharedPath.map((m) => (
            <Fragment key={m.id}>{render(m, false, false)}</Fragment>
          ))}
        </div>
      )}
      <div className={cn("grid gap-4 px-6 py-6", GRID[columns.length])}>
        {columns.map((column, index) => {
          const model = models.find((m) => m.key === column.modelKey) ?? modelLabel(models, column.modelKey);
          const rest = paths[index].slice(shared);
          return (
            <section key={index} aria-label={`Column ${index + 1}: ${model.name}`} className="flex min-w-0 flex-col rounded-dialog border border-border">
              <header className="flex h-12 items-center gap-2 border-b border-border pr-2 pl-3">
                <button
                  type="button"
                  onClick={() => onPickColumnModel(index)}
                  aria-label={`Change model for column ${index + 1}`}
                  className={cn("flex min-w-0 items-center gap-2 rounded-control px-1 py-1 hover:bg-hover", focusRing, transition)}
                >
                  <ModelAvatar name={model.name} vendor={model.vendor} />
                  <span className="truncate text-label font-semibold text-fg">{model.name}</span>
                </button>
                <Button size="sm" variant="ghost" className="ml-auto" disabled={anyStreaming || !column.leafId} onClick={() => onContinueWith(index)}>
                  Continue with this one
                </Button>
              </header>
              <div className="flex flex-col gap-7 p-4">
                {rest.length === 0 ? (
                  <p className="text-label text-muted">Send a message to see this model's reply.</p>
                ) : (
                  rest.map((m, i) => <Fragment key={m.id}>{render(m, i === rest.length - 1, true)}</Fragment>)
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
