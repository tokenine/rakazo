import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { describe, expect, it } from "vitest";
import { listPiCatalog } from "./pi-models.js";
import {
  registerZaiPlatformProvider,
  ZAI_PLATFORM_BASE_URL,
  ZAI_PLATFORM_PROVIDER_ID,
} from "./pi-zai-platform-provider.js";

describe("zai platform provider", () => {
  it("clones the coding catalog onto the regular platform endpoint", () => {
    const provider = registerZaiPlatformProvider(builtinModels())
      .getProviders()
      .find((entry) => entry.id === ZAI_PLATFORM_PROVIDER_ID);
    expect(provider).toBeDefined();
    expect(provider?.name).toBe("Z.AI");
    const models = provider?.getModels() ?? [];
    const ids = models.map((model) => model.id);
    expect(ids).toContain("glm-5.3-flash");
    expect(ids).toContain("glm-5.3");
    for (const model of models) {
      expect(model.baseUrl).toBe(ZAI_PLATFORM_BASE_URL);
      expect(model.api).toBe("openai-completions");
    }
  });

  it("resolves registered models from the per-request registry", () => {
    const models = registerZaiPlatformProvider(builtinModels());
    const model = models.getModel(ZAI_PLATFORM_PROVIDER_ID, "glm-5.3-flash");
    expect(model?.baseUrl).toBe(ZAI_PLATFORM_BASE_URL);
  });

  it("lists the platform provider and relabels the coding-plan entry", () => {
    const catalog = listPiCatalog();
    const platform = catalog.find((entry) => entry.provider === ZAI_PLATFORM_PROVIDER_ID);
    expect(platform?.providerName).toBe("Z.AI");
    expect(platform?.auth).toBe("api-key");
    const coding = catalog.find((entry) => entry.provider === "zai");
    expect(coding?.providerName).toBe("Z.AI Coding Plan");
  });
});
