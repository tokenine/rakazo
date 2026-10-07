import { expect, test } from "@playwright/test";
import { captureScreenshot, signup } from "./helpers";

test("onboarding offers only Ai7 and Custom Provider, with a fixed Ai7 model", async ({
  page,
}, testInfo) => {
  await page.route("**/rpc/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { json: Record<string, unknown> };
    await route.fulfill({
      response,
      json: {
        json: {
          ...body.json,
          needsModel: true,
          defaultProvider: "openrouter",
          defaultModel: "openai/gpt-5.6-luna",
        },
      },
    });
  });

  const stamp = Date.now();
  await signup(
    page,
    `model-providers-${stamp}@rakazo.test`,
    "password12",
    `Model providers ${stamp}`,
  );
  await expect(page.getByRole("heading", { name: "Connect a model" })).toBeVisible({
    timeout: 20_000,
  });

  // The house provider is preselected: fixed server URL and model, key-only setup.
  const provider = page.getByRole("combobox", { name: "Provider" });
  await expect(provider).toContainText("Ai7");
  await expect(page.getByText("https://api.ai7.work/v1")).toBeVisible();
  await expect(page.getByText("Basic", { exact: true })).toBeVisible();
  const ai7Key = page.getByLabel("API key");
  await ai7Key.fill("short");
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  await ai7Key.fill("ai7-provider-key");
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();

  await provider.click();
  await expect(page.getByRole("option", { name: "Custom Provider" })).toBeVisible();
  await expect(page.getByRole("option", { name: "OpenRouter" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "ChatGPT" })).toHaveCount(0);
  await page.getByRole("option", { name: "Custom Provider" }).click();

  await page.route("**/rpc/models/probeOpenAiCompatible", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: { models: ["probed-model"] } }),
    });
  });
  await page.getByLabel("OpenAI-compatible server URL").fill("http://127.0.0.1:8090/v1");
  const manualModel = page.getByLabel("Model id");
  await expect(manualModel).toBeVisible();
  // Typing before the first probe must keep freeform even if the probe returns that id.
  await manualModel.fill("probed-model");
  const firstProbeResponse = page.waitForResponse("**/rpc/models/probeOpenAiCompatible");
  await page.getByRole("button", { name: "Find models" }).click();
  await firstProbeResponse;
  await expect(manualModel).toBeVisible();
  await expect(manualModel).toHaveValue("probed-model");
  await expect(page.getByRole("combobox", { name: "Models from server" })).toHaveCount(0);
  await page.getByRole("button", { name: "Use a found model" }).click();
  const discovered = page.getByRole("combobox", { name: "Models from server" });
  await expect(discovered).toBeVisible();
  await expect(discovered).toContainText("probed-model");
  await discovered.click();
  await page.getByRole("option", { name: "Other model…" }).click();
  await expect(manualModel).toBeVisible();
  // Typing a discovered id (or its prefix) must keep the freeform field.
  await manualModel.fill("probed-model");
  await expect(manualModel).toBeVisible();
  await expect(manualModel).toHaveValue("probed-model");
  // Re-probe while the typed id matches a discovered model must stay freeform.
  const reProbeResponse = page.waitForResponse("**/rpc/models/probeOpenAiCompatible");
  await page.getByRole("button", { name: "Find models" }).click();
  await reProbeResponse;
  await expect(manualModel).toBeVisible();
  await expect(manualModel).toHaveValue("probed-model");
  await expect(page.getByRole("combobox", { name: "Models from server" })).toHaveCount(0);
  // Editing the server URL must not drop Other model… mode either.
  await page.getByLabel("OpenAI-compatible server URL").fill("http://127.0.0.1:8091/v1");
  const editedUrlProbeResponse = page.waitForResponse("**/rpc/models/probeOpenAiCompatible");
  await page.getByRole("button", { name: "Find models" }).click();
  await editedUrlProbeResponse;
  await expect(manualModel).toBeVisible();
  await expect(manualModel).toHaveValue("probed-model");
  await expect(page.getByRole("combobox", { name: "Models from server" })).toHaveCount(0);
  await manualModel.fill("probed-model-custom");
  await expect(manualModel).toHaveValue("probed-model-custom");

  await captureScreenshot(page, testInfo, "onboarding-model-providers");
});
