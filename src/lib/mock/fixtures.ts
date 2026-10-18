// Fixtures for the mock backend (browser dev server, Vitest, Playwright). They mirror the
// shape of real data; the desktop app always gets models from the Rust catalog instead.
import type { ModelInfo } from "../bindings";
import fixtureModels from "./models.fixture.json";

/**
 * Models for the mock backend, produced by the real Rust catalog merge
 * (`cargo run -p machi-core --example export_model_fixture`), so they can't drift from the app.
 */
export const MOCK_MODELS = fixtureModels as ModelInfo[];

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
