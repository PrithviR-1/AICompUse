// Markdown for assistant replies (§11.5): GFM tables, code blocks, KaTeX math; links open in
// the system browser.
import { memo, useMemo, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./CodeBlock";

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

function components(onLink: (url: string) => void): Components {
  return {
    pre: ({ children }) => <>{children}</>,
    code: ({ className, children, ...props }: ComponentPropsWithoutRef<"code">) => {
      const match = /language-([\w+#-]+)/.exec(className ?? "");
      const text = String(children ?? "");
      if (match || text.includes("\n")) {
        return <CodeBlock code={text.replace(/\n$/, "")} lang={match?.[1]} />;
      }
      return <code {...props}>{children}</code>;
    },
    a: ({ href, children }) => (
      <a
        href={href}
        className="text-accent underline-offset-2 hover:underline"
        onClick={(e) => {
          e.preventDefault();
          if (href && /^(https?:|mailto:)/i.test(href)) onLink(href);
        }}
      >
        {children}
      </a>
    ),
    table: ({ children }) => (
      <div className="my-4 max-h-[28rem] overflow-auto rounded-menu border border-border">
        <table className="w-full border-collapse text-label">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="sticky top-0 bg-raised">{children}</thead>,
    th: ({ children, style }) => (
      <th style={style} className="border-b border-border px-3 py-2 text-left font-semibold text-fg">
        {children}
      </th>
    ),
    td: ({ children, style }) => (
      <td style={style} className="border-b border-border px-3 py-2 align-top text-fg">
        {children}
      </td>
    ),
  };
}

/**
 * Splits Markdown into top-level blocks at blank lines outside code fences and $$ math, so a
 * streaming reply only re-parses its last block (finished blocks are memoized).
 */
export function splitBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  let math = false;
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fence) {
      if (fenceMatch && trimmed.startsWith(fence)) fence = null;
    } else if (fenceMatch) {
      fence = fenceMatch[1];
    } else if (trimmed === "$$") {
      math = !math;
    }
    if (!fence && !math && trimmed === "" && current.length > 0) {
      blocks.push(current.join("\n"));
      current = [];
      continue;
    }
    if (trimmed !== "" || current.length > 0) current.push(line);
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}

const MarkdownBlock = memo(function MarkdownBlock({ content, components: c }: { content: string; components: Components }) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={c}>
      {content}
    </ReactMarkdown>
  );
});

interface MarkdownProps {
  content: string;
  onLink: (url: string) => void;
  className?: string;
}

export const Markdown = memo(function Markdown({ content, onLink, className }: MarkdownProps) {
  const rendered = useMemo(() => components(onLink), [onLink]);
  const blocks = useMemo(() => splitBlocks(content), [content]);
  return (
    <div className={cn("markdown text-body leading-(--line-height-message) text-fg", className)}>
      {blocks.map((block, i) => (
        <MarkdownBlock key={i} content={block} components={rendered} />
      ))}
    </div>
  );
});
