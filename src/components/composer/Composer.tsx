// The composer (§15.7): one rounded card with an auto-growing textarea and a single toolbar
// row (+ attach, @ mention, settings, mic, send/stop). Used on home and in chats.
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { ArrowUp, AtSign, FileText, Mic, Plus, Square, X } from "lucide-react";
import { ModelAvatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { focusRing } from "@/components/ui/styles";
import { ModelPickerList } from "@/components/models/ModelPickerList";
import type { ChatSettings, ModelInfo, NewAttachment } from "@/lib/bindings";
import { fileToAttachment } from "@/lib/files";
import { cn } from "@/lib/utils";
import { useComposer } from "@/stores/composer";
import { toast } from "@/stores/toasts";
import { ChatSettingsPopover } from "./ChatSettingsPopover";

const MAX_LINES = 8;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,text/*,.md,.csv,.json,.yaml,.yml,.toml,.ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.c,.cpp,.cs,.rb,.php,.sh,.sql";
const EMPTY: NewAttachment[] = [];

interface ComposerSendInput {
  content: string;
  attachments: NewAttachment[];
  modelKey: string;
}

interface ComposerProps {
  draftKey: string;
  placeholder: string;
  /** Model the next message goes to, before any "@" override. */
  model: ModelInfo | undefined;
  /** Models offered by "@" (hidden models excluded). */
  models: ModelInfo[];
  favorites: string[];
  streaming: boolean;
  settings: ChatSettings;
  onSettingsChange: (settings: ChatSettings) => void;
  onSend: (input: ComposerSendInput) => Promise<boolean>;
  onStop: () => void;
  /** In compare mode each column has its own model, so "@" is unavailable. */
  compareActive?: boolean;
  autoFocus?: boolean;
  className?: string;
}

function AttachmentPreview({ attachment, onRemove }: { attachment: NewAttachment; onRemove: () => void }) {
  return (
    <div className="group relative">
      {attachment.kind === "image" ? (
        <img src={attachment.data} alt={attachment.name} className="size-14 rounded-control border border-border object-cover" />
      ) : (
        <div className="flex h-14 max-w-48 items-center gap-2 rounded-control border border-border bg-bg px-3">
          <Icon icon={FileText} size="md" className="text-muted" />
          <div className="min-w-0">
            <p className="truncate text-meta font-medium text-fg">{attachment.name}</p>
            <p className="text-caption text-faint tabular-nums">{Math.max(1, Math.round(attachment.size / 1024))} KB</p>
          </div>
        </div>
      )}
      <button
        type="button"
        aria-label={`Remove ${attachment.name}`}
        onClick={onRemove}
        className={cn(
          "absolute -top-2 -right-2 inline-flex size-5 items-center justify-center rounded-full border border-border bg-raised text-muted shadow-popover hover:text-fg",
          focusRing,
        )}
      >
        <Icon icon={X} size="xs" />
      </button>
    </div>
  );
}

