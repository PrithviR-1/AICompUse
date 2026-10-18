// Global search (Ctrl/Cmd+Shift+F, §15.3): finds chats by title and message content.
import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { Dialog as RadixDialog } from "radix-ui";
import { MessageSquare, Search } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import type { SearchHit } from "@/lib/bindings";
import { navigate } from "@/lib/router";
import { useChats } from "@/stores/chats";
import { useUi } from "@/stores/ui";

export function SearchPalette() {
  const open = useUi((s) => s.searchOpen);
  const setOpen = useUi((s) => s.setSearchOpen);
  const search = useChats((s) => s.search);
  const recent = useChats((s) => s.list);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ query: string; results: SearchHit[] }>({ query: "", results: [] });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!open || !q) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setBusy(true);
      void search(q).then((results) => {
        if (!cancelled) {
          setHits({ query: q, results });
          setBusy(false);
        }
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, search]);

  const setOpenAndReset = (next: boolean) => {
    if (!next) {
      setQuery("");
      setHits({ query: "", results: [] });
    }
    setOpen(next);
  };

  const go = (id: string) => {
    setOpenAndReset(false);
    navigate({ name: "chat", id });
  };
  const showRecent = !query.trim();
  const items: Array<{ id: string; title: string; snippet?: string }> = showRecent
    ? recent.slice(0, 8).map((c) => ({ id: c.id, title: c.title }))
    : hits.results.map((h) => ({ id: h.conversationId, title: h.title, snippet: h.snippet }));

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpenAndReset}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-overlay animate-fade-in" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="fixed top-[12vh] left-1/2 z-50 w-[min(var(--dialog-wide),calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-dialog border border-border bg-raised shadow-popover outline-none animate-pop-in"
        >
          <RadixDialog.Title className="sr-only">Search chats</RadixDialog.Title>
          <Command label="Search chats" shouldFilter={false} loop>
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Icon icon={Search} size="md" className="text-faint" />
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder="Search chats by title or content"
                className="h-12 flex-1 bg-transparent text-body text-fg outline-none placeholder:text-faint"
              />
              {busy && <Spinner className="text-faint" label="Searching" />}
            </div>
            <Command.List className="max-h-[min(26rem,60vh)] overflow-y-auto p-2">
              {!busy && items.length === 0 && (showRecent || hits.query === query.trim()) && (
                <p className="px-3 py-8 text-center text-label text-muted">{showRecent ? "No chats yet." : `No chats mention "${query.trim()}".`}</p>
              )}
              {items.length > 0 && (
                <Command.Group
                  heading={showRecent ? "Recent chats" : "Results"}
                  className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint"
                >
                  {items.map((item) => (
                    <Command.Item
                      key={item.id}
                      value={item.id}
                      onSelect={() => go(item.id)}
                      className="flex cursor-pointer items-start gap-3 rounded-control px-3 py-2 outline-none data-[selected=true]:bg-hover"
                    >
                      <Icon icon={MessageSquare} size="sm" className="mt-1 text-faint" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-label font-medium text-fg">{item.title}</p>
                        {item.snippet && <p className="line-clamp-2 text-meta text-muted">{item.snippet}</p>}
                      </div>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
