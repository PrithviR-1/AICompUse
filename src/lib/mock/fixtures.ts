// Fixtures for the mock backend (browser dev server, Vitest, Playwright). They mirror the
// shape of real data; the desktop app always gets models from the Rust catalog instead.
import type { ModelCaps, ModelInfo, ProviderId } from "../bindings";

const caps = (c: Partial<ModelCaps>): ModelCaps => ({
  vision: false,
  tools: false,
  structuredOutput: false,
  reasoning: false,
  fileInput: false,
  ...c,
});

function model(
  id: string,
  name: string,
  vendor: string,
  rank: number | null,
  price: [number, number] | null,
  context: number | null,
  c: Partial<ModelCaps>,
  extra: Partial<ModelInfo> = {},
): ModelInfo {
  const provider: ProviderId = "mixroute";
  const modelCaps = caps(c);
  return {
    key: `${provider}:${id}`,
    id,
    provider,
    name,
    vendor,
    contextWindow: context,
    inputPrice: price ? price[0] : null,
    outputPrice: price ? price[1] : null,
    free: false,
    caps: modelCaps,
    rank,
    seeded: true,
    isNew: false,
    agentEligible: modelCaps.tools || modelCaps.structuredOutput,
    ...extra,
  };
}

export const MOCK_MODELS: ModelInfo[] = [
  model("gpt-4.1", "GPT-4.1", "OpenAI", 1, null, 1047576, { vision: true, tools: true }),
  model("gemini-2.5-flash", "Gemini 2.5 Flash", "Google", 2, [0.3, 2.5], 1048576, { vision: true, tools: true, structuredOutput: true, reasoning: true }),
  model("deepseek-v4-flash", "DeepSeek V4 Flash", "DeepSeek", 4, [0.14, 0.28], 1000000, { tools: true, reasoning: true }),
  model("kimi-k2.5", "Kimi K2.5", "Moonshot", 5, [0.6, 3.0], 256000, { vision: true, tools: true, reasoning: true }),
  model("qwen3.6-flash", "Qwen3.6 Flash", "Alibaba", 7, [0.25, 1.5], null, { vision: true, tools: true }),
  model("gemini-3.5-flash-lite", "Gemini 3.5 Flash Lite", "Google", 8, [0.3, 1.2], 1000000, { vision: true, tools: true }, { isNew: true }),
  model("MiniMax-M2.5", "MiniMax M2.5", "MiniMax", 9, [0.3, 1.2], null, { tools: true }),
  model("gpt-4.1-mini", "GPT-4.1 mini", "OpenAI", 10, null, 1047576, { tools: true }),
  model("gpt-4o-mini", "GPT-4o mini", "OpenAI", 11, null, 128000, { vision: true, tools: true }),
  model("gpt-4.1-nano", "GPT-4.1 nano", "OpenAI", 12, null, 1047576, { tools: true }),
  model("gpt-5-nano", "GPT-5 nano", "OpenAI", 13, [0.05, 0.4], 400000, { tools: true, reasoning: true }),
  model("gpt-4o-2024-11-20", "GPT-4o (Nov 2024)", "OpenAI", 14, null, 128000, { vision: true, tools: true }),
  model("gpt-5", "GPT-5", "OpenAI", 20, [1.25, 10], 400000, { tools: true, reasoning: true }),
  model("gpt-5-mini", "GPT-5 mini", "OpenAI", 21, [0.25, 2], 400000, { tools: true, reasoning: true }),
];

export const MOCK_DEFAULT_MODEL = "mixroute:gpt-4.1-nano";

/** A multi-paragraph answer with a code block and a table (the §15.12 screenshot state). */
export const RICH_ANSWER = `Here's a compact way to debounce a function in TypeScript. Debouncing delays a call until the input has been quiet for a moment, which keeps search boxes and resize handlers from doing work on every keystroke.

The version below keeps the latest arguments, clears the pending timer on each call, and returns a \`cancel\` method so a component can clean up when it unmounts.

\`\`\`ts
export function debounce<A extends unknown[]>(fn: (...args: A) => void, waitMs = 250) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}
\`\`\`

Choosing the wait time depends on what the user is doing:

| Use case | Typical wait | Why |
| --- | --- | --- |
| Search as you type | 200–300 ms | Feels instant, skips most keystrokes |
| Window resize | 100–150 ms | Layout should catch up quickly |
| Autosave | 1–2 s | Fewer writes while someone is still typing |

If you need the first call to run immediately, use a *leading-edge* debounce instead, or a throttle when you want a steady rate such as one update every $\\frac{1}{60}$ of a second.`;

const SHORT_ANSWERS = [
  "Sure. Here's a short summary of the main points, with the trade-offs called out so you can decide quickly.",
  "Good question. The short answer is yes, as long as the inputs are validated first. Here's why that matters.",
];

interface SeedChat {
  title: string;
  ageDays: number;
  pinned?: boolean;
  prompt: string;
  answer: string;
  model: string;
}

export const SEED_CHATS: SeedChat[] = [
  { title: "Debounce helper in TypeScript", ageDays: 0, prompt: "How do I debounce a function in TypeScript?", answer: RICH_ANSWER, model: "mixroute:gpt-4.1" },
  { title: "Weekend trip to the coast", ageDays: 0, pinned: true, prompt: "Plan a relaxed weekend trip to the coast.", answer: SHORT_ANSWERS[0], model: "mixroute:gemini-2.5-flash" },
  { title: "SQL window functions", ageDays: 1, prompt: "Explain SQL window functions with an example.", answer: SHORT_ANSWERS[1], model: "mixroute:deepseek-v4-flash" },
  { title: "Cover letter feedback", ageDays: 4, prompt: "Can you review my cover letter?", answer: SHORT_ANSWERS[0], model: "mixroute:gpt-4.1" },
  { title: "Rust lifetimes, explained simply", ageDays: 12, prompt: "Explain Rust lifetimes simply.", answer: SHORT_ANSWERS[1], model: "mixroute:kimi-k2.5" },
  { title: "Sourdough schedule", ageDays: 45, prompt: "Give me a sourdough baking schedule.", answer: SHORT_ANSWERS[0], model: "mixroute:qwen3.6-flash" },
];
