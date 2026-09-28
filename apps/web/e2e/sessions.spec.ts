import { expect, type Page, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, signup } from "./helpers";

function switcherTrigger(page: Page) {
  return page.getByTestId("session-switcher-trigger");
}

function sessionRow(page: Page, name: string) {
  return page.getByTestId("session-switcher-row").filter({ hasText: name });
}

test("switch sessions, rename, delete, and keep botId-only legacy routing", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `sessions-${stamp}@rakazo.test`, "password12", "Sessions E2E");
  await completeOnboarding(page);
  await page.waitForURL(/\/app\/[^/]+$/);
  const botId = activeBotId(page);

  // The default route stays the legacy /app/:botId shape (primary session).
  await expect(switcherTrigger(page)).toBeVisible();
  await expect(page.getByTestId("transcript")).toBeVisible();

  // Create a second session from the switcher.
  await switcherTrigger(page).click();
  await page.getByTestId("session-create-trigger").click();
  await page.getByLabel("Session name").fill("Research");
  await page.getByTestId("session-create-submit").click();
  // Wait for navigation to complete. After the popover closes, the trigger button shows
  // the active session name as confirmation the session was created and is active.
  await page.waitForURL(new RegExp(`/app/${botId}/[^/]+$`));
  await expect(switcherTrigger(page).getByText("Research")).toBeVisible({ timeout: 15_000 });
  const researchUrl = page.url();
  await expect(page.getByPlaceholder(/^Message /)).toBeVisible();

  // Messages sent while a session is open land in that session only.
  await page.getByPlaceholder(/^Message /).fill("research session note");
  await page.getByRole("button", { name: "Send" }).click({ force: true });
  await expect(
    page.getByTestId("transcript").getByText("research session note", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });

  // Switch back to the primary session: separate history, legacy URL shape.
  await switcherTrigger(page).click();
  await page.getByTestId("session-switcher-option").filter({ hasText: "Primary" }).click();
  await page.waitForURL(new RegExp(`/app/${botId}$`));
  await expect(page.getByTestId("transcript")).toBeVisible();
  await expect(
    page.getByTestId("transcript").getByText("research session note", { exact: true }),
  ).toHaveCount(0);
  await captureScreenshot(page, testInfo, "sessions-primary-after-switch");

  // Rename the session from the switcher.
  await switcherTrigger(page).click();
  // Wait for the popover to fully settle (the create form is hidden but present in DOM;
  // opening the switcher fresh ensures the form is gone and sessions are rendered).
  await expect(page.getByTestId("session-switcher-list")).toBeVisible({ timeout: 10_000 });
  const researchRow = sessionRow(page, "Research");
  await researchRow.hover();
  await researchRow.getByTestId("session-rename-trigger").click();
  // The rename dialog renders as a top-level dialog; use page-level selectors.
  await expect(page.getByLabel("Session name")).toBeVisible({ timeout: 5_000 });
  await page.getByLabel("Session name").fill("Deep research");
  await page.getByTestId("session-rename-save").click();
  await expect(sessionRow(page, "Deep research")).toBeVisible();

  // Delete the renamed session; the view stays on the primary.
  await sessionRow(page, "Deep research").hover();
  await sessionRow(page, "Deep research").getByTestId("session-delete-trigger").click();
  await sessionRow(page, "Deep research").getByTestId("session-delete-confirm").click();
  await expect(page.getByTestId("session-switcher-row")).toHaveCount(1);
  await expect(page).toHaveURL(new RegExp(`/app/${botId}$`));

  // The last remaining session cannot be deleted (grill #6).
  await switcherTrigger(page).click();
  await expect(
    page.getByTestId("session-switcher-row").first().getByTestId("session-delete-trigger"),
  ).toBeDisabled();
});

