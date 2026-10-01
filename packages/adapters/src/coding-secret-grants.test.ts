import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectSecretsStore } from "./coding-project-secrets.js";
import {
  createSecretsGrantsService,
  SECRETS_CONFIDENTIALITY_DISCLOSURE,
  SECRETS_GRANT_TTL_SECONDS,
  SecretsDisabledError,
} from "./coding-secret-grants.js";
import { verifySecretsAuditChain } from "./coding-secrets-audit.js";
import { EncryptedSecretStore } from "./secrets.js";

/**
 * 004-code-mode S3 — grants (T15), revocation/rotation (T19), fail-closed
 * disclosure (T21), all V9/V10/V11.
 *
 * Gate family of T4: DENY-BY-DEFAULT. A task config declares required secret
 * NAMES before start; only those names — existing in the project store — can
 * be granted; injection resolves granted names ONLY; no wildcards v1; TTL per
 * (workspace, taskRun). Every state change lands in the tamper-evident audit
 * chain (T18) and the fail-closed rule holds in BOTH directions: a runtime
 * that cannot guarantee spawn-env injection disables secrets with an explicit
 * disclosure, never silently.
 */

function fakeGrantClient() {
  const grantRows: Array<Record<string, unknown>> = [];
  const prisma = {
    codingSecretGrant: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: {
          workspaceId_taskRunId_secretName: {
            workspaceId: string;
            taskRunId: string;
            secretName: string;
          };
        };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const key = where.workspaceId_taskRunId_secretName;
        const existing = grantRows.find(
          (row) =>
            row.workspaceId === key.workspaceId &&
            row.taskRunId === key.taskRunId &&
            row.secretName === key.secretName,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        grantRows.push({ ...create });
        return create;
      },
      findMany: async ({ where }: { where: { workspaceId: string; taskRunId?: string } }) =>
        grantRows.filter(
          (row) =>
            row.workspaceId === where.workspaceId &&
            (where.taskRunId === undefined || row.taskRunId === where.taskRunId),
        ),
      updateMany: async ({
        where,
        data,
      }: {
        where: { workspaceId: string; taskRunId: string; revokedAt: null };
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const row of grantRows) {
          if (
            row.workspaceId === where.workspaceId &&
            row.taskRunId === where.taskRunId &&
            row.revokedAt === null
          ) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
    },
  };
  return { prisma, grantRows };
}

function fakeSecretsClient() {
  const secretRows: Array<Record<string, unknown>> = [];
  const prisma = {
    codingProjectSecret: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        secretRows.push({ ...data });
        return data;
      },
      findUnique: async ({
        where,
      }: {
        where: { workspaceId_name: { workspaceId: string; name: string } };
      }) =>
        secretRows.find(
          (row) =>
            row.workspaceId === where.workspaceId_name.workspaceId &&
            row.name === where.workspaceId_name.name,
        ) ?? null,
      findMany: async ({ where }: { where: { workspaceId: string } }) =>
        secretRows.filter((row) => row.workspaceId === where.workspaceId),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = secretRows.find((entry) => entry.id === where.id);
        if (!row) throw new Error("row not found");
        Object.assign(row, data);
        return row;
      },
      deleteMany: async () => ({ count: 0 }),
      count: async () => secretRows.length,
    },
  };
  return { prisma, secretRows };
}

async function service(now: () => Date = () => new Date("2026-10-02T06:00:00Z")) {
  const dir = await mkdtemp(path.join(tmpdir(), "rakazo-s3-grants-"));
  const grantsClient = fakeGrantClient();
  const secretsClient = fakeSecretsClient();
  const store = createProjectSecretsStore({
    prisma: secretsClient.prisma as never,
    secretStore: new EncryptedSecretStore("s3-grants-test-key"),
    now,
  });
  await store.set({ workspaceId: "ws-1", name: "github_token", plaintext: "ghp_grantvalue" });
  await store.set({ workspaceId: "ws-1", name: "npm_token", plaintext: "npm_grantvalue" });
  const sessionUpdates: Array<Record<string, unknown>> = [];
  const grants = createSecretsGrantsService({
    prisma: {
      codingSecretGrant: (grantsClient.prisma as Record<string, unknown>).codingSecretGrant,
      codingSession: {
        update: async (args: Record<string, unknown>) => {
          sessionUpdates.push(args);
          return {};
        },
      },
    } as never,
    store,
    auditFile: path.join(dir, "audit.jsonl"),
    driverKind: "process",
    now,
  });
  return { grants, dir, grantRows: grantsClient.grantRows, sessionUpdates };
}

