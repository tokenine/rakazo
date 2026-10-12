import { describe, expect, it } from "vitest";
import {
  OPENAI_COMPATIBLE_PRESETS,
  openAiCompatibleConnectReady,
  openAiCompatiblePresetForBaseUrl,
  openAiCompatibleProbeSuccessMessage,
} from "./openai-compatible-ui.js";

describe("OPENAI_COMPATIBLE_PRESETS", () => {
  it("offers Z.AI Coding Plan and MiniMax with distinct endpoints", () => {
    expect(OPENAI_COMPATIBLE_PRESETS.map((preset) => preset.id)).toEqual([
      "zai-coding-plan",
      "minimax",
    ]);
    expect(new Set(OPENAI_COMPATIBLE_PRESETS.map((preset) => preset.baseUrl)).size).toBe(
      OPENAI_COMPATIBLE_PRESETS.length,
    );
  });
});

describe("openAiCompatiblePresetForBaseUrl", () => {
  it("recognizes a preset endpoint exactly", () => {
    expect(openAiCompatiblePresetForBaseUrl(OPENAI_COMPATIBLE_PRESETS[0].baseUrl)?.id).toBe(
      "zai-coding-plan",
    );
  });

  it("treats any other address as a custom server", () => {
    expect(openAiCompatiblePresetForBaseUrl("http://127.0.0.1:8000/v1")).toBeUndefined();
    expect(openAiCompatiblePresetForBaseUrl(" ")).toBeUndefined();
  });
});

describe("openAiCompatibleConnectReady", () => {
  it("allows a new connection with base URL and explicit model id", () => {
    expect(
      openAiCompatibleConnectReady({
        baseUrl: "http://127.0.0.1:8000/v1",
        modelId: "qwen",
      }),
    ).toBe(true);
  });

  it("rejects empty base URL or model id", () => {
    expect(
      openAiCompatibleConnectReady({
        baseUrl: "  ",
        modelId: "qwen",
      }),
    ).toBe(false);
    expect(
      openAiCompatibleConnectReady({
        baseUrl: "http://127.0.0.1:8000/v1",
        modelId: "",
      }),
    ).toBe(false);
  });

  it("guides manual entry when a successful probe lists no models", () => {
    expect(openAiCompatibleProbeSuccessMessage(0)).toBe("Server found. Enter a model name.");
  });
});
