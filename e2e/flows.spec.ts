// End-to-end UI flows on the mock backend: the Phase 0 chat features exercised through the UI.
import { expect, test } from "@playwright/test";
import { composer, modKey, openApp, send } from "./helpers";

test("streaming, stop, retry and branch navigation", async ({ page }) => {
  await openApp(page, { seed: false, streamDelayMs: 25, firstTokenDelayMs: 0 });
  await composer(page).fill("Write a long answer");
  await composer(page).press("Enter");
  const stop = page.getByRole("button", { name: "Stop generating" });
  await expect(stop).toBeVisible();
  await page.waitForTimeout(300);
  await stop.click();
  await expect(page.getByText("Stopped")).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).last().click();
  await expect(page.getByRole("button", { name: "Stop generating" })).toBeVisible();
  await page.getByRole("button", { name: "Stop generating" }).click();
  await expect(page.getByText("2/2")).toBeVisible();
  await page.getByRole("button", { name: "Previous version" }).click();
  await expect(page.getByText("1/2")).toBeVisible();
});

test("@ mention switches the model for one message only", async ({ page }) => {
  await openApp(page, { seed: false });
  await composer(page).fill("@");
  await expect(page.getByPlaceholder("Search models")).toBeFocused();
  await page.keyboard.type("gemini 2.5");
  await page.keyboard.press("Enter");
  await expect(page.getByText("for this message")).toBeVisible();
  await send(page, "Hello");
  await expect(page.locator("article").last()).toContainText("Gemini 2.5 Flash");
  await expect(page.getByRole("button", { name: /Model: GPT-4.1 nano/ })).toBeVisible();
  await send(page, "And again", 2);
  await expect(page.locator("article").last()).toContainText("GPT-4.1 nano");
});

test("switching models mid-chat from the header", async ({ page }) => {
  await openApp(page, { seed: false });
  await send(page, "First question");
  await page.getByRole("button", { name: /Model: GPT-4.1 nano/ }).click();
  await page.getByPlaceholder("Search models").fill("deepseek");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Model: DeepSeek/ })).toBeVisible();
  await send(page, "Follow-up", 2);
  await expect(page.locator("article").last()).toContainText("DeepSeek");
});

test("editing a message creates a branch", async ({ page }) => {
  await openApp(page, { seed: false });
  await send(page, "Tell me a joke");
  await page.locator('[data-role="user"]').hover();
  await page.getByRole("button", { name: "Edit and resend" }).click();
  await page.getByRole("textbox", { name: "Edit message" }).fill("Tell me a pun");
  await page.getByRole("button", { name: "Save and send" }).click();
  await expect(page.locator('[data-role="user"]').getByText("Tell me a pun")).toBeVisible();
  await expect(page.locator('[data-role="user"]').getByText("2/2")).toBeVisible();
});

test("compare mode streams two columns and continues with one", async ({ page }) => {
  await openApp(page, { seed: false });
  await page.getByRole("button", { name: "Compare models" }).click();
  await expect(page.getByRole("group", { name: "Models to compare" })).toBeVisible();
  await send(page, "Compare this", 2);
  await expect(page.getByTestId("compare-view")).toBeVisible();
  await page.getByRole("button", { name: "Continue with this one" }).nth(1).click();
  await expect(page.getByTestId("compare-view")).toHaveCount(0);
  await expect(page.getByTestId("message-list")).toBeVisible();
});

test("chat rename, pin, search and delete", async ({ page }) => {
  await openApp(page, { seed: true });
  await page.getByRole("button", { name: "Chats", exact: true }).click();
  const flyout = page.getByRole("complementary", { name: "Chats" });
  await flyout.getByText("SQL window functions").hover();
  await flyout.getByRole("button", { name: "More actions for SQL window functions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await flyout.getByRole("textbox", { name: "Chat title" }).fill("SQL notes");
  await page.keyboard.press("Enter");
  await expect(flyout.getByText("SQL notes")).toBeVisible();

  await flyout.getByText("SQL notes").hover();
  await flyout.getByRole("button", { name: "More actions for SQL notes" }).click();
  await page.getByRole("menuitem", { name: "Pin" }).click();
  await expect(flyout.getByRole("region", { name: "Pinned" }).getByText("SQL notes")).toBeVisible();

  await page.keyboard.press(`${modKey}+Shift+f`);
  await page.keyboard.type("window functions");
  await expect(page.getByRole("option", { name: /SQL notes/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/chat\/seed-2/);

  await flyout.getByText("SQL notes").hover();
  await flyout.getByRole("button", { name: "More actions for SQL notes" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(flyout.getByText("SQL notes")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/$/);
});

test("first run: saving a key replaces the card with the composer", async ({ page }) => {
  await openApp(page, { seed: false, noKey: true });
  await page.getByLabel("Mixroute API key").fill("short");
  await page.getByRole("button", { name: "Test & save" }).click();
  await expect(page.getByText("The provider rejected your API key.", { exact: false })).toBeVisible();
  await page.getByLabel("Mixroute API key").fill("sk-valid-test-key");
  await page.getByRole("button", { name: "Test & save" }).click();
  await expect(composer(page)).toBeVisible();
});

test("keyboard: rail reachable with Tab, Esc closes the picker, shortcuts dialog", async ({ page }) => {
  await openApp(page, { seed: false });
  // Every rail item is reachable with Tab (§15.11); the composer starts focused.
  const reached = new Set<string>();
  for (let i = 0; i < 40 && reached.size < 9; i++) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
    if (["Machi home", "New chat", "Search chats", "Chats", "Models", "Compare models", "Settings", "Providers and keys"].includes(name)) reached.add(name);
  }
  expect(reached.size).toBeGreaterThanOrEqual(8);
  await page.keyboard.press(`${modKey}+k`);
  await expect(page.getByPlaceholder("Search models")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("Search models")).toHaveCount(0);
  await page.keyboard.press(`${modKey}+/`);
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
});

test("theme setting switches the whole app", async ({ page }) => {
  await openApp(page, { seed: false, theme: "dark" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByRole("tab", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