const BOOT = { botId: "bot-1", actor: "user" };

describe("grants (T15, V9)", () => {
  it("grants only declared names that exist in the project store; refusal is explicit and lists the missing", async () => {
    const { grants } = await service();
    await expect(
      grants.grantSecretsForRun({
        ...BOOT,
        workspaceId: "ws-1",
        taskRunId: "run-1",
        names: ["github_token", "does_not_exist"],
      }),
    ).rejects.toThrow(/does_not_exist/);
    // Deny-by-default: the failed grant left NOTHING behind.
    const resolved = await grants.resolveGrantedSecrets({
      workspaceId: "ws-1",
      taskRunId: "run-1",
    });
    expect(resolved.env).toEqual({});
  });

  it("refuses wildcards and malformed names at declaration (v1: no wildcards)", async () => {
    const { grants } = await service();
    await expect(
      grants.grantSecretsForRun({ ...BOOT, workspaceId: "ws-1", taskRunId: "run-1", names: ["*"] }),
    ).rejects.toThrow(/wildcard|invalid name/i);
    await expect(
      grants.grantSecretsForRun({
        ...BOOT,
        workspaceId: "ws-1",
        taskRunId: "run-1",
        names: ["github_token", "GITHUB_TOKEN"],
      }),
    ).rejects.toThrow(/GITHUB_TOKEN/);
  });

  it("injection resolves granted names ONLY — an existing but ungranted secret never resolves", async () => {
    const { grants } = await service();
    await grants.grantSecretsForRun({
      ...BOOT,
      workspaceId: "ws-1",
      taskRunId: "run-1",
      names: ["github_token"],
    });
    const resolved = await grants.resolveGrantedSecrets({
      workspaceId: "ws-1",
      taskRunId: "run-1",
    });
    expect(Object.keys(resolved.env)).toEqual(["github_token"]);
    expect(resolved.env.github_token).toBe("ghp_grantvalue");
    // npm_token exists in the store but was never granted for this run.
    expect(resolved.env.npm_token).toBeUndefined();
  });

  it("TTL per (workspace, taskRun): expiry is grantedAt + the ratified 10-minute default", async () => {
    const { grants } = await service();
    const result = await grants.grantSecretsForRun({
      ...BOOT,
      workspaceId: "ws-1",
      taskRunId: "run-1",
      names: ["github_token"],
    });
    expect(SECRETS_GRANT_TTL_SECONDS).toBe(600);
    expect(result.grants[0]!.grantedAt).toEqual(new Date("2026-10-02T06:00:00Z"));
    expect(result.grants[0]!.expiresAt).toEqual(new Date("2026-10-02T06:10:00Z"));
  });

  it("grants are scoped to the (workspace, taskRun) pair — another run does not inherit them", async () => {
    const { grants } = await service();
    await grants.grantSecretsForRun({
      ...BOOT,
      workspaceId: "ws-1",
      taskRunId: "run-1",
      names: ["github_token"],
    });
    const other = await grants.resolveGrantedSecrets({ workspaceId: "ws-1", taskRunId: "run-2" });
    expect(other.env).toEqual({});
    const otherWs = await grants.resolveGrantedSecrets({ workspaceId: "ws-2", taskRunId: "run-1" });
    expect(otherWs.env).toEqual({});
  });

  it("prepareTaskSecretInjection audits inject BEFORE handing values to the provider (audit-then-act)", async () => {
    const { grants, dir } = await service();
    const applied: Array<{ taskId: string; keys: string[]; ref: unknown }> = [];
    const provider = {
      applySecretGrant: async (taskId: string, env: Record<string, string>, ref: unknown) => {
        applied.push({ taskId, keys: Object.keys(env), ref });
      },
    };
    await grants.grantSecretsForRun({
      ...BOOT,
      workspaceId: "ws-1",
      taskRunId: "run-1",
      names: ["github_token"],
    });
    const outcome = await grants.prepareTaskSecretInjection({
      provider: provider as never,
      taskId: "task-1",
      workspaceId: "ws-1",
      taskRunId: "run-1",
      sessionId: "session-1",
    });
    expect(outcome.injected).toBe(true);
    expect(applied).toHaveLength(1);
    expect(applied[0]!.keys).toEqual(["github_token"]);
    expect(applied[0]!.taskId).toBe("task-1");
    // The audit chain already contains the inject event AND the returned head
    // matches the chain (the run-record checkpoint is part of the flow).
    expect(outcome.auditHead).toBeTruthy();
    const verify = await verifySecretsAuditChain({
      file: path.join(dir, "audit.jsonl"),
      expectedHead: outcome.auditHead,
    });
    expect(verify.ok).toBe(true);
    expect(verify.entries.map((entry) => entry.mechanism)).toEqual(["grant", "inject"]);
  });

  it("refuses injection through a provider that cannot guarantee spawn-env injection (T21, structural)", async () => {
    const { grants } = await service();
    await grants.grantSecretsForRun({
      ...BOOT,
      workspaceId: "ws-1",
      taskRunId: "run-1",
      names: ["github_token"],
    });
    await expect(
      grants.prepareTaskSecretInjection({
        provider: {} as never, // no applySecretGrant capability
        taskId: "task-1",
        workspaceId: "ws-1",
        taskRunId: "run-1",
      }),
    ).rejects.toThrow(/spawn-env injection cannot be guaranteed/i);
  });
});

