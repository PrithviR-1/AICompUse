// Read-only keyboard shortcut list (Ctrl/Cmd+/, Settings → About) (§11.9, §11.10).
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { SHORTCUTS, shortcutKeys } from "@/lib/shortcuts";
import { useApp } from "@/stores/app";
import { useUi } from "@/stores/ui";

export function ShortcutList() {
  const modifier = useApp((s) => s.platform.modifierLabel);
  return (
    <dl className="flex flex-col">
      {SHORTCUTS.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-b-0">
          <dt className="text-label text-fg">{s.label}</dt>
          <dd className="flex items-center gap-1">
            {shortcutKeys(s, modifier).map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  const setOpen = useUi((s) => s.setShortcutsOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Keyboard shortcuts" wide>
        <ShortcutList />
      </DialogContent>
    </Dialog>
  );
}
