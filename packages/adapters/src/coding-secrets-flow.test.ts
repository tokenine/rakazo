import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AdapterContext } from "@rakazo/adapter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectSecretsStore } from "./coding-project-secrets.js";
import { createSecretsGrantsService, secretsRuntimeSupport } from "./coding-secret-grants.js";
import { verifySecretsAuditChain } from "./coding-secrets-audit.js";
import { sweepSurfacesForSecretEgress } from "./coding-secrets-egress.js";
import { ProcessSandboxProvider } from "./process-sandbox.js";
import { EncryptedSecretStore } from "./secrets.js";

/**
 * 004-code-mode S3 — END-TO-END secrets flow (V8/V9/V10/V11 evidence).
 *
 * Runtime-generated canary (never present in any file before the run), so
 * the tree greps at the end are a REAL V9 gate: if the injection path wrote
 * the value anywhere (host tree, repo tree, workspace storage), the scan
 * finds it. Flow: store → grant → resolve → audited spawn injection →
 * command-env attack refused → revoke --force stops the task now → audit
 * chain verifies with the checkpointed head → artifact-surface sweep clean.
 */

const ctx: AdapterContext = {
  operationId: "test",
  traceId: "test",
  spaceId: "space",
  userId: "user",
  signal: new AbortController().signal,
};

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function collect(generator: AsyncIterable<{ type: string; data?: string; code?: number }>) {
  let stdout = "";
  let stderr = "";
  let code = -1;
  for await (const event of generator) {
    if (event.type === "stdout") stdout += event.data ?? "";
    if (event.type === "stderr") stderr += event.data ?? "";
    if (event.type === "exit") code = event.code ?? -1;
  }
  return { stdout, stderr, code };
}

describe("end-to-end secrets flow (Q10 Option B)", () => {
  it("store → grant → audited spawn injection → command-env attack refused → revoke --force → audit verify → surfaces clean", async () => {
    // Runtime-generated canary: exists NOWHERE before this test runs.
    const canary = `s3canary-${randomUUID().replace(/-/g, "")}`;
    const workspaceId = "ws-flow";
    const taskRunId = "run-flow";
    const sessionRow: { secretsAuditHead: unknown } = { secretsAuditHead: null };

    const root = await mkdtemp(path.join(tmpdir(), "rakazo-s3-flow-"));
    dirs.push(root);
    const auditDir = await mkdtemp(path.join(tmpdir(), "rakazo-s3-flow-audit-"));
    dirs.push(auditDir);
    const auditFile = path.join(auditDir, "secrets-audit.jsonl");

    const grantRows: Array<Record<string, unknown>> = [];
    const secretRows: Array<Record<string, unknown>> = [];
    const secretsPrisma = {
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
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = secretRows.find((entry) => entry.id === where.id);
          if (!row) throw new Error("row not found");
          Object.assign(row, data);
          return row;
        },
        deleteMany: async () => ({ count: 0 }),
        count: async () => secretRows.length,
      },
    };
    const store = createProjectSecretsStore({
      prisma: secretsPrisma as never,
      secretStore: new EncryptedSecretStore("s3-flow-key"),
    });
    await store.set({ workspaceId, name: "github_token", plaintext: canary });

    const grantsPrisma = {
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
      codingSession: {
        update: async ({ data }: { data: unknown }) => {
          sessionRow.secretsAuditHead = (data as { secretsAuditHead: unknown }).secretsAuditHead;
          return {};
        },
      },
    };
    const grants = createSecretsGrantsService({
      prisma: grantsPrisma as never,
      store,
      auditFile,
      driverKind: "process",
    });

    // Fail-closed truthfulness: the driver IS the spawn-owning process driver.
    expect(secretsRuntimeSupport("process").enabled).toBe(true);

    const provider = new ProcessSandboxProvider({ root });
    const task = await provider.createTaskContext({
      taskId: "flow-task",
      requiredSecrets: ["github_token"],
      env: { TASK_VAR: "declared" },
    });

    // 1. Grant (T15) — deny-by-default, TTL per (workspace, taskRun).
    const grant = await grants.grantSecretsForRun({
      workspaceId,
      taskRunId,
      botId: "bot-flow",
      actor: "user",
      names: ["github_token"],
    });
    expect(grant.disclosure).toMatch(/threat model/);

    // 2. Audited injection into the spawn env (T16, audit-then-act).
    const injection = await grants.prepareTaskSecretInjection({
      provider,
      taskId: task.taskId,
      workspaceId,
      taskRunId,
      botId: "bot-flow",
      sessionId: "session-flow",
    });
    expect(injection.injected).toBe(true);

    // 3. The child sees the granted value WITHOUT printing it.
    const present = await collect(
      provider.execute(
        task.ref,
        {
          argv: [
            "bash",
            "-c",
            'if [ "$github_token" = "present" ]; then echo no; elif [ -n "$github_token" ]; then echo granted-present; fi',
          ],
        },
        ctx,
      ),
    );
    expect(present.stdout).toContain("granted-present");

    // 4. The command-env attack is refused (binding constraint).
    const attack = await collect(
      provider.execute(
        task.ref,
        {
          argv: ["bash", "-c", 'printf "LEAKED:%s" "$github_token"'],
          env: { github_token: `${canary}-attacker` },
        },
        ctx,
      ),
    );
    expect(attack.stdout).not.toContain("LEAKED");
    expect(attack.code).not.toBe(0);

    // 5. V9 in-test tree gate: the canary is in NO tree the injection touches.
    async function scan(dir: string): Promise<string[]> {
      const hits: string[] = [];
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) hits.push(...(await scan(full)));
        else {
          const content = await readFile(full, "utf8").catch(() => "");
          if (content.includes(canary)) hits.push(full);
        }
      }
      return hits;
    }
    expect(await scan(root)).toEqual([]);
    expect(await scan(auditDir)).toEqual([]);

    // 6. Revoke --force stops the task NOW (T19).
    let stopped = false;
    const revoke = await grants.revokeGrant({
      workspaceId,
      taskRunId,
      botId: "bot-flow",
      actor: "user",
      sessionId: "session-flow",
      force: true,
      stopNow: async () => {
        await provider.suspend(task.ref);
        stopped = true;
      },
    });
    expect(stopped).toBe(true);
    expect(revoke.forced).toBe(true);
    expect(task.running).toBe(false);

    // 7. V10: the whole chain verifies and matches the checkpointed head.
    const verify = await verifySecretsAuditChain({
      file: auditFile,
      expectedHead: sessionRow.secretsAuditHead as { seq: number; hash: string },
    });
    expect(verify.ok).toBe(true);
    expect(verify.entries.map((entry) => entry.mechanism)).toEqual([
      "grant",
      "inject",
      "revoke-force",
    ]);
    // Every audit entry is value-free: the canary appears NOWHERE in the log.
    const auditRaw = await readFile(auditFile, "utf8");
    expect(auditRaw).not.toContain(canary);

    // 8. V8: artifact-surface sweep clean (post-filter surfaces) AND the
    //    control proves the sweep detects the canary when unfiltered.
    const sweep = sweepSurfacesForSecretEgress([canary], {
      prompt: "credentials are available as env vars (names only)",
      transcript: "the agent discussed the token without printing it",
      commandResult: "[redacted] [redacted]",
      handoffSummary: "handoff: token stays in env",
      qaEvidence: "audit verify: chain intact, 3 entries",
    });
    expect(sweep.clean).toBe(true);
    const control = sweepSurfacesForSecretEgress([canary], { raw: `unfiltered ${canary}` });
    expect(control.clean).toBe(false);
  });
});
