// Far-left icon rail (§15.3): icons only, tooltips to the right, active item filled.
import type { ReactNode } from "react";
import { Columns2, Compass, MessageSquare, Search, Settings, SquarePen, type LucideIcon } from "lucide-react";
import { ProfileAvatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icon";
import { focusRing, transition } from "@/components/ui/styles";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { MachiMark } from "./MachiMark";

interface RailActions {
  onHome: () => void;
  onNewChat: () => void;
  onSearch: () => void;
  onToggleChats: () => void;
  onModels: () => void;
  onCompare: () => void;
  onSettings: () => void;
  onProfile: () => void;
}

interface RailState {
  chatsOpen: boolean;
  modelsActive: boolean;
  compareActive: boolean;
  settingsActive: boolean;
}

function RailButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={label} side="right">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          "inline-flex size-10 items-center justify-center rounded-control active:scale-95",
          active ? "bg-active text-fg" : "text-muted hover:bg-hover hover:text-fg",
          focusRing,
          transition,
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

const railIcon = (icon: LucideIcon) => <Icon icon={icon} size="lg" />;

export function IconRail({ actions, state }: { actions: RailActions; state: RailState }) {
  return (
    <nav aria-label="Main" className="flex h-full w-(--rail-width) shrink-0 flex-col items-center border-r border-border bg-rail py-3">
      <div className="flex flex-col items-center gap-2">
        <Tooltip content="Machi home" side="right">
          <button
            type="button"
            aria-label="Machi home"
            onClick={actions.onHome}
            className={cn("mb-2 inline-flex size-10 items-center justify-center rounded-control hover:opacity-90", focusRing)}
          >
            <MachiMark />
          </button>
        </Tooltip>
        <RailButton label="New chat" onClick={actions.onNewChat}>
          {railIcon(SquarePen)}
        </RailButton>
        <RailButton label="Search chats" onClick={actions.onSearch}>
          {railIcon(Search)}
        </RailButton>
        <div role="separator" className="my-1 h-px w-8 bg-border" />
        <RailButton label="Chats" active={state.chatsOpen} onClick={actions.onToggleChats}>
          {railIcon(MessageSquare)}
        </RailButton>
        <RailButton label="Models" active={state.modelsActive} onClick={actions.onModels}>
          {railIcon(Compass)}
        </RailButton>
        <RailButton label="Compare models" active={state.compareActive} onClick={actions.onCompare}>
          {railIcon(Columns2)}
        </RailButton>
      </div>
      <div className="mt-auto flex w-full flex-col items-center gap-2 border-t border-border pt-3">
        <RailButton label="Settings" active={state.settingsActive} onClick={actions.onSettings}>
          {railIcon(Settings)}
        </RailButton>
        <Tooltip content="Providers and keys" side="right">
          <button
            type="button"
            aria-label="Providers and keys"
            onClick={actions.onProfile}
            className={cn("inline-flex size-10 items-center justify-center rounded-full hover:opacity-90", focusRing)}
          >
            <ProfileAvatar initial="M" />
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}
