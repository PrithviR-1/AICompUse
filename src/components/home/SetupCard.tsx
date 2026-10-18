// First-run card (§11.3, §15.5 item 5): explanation, key field, "Test & save", plain-text hint.
import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import type { ErrorInfo } from "@/lib/bindings";

interface SetupCardProps {
  hint: string;
  onSave: (key: string) => Promise<ErrorInfo | null>;
}

export function SetupCard({ hint, onSave }: SetupCardProps) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim()) {
      setError("Paste your API key first.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await onSave(key.trim());
    setBusy(false);
    if (result) setError(result.message);
  };

  return (
    <form onSubmit={submit} data-testid="setup-card" className="flex w-full flex-col gap-4 rounded-card border border-border bg-raised p-6">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-control bg-active text-muted">
          <Icon icon={KeyRound} size="md" />
        </span>
        <div>
          <h2 className="text-title font-semibold text-fg">Connect Mixroute to start chatting</h2>
          <p className="mt-1 text-label text-muted">
            Machi reaches every model through your Mixroute key. It's stored in your system keychain and never leaves this device except to call Mixroute.
          </p>
        </div>
      </div>
      <Field label="Mixroute API key" helper={hint} error={error}>
        {({ id, describedBy, invalid }) => (
          <div className="flex gap-2">
            <Input
              id={id}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-…"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setError(null);
              }}
            />
            <Button type="submit" variant="primary" size="lg" loading={busy}>
              Test & save
            </Button>
          </div>
        )}
      </Field>
    </form>
  );
}
