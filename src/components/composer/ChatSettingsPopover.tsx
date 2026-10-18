// Per-chat settings popover behind the composer's sliders icon (§15.7, §11.9): system prompt,
// temperature, max tokens and reasoning effort. Edits apply when the popover closes.
import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { ChatSettings, ReasoningEffort } from "@/lib/bindings";

interface Props {
  settings: ChatSettings;
  onChange: (settings: ChatSettings) => void;
  supportsReasoning: boolean;
  modelName: string;
}

const EMPTY: ChatSettings = { systemPrompt: null, temperature: null, maxTokens: null, reasoningEffort: null };

function isCustomized(s: ChatSettings) {
  return Boolean(s.systemPrompt) || s.temperature != null || s.maxTokens != null || s.reasoningEffort != null;
}

export function ChatSettingsPopover({ settings, onChange, supportsReasoning, modelName }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ChatSettings>(settings);
  const [maxTokensText, setMaxTokensText] = useState(settings.maxTokens?.toString() ?? "");
  const maxTokensError = maxTokensText && !/^\d+$/.test(maxTokensText.trim()) ? "Enter a whole number, or leave it empty." : null;

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setDraft(settings);
      setMaxTokensText(settings.maxTokens?.toString() ?? "");
    } else if (!maxTokensError) {
      const maxTokens = maxTokensText.trim() ? Number(maxTokensText.trim()) : null;
      const result = { ...draft, systemPrompt: draft.systemPrompt?.trim() || null, maxTokens };
      if (JSON.stringify(result) !== JSON.stringify(settings)) onChange(result);
    }
    setOpen(next);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <IconButton
          label="Chat settings"
          variant={isCustomized(settings) ? "active" : "ghost"}
          icon={<Icon icon={SlidersHorizontal} size="md" />}
        />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="flex w-(--popover-width) flex-col gap-4 p-4">
        <div>
          <h3 className="text-title font-semibold">Chat settings</h3>
          <p className="mt-1 text-meta text-muted">Apply to this chat only.</p>
        </div>
        <Field label="System prompt" helper="Instructions the model follows for the whole chat.">
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={3}
              placeholder="You are a helpful assistant."
              value={draft.systemPrompt ?? ""}
              onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
            />
          )}
        </Field>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-label font-medium">Temperature</span>
            <label className="flex items-center gap-2 text-meta text-muted">
              Custom
              <Switch
                aria-label="Use a custom temperature"
                checked={draft.temperature != null}
                onCheckedChange={(on) => setDraft({ ...draft, temperature: on ? 0.7 : null })}
              />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <Slider
              aria-label="Temperature"
              min={0}
              max={2}
              step={0.1}
              disabled={draft.temperature == null}
              value={[draft.temperature ?? 1]}
              onValueChange={([v]) => setDraft({ ...draft, temperature: Math.round(v * 10) / 10 })}
            />
            <span className="w-8 text-right text-meta text-muted tabular-nums">{draft.temperature?.toFixed(1) ?? "—"}</span>
          </div>
          <p className="text-meta text-muted">Lower is more focused, higher is more varied. Off uses the model default.</p>
        </div>
        <Field label="Max tokens" helper="Longest reply allowed. Leave empty for the model default." error={maxTokensError}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              inputMode="numeric"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              placeholder="Default"
              value={maxTokensText}
              onChange={(e) => setMaxTokensText(e.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-label font-medium">Reasoning effort</span>
          <Tabs
            value={draft.reasoningEffort ?? "default"}
            onValueChange={(v) => setDraft({ ...draft, reasoningEffort: v === "default" ? null : (v as ReasoningEffort) })}
          >
            <TabsList className="w-full">
              {["default", "low", "medium", "high"].map((v) => (
                <TabsTrigger key={v} value={v} disabled={!supportsReasoning} className="flex-1 justify-center">
                  {v === "default" ? "Default" : v[0].toUpperCase() + v.slice(1)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {!supportsReasoning && <p className="text-meta text-muted">{modelName} doesn't support reasoning effort.</p>}
        </div>
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            disabled={!isCustomized(draft) && !maxTokensText}
            onClick={() => {
              setDraft(EMPTY);
              setMaxTokensText("");
            }}
          >
            Reset to defaults
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
