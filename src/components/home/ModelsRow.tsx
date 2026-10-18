// Home "Models" section (§15.5 item 4): heading, "See all", and a scroll-snapping row of large
// tiles with chevrons that page the row.
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ModelAvatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { Skeleton } from "@/components/ui/skeleton";
import { focusRing, transition } from "@/components/ui/styles";
import type { ModelInfo } from "@/lib/bindings";
import { cn } from "@/lib/utils";

interface ModelsRowProps {
  models: ModelInfo[];
  status: "idle" | "loading" | "ready" | "error";
  onSelect: (key: string) => void;
  onSeeAll: () => void;
  onRetry: () => void;
}

function Tile({ model, onSelect }: { model: ModelInfo; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={model.name}
      className={cn("group flex w-28 shrink-0 snap-start flex-col items-center gap-2 rounded-tile p-2 hover:bg-hover active:scale-[0.98]", focusRing, transition)}
    >
      <span className="relative">
        <ModelAvatar name={model.name} vendor={model.vendor} size="lg" className="rounded-tile" />
        {model.isNew && <Badge variant="outline" className="absolute -top-2 left-1/2 -translate-x-1/2">NEW</Badge>}
      </span>
      <span className="line-clamp-2 w-full text-center text-label font-medium text-fg">{model.name}</span>
    </button>
  );
}

export function ModelsRow({ models, status, onSelect, onSeeAll, onRetry }: ModelsRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const update = () => {
      setCanLeft(row.scrollLeft > 4);
      setCanRight(row.scrollLeft + row.clientWidth < row.scrollWidth - 4);
    };
    update();
    row.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(row);
    return () => {
      row.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [models.length, status]);

  const page = (dir: 1 | -1) => rowRef.current?.scrollBy({ left: dir * rowRef.current.clientWidth * 0.85, behavior: "smooth" });

  return (
    <section aria-labelledby="models-heading" className="flex w-full flex-col gap-4">
      <div className="flex items-baseline justify-between px-2">
        <h2 id="models-heading" className="text-heading font-bold text-fg">
          Models
        </h2>
        <Button variant="link" onClick={onSeeAll} className="text-label font-medium">
          See all
        </Button>
      </div>
      {status === "error" && models.length === 0 ? (
        <div className="flex h-36 items-center gap-3 px-2">
          <p className="text-label text-muted">Models couldn't be loaded.</p>
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="relative">
          <div ref={rowRef} className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth [scrollbar-width:none]" data-testid="models-row">
            {status !== "ready" && models.length === 0
              ? Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="flex w-28 shrink-0 flex-col items-center gap-2 p-2">
                    <Skeleton className="size-24 rounded-tile" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))
              : models.map((m) => <Tile key={m.key} model={m} onSelect={() => onSelect(m.key)} />)}
          </div>
          {canLeft && (
            <IconButton
              label="Scroll models left"
              variant="outline"
              size="lg"
              icon={<Icon icon={ChevronLeft} size="md" />}
              onClick={() => page(-1)}
              className="absolute top-12 left-0 -translate-x-1/2 -translate-y-1/2"
            />
          )}
          {canRight && (
            <IconButton
              label="Scroll models right"
              variant="outline"
              size="lg"
              icon={<Icon icon={ChevronRight} size="md" />}
              onClick={() => page(1)}
              className="absolute top-12 right-0 translate-x-1/2 -translate-y-1/2"
            />
          )}
        </div>
      )}
    </section>
  );
}
