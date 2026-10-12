import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCredentials, removeCredentials, storeCredentials } from "./credentials.js";

function tempConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "rakazo-cli-test-"));
}

describe("credentials store", () => {
  it("round-trips server, token, and space id", () => {
    const dir = tempConfigDir();
    try {
      storeCredentials(
        { server: "https://rakazo.example.com", token: "tok_1", spaceId: "space_1" },
        { configDir: dir },
      );
      expect(loadCredentials({ configDir: dir })).toEqual({
        server: "https://rakazo.example.com",
        token: "tok_1",
        spaceId: "space_1",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stores the file readable only by the owner", () => {
    const dir = tempConfigDir();
    try {
      storeCredentials({ server: "https://x", token: "t", spaceId: "s" }, { configDir: dir });
      const mode = statSync(join(dir, "credentials.json")).mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when no credentials exist and after logout", () => {
    const dir = tempConfigDir();
    try {
      expect(loadCredentials({ configDir: dir })).toBeNull();
      storeCredentials({ server: "https://x", token: "t", spaceId: "s" }, { configDir: dir });
      removeCredentials({ configDir: dir });
      expect(loadCredentials({ configDir: dir })).toBeNull();
      expect(() => readFileSync(join(dir, "credentials.json"))).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