describe("revocation + rotation (T19, V11)", () => {
  it("revoke without force is enforced at the NEXT start; the message documents it", async () => {
    const { grants, dir } = await service();
    await grants.grantSecretsForRun({
      ...BOOT,
      workspaceId: "ws-1",
      taskRunId: "run-1",
      names: ["github_token"],
    });
    let stopped = false;
    const outcome = await grants.revokeGrant({
      ...BOOT,
      workspaceId: "ws-1",
      taskRunId: "run-1",
      force: false,
      stopNow: async () => {
        stopped = true;
      },
    });
    expect(stopped).toBe(false); // no force: the task is NOT stopped now
    expect(outcome.disclosure).toMatch(/next start/i);
    const resolved = await grants.resolveGrantedSecrets({
      workspaceId: "ws-1",
      taskRunId: "run-1",
    });
    expect(resolved.env).toEqual({});
    expect(resolved.refused).toEqual([{ name: "github_token", reason: "revoked" }]);
    const verify = await verifySecretsAuditChain({ file: path.join(dir, "audit.jsonl") });
    expect(verify.entries.map((entry) => entry.mechanism)).toEqual(["grant", "revoke"]);
  });

  it("revoke with --force stops the task NOW", async () => {
    const { grants, dir } = await service();
    await grants.grantSecretsForRun({
      ...BOOT,
      workspaceId: "ws-1",
      taskRunId: "run-1",
      names: ["github_token"],
    });
    let stopped = false;
    const outcome = await grants.revokeGrant({
      ...BOOT,
      workspaceId: "ws-1",
      taskRunId: "run-1",
      force: true,
      stopNow: async () => {
        stopped = true;
      },
    });
    expect(stopped).toBe(true);
    expect(outcome.forced).toBe(true);
    const verify = await verifySecretsAuditChain({ file: path.join(dir, "audit.jsonl") });
    expect(verify.entries.map((entry) => entry.mechanism)).toEqual(["grant", "revoke-force"]);
  });

  it("--force without a stop handle refuses explicitly instead of pretending to stop", async () => {
    const { grants } = await service();
    await grants.grantSecretsForRun({
      ...BOOT,
      workspaceId: "ws-1",
      taskRunId: "run-1",
      names: ["github_token"],
    });
    await expect(
      grants.revokeGrant({ ...BOOT, workspaceId: "ws-1", taskRunId: "run-1", force: true }),
    ).rejects.toThrow(/stop/i);
  });

  it("TTL expiry is enforced at the next start and audited once", async () => {
    let clock = new Date("2026-10-02T06:00:00Z").getTime();
    const { grants, dir } = await service(() => new Date(clock));
    await grants.grantSecretsForRun({
      ...BOOT,
      workspaceId: "ws-1",
      taskRunId: "run-1",
      names: ["github_token"],
    });
    clock = new Date("2026-10-02T06:11:00Z").getTime(); // past the 10-minute TTL
    const resolved = await grants.resolveGrantedSecrets({
      workspaceId: "ws-1",
      taskRunId: "run-1",
    });
    expect(resolved.env).toEqual({});
    expect(resolved.refused).toEqual([{ name: "github_token", reason: "expired" }]);
    await grants.resolveGrantedSecrets({ workspaceId: "ws-1", taskRunId: "run-1" });
    const verify = await verifySecretsAuditChain({ file: path.join(dir, "audit.jsonl") });
    const expires = verify.entries.filter((entry) => entry.mechanism === "expire");
    expect(expires).toHaveLength(1); // audited once, not per repeated resolve
  });

  it("rotation marks grants stale: refusal at next start until an explicit re-grant", async () => {
    let clock = new Date("2026-10-02T06:00:00Z").getTime();
    const { grants, dir } = await service(() => new Date(clock));
    await grants.grantSecretsForRun({
      ...BOOT,
      workspaceId: "ws-1",
      taskRunId: "run-1",
      names: ["github_token"],
    });
    clock = new Date("2026-10-02T06:05:00Z").getTime();
    await grants.rotateSecret({
      workspaceId: "ws-1",
      name: "github_token",
      plaintext: "ghp_rotated",
    });
    const resolved = await grants.resolveGrantedSecrets({
      workspaceId: "ws-1",
      taskRunId: "run-1",
    });
    expect(resolved.env).toEqual({});
    expect(resolved.refused).toEqual([{ name: "github_token", reason: "stale" }]);
    // Re-grant after rotation resolves again (with the NEW value).
    await grants.grantSecretsForRun({
      ...BOOT,
      workspaceId: "ws-1",
      taskRunId: "run-1",
      names: ["github_token"],
    });
    const after = await grants.resolveGrantedSecrets({ workspaceId: "ws-1", taskRunId: "run-1" });
    expect(after.env.github_token).toBe("ghp_rotated");
    const verify = await verifySecretsAuditChain({ file: path.join(dir, "audit.jsonl") });
    expect(verify.entries.map((entry) => entry.mechanism)).toEqual([
      "grant",
      "rotate",
      "stale",
      "grant",
    ]);
  });
});