test("session history resumes after reload on the same session route", async ({ page }) => {
  const stamp = Date.now();
  await signup(page, `sessions-resume-${stamp}@rakazo.test`, "password12", "Resume E2E");
  await completeOnboarding(page);
  await page.waitForURL(/\/app\/[^/]+$/);
  const botId = activeBotId(page);

  await switcherTrigger(page).click();
  await page.getByTestId("session-create-trigger").click();
  await page.getByLabel("Session name").fill("Field notes");
  await page.getByTestId("session-create-submit").click();
  await page.waitForURL(new RegExp(`/app/${botId}/[^/]+$`));

  await page.getByPlaceholder(/^Message /).fill("field note one");
  await page.getByRole("button", { name: "Send" }).click({ force: true });
  await expect(
    page.getByTestId("transcript").getByText("field note one", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByPlaceholder(/^Message /).fill("field note two");
  await page.getByRole("button", { name: "Send" }).click({ force: true });
  await expect(
    page.getByTestId("transcript").getByText("field note two", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(page.getByTestId("shell-root")).toHaveAttribute("data-ready", "true");
  await expect(page).toHaveURL(new RegExp(`/app/${botId}/[^/]+$`));
  await expect(
    page.getByTestId("transcript").getByText("field note one", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId("transcript").getByText("field note two", { exact: true }),
  ).toBeVisible();
});

test("a second client sees the session list change without reloading", async ({ page }) => {
  const stamp = Date.now();
  await signup(page, `sessions-live-${stamp}@rakazo.test`, "password12", "Live E2E");
  await completeOnboarding(page);
  await page.waitForURL(/\/app\/[^/]+$/);
  const botId = activeBotId(page);

  const second = await page.context().newPage();
  await second.goto(`/app/${botId}`);
  await second.waitForURL(new RegExp(`/app/${botId}$`));
  await expect(second.getByTestId("session-switcher-trigger")).toBeVisible();
  await second.getByTestId("session-switcher-trigger").click();
  await expect(second.getByTestId("session-switcher-row")).toHaveCount(1);

  // Client 1 creates a session; client 2's open switcher updates live (V12).
  await switcherTrigger(page).click();
  await page.getByTestId("session-create-trigger").click();
  await page.getByLabel("Session name").fill("Shared research");
  await page.getByTestId("session-create-submit").click();
  // Wait for navigation to complete. The trigger shows the new session name when active.
  await page.waitForURL(new RegExp(`/app/${botId}/[^/]+$`));
  await expect(switcherTrigger(page).getByText("Shared research")).toBeVisible({ timeout: 15_000 });
  // Client 2 also sees the new session in its open switcher (live update).
  await expect(second.getByTestId("session-switcher-row").filter({ hasText: "Shared research" })).toBeVisible(
    { timeout: 20_000 },
  );

  // Renames arrive live too.
  await switcherTrigger(page).click();
  // Wait for popover to fully settle (form gone, sessions rendered).
  await expect(page.getByTestId("session-switcher-list")).toBeVisible({ timeout: 10_000 });
  const sharedRow = sessionRow(page, "Shared research");
  await sharedRow.hover();
  await sharedRow.getByTestId("session-rename-trigger").click();
  // The rename dialog renders as a top-level dialog; use page-level selectors.
  await expect(page.getByLabel("Session name")).toBeVisible({ timeout: 5_000 });
  await page.getByLabel("Session name").fill("Shared deep dive");
  await page.getByTestId("session-rename-save").click();
  await page.keyboard.press("Escape"); // close rename dialog
  await expect(sessionRow(page, "Shared deep dive")).toBeVisible({ timeout: 10_000 });
  await expect(
    second.getByTestId("session-switcher-row").filter({ hasText: "Shared deep dive" }),
  ).toBeVisible({ timeout: 20_000 });

  // And the deletion disappears from the second client without a reload.
  await switcherTrigger(page).click();
  await expect(page.getByTestId("session-switcher-list")).toBeVisible({ timeout: 10_000 });
  // Hover with force to bypass stability checks (live updates may re-render rows).
  await sessionRow(page, "Shared deep dive").hover({ force: true });
  // Chain within the row so we target the correct session's delete trigger.
  await sessionRow(page, "Shared deep dive").getByTestId("session-delete-trigger").click();
  await page.getByTestId("session-delete-confirm").click();
  // Re-open second client's popover so the live-update re-render is visible in DOM.
  await second.getByTestId("session-switcher-trigger").click();
  await expect(second.getByTestId("session-switcher-row")).toHaveCount(1, { timeout: 20_000 });
  await second.close();
});
