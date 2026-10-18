// §15.12 visual verification: every listed state at 1280×820 in dark and light, saved to
// docs/screenshots/ for review against §15.0–§15.11.
import { expect, test, type Page } from "@playwright/test";
import { modKey, openApp, send } from "./helpers";

const DIR = "docs/screenshots";

async function shoot(page: Page, name: string) {
  await page.mouse.move(2, 400);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${DIR}/${name}.png`, animations: "disabled", caret: "hide" });
}

for (const theme of ["dark", "light"] as const) {
  test.describe(`${theme} theme`, () => {
    test("home (empty)", async ({ page }) => {
      await openApp(page, { theme, seed: false });
      await page.locator('[data-testid="composer"] textarea').blur();
      await expect(page.getByRole("heading", { name: "Models" })).toBeVisible();
      await shoot(page, `home-empty-${theme}`);
    });

    test("home (first-run key card)", async ({ page }) => {
      await openApp(page, { theme, seed: false, noKey: true });
      await expect(page.getByText("Connect Mixroute to start chatting")).toBeVisible();
      await shoot(page, `home-first-run-${theme}`);
    });

    test("chat with a streamed answer (code block and table)", async ({ page }) => {
      await openApp(page, { theme, seed: false });
      await send(page, "How do I debounce a function in TypeScript?");
      await expect(page.locator(".markdown table")).toBeVisible();
      await expect(page.locator(".code-scroll")).toBeVisible();
      await page.locator('[data-testid="message-list"]').evaluate((el) => (el.scrollTop = 0));
      await page.locator('[data-testid="composer"] textarea').blur();
      await shoot(page, `chat-streamed-answer-${theme}`);
    });

    test("chat with an error", async ({ page }) => {
      await openApp(page, { theme, seed: false });
      await send(page, "Why does this hit a rate limit?");
      await expect(page.getByTestId("error-card")).toBeVisible();
      await page.locator('[data-testid="composer"] textarea').blur();
      await shoot(page, `chat-error-${theme}`);
    });

    test("chats flyout open", async ({ page }) => {
      await openApp(page, { theme, seed: true });
      await page.getByRole("button", { name: "Chats", exact: true }).click();
      await expect(page.getByRole("complementary", { name: "Chats" })).toBeVisible();
      await shoot(page, `chats-flyout-${theme}`);
    });

    test("models page", async ({ page }) => {
      await openApp(page, { theme, seed: false });
      await page.getByRole("button", { name: "Models", exact: true }).click();
      await expect(page.getByTestId("model-card").first()).toBeVisible();
      await shoot(page, `models-page-${theme}`);
    });

    test("settings → providers", async ({ page }) => {
      await openApp(page, { theme, seed: false });
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Providers", level: 2, exact: true })).toBeVisible();
      await shoot(page, `settings-providers-${theme}`);
    });

    test("model picker open", async ({ page }) => {
      await openApp(page, { theme, seed: false });
      await page.keyboard.press(`${modKey}+k`);
      await expect(page.getByPlaceholder("Search models")).toBeFocused();
      await shoot(page, `model-picker-${theme}`);
    });
  });
}

test("design-system gallery", async ({ page }) => {
  await page.setViewportSize({ width: 2200, height: 3600 });
  await page.goto("/#/gallery");
  await expect(page.getByTestId("gallery")).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/gallery.png`, animations: "disabled", caret: "hide" });
});

test.describe("minimum window 960×620 and 200% text", () => {
  test("home and chat do not overflow horizontally", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 620 });
    await openApp(page, { theme: "dark", seed: false });
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(await overflow()).toBe(false);
    await shoot(page, "min-window-home-dark");
    await send(page, "How do I debounce a function in TypeScript?");
    expect(await overflow()).toBe(false);
    await shoot(page, "min-window-chat-dark");
  });

  test("200% text keeps the layout usable", async ({ page }) => {
    await openApp(page, { theme: "dark", seed: false });
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await expect(page.locator('[data-testid="composer"] textarea')).toBeVisible();
    await shoot(page, "text-200-home-dark");
  });
});