describe("fail-closed + disclosure (T21, V11)", () => {
  it("a driver that cannot guarantee spawn-env injection disables secrets with an explicit disclosure — never silent", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rakazo-s3-grants-off-"));
    try {
      await mkdir(dir, { recursive: true });
      // store is deliberately UNDEFINED: the fail-closed check must fire
      // before the store is ever touched (a TypeError here would mean the
      // guard does not run first).
      const grants = createSecretsGrantsService({
        prisma: fakeGrantClient().prisma as never,
        store: undefined as never,
        auditFile: path.join(dir, "audit.jsonl"),
        driverKind: "future-container",
      });
      await expect(
        grants.grantSecretsForRun({
          ...BOOT,
          workspaceId: "ws-1",
          taskRunId: "run-1",
          names: ["github_token"],
        }),
      ).rejects.toBeInstanceOf(SecretsDisabledError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("the confidentiality-bounded-by-threat-model disclosure rides the grant result and the disabled error", async () => {
    const { grants } = await service();
    const result = await grants.grantSecretsForRun({
      ...BOOT,
      workspaceId: "ws-1",
      taskRunId: "run-1",
      names: ["github_token"],
    });
    expect(result.disclosure).toBe(SECRETS_CONFIDENTIALITY_DISCLOSURE);
    expect(SECRETS_CONFIDENTIALITY_DISCLOSURE).toMatch(/same-UID/i);
    expect(SECRETS_CONFIDENTIALITY_DISCLOSURE).toMatch(/threat model/i);
    let disabledMessage = "";
    try {
      const disabled = createSecretsGrantsService({
        prisma: fakeGrantClient().prisma as never,
        store: undefined as never,
        auditFile: path.join(tmpdir(), "audit-off.jsonl"),
        driverKind: "desktop",
      });
      await disabled.grantSecretsForRun({
        ...BOOT,
        workspaceId: "ws-1",
        taskRunId: "run-1",
        names: ["github_token"],
      });
    } catch (error) {
      disabledMessage = error instanceof Error ? error.message : String(error);
    }
    expect(disabledMessage).toMatch(/same-UID/i);
    expect(disabledMessage).toMatch(/threat model/i);
  });
});
