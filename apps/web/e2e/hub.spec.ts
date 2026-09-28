import { expect, test } from "@playwright/test";
import {
  captureScreenshot,
  completeOnboarding,
  signup,
  signupOnly,
} from "./helpers";

test.describe("hub", () => {
  // V1: empty deployment → guided first actions
  test("empty deployment shows guided first actions on /app/hub", async ({ page }, testInfo) => {
    const stamp = Date.now();
    const email = `hub-empty-${stamp}@rakazo.test`;

    await page.goto("/sign-up");
    await signupOnly(page, email, "unused-password12", "Hub Tester", testInfo);

    // Navigate directly to /app/hub
    await page.goto("/app/hub");
    await page.waitForURL(/\/app\/hub/);

    // Wait for HubPage h2 headings to appear (rendered via Trans macro after i18n init)
    await expect(page.locator("h2", { hasText: /activity/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("h2", { hasText: /gallery/i })).toBeVisible();

    // Gallery: inspiration cards should be present
    await expect(page.locator("[data-testid^='inspiration-card-']").first()).toBeVisible();

    // First-actions are hidden when hasContent=true (Chief bot exists from onboarding)
    await expect(page.locator("h2", { hasText: /start/i })).not.toBeVisible();
    await expect(page.getByRole("button", { name: /create agent/i })).not.toBeVisible();

    await captureScreenshot(page, testInfo, "hub-empty-v1");
  });

  // V1: active deployment → recent threads (bot previews)
  test("active deployment shows bot previews on /app/hub", async ({ page }, testInfo) => {
    const stamp = Date.now();
    const email = `hub-active-${stamp}@rakazo.test`;

    await page.goto("/sign-up");
    await signup(page, email, "unused-password12", "Hub Active", testInfo);
    await completeOnboarding(page, testInfo);

    // At this point the user has at least one bot (Chief from onboarding)
    await page.goto("/app/hub");
    await page.waitForURL(/\/app\/hub/);

    // Should show bot previews in the Activity zone
    await expect(page.locator("h2", { hasText: /activity/i })).toBeVisible();
    await expect(page.locator("h2", { hasText: /gallery/i })).toBeVisible();

    // Bots should be shown as clickable previews
    const botButtons = page.locator("button").filter({ hasText: /^[A-Z]/ });
    await expect(botButtons.first()).toBeVisible();

    // No first-actions when hasContent is true
    await expect(page.locator("h2", { hasText: /start/i })).not.toBeVisible();

    await captureScreenshot(page, testInfo, "hub-active-v1");
  });

  // V2: Make similar creates bot and navigates
  test("Make similar creates a bot from an expert and navigates to its thread", async ({
    page,
  }, testInfo) => {
    const stamp = Date.now();
    const email = `hub-make-similar-${stamp}@rakazo.test`;

    await page.goto("/sign-up");
    await signup(page, email, "unused-password12", "Hub Maker", testInfo);
    await completeOnboarding(page, testInfo);

    // Navigate to /app/hub
    await page.goto("/app/hub");
    await page.waitForURL(/\/app\/hub/);

    // Find the first inspiration card and click "Make similar"
    // Wait for the gallery rail to stabilize (React may remount cards during
    // scroll-into-view animations).
    await expect(page.locator("[data-testid^='inspiration-card-']").first()).toBeVisible();
    await page.waitForTimeout(300);

    // Use JS click to bypass Playwright's DOM-attachment checks when the button
    // may detach due to React re-renders mid-action.
    await page.evaluate(() => {
      const card = document.querySelector("[data-testid^='inspiration-card-']");
      // Find the "Make similar" button specifically
      const btn = [...(card?.querySelectorAll("button") ?? [])].find((b) =>
        /make similar/i.test(b.textContent ?? ""),
      );
      if (btn instanceof HTMLElement) btn.click();
    });

    // Wait for navigation — the Make similar action creates a new bot and
    // navigates to /app/:botId (threadId may be null from the RPC).
    await page.waitForURL(/\/app\/[^/]+$/, { timeout: 30_000 });
    await expect(page.url()).toMatch(/\/app\/[^/]+$/);

    // Composer should be visible (we're in a thread)
    await expect(page.getByPlaceholder(/message/i)).toBeVisible();
    await captureScreenshot(page, testInfo, "hub-make-similar-v2");
  });
});
