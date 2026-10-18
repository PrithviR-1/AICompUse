// Dev-only design-system gallery (§15.12 b): every primitive in every state, in both themes.
// Hover/active/focus are forced with data-force so the states can be reviewed statically.
import { useState, type ReactNode } from "react";
import { ArrowUp, Copy, Pencil, Pin, Plus, Search, Square, Star, Trash, type LucideIcon } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { DialogContent, Dialog, DialogClose } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { ModelAvatar, ProfileAvatar } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToastCard } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";

const STATES = ["default", "hover", "active", "focus", "disabled", "loading"] as const;
type State = (typeof STATES)[number];

function forceProps(state: State) {
  return {
    "data-force": state === "hover" || state === "active" || state === "focus" ? state : undefined,
    disabled: state === "disabled" || undefined,
  };
}

const icon = (node: ReactNode) => node;
const i = (C: LucideIcon) => <Icon icon={C} size="md" />;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-label font-semibold text-muted">{title}</h2>
      {children}
    </section>
  );
}

function StateGrid({ render, states = STATES }: { render: (state: State) => ReactNode; states?: readonly State[] }) {
  return (
    <div className="grid grid-cols-6 items-center gap-3">
      {states.map((s) => (
        <span key={`${s}-label`} className="text-caption text-faint">
          {s}
        </span>
      ))}
      {states.map((s) => (
        <div key={s} className="flex min-h-10 items-center">
          {render(s)}
        </div>
      ))}
    </div>
  );
}

/** A box that contains fixed-position overlays so they render inside the themed panel. */
function OverlayStage({ children, height }: { children: ReactNode; height: string }) {
  return (
    <div className={`relative overflow-hidden rounded-menu border border-dashed border-border [transform:translateZ(0)] ${height}`}>{children}</div>
  );
}

