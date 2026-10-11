import { describe, expect, it } from "vitest";
import { OMP_API_KEY_ENV, ompTerminalInjection } from "./omp-terminal.js";

describe("omp terminal injection", () => {
  it("maps an api-key credential on a native provider to omp's env var name", () => {
    const injection = ompTerminalInjection({
      provider: "anthropic",
      modelId: "claude-opus-4-8",
      plaintext: JSON.stringify({ kind: "api_key", key: "sk-ant-secret" }),
    });
    expect(injection.env).toEqual({ ANTHROPIC_API_KEY: "sk-ant-secret" });
    expect(injection.homeFiles).toHaveLength(1);
    expect(injection.homeFiles?.[0].content).toContain("default: anthropic/claude-opus-4-8");
    expect(injection.launchCommand).toBe("omp --model anthropic/claude-opus-4-8");
  });

  it("never places the key inside the models.yml file or the launch command", () => {
    const injection = ompTerminalInjection({
      provider: "openai_compatible",
      modelId: "my-model",
      plaintext: JSON.stringify({
        kind: "openai_compatible",
        baseUrl: "https://gateway.example.com/v1",
        apiKey: "sk-secret",
        contextWindow: 128000,
        maxTokens: 8192,
      }),
    });
    const file = injection.homeFiles?.[0];
    expect(injection.env).toEqual({ [OMP_API_KEY_ENV]: "sk-secret" });
    expect(file?.path).toBe(".omp/agent/models.yml");
    expect(file?.content).toContain("apiKey: " + OMP_API_KEY_ENV);
    expect(file?.content).toContain("baseUrl: https://gateway.example.com/v1");
    expect(file?.content).not.toContain("sk-secret");
    expect(injection.launchCommand).toBe("omp --model rakazo/my-model");
    expect(injection.launchCommand).not.toContain("sk-secret");
  });

  it("injects nothing for oauth-kind credentials (known limitation: omp shows no-model)", () => {
    const injection = ompTerminalInjection({
      provider: "openai-codex",
      modelId: "gpt-5.5",
      plaintext: JSON.stringify({
        kind: "oauth",
        credential: { type: "oauth", access: "token", refresh: "r", expires: 9999999999 },
      }),
    });
    expect(injection).toEqual({});
  });

  it("maps only unambiguous Rakazo provider ids onto omp native providers", () => {
    const mapped = ["anthropic", "openai", "google", "deepseek", "openrouter", "zai-platform"];
    for (const provider of mapped) {
      const injection = ompTerminalInjection({
        provider,
        modelId: "m",
        plaintext: "plain-key-value",
      });
      expect(injection.homeFiles, provider).toHaveLength(1);
      expect(Object.keys(injection.env ?? {}), provider).toHaveLength(1);
    }
    // The z.ai coding-plan endpoint shares omp's "zai" provider id but not its
    // endpoint; it must take the custom-provider route, not the native env var.
    const codingPlan = ompTerminalInjection({
      provider: "zai",
      modelId: "glm-5",
      plaintext: "plain-key-value",
    });
    expect(codingPlan.homeFiles).toHaveLength(2);
    expect(codingPlan.homeFiles?.[0].content).toContain(
      "baseUrl: https://api.z.ai/api/coding/paas/v4",
    );
    expect(codingPlan.homeFiles?.[1].path).toBe(".omp/agent/config.yml");
    expect(codingPlan.homeFiles?.[1].content).toContain("default: rakazo/glm-5");
    expect(Object.keys(codingPlan.env ?? {})).toEqual([OMP_API_KEY_ENV]);
  });

  it("launches bare omp when the session has no model id", () => {
    const injection = ompTerminalInjection({
      provider: "anthropic",
      modelId: "",
      plaintext: "plain-key-value",
    });
    expect(injection.launchCommand).toBeUndefined();
    expect(injection.env).toEqual({ ANTHROPIC_API_KEY: "plain-key-value" });
  });

  it("stays out of the way when the credential cannot be read", () => {
    expect(ompTerminalInjection({ provider: "anthropic", modelId: "m", plaintext: "" })).toEqual(
      {},
    );
    // A keyless openai_compatible endpoint has nothing to inject.
    expect(
      ompTerminalInjection({
        provider: "openai_compatible",
        modelId: "m",
        plaintext: JSON.stringify({ kind: "openai_compatible", baseUrl: "https://x.test/v1" }),
      }),
    ).toEqual({});
  });
});
