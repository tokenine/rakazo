import { BRAND_NAME } from "./brand.js";

export const OPENAI_COMPATIBLE_BASE_URL_HINT = `Paste the OpenAI-compatible address from your server. ${BRAND_NAME} adds /v1 if needed.`;

/** Preconfigured OpenAI-compatible endpoints offered beside the custom server field. */
export const OPENAI_COMPATIBLE_PRESETS = [
  {
    id: "zai-coding-plan",
    label: "Z.AI Coding Plan",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    modelPlaceholder: "glm-4.6",
  },
  {
    id: "minimax",
    label: "MiniMax",
    baseUrl: "https://api.minimax.io/v1",
    modelPlaceholder: "MiniMax-M2.5",
  },
] as const;

export function openAiCompatiblePresetForBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim();
  return OPENAI_COMPATIBLE_PRESETS.find((preset) => preset.baseUrl === trimmed);
}

/** Connect when base URL and model id are set. */
export function openAiCompatibleConnectReady(input: { baseUrl: string; modelId: string }): boolean {
  return Boolean(input.baseUrl.trim() && input.modelId.trim());
}

export function openAiCompatibleProbeSuccessMessage(modelCount: number): string {
  return modelCount
    ? `Found ${modelCount} model${modelCount === 1 ? "" : "s"}.`
    : "Server found. Enter a model name.";
}
