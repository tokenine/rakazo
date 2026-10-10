import {
  createProvider,
  type Model,
  type MutableModels,
  type Provider,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import {
  AI7_BASE_URL,
  AI7_MODEL_ID,
  AI7_PROVIDER_ID,
  DEFAULT_MODEL_CONTEXT_WINDOW,
  DEFAULT_MODEL_MAX_TOKENS,
} from "@rakazo/contracts";

/**
 * The Ai7 house gateway: an OpenAI-compatible endpoint the deployment sells to
 * its users, so setup only asks for an API key — endpoint and model id are
 * fixed here and not selectable in the UI. Credentials still persist as
 * `openai_compatible` secrets (baseUrl included), so the existing runtime,
 * redaction and consent paths serve it unchanged.
 */
export function ai7Model(): Model<"openai-completions"> {
  return {
    id: AI7_MODEL_ID,
    name: "Basic",
    api: "openai-completions",
    provider: AI7_PROVIDER_ID,
    baseUrl: AI7_BASE_URL,
    reasoning: false,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      thinkingFormat: "openai",
    },
    thinkingLevelMap: { off: "none" },
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_MODEL_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MODEL_MAX_TOKENS,
  };
}

export function ai7Provider(): Provider {
  return createProvider({
    id: AI7_PROVIDER_ID,
    name: "Ai7",
    baseUrl: AI7_BASE_URL,
    auth: {
      apiKey: {
        name: "Ai7 API key",
        resolve: async () => ({
          auth: { apiKey: "credential" },
          source: "Ai7 credential",
        }),
      },
    },
    models: [ai7Model()],
    api: openAICompletionsApi(),
  });
}

export function registerAi7Provider(models: MutableModels): MutableModels {
  // Tests stub builtinModels with a getModel-only fake; mirror the zai-platform
  // guard and register nothing on a registry without setProvider.
  if (typeof models.setProvider !== "function") return models;
  models.setProvider(ai7Provider());
  return models;
}

/** Register the concrete per-run model so stored limits/vision override the catalog. */
export function registerAi7Runtime(
  models: MutableModels,
  opts: {
    modelId: string;
    baseUrl: string;
    reasoning?: boolean;
    acceptsImages?: boolean;
    maxTokens?: number;
    contextWindow?: number;
  },
): MutableModels {
  const modelId = opts.modelId.trim();
  models.setProvider(
    createProvider({
      id: AI7_PROVIDER_ID,
      name: "Ai7",
      baseUrl: opts.baseUrl,
      auth: {
        apiKey: {
          name: "Ai7 API key",
          resolve: async () => ({
            auth: { apiKey: "credential" },
            source: "Ai7 credential",
          }),
        },
      },
      models: [
        {
          ...ai7Model(),
          id: modelId,
          name: modelId,
          baseUrl: opts.baseUrl,
          reasoning: Boolean(opts.reasoning),
          input: opts.acceptsImages ? ["text", "image"] : ["text"],
          ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
          ...(opts.contextWindow !== undefined ? { contextWindow: opts.contextWindow } : {}),
        },
      ],
      api: openAICompletionsApi(),
    }),
  );
  return models;
}
