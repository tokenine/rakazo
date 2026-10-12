/**
 * Translation from a Rakazo model credential to the environment and config that omp needs
 * inside a coding terminal. This is the omp provider boundary: the secret travels only as
 * process env (never argv, logs, or files); models.yml names the env var, not the key.
 */
import { AI7_BASE_URL, AI7_PROVIDER_ID } from "@rakazo/contracts";
import { parseModelSecret } from "./pi-oauth.js";

/** Env var carrying the key for the custom-provider route; models.yml references the name. */
export const OMP_API_KEY_ENV = "RAKAZO_OMP_API_KEY";

/**
 * Rakazo provider ids whose credentials map onto an omp bundled provider. Only unambiguous
 * id-to-id matches (same endpoint, API-key auth on both sides) appear here; everything else
 * takes the custom-provider route below or gets no injection.
 */
const OMP_NATIVE_PROVIDERS: Record<string, { provider: string; env: string }> = {
  anthropic: { provider: "anthropic", env: "ANTHROPIC_API_KEY" },
  openai: { provider: "openai", env: "OPENAI_API_KEY" },
  google: { provider: "google", env: "GEMINI_API_KEY" },
  deepseek: { provider: "deepseek", env: "DEEPSEEK_API_KEY" },
  openrouter: { provider: "openrouter", env: "OPENROUTER_API_KEY" },
  groq: { provider: "groq", env: "GROQ_API_KEY" },
  mistral: { provider: "mistral", env: "MISTRAL_API_KEY" },
  xai: { provider: "xai", env: "XAI_API_KEY" },
  cerebras: { provider: "cerebras", env: "CEREBRAS_API_KEY" },
  together: { provider: "together", env: "TOGETHER_API_KEY" },
  fireworks: { provider: "fireworks", env: "FIREWORKS_API_KEY" },
  // omp's bundled "zai" is the regular platform endpoint, same as this id.
  "zai-platform": { provider: "zai", env: "ZAI_API_KEY" },
};

/**
 * Api-key providers whose endpoint omp does not bundle at Rakazo's URL: their Rakazo
 * credentials store only the key, so the custom-provider route needs the base URL here.
 */
const OMP_CUSTOM_BASE_URLS: Record<string, string> = {
  // Rakazo's "zai" id is the coding-plan endpoint; omp's bundled "zai" is not.
  zai: "https://api.z.ai/api/coding/paas/v4",
  [AI7_PROVIDER_ID]: AI7_BASE_URL,
};

export type OmpTerminalInjection = {
  env?: Record<string, string>;
  homeFiles?: Array<{ path: string; content: string }>;
  launchCommand?: string;
};

export function ompTerminalInjection(input: {
  provider: string;
  modelId: string;
  plaintext: string;
}): OmpTerminalInjection {
  if (!input.plaintext) return {};
  let secret: ReturnType<typeof parseModelSecret>;
  try {
    secret = parseModelSecret(input.plaintext);
  } catch {
    return {};
  }
  // OAuth-kind credentials (ChatGPT/Codex subscriptions) cannot be injected: omp would
  // need its own /login. No-model there is truthful. Known limitation.
  if (secret.kind === "oauth") return {};
  const apiKey = secret.kind === "api_key" ? secret.key : secret.apiKey;
  if (!apiKey) return {};
  const native =
    input.provider in OMP_NATIVE_PROVIDERS ? OMP_NATIVE_PROVIDERS[input.provider] : undefined;
  if (native && secret.kind === "api_key") {
    const selector = modelSelector(native.provider, input.modelId);
    return {
      env: { [native.env]: apiKey },
      homeFiles: selector ? [ompDefaultModelConfig(selector)] : [],
      launchCommand: selector,
    };
  }
  const baseUrl =
    secret.kind === "openai_compatible" ? secret.baseUrl : OMP_CUSTOM_BASE_URLS[input.provider];
  if (!baseUrl) return {};
  const selector = input.modelId ? modelSelector("rakazo", input.modelId) : undefined;
  return {
    env: { [OMP_API_KEY_ENV]: apiKey },
    homeFiles: [
      {
        path: ".omp/agent/models.yml",
        content: ompModelsYml(
          baseUrl,
          input.modelId,
          secret.kind === "openai_compatible" ? secret : undefined,
        ),
      },
      ...(selector ? [ompDefaultModelConfig(selector)] : []),
    ],
    launchCommand: selector,
  };
}

/** modelRoles.default plus the wizard off-switch: the TUI opens on the Rakazo-picked model. */
function ompDefaultModelConfig(selector: string): { path: string; content: string } {
  const target = selector.replace(/^omp --model /, "").trim();
  return {
    path: ".omp/agent/config.yml",
    content: `startup:\n  setupWizard: false\nmodelRoles:\n  default: ${target}\n`,
  };
}

/** `omp --model <provider>/<modelId>`; omitted when the id is unusable on a command line. */
function modelSelector(provider: string, modelId: string): string | undefined {
  const target = modelTarget(provider, modelId);
  return target ? `omp --model ${target}` : undefined;
}

function modelTarget(provider: string, modelId: string): string | undefined {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(modelId)) return undefined;
  return `${provider}/${modelId}`;
}

/** Secret-free provider entry: `apiKey` names the env var omp resolves at runtime. */
function ompModelsYml(
  baseUrl: string,
  modelId: string,
  secret: { contextWindow?: number; maxTokens?: number } | undefined,
): string {
  const lines = [
    "providers:",
    "  rakazo:",
    `    baseUrl: ${yamlScalar(baseUrl)}`,
    "    api: openai-completions",
    `    apiKey: ${OMP_API_KEY_ENV}`,
  ];
  if (modelId) {
    lines.push(
      "    models:",
      `      - id: ${yamlScalar(modelId)}`,
      `        name: ${yamlScalar(modelId)}`,
    );
    if (secret?.contextWindow) lines.push(`        contextWindow: ${secret.contextWindow}`);
    if (secret?.maxTokens) lines.push(`        maxTokens: ${secret.maxTokens}`);
  }
  return lines.join("\n") + "\n";
}

function yamlScalar(value: string): string {
  return /^[A-Za-z0-9._:/-]+$/.test(value) ? value : JSON.stringify(value);
}
