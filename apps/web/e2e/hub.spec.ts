import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, otpFromEmulator, signup } from "./helpers";

test.describe("hub", () => {
  // V1: empty deployment → guided first actions
  test("empty deployment shows guided first actions on /app/hub", async ({ page }, testInfo) => {
    const stamp = Date.now();
    const email = `hub-empty-${stamp}@rakazo.test`;

    await page.goto("/sign-up");
    await signup(page, email, "unused-password12", "Hub Tester", testInfo);
    await completeOnboarding(page, testInfo);

    // Navigate directly to /app/hub
    await page.goto("/app/hub");
    await page.waitForURL(/\/app\/hub/);

    // Should show Activity, Gallery, and First-actions sections
    await expect(page.getByRole("heading", { name: /activity/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /gallery/i })).toBeVisible();
    // First-actions: create agent button
    await expect(page.getByRole("button", { name: /create agent/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /connect model/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /connect telegram/i })).toBeVisible();

    // Gallery: inspiration cards
    await expect(page.locator("[data-testid^='inspiration-card-']").first()).toBeVisible();
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
    await expect(page.getByRole("heading", { name: /activity/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /gallery/i })).toBeVisible();

    // Bots should be shown as clickable previews
    const botButtons = page.locator("button").filter({ hasText: /^[A-Z]/ });
    await expect(botButtons.first()).toBeVisible();

    // No first-actions when hasContent is true
    await expect(page.getByRole("button", { name: /create agent/i })).not.toBeVisible();

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
    const firstCard = page.locator("[data-testid^='inspiration-card-']").first();
    await expect(firstCard).toBeVisible();

    const makeSimilarBtn = firstCard.getByRole("button", { name: /make similar/i });
    await makeSimilarBtn.click();

    // Should navigate to a bot's thread
    await page.waitForURL(/\/app\/[^/]+\/[^/]+$/, { timeout: 15_000 });
    await expect(page.url()).toMatch(/\/app\/[^/]+\/[^/]+$/);

    // Composer should be visible (we're in a thread)
    await expect(page.getByPlaceholder(/message/i)).toBeVisible();
    await captureScreenshot(page, testInfo, "hub-make-similar-v2");
  });
});
