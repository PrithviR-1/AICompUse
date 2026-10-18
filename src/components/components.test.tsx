// Component tests: composer behavior, picker grouping/filtering, the virtualized list with a
// 200-message chat (§11.12), the chats flyout, the first-run card and the home screen.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ConversationSummary, Message } from "@/lib/bindings";
import { createMockBackend } from "@/lib/mock/mockBackend";
import { MOCK_MODELS } from "@/lib/mock/fixtures";
import { setBackend } from "@/lib/machiClient";
import { useApp } from "@/stores/app";
import { useComposer } from "@/stores/composer";
import { useModels } from "@/stores/models";
import { splitBlocks } from "./chat/Markdown";
import { MessageList } from "./chat/MessageList";
import type { MessageHandlers } from "./chat/Messages";
import { Composer } from "./composer/Composer";
import { HomeView } from "./home/HomeView";
import { SetupCard } from "./home/SetupCard";
import { ModelPickerList, groupModels } from "./models/ModelPickerList";
import { ChatsFlyout } from "./shell/ChatsFlyout";

const wrap = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>);
const nano = MOCK_MODELS.find((m) => m.id === "gpt-4.1-nano")!;
const vision = MOCK_MODELS.find((m) => m.id === "gpt-4.1")!;
const settings = { systemPrompt: null, temperature: null, maxTokens: null, reasoningEffort: null };

function composer(overrides: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const onSend = vi.fn(() => Promise.resolve(true));
  const onStop = vi.fn();
  wrap(
    <Composer
      draftKey="test"
      placeholder="Start a new chat"
      model={nano}
      models={MOCK_MODELS}
      favorites={[]}
      streaming={false}
      settings={settings}
      onSettingsChange={() => undefined}
      onSend={onSend}
      onStop={onStop}
      {...overrides}
    />,
  );
  return { onSend, onStop, textarea: screen.getByRole("textbox", { name: "Start a new chat" }) };
}

beforeEach(() => {
  useComposer.setState({ drafts: {}, attachments: {}, mention: {}, chatModels: {} });
});

describe("Composer", () => {
  it("disables Send while empty and sends on Enter", async () => {
    const user = userEvent.setup();
    const { onSend, textarea } = composer();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    await user.type(textarea, "Hello there");
    await user.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith({ content: "Hello there", attachments: [], modelKey: nano.key, baseModelKey: nano.key });
    await waitFor(() => expect(textarea).toHaveValue(""));
  });

  it("inserts a newline with Shift+Enter", async () => {
    const user = userEvent.setup();
    const { onSend, textarea } = composer();
    await user.type(textarea, "a{Shift>}{Enter}{/Shift}b");
    expect(textarea).toHaveValue("a\nb");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows Stop while generating", async () => {
    const user = userEvent.setup();
    const { onStop } = composer({ streaming: true });
    await user.click(screen.getByRole("button", { name: "Stop generating" }));
    expect(onStop).toHaveBeenCalled();
  });

  it("blocks images for models without vision with an inline hint", () => {
    useComposer.setState({ attachments: { test: [{ kind: "image", name: "a.png", mime: "image/png", size: 3, data: "data:image/png;base64,AAA" }] } });
    composer();
    expect(screen.getByRole("alert")).toHaveTextContent("GPT-4.1 nano can't read images");
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("allows images for vision models", () => {
    useComposer.setState({ attachments: { test: [{ kind: "image", name: "a.png", mime: "image/png", size: 3, data: "data:image/png;base64,AAA" }] } });
    composer({ model: vision });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
  });

  it("uses an @ model for the next message only", async () => {
    const user = userEvent.setup();
    useComposer.setState({ mention: { test: vision.key } });
    const { onSend, textarea } = composer();
    expect(screen.getByText("for this message")).toBeInTheDocument();
    await user.type(textarea, "Hi{Enter}");
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ modelKey: vision.key, baseModelKey: nano.key }));
    await waitFor(() => expect(screen.queryByText("for this message")).toBeNull());
  });
});

describe("Markdown blocks", () => {
  it("splits at blank lines but keeps fenced code and math together", () => {
    const md = "Intro\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n$$\na\n\nb\n$$\n\n| a | b |\n| - | - |\n| 1 | 2 |";
    const blocks = splitBlocks(md);
    expect(blocks).toHaveLength(4);
    expect(blocks[1]).toContain("const b = 2;");
    expect(blocks[2].startsWith("$$")).toBe(true);
    expect(blocks[3]).toContain("| 1 | 2 |");
  });
});

describe("ModelPickerList", () => {
  it("groups favorites first, then vendors by rank", () => {
    const groups = groupModels(MOCK_MODELS, ["mixroute:kimi-k2.5"]);
    expect(groups[0]).toMatchObject({ heading: "Favorites" });
    expect(groups[1].heading).toBe("OpenAI");
    expect(groups.some((g) => g.heading === "Free")).toBe(false);
  });

  it("filters by name and ID as you type and selects with Enter", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    wrap(<ModelPickerList models={MOCK_MODELS} favorites={[]} onSelect={onSelect} />);
    await user.type(screen.getByPlaceholderText("Search models"), "deepseek");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("DeepSeek V4 Flash");
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("mixroute:deepseek-v4-flash");
  });
});