export function Composer({
  draftKey,
  placeholder,
  model,
  models,
  favorites,
  streaming,
  settings,
  onSettingsChange,
  onSend,
  onStop,
  compareActive = false,
  autoFocus = false,
  className,
}: ComposerProps) {
  const text = useComposer((s) => s.drafts[draftKey] ?? "");
  const attachments = useComposer((s) => s.attachments[draftKey] ?? EMPTY);
  const mentionKey = useComposer((s) => s.mention[draftKey] ?? null);
  const { setDraft, addAttachments, removeAttachment, setMention, clearDraft } = useComposer.getState();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionFromTyping, setMentionFromTyping] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);

  const mention = mentionKey ? models.find((m) => m.key === mentionKey) : undefined;
  const target = mention ?? model;
  const hasImage = attachments.some((a) => a.kind === "image");
  const imageBlocked = hasImage && target !== undefined && !target.caps.vision && !compareActive;
  const empty = text.trim() === "" && attachments.length === 0;
  const canSend = !empty && !imageBlocked && !sending && target !== undefined;

  // Auto-grow between one and eight lines, then scroll.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24;
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * MAX_LINES)}px`;
  }, [text]);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus, draftKey]);

  // Keep toasts above the composer (§15.11).
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const update = () => root.style.setProperty("--toast-bottom", `${Math.max(24, window.innerHeight - el.getBoundingClientRect().top + 16)}px`);
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      root.style.removeProperty("--toast-bottom");
    };
  }, []);

  const addFiles = async (files: FileList | File[]) => {
    const results = await Promise.all([...files].map(fileToAttachment));
    const ok = results.flatMap((r) => (r.ok ? [r.attachment] : []));
    results.forEach((r) => !r.ok && toast(r.reason, { tone: "danger" }));
    if (ok.length) addAttachments(draftKey, ok);
  };

  const submit = async () => {
    if (streaming || !canSend || !target) return;
    setSending(true);
    const ok = await onSend({ content: text, attachments, modelKey: target.key });
    setSending(false);
    if (ok) clearDraft(draftKey);
    textareaRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const onChange = (value: string, caret: number) => {
    setDraft(draftKey, value);
    // "@" typed at the start of a word opens the model popover (§15.7).
    const typed = value.slice(caret - 1, caret);
    const before = value.slice(caret - 2, caret - 1);
    if (!compareActive && typed === "@" && (caret === 1 || /\s/.test(before)) && value.length > text.length) {
      setMentionFromTyping(caret - 1);
      setMentionQuery("");
      setMentionOpen(true);
    }
  };

  const chooseMention = (key: string) => {
    if (mentionFromTyping !== null && text[mentionFromTyping] === "@") {
      setDraft(draftKey, text.slice(0, mentionFromTyping) + text.slice(mentionFromTyping + 1));
    }
    setMention(draftKey, key);
    setMentionOpen(false);
    setMentionFromTyping(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
  };

  return (
    <Popover
      open={mentionOpen}
      onOpenChange={(open) => {
        setMentionOpen(open);
        if (!open) {
          setMentionFromTyping(null);
          requestAnimationFrame(() => textareaRef.current?.focus());
        }
      }}
    >
      <PopoverAnchor asChild>
        <div
          ref={cardRef}
          data-testid="composer"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex w-full flex-col gap-2 rounded-card border bg-raised px-4 pt-3 pb-2 transition-colors duration-150",
            "focus-within:border-accent-ring",
            dragging ? "border-accent-ring" : "border-border",
            className,
          )}
        >
          {(attachments.length > 0 || mention) && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {attachments.map((a, i) => (
                <AttachmentPreview key={`${a.name}-${i}`} attachment={a} onRemove={() => removeAttachment(draftKey, i)} />
              ))}
              {mention && (
                <span className="inline-flex h-8 items-center gap-2 rounded-control bg-active pr-1 pl-1 text-label text-fg">
                  <ModelAvatar name={mention.name} vendor={mention.vendor} />
                  <span className="max-w-48 truncate">{mention.name}</span>
                  <span className="text-meta text-muted">for this message</span>
                  <button
                    type="button"
                    aria-label="Remove model override"
                    onClick={() => setMention(draftKey, null)}
                    className={cn("inline-flex size-6 items-center justify-center rounded-control text-muted hover:bg-hover hover:text-fg", focusRing)}
                  >
                    <Icon icon={X} size="sm" />
                  </button>
                </span>
              )}
            </div>
          )}
          {imageBlocked && target && (
            <p role="alert" className="text-meta text-danger-text">
              {target.name} can't read images. Choose a model with image support, or remove the image.
            </p>
          )}
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            className="w-full resize-none bg-transparent py-1 text-body text-fg outline-none placeholder:text-faint"
          />
          <div className="flex items-center gap-1">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <IconButton label="Attach files or images" icon={<Icon icon={Plus} size="md" />} onClick={() => fileRef.current?.click()} />
            <IconButton
              label="Choose a model for this message"
              icon={<Icon icon={AtSign} size="md" />}
              variant={mention ? "active" : "ghost"}
              disabled={compareActive}
              tooltip={compareActive ? "Each compare column uses its own model" : undefined}
              onClick={() => {
                setMentionFromTyping(null);
                setMentionQuery("");
                setMentionOpen(true);
              }}
            />
            <ChatSettingsPopover
              settings={settings}
              onChange={onSettingsChange}
              supportsReasoning={Boolean(target?.caps.reasoning)}
              modelName={target?.name ?? "This model"}
            />
            <div className="flex-1" />
            <IconButton label="Voice input" tooltip="Coming soon" icon={<Icon icon={Mic} size="md" />} disabled />
            {streaming ? (
              <IconButton
                label="Stop generating"
                variant="filled"
                icon={<Icon icon={Square} size="xs" fill="currentColor" strokeWidth={0} />}
                onClick={onStop}
              />
            ) : (
              <IconButton
                label="Send message"
                variant="filled"
                icon={<Icon icon={ArrowUp} size="md" strokeWidth={2.25} />}
                disabled={!canSend}
                loading={sending}
                onClick={() => void submit()}
              />
            )}
          </div>
        </div>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        className="w-[min(var(--dialog-wide),calc(100vw-2rem))] overflow-hidden p-0"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <ModelPickerList
          models={models}
          favorites={favorites}
          selectedKey={mentionKey}
          query={mentionQuery}
          onQueryChange={setMentionQuery}
          onSelect={chooseMention}
          unavailableReason={hasImage ? (m) => (m.caps.vision ? null : "Can't read images") : undefined}
          listClassName="max-h-[min(20rem,45vh)]"
        />
      </PopoverContent>
    </Popover>
  );
}
