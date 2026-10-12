import { describe, expect, it } from "vitest";
import { codeWorkspaceEnabled } from "./feature-flags";

describe("codeWorkspaceEnabled", () => {
  it("defaults to off when the flag is unset", () => {
    expect(codeWorkspaceEnabled(undefined)).toBe(false);
    expect(codeWorkspaceEnabled({})).toBe(false);
  });

  it("is off for any value other than an explicit true", () => {
    expect(codeWorkspaceEnabled({ VITE_FEATURE_CODE_WORKSPACE: "1" })).toBe(false);
    expect(codeWorkspaceEnabled({ VITE_FEATURE_CODE_WORKSPACE: "false" })).toBe(false);
  });

  it("turns on only with an explicit true", () => {
    expect(codeWorkspaceEnabled({ VITE_FEATURE_CODE_WORKSPACE: "true" })).toBe(true);
  });
});