describe("MessageList", () => {
  it("virtualizes a 200-message conversation", () => {
    // jsdom has no layout: give the scroll viewport a size so the virtualizer can measure.
    const height = vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(600);
    const width = vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(800);
    // Each rendered message measures 120 px tall (the virtualizer reads offsetHeight).
    const rect = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-index") ? 120 : 0;
    });
    const messages: Message[] = Array.from({ length: 200 }, (_, i) => ({
      id: `m${i}`,
      conversationId: "c",
      parentId: i ? `m${i - 1}` : null,
      role: i % 2 ? "assistant" : "user",
      content: `Message number ${i}`,
      modelKey: i % 2 ? nano.key : null,
      status: "complete",
      error: null,
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      elapsedMs: null,
      createdAt: i,
      attachments: [],
    }));
    const handlers: MessageHandlers = {
      onRetry: vi.fn(),
      onRetryWith: vi.fn(),
      onDelete: vi.fn(),
      onEdit: vi.fn(() => Promise.resolve(true)),
      onLink: vi.fn(),
      onOpenSettings: vi.fn(),
    };
    wrap(
      <div style={{ height: 600 }}>
        <MessageList
          conversationId="c"
          path={messages}
          allMessages={messages}
          streaming={{}}
          models={MOCK_MODELS}
          handlers={handlers}
          onSelectBranch={vi.fn()}
          editable
          initialScrollTop={undefined}
          onScrollTopChange={vi.fn()}
        />
      </div>,
    );
    const rendered = document.querySelectorAll("[data-index]").length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(40);
    height.mockRestore();
    width.mockRestore();
    rect.mockRestore();
  });
});

describe("ChatsFlyout", () => {
  const base = {
    status: "ready" as const,
    activeId: null,
    pinned: false,
    onOpenChat: vi.fn(),
    onNewChat: vi.fn(),
    onClose: vi.fn(),
    onTogglePinned: vi.fn(),
    onRetry: vi.fn(),
    onRename: vi.fn(),
    onSetPinned: vi.fn(),
    onExport: vi.fn(),
    onDelete: vi.fn(),
  };

  it("groups chats and filters as you type", async () => {
    const user = userEvent.setup();
    const now = Date.now();
    const chats: ConversationSummary[] = [
      { id: "1", title: "Trip plan", pinned: true, createdAt: now, updatedAt: now },
      { id: "2", title: "SQL help", pinned: false, createdAt: now, updatedAt: now },
    ];
    wrap(<ChatsFlyout {...base} chats={chats} />);
    expect(within(screen.getByRole("region", { name: "Pinned" })).getByText("Trip plan")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Today" })).getByText("SQL help")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Filter chats" }), "sql");
    expect(screen.queryByText("Trip plan")).toBeNull();
    await user.click(screen.getByText("SQL help"));
    expect(base.onOpenChat).toHaveBeenCalledWith("2");
  });

  it("shows an empty state with a New chat button", async () => {
    const user = userEvent.setup();
    wrap(<ChatsFlyout {...base} chats={[]} />);
    expect(screen.getByText("No chats yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New chat" }));
    expect(base.onNewChat).toHaveBeenCalled();
  });
});

describe("SetupCard", () => {
  it("validates and reports the provider's answer inline", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(() => Promise.resolve({ kind: "invalidKey" as const, message: "The provider rejected your API key.", retryAfterMs: null }));
    wrap(<SetupCard hint="Create a key in the Mixroute dashboard." onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: "Test & save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Paste your API key first.");
    await user.type(screen.getByLabelText("Mixroute API key"), "sk-bad");
    await user.click(screen.getByRole("button", { name: "Test & save" }));
    expect(onSave).toHaveBeenCalledWith("sk-bad");
    expect(await screen.findByText("The provider rejected your API key.")).toBeInTheDocument();
  });
});

describe("HomeView", () => {
  it("renders wordmark, chips, composer and the Models row", async () => {
    setBackend(createMockBackend({ seed: false }));
    await act(async () => {
      await useApp.getState().init();
      await useModels.getState().load();
    });
    wrap(<HomeView />);
    expect(screen.getByText("Machi")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Choose a model" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Start a new chat" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Models" })).toBeInTheDocument();
    expect(within(screen.getByTestId("models-row")).getAllByRole("button").length).toBeGreaterThan(5);
  });

  it("shows the setup card instead of the composer on first run", async () => {
    setBackend(createMockBackend({ seed: false, noKey: true }));
    await act(async () => {
      await useApp.getState().init();
    });
    wrap(<HomeView />);
    expect(screen.getByTestId("setup-card")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Start a new chat" })).toBeNull();
  });
});
