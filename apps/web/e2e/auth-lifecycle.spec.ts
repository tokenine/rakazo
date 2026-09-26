import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, otpFromEmulator, signup } from "./helpers";

test("shows the no-email-delivery state when the server cannot send codes", async ({ page }) => {
  await page.route("**/api/auth/get-session**", (route) => route.fulfill({ json: null }));
  await page.route("**/api/auth/capabilities", (route) =>
    route.fulfill({
      json: { otp: false },
    }),
  );
  await page.goto("/sign-up");
  await expect(
    page.getByText(
      /This server does not have email delivery configured, so sign-in codes cannot be sent/,
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with email" })).toHaveCount(0);
});

test("logout protects bot deep links and OTP sign-in restores the session", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  const email = `auth-lifecycle-${stamp}@rakazo.test`;
  const userName = "Auth Lifecycle";

  await page.goto("/sign-up");
  await expect(page.getByLabel("Name")).toHaveAttribute("autocomplete", "name");
  await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "email");

  await signup(page, email, "unused-password12", userName);
  await completeOnboarding(page);

  await page.waitForURL(/\/app\/[^/]+$/);
  const protectedBotPath = new URL(page.url()).pathname;
  await expect(page.getByPlaceholder("Message Chief")).toBeVisible();

  await page.getByRole("button", { name: new RegExp(userName, "i") }).click();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Usage", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  await expect(
    page
      .locator('[data-slot="popover-content"]')
      .getByRole("button", { name: "Models", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator('[data-slot="popover-content"]')
      .getByRole("button", { name: "Memory", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator('[data-slot="popover-content"]')
      .getByRole("button", { name: "Voice", exact: true }),
  ).toHaveCount(0);
  await captureScreenshot(page, testInfo, "36-account-menu");

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Ai7" })).toBeVisible();
  await page.goto("/");
  await expect(page.locator('[data-rakazo-surface="welcome"]')).toBeVisible();
  await expect(page.getByText(/Your team of always-on agents/)).toBeVisible();
  await page.getByRole("button", { name: /Sign up/ }).click();
  await expect(page).toHaveURL(/\/sign-up$/);
  await expect(page.getByRole("heading", { name: "Create your Ai7" })).toBeVisible();
  await page.goto("/");
  await captureScreenshot(page, testInfo, "37-logged-out-welcome");

  await page.goto(protectedBotPath);
  await page.waitForURL((url) => url.pathname === "/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in to Ai7" })).toBeVisible();
  await expect(page.getByText("Chief", { exact: true })).toHaveCount(0);
  await expect(page.getByText(userName, { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "email");
  await captureScreenshot(page, testInfo, "38-protected-deep-link-sign-in");

  // A wrong code keeps the user on the sign-in form.
  await page.getByPlaceholder("Your email address").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.getByPlaceholder("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(
    page.locator("form").getByText(/invalid|incorrect|expired|could not verify/i),
  ).toBeVisible();

  // The emailed code restores the session and lands back on the deep link.
  await page.getByPlaceholder("6-digit code").fill(await otpFromEmulator(page, email));
  await page.getByRole("button", { name: "Verify code" }).click();
  await page.waitForURL((url) => url.pathname === protectedBotPath, {
    timeout: 20_000,
  });
  const composer = page.getByRole("combobox", { name: "Message Chief" });
  await expect(composer).toHaveAttribute("name", "chat-message");
  await expect(composer).toHaveAttribute("autocomplete", "off");
  await expect(composer).toHaveAttribute("aria-label", "Message Chief");
  await expect(page.getByRole("button", { name: new RegExp(userName, "i") })).toBeVisible();

  await composer.fill("line one");
  const heightBeforeNewline = await composer.evaluate((el) => el.getBoundingClientRect().height);
  await composer.press("Shift+Enter");
  await composer.type("line two");
  await expect(composer).toHaveValue("line one\nline two");
  const heightWithNewline = await composer.evaluate((el) => el.getBoundingClientRect().height);
  expect(heightWithNewline).toBeGreaterThan(heightBeforeNewline);

  await composer.press("Enter");
  const multilineMessage = page
    .getByTestId("transcript")
    .getByText("line one\nline two", { exact: true });
  await expect(multilineMessage).toBeVisible();
  await expect(multilineMessage).toHaveCSS("white-space", "pre-wrap");

  const message = "Fake composer regression check.";
  await composer.fill(message);
  await captureScreenshot(page, testInfo, "40-restored-auth-session");
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  // Scope to the transcript: the sidebar activity row can echo the same text.
  await expect(page.getByTestId("transcript").getByText(message, { exact: true })).toBeVisible();
});