function ThemePanel({ theme }: { theme: "dark" | "light" }) {
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [checked, setChecked] = useState(true);
  return (
    <div ref={setPanel} data-theme={theme} className="flex min-w-0 flex-1 flex-col gap-12 rounded-dialog border border-border bg-bg p-8">
      <h1 className="text-heading font-bold">{theme === "dark" ? "Dark" : "Light"} theme</h1>

      <Section title="Button — primary, secondary, ghost, danger, link">
        {(["primary", "secondary", "ghost", "danger", "link"] as const).map((variant) => (
          <StateGrid
            key={variant}
            render={(s) => (
              <Button variant={variant} size="sm" loading={s === "loading"} {...forceProps(s)}>
                {variant === "danger" ? "Delete" : "Save"}
              </Button>
            )}
          />
        ))}
      </Section>

      <Section title="IconButton with tooltip — ghost, active, filled (send), outline, danger">
        {(["ghost", "active", "filled", "outline", "danger"] as const).map((variant) => (
          <StateGrid
            key={variant}
            render={(s) => (
              <IconButton
                label={variant === "filled" ? "Send" : "Copy"}
                variant={variant}
                loading={s === "loading"}
                showTooltip={false}
                icon={icon(variant === "filled" ? i(ArrowUp) : variant === "danger" ? i(Trash) : i(Copy))}
                {...forceProps(s)}
              />
            )}
          />
        ))}
      </Section>

      <Section title="Input and Textarea">
        <StateGrid
          states={["default", "hover", "focus", "disabled"]}
          render={(s) => <Input placeholder="sk-…" aria-label="Example input" {...forceProps(s)} />}
        />
        <div className="grid grid-cols-2 gap-6">
          <Field label="API key" helper="Stored in the system keychain.">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} defaultValue="sk-live-1234" />}
          </Field>
          <Field label="Base URL" error="The base URL must start with https://.">
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} defaultValue="ftp://x" />}
          </Field>
        </div>
        <Textarea aria-label="Example textarea" placeholder="System prompt" />
      </Section>

      <Section title="Chip — ghost and selected">
        <StateGrid
          states={["default", "hover", "active", "focus", "disabled"]}
          render={(s) => (
            <Chip size="lg" leading={<ModelAvatar name="GPT-4.1" vendor="OpenAI" />} {...forceProps(s)}>
              GPT-4.1
            </Chip>
          )}
        />
        <StateGrid
          states={["default", "hover", "focus", "disabled"]}
          render={(s) => (
            <Chip selected size="lg" leading={<ModelAvatar name="Gemini 2.5 Flash" vendor="Google" />} {...forceProps(s)}>
              Gemini 2.5 Flash
            </Chip>
          )}
        />
        <div className="flex flex-wrap gap-2">
          <Chip selected>All</Chip>
          <Chip>Free</Chip>
          <Chip>Vision</Chip>
          <Chip>Reasoning</Chip>
        </div>
      </Section>

      <Section title="Avatar — 28, 40 and 96 px; one color per vendor">
        <div className="flex flex-wrap items-end gap-4">
          {[
            ["GPT-4.1", "OpenAI"],
            ["Gemini 2.5 Flash", "Google"],
            ["DeepSeek V4 Flash", "DeepSeek"],
            ["Kimi K2.5", "Moonshot"],
            ["Qwen3.6 Flash", "Alibaba"],
            ["MiniMax M2.5", "MiniMax"],
          ].map(([name, vendor]) => (
            <div key={name} className="flex items-end gap-2">
              <ModelAvatar name={name} vendor={vendor} size="sm" />
              <ModelAvatar name={name} vendor={vendor} size="md" />
            </div>
          ))}
          <ModelAvatar name="GPT-4.1" vendor="OpenAI" size="lg" />
          <ProfileAvatar initial="M" />
        </div>
      </Section>

      <Section title="Badge">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">NEW</Badge>
          <Badge>Price unknown</Badge>
          <Badge variant="success">Connected</Badge>
          <Badge variant="danger">Invalid key</Badge>
        </div>
      </Section>

      <Section title="Tabs (segmented), Switch, Slider, Kbd, Spinner">
        <div className="flex flex-wrap items-center gap-6">
          <Tabs defaultValue="dark">
            <TabsList>
              <TabsTrigger value="system">System</TabsTrigger>
              <TabsTrigger value="light" data-force="hover">
                Light
              </TabsTrigger>
              <TabsTrigger value="dark">Dark</TabsTrigger>
              <TabsTrigger value="focus" data-force="focus">
                Focused
              </TabsTrigger>
              <TabsTrigger value="off" disabled>
                Disabled
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-3">
            <Switch aria-label="Off" />
            <Switch aria-label="On" checked={checked} onCheckedChange={setChecked} />
            <Switch aria-label="Focused" data-force="focus" />
            <Switch aria-label="Disabled" disabled checked />
          </div>
          <div className="w-48">
            <Slider aria-label="Temperature" defaultValue={[0.7]} max={2} step={0.1} />
          </div>
          <div className="flex items-center gap-1">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </div>
          <Spinner className="text-muted" />
        </div>
      </Section>

      <Section title="Card and Skeleton (loading)">
        <div className="grid grid-cols-2 gap-6">
          <Card>
            <CardHeader title="Mixroute" description="Required. Used for every model unless a direct key is added." />
            <CardBody>
              <p className="text-label text-muted">Section card content.</p>
            </CardBody>
          </Card>
          <Card className="flex flex-col gap-3 p-6">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="size-24 rounded-tile" />
          </Card>
        </div>
      </Section>

      <Section title="Toast — neutral, success, danger">
        <div className="flex flex-col items-start gap-2">
          <ToastCard toast={{ id: 1, message: "Chat exported to Downloads", tone: "neutral" }} onDismiss={() => undefined} />
          <ToastCard toast={{ id: 2, message: "Key saved", tone: "success" }} />
          <ToastCard
            toast={{ id: 3, message: "Couldn't delete the chat", tone: "danger", action: { label: "Retry", run: () => undefined } }}
          />
        </div>
      </Section>

      <Section title="Tooltip, Popover and Menu (open)">
        <OverlayStage height="h-72">
          {panel && (
            <div className="flex h-full items-start gap-24 p-6">
              <Tooltip content="New chat" side="right" forceOpen>
                <span className="inline-flex">
                  <IconButton label="New chat" showTooltip={false} icon={i(Plus)} />
                </span>
              </Tooltip>
              <Popover open>
                <PopoverTrigger asChild>
                  <Button size="sm">Settings</Button>
                </PopoverTrigger>
                <PopoverContent container={panel} className="w-56 p-4" onOpenAutoFocus={(e) => e.preventDefault()}>
                  <p className="text-label font-medium">Temperature</p>
                  <p className="mt-1 text-meta text-muted">Higher is more creative.</p>
                </PopoverContent>
              </Popover>
              <Menu open modal={false}>
                <MenuTrigger asChild>
                  <Button size="sm" variant="ghost">
                    More
                  </Button>
                </MenuTrigger>
                <MenuContent container={panel} align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
                  <MenuLabel>Chat</MenuLabel>
                  <MenuItem icon={<Icon icon={Pencil} size="sm" />}>Rename</MenuItem>
                  <MenuItem icon={<Icon icon={Pin} size="sm" />}>Pin</MenuItem>
                  <MenuItem icon={<Icon icon={Star} size="sm" />} disabled>
                    Disabled item
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem danger icon={<Icon icon={Trash} size="sm" />}>
                    Delete
                  </MenuItem>
                </MenuContent>
              </Menu>
            </div>
          )}
        </OverlayStage>
      </Section>

      <Section title="Dialog (open, destructive action on the right)">
        <OverlayStage height="h-64">
          {panel && (
            <Dialog open modal={false}>
              <DialogContent
                title="Delete this chat?"
                description="The chat and all of its replies are removed from this device. This can't be undone."
                footer={
                  <>
                    <DialogClose asChild>
                      <Button variant="secondary">Cancel</Button>
                    </DialogClose>
                    <Button variant="danger">Delete</Button>
                  </>
                }
              />
            </Dialog>
          )}
        </OverlayStage>
      </Section>

      <Section title="Composer controls">
        <div className="flex items-center gap-2">
          <IconButton label="Attach" showTooltip={false} icon={i(Plus)} />
          <IconButton label="Search" showTooltip={false} icon={i(Search)} />
          <IconButton label="Send" variant="filled" showTooltip={false} icon={i(ArrowUp)} />
          <IconButton label="Send" variant="filled" disabled showTooltip={false} icon={i(ArrowUp)} />
          <IconButton label="Stop" variant="filled" showTooltip={false} icon={<Icon icon={Square} size="xs" fill="currentColor" strokeWidth={0} />} />
        </div>
      </Section>
    </div>
  );
}

export default function GalleryPage() {
  return (
    <div className="h-full overflow-y-auto bg-bg p-8" data-testid="gallery">
      <div className="mx-auto flex max-w-[110rem] gap-8">
        <ThemePanel theme="dark" />
        <ThemePanel theme="light" />
      </div>
    </div>
  );
}
