// Shared e2e helpers: start the app with a mock-backend configuration and common actions.
import type { Page } from "@playwright/test";

export interface MockOptions {
  theme?: "dark" | "light";
  noKey?: boolean;
  seed?: boolean;
  streamDelayMs?: number;
  firstTokenDelayMs?: number;
}

export async function openApp(page: Page, options: MockOptions = {}) {
  await page.addInitScript((cfg) => {
    (window as unknown as { __MACHI_MOCK__: unknown }).__MACHI_MOCK__ = cfg;
  }, { streamDelayMs: 2, firstTokenDelayMs: 50, ...options });
  await page.goto("/#/");
  await page.waitForSelector(options.noKey ? '[data-testid="setup-card"]' : '[data-testid="composer"] textarea', { timeout: 15_000 });
}

export const modKey = process.platform === "darwin" ? "Meta" : "Control";

export function composer(page: Page) {
  return page.locator('[data-testid="composer"] textarea');
}

/** Sends a message and waits until every reply has finished streaming. */
export async function send(page: Page, text: string, replies = 1) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="message-actions"]').length >= n && !document.querySelector('[aria-busy="true"]'), replies, {
    timeout: 20_000,
  });
}
