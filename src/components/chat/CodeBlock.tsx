// Fenced code block (§15.6): darker surface, 12 px radius, header strip with the language and a
// copy button; Shiki highlighting arrives asynchronously over a plain rendering.
import { memo, useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { focusRing } from "@/components/ui/styles";
import { highlight } from "@/lib/highlight";
import { cn } from "@/lib/utils";
import { useCopy } from "@/hooks/useCopy";

export const CodeBlock = memo(function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, copy] = useCopy();

  useEffect(() => {
    let cancelled = false;
    // Debounce while a reply is still streaming into this block.
    const timer = setTimeout(() => {
      highlight(code, lang)
        .then((result) => !cancelled && setHtml(result))
        .catch(() => !cancelled && setHtml(null));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, lang]);

  return (
    <div className="my-4 overflow-hidden rounded-menu border border-border bg-sunken">
      <div className="flex h-9 items-center justify-between border-b border-border pr-1 pl-4">
        <span className="text-caption font-medium text-muted">{lang || "text"}</span>
        <button
          type="button"
          onClick={() => void copy(code)}
          aria-label={copied ? "Copied" : "Copy code"}
          className={cn("inline-flex h-7 items-center gap-2 rounded-control px-2 text-caption text-muted hover:bg-hover hover:text-fg", focusRing)}
        >
          <Icon icon={copied ? Check : Copy} size="sm" />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {html ? (
        <div className="code-scroll overflow-x-auto px-4 py-3 font-mono text-label leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="overflow-x-auto px-4 py-3 font-mono text-label leading-relaxed text-fg">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
});
