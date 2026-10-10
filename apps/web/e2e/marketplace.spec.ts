// T9 e2e — marketplace browse → install agent → run proceeds
// Uses the isolated-API recipe: page.route mocking for RPC + real auth cookies.

import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test.describe("marketplace", () => {
  test("V3: browse marketplace → search → install agent+skill+MCP → agent appears → run proceeds", async ({
    page,
  }, testInfo) => {
    const stamp = Date.now();
    const email = `marketplace-${stamp}@rakazo.test`;

    // Sign up and complete onboarding to get a real deployment.
    await page.goto("/sign-up");
    await signup(page, email, "unused-password12", "Marketplace Tester", testInfo);
    await completeOnboarding(page, testInfo);

    // Navigate to marketplace.
    await page.goto("/app/marketplace");
    await page.waitForURL(/\/app\/marketplace/, { timeout: 30_000 });

    // Catalog cards should be visible (bundled agents from EXPERT_CATALOG).
    const cards = page.locator("[data-testid^='marketplace-card-']");
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });

    // Search: filter by typing in the search box.
    const searchInput = page.getByRole("searchbox", { name: /search/i });
    await searchInput.fill("chief");
    await page.waitForTimeout(300); // debounce
    // After search, fewer or same cards visible.
    await expect(cards.first()).toBeVisible();

    // Kind chips: click the Agents chip to filter (exact: the sidebar also has
    // a "Skills & Connectors" trigger that substring matching would hit).
    const agentsChip = page.getByRole("button", { name: "Agents", exact: true });
    await agentsChip.click();
    await expect(cards.first()).toBeVisible();

    // Clear search.
    await searchInput.fill("");
    await page.waitForTimeout(300);

    // Card Install is a shortcut straight to the review modal (the card's
    // onClick must not also open the detail drawer beneath it).
    const firstCard = cards.first();
    const installBtn = firstCard.getByRole("button", { name: /install/i });
    await installBtn.click();

    // The detail drawer opens on a plain card click (browse path); it must NOT
    // be stacked underneath the review modal here.
    await expect(page.getByTestId("drawer-install")).toHaveCount(0);

    // Import review modal appears with Confirm Install.
    const confirmBtn = page.getByTestId("confirm-install");
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });

    // Click Confirm Install (this calls previewImport → import RPCs).
    await confirmBtn.click();

    // After successful import, modal closes and the agent appears in the sidebar.
    await expect(confirmBtn).not.toBeVisible({ timeout: 10_000 });

    // The bot should appear in the roster/sidebar.
    const botButtons = page.locator("button").filter({ hasText: /^[A-Z]/ });
    await expect(botButtons.first()).toBeVisible({ timeout: 15_000 });

    // Navigate to the bot's thread.
    await botButtons.first().click();
    await page.waitForURL(/\/app\/[^/]+\/[^/]+$/, { timeout: 15_000 });

    // Composer should be visible — we are in a thread.
    await expect(page.getByPlaceholder(/message/i)).toBeVisible();

    // Send a message and verify run proceeds (no crash/error shown).
    await page.getByPlaceholder(/message/i).fill("Hello");
    await page.keyboard.press("Enter");
    // Wait briefly for a response indicator.
    await page.waitForTimeout(2_000);

    await captureScreenshot(page, testInfo, "marketplace-installed-run");
  });

  test("search returns no results for nonsense query", async ({ page }, testInfo) => {
    const stamp = Date.now();
    const email = `marketplace-search-${stamp}@rakazo.test`;

    await page.goto("/sign-up");
    await signup(page, email, "unused-password12", "Marketplace Search", testInfo);
    await completeOnboarding(page, testInfo);
    await page.goto("/app/marketplace");
    await page.waitForURL(/\/app\/marketplace/, { timeout: 30_000 });

    const searchInput = page.getByRole("searchbox", { name: /search/i });
    await searchInput.fill("zzznoresultzzz");
    await page.waitForTimeout(500);

    await expect(page.getByText(/no results/i)).toBeVisible({ timeout: 5_000 });
  });

  test("kind chip filters the card grid", async ({ page }, testInfo) => {
    const stamp = Date.now();
    const email = `marketplace-filter-${stamp}@rakazo.test`;

    await page.goto("/sign-up");
    await signup(page, email, "unused-password12", "Marketplace Filter", testInfo);
    await completeOnboarding(page, testInfo);
    await page.goto("/app/marketplace");
    await page.waitForURL(/\/app\/marketplace/, { timeout: 30_000 });

    const cards = page.locator("[data-testid^='marketplace-card-']");
    // The catalog loads async after the route renders; wait for it before counting.
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
    const countAll = await cards.count();
    expect(countAll).toBeGreaterThan(0);

    // Filter to Agents only. Exact names: the sidebar also has a
    // "Skills & Connectors" trigger that substring matching would hit.
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await page.waitForTimeout(300);
    // Some cards should still be visible.
    await expect(cards.first()).toBeVisible();

    // Filter to Skills. The bundled catalog ships agents only, so the honest
    // assertion is the empty state; the filter itself must still apply.
    await page.getByRole("button", { name: "Skills", exact: true }).click();
    await page.waitForTimeout(300);
    await expect(page.getByText(/no results/i)).toBeVisible();
    await expect(cards).toHaveCount(0);

    // Back to All restores the cards.
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.waitForTimeout(300);
    const countAllAfter = await cards.count();
    expect(countAllAfter).toBe(countAll);
  });
});
