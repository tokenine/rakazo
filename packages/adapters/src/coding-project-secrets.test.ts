import { describe, expect, it } from "vitest";
import {
  MAX_PROJECT_SECRETS_PER_WORKSPACE,
  ProjectSecretNotFoundError,
  ProjectSecretNameInvalidError,
  type ProjectSecretsClient,
  createProjectSecretsStore,
  projectSecretRef,
} from "./coding-project-secrets.js";
import { EncryptedSecretStore } from "./secrets.js";

/**
 * 004-code-mode T14 (V9) — per-project encrypted secrets store.
 *
 * Reuses the existing credential-storage primitives (docs/bot-secrets.md
 * facility): values are sealed with the SAME EncryptedSecretStore
 * (AES-256-GCM, record-bound) the bot_secrets table uses, but scoped to a
 * CODING WORKSPACE (a project) instead of a bot — the bot_secrets schema
 * itself is (user, space, bot, name)-keyed and HTTP-destination-shaped
 * (packages/db/prisma/schema.prisma `BotSecret`), so it cannot hold project
 * secrets; this store is the project-scoped variant over the same
 * encryption primitive. Values never leave the store in plaintext except
 * through getDecrypted(), which only the grant/injection path may call.
 *
 * Offline determinism: in-memory prisma double (coding-session-service
 * test pattern); no live DB, no network.
 */

function fakePrisma() {
  const rows: Array<Record<string, unknown>> = [];
  const prisma = {
    codingProjectSecret: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data };
        rows.push(row);
        return row;
      },
      findUnique: async ({
        where,
      }: {
        where: { workspaceId_name: { workspaceId: string; name: string } };
      }) =>
        rows.find(
          (row) =>
            row.workspaceId === where.workspaceId_name.workspaceId &&
            row.name === where.workspaceId_name.name,
        ) ?? null,
      findMany: async ({ where }: { where: { workspaceId: string } }) =>
        rows.filter((row) => row.workspaceId === where.workspaceId),
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = rows.find((entry) => entry.id === where.id);
        if (!row) throw new Error("row not found");
        Object.assign(row, data);
        return row;
      },
      deleteMany: async ({ where }: { where: { workspaceId: string; name: string } }) => {
        const before = rows.length;
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          const row = rows[index]!;
          if (row.workspaceId === where.workspaceId && row.name === where.name) {
            rows.splice(index, 1);
          }
        }
        return { count: before - rows.length };
      },
      count: async ({ where }: { where: { workspaceId: string } }) =>
        rows.filter((row) => row.workspaceId === where.workspaceId).length,
    },
  };
  return { prisma: prisma as unknown as ProjectSecretsClient, rows };
}

function fixture() {
  const { prisma, rows } = fakePrisma();
  const store = createProjectSecretsStore({
    prisma,
    secretStore: new EncryptedSecretStore("s3-test-encryption-key"),
    now: () => new Date("2026-10-02T06:00:00Z"),
  });
  return { store, rows };
}

describe("project secrets store (T14, V9)", () => {
  it("stores a project secret encrypted at rest and never persists the plaintext", async () => {
    const { store, rows } = fixture();
    await store.set({ workspaceId: "ws-1", name: "github_token", plaintext: "ghp_s3plantedvalue" });
    // The row must contain only ciphertext: no plaintext substring anywhere.
    const raw = JSON.stringify(rows);
    expect(raw).not.toContain("ghp_s3plantedvalue");
    expect(raw).toContain("v2:"); // EncryptedSecretStore versioned seal format
  });

  it("round-trips the plaintext only through getDecrypted", async () => {
    const { store } = fixture();
    await store.set({ workspaceId: "ws-1", name: "github_token", plaintext: "ghp_roundtrip" });
    expect(await store.getDecrypted("ws-1", "github_token")).toBe("ghp_roundtrip");
  });

  it("scopes secrets per workspace: another workspace cannot see or decrypt them", async () => {
    const { store } = fixture();
    await store.set({ workspaceId: "ws-1", name: "github_token", plaintext: "ghp_ws1" });
    await expect(store.getDecrypted("ws-2", "github_token")).rejects.toBeInstanceOf(
      ProjectSecretNotFoundError,
    );
    expect(await store.listNames("ws-2")).toEqual([]);
  });

  it("rejects invalid names, including wildcards (v1: no wildcards)", async () => {
    const { store } = fixture();
    await expect(
      store.set({ workspaceId: "ws-1", name: "*", plaintext: "x" }),
    ).rejects.toBeInstanceOf(ProjectSecretNameInvalidError);
    await expect(
      store.set({ workspaceId: "ws-1", name: "GH_TOKEN", plaintext: "x" }),
    ).rejects.toBeInstanceOf(ProjectSecretNameInvalidError);
    await expect(
      store.set({ workspaceId: "ws-1", name: "has-dash", plaintext: "x" }),
    ).rejects.toBeInstanceOf(ProjectSecretNameInvalidError);
  });

  it("re-setting a name is a rotation: ciphertext changes and rotatedAt advances", async () => {
    const { store, rows } = fixture();
    await store.set({ workspaceId: "ws-1", name: "github_token", plaintext: "ghp_v1" });
    const before = rows[0] && (rows[0].ciphertext as string);
    const result = await store.set({
      workspaceId: "ws-1",
      name: "github_token",
      plaintext: "ghp_v2",
      now: () => new Date("2026-10-02T07:00:00Z"),
    });
    expect(result.rotated).toBe(true);
    expect(result.rotatedAt).toEqual(new Date("2026-10-02T07:00:00Z"));
    expect(rows[0] && (rows[0].ciphertext as string)).not.toBe(before);
    expect(await store.getDecrypted("ws-1", "github_token")).toBe("ghp_v2");
  });

  it("enforces the per-workspace credential limit (same ceiling as bot_secrets)", async () => {
    const { store } = fixture();
    for (let index = 0; index < MAX_PROJECT_SECRETS_PER_WORKSPACE; index += 1) {
      await store.set({ workspaceId: "ws-1", name: `secret_${index}`, plaintext: `v${index}` });
    }
    await expect(
      store.set({ workspaceId: "ws-1", name: "one_too_many", plaintext: "v" }),
    ).rejects.toThrow(/limit/i);
  });

  it("lists names and metadata only — never values", async () => {
    const { store } = fixture();
    await store.set({ workspaceId: "ws-1", name: "github_token", plaintext: "ghp_meta" });
    const listing = JSON.stringify(await store.listMetadata("ws-1"));
    expect(listing).toContain("github_token");
    expect(listing).not.toContain("ghp_meta");
  });

  it("exposes a stable secretRef that never contains the plaintext", async () => {
    const { store } = fixture();
    const stored = await store.set({
      workspaceId: "ws-1",
      name: "github_token",
      plaintext: "ghp_ref",
    });
    const ref = projectSecretRef(stored.id);
    expect(ref).toBe(`coding-project-secret:${stored.id}`);
    expect(ref).not.toContain("ghp_ref");
  });

  it("removes a secret; it stops resolving", async () => {
    const { store } = fixture();
    await store.set({ workspaceId: "ws-1", name: "github_token", plaintext: "ghp_remove" });
    await store.remove("ws-1", "github_token");
    await expect(store.getDecrypted("ws-1", "github_token")).rejects.toBeInstanceOf(
      ProjectSecretNotFoundError,
    );
  });
});
