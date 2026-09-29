import {
  createProvider,
  type Model,
  type MutableModels,
  type Provider,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

/**
 * pi's generated catalog ships the GLM Coding Plan endpoint under the plain
 * "zai" id (https://api.z.ai/api/coding/paas/v4 — coding-plan keys only).
 * Register the regular pay-as-you-go platform endpoint as its own provider so
 * both are selectable, cloning the coding catalog's model metadata onto the
 * platform base URL.
 */
export const ZAI_PLATFORM_PROVIDER_ID = "zai-platform";
/** The generated-catalog provider id that actually serves the Coding Plan endpoint. */
export const ZAI_CODING_PLAN_PROVIDER_ID = "zai";

export const ZAI_PLATFORM_BASE_URL = "https://api.z.ai/api/paas/v4";

function zaiPlatformModels(): Model<"openai-completions">[] {
  const registry = builtinModels();
  // Tests stub builtinModels with a getModel-only fake; treat any registry
  // without a provider list as "no coding catalog" and register nothing.
  if (typeof registry.getProviders !== "function") return [];
  const coding = registry
    .getProviders()
    .find((provider) => provider.id === ZAI_CODING_PLAN_PROVIDER_ID);
  if (!coding) return [];
  return coding.getModels().map((model) => ({
    ...model,
    provider: ZAI_PLATFORM_PROVIDER_ID,
    baseUrl: ZAI_PLATFORM_BASE_URL,
  })) as Model<"openai-completions">[];
}

export function zaiPlatformProvider(): Provider {
  return createProvider({
    id: ZAI_PLATFORM_PROVIDER_ID,
    name: "Z.AI",
    baseUrl: ZAI_PLATFORM_BASE_URL,
    auth: {
      apiKey: {
        name: "Z.AI API key",
        resolve: async () => ({
          auth: { apiKey: "credential" },
          source: "Z.AI platform credential",
        }),
      },
    },
    models: zaiPlatformModels(),
    api: openAICompletionsApi(),
  });
}

/** Register on a Models collection. No-op when the coding catalog is absent. */
export function registerZaiPlatformProvider(models: MutableModels): MutableModels {
  if (zaiPlatformModels().length) models.setProvider(zaiPlatformProvider());
  return models;
}
