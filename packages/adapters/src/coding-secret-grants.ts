/**
 * 004-code-mode S3 — secret grants (T15), revocation/rotation (T19),
 * fail-closed + disclosure (T21). Q10 Option B, ratification constants
 * unchanged: TTL default = the 10-minute lease default; credential name
 * grammar per BotSecretName (no wildcards v1).
 *
 * Gate family of T4 (deny-by-default): a task config declares required
 * secret NAMES before start; only names that exist in the project store can
 * be granted; injection resolves granted names ONLY, per
 * (workspace, taskRun). Refusals are explicit, typed, and audited.
 *
 * Fail-closed (D-Q10 §6): `secretsRuntimeSupport` is the single predicate
 * that decides whether the runtime can guarantee spawn-env injection; the
 * doctor's secrets-state line delegates to the SAME predicate so the gate
 * and the doctor cannot drift. A driver that cannot guarantee injection
 * disables secrets with an explicit disclosure — never silent, and the
 * confidentiality-bounded-by-threat-model note rides the disclosure.
 *
 * Ordering is AUDIT-THEN-ACT: the audit entry is appended before values
 * reach the provider (prepareTaskSecretInjection), so an audit failure can
 * never leave an unaudited injection behind.
 */

import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@rakazo/db";
import {
  isValidProjectSecretName,
  type ProjectSecretsStore,
  projectSecretRef,
} from "./coding-project-secrets.js";
import {
  appendSecretsAudit,
  checkpointSecretsAuditHead,
  SECRETS_AUDIT_GENESIS_HASH,
  type SecretsAuditEntry,
  type SecretsAuditHead,
  verifySecretsAuditChain,
} from "./coding-secrets-audit.js";
import { DEFAULT_LEASE_TTL_MS } from "./coding-session-service.js";

/** Ratified v1: the secrets-grant TTL equals the 10-minute lease default. */
export const SECRETS_GRANT_TTL_MS = DEFAULT_LEASE_TTL_MS;
export const SECRETS_GRANT_TTL_SECONDS = SECRETS_GRANT_TTL_MS / 1000;

/** D-Q10 §5 / plan Risks: the confidentiality boundary, shown at the gate. */
export const SECRETS_CONFIDENTIALITY_DISCLOSURE =
  "Secret confidentiality is bounded by the D-Q9 trusted-code threat model: values are injected into the task's spawn environment, where any same-UID process can read them. This guards accidents, not malice.";

export class SecretsDisabledError extends Error {
  constructor(driverKind: string) {
    super(
      `Secrets are DISABLED for driver ${JSON.stringify(driverKind)}: it does not own the spawn boundary, so a spawn-env injection cannot be guaranteed; secrets features fail closed (D-Q10 §6). ${SECRETS_CONFIDENTIALITY_DISCLOSURE}`,
    );
    this.name = "SecretsDisabledError";
  }
}

export class SecretInjectionUnsupportedError extends Error {
  constructor() {
    super(
      "This runtime provider does not expose the spawn-env injection capability (applySecretGrant), so a spawn-env injection cannot be guaranteed; refusing instead of injecting by another path (D-Q10 §2). " +
        SECRETS_CONFIDENTIALITY_DISCLOSURE,
    );
    this.name = "SecretInjectionUnsupportedError";
  }
}

export class SecretGrantRefusedError extends Error {
  constructor(refusals: Array<{ name: string; reason: string }>) {
    super(
      `Secret grant refused for this start: ${refusals
        .map((r) => `${r.name} (${r.reason})`)
        .join("; ")}. Re-grant the affected names to continue.`,
    );
    this.name = "SecretGrantRefusedError";
    this.refusals = refusals;
  }

  readonly refusals: Array<{ name: string; reason: string }>;
}

/**
 * The single ON/OFF predicate (T21). ON only when the driver owns the spawn
 * boundary so injection can be guaranteed at process spawn/bootstrap env.
 */
export function secretsRuntimeSupport(driverKind: string): {
  enabled: boolean;
  driverKind: string;
  disclosure: string;
} {
  const enabled = driverKind === "process";
  return {
    enabled,
    driverKind,
    disclosure: enabled
      ? `driver 'process' owns the spawn boundary; injection happens at process spawn/bootstrap env only (D-Q10 §2), so the injection guarantee holds. ${SECRETS_CONFIDENTIALITY_DISCLOSURE}`
      : `driver '${driverKind || "none"}' does not own the spawn boundary, so a spawn-env injection cannot be guaranteed; secrets features fail closed (D-Q10 §6). ${SECRETS_CONFIDENTIALITY_DISCLOSURE}`,
  };
}

/** The provider capability only the spawn-owning driver implements (T16). */
export interface SecretInjectionProvider {
  applySecretGrant(
    taskId: string,
    grantedEnv: Record<string, string>,
    ref: { grantRef: string; auditHead: SecretsAuditHead },
  ): Promise<void>;
}

export interface GrantRecord {
  id: string;
  workspaceId: string;
  taskRunId: string;
  secretName: string;
  secretRef: string;
  grantRef: string;
  grantedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** The prisma surface this service uses (also the fake-double contract). */
export interface SecretsGrantsClient {
  codingSecretGrant: {
    upsert(args: {
      where: {
        workspaceId_taskRunId_secretName: {
          workspaceId: string;
          taskRunId: string;
          secretName: string;
        };
      };
      create: GrantRecord;
      update: Partial<GrantRecord>;
    }): Promise<GrantRecord>;
    findMany(args: { where: { workspaceId: string; taskRunId?: string } }): Promise<GrantRecord[]>;
    updateMany(args: {
      where: { workspaceId: string; taskRunId: string; revokedAt: null };
      data: { revokedAt: Date };
    }): Promise<{ count: number }>;
  };
}

export interface SecretsGrantsService {
  readonly driverKind: string;
  grantSecretsForRun(input: {
    workspaceId: string;
    taskRunId: string;
    botId: string;
    actor: string;
    names: string[];
  }): Promise<{
    grantRef: string;
    grants: Array<{ name: string; grantedAt: Date; expiresAt: Date }>;
    disclosure: string;
  }>;
  resolveGrantedSecrets(input: {
    workspaceId: string;
    taskRunId: string;
    botId?: string;
  }): Promise<{
    env: Record<string, string>;
    granted: string[];
    refused: Array<{ name: string; reason: string }>;
  }>;
  prepareTaskSecretInjection(input: {
    provider: unknown;
    taskId: string;
    workspaceId: string;
    taskRunId: string;
    botId?: string;
    sessionId?: string;
  }): Promise<{
    injected: boolean;
    names: string[];
    refused: Array<{ name: string; reason: string }>;
    auditHead: SecretsAuditHead | null;
  }>;
  revokeGrant(input: {
    workspaceId: string;
    taskRunId: string;
    botId: string;
    actor: string;
    force?: boolean;
    stopNow?: () => Promise<void>;
  }): Promise<{ revoked: string[]; forced: boolean; disclosure: string }>;
  rotateSecret(input: {
    workspaceId: string;
    name: string;
    plaintext: string;
    botId?: string;
  }): Promise<void>;
}

export function createSecretsGrantsService(deps: {
  prisma: SecretsGrantsClient;
  store: ProjectSecretsStore;
  auditFile: string;
  driverKind: string;
  now?: () => Date;
}): SecretsGrantsService {
  const now = deps.now ?? (() => new Date());

  async function audit(
    entryData: Omit<SecretsAuditEntry, "seq" | "ts">,
  ): Promise<SecretsAuditHead> {
    const at = now();
    const current = await verifySecretsAuditChain({ file: deps.auditFile });
    const seq = (current.head?.seq ?? 0) + 1;
    const sealed = await appendSecretsAudit(
      { file: deps.auditFile },
      { ...entryData, seq, ts: at.toISOString() },
    );
    return { seq: sealed.seq, hash: sealed.hash, at: at.toISOString() };
  }

  async function auditedOnce(
    entryData: Omit<SecretsAuditEntry, "seq" | "ts">,
    mechanism: string,
  ): Promise<SecretsAuditHead | null> {
    // Enforcement events (expire/stale) are audited once per grant, not per
    // repeated resolve — the chain records the EVENT, not each check.
    const existing = await verifySecretsAuditChain({ file: deps.auditFile });
    if (
      existing.entries.some(
        (entry) =>
          entry.mechanism === mechanism &&
          entry.grantRef === entryData.grantRef &&
          entry.secretName === entryData.secretName,
      )
    ) {
      return existing.head;
    }
    return audit(entryData);
  }

  const service: SecretsGrantsService = {
    driverKind: deps.driverKind,

    async grantSecretsForRun(input) {
      const support = secretsRuntimeSupport(deps.driverKind);
      if (!support.enabled) throw new SecretsDisabledError(deps.driverKind);
      if (input.names.length === 0) {
        throw new Error("Secret grant refused: no secret names were declared.");
      }
      const unique = [...new Set(input.names)];
      for (const name of unique) {
        if (name.includes("*") || !isValidProjectSecretName(name)) {
          throw new Error(
            `Invalid secret name ${JSON.stringify(name)}: wildcards are not supported in v1; names are lowercase letters, digits and underscores.`,
          );
        }
      }
      // Deny-by-default (T4 gate family): every name must exist in the
      // project store BEFORE any grant row is written.
      const missing: string[] = [];
      for (const name of unique) {
        if ((await deps.store.rotationOf(input.workspaceId, name)) === null) {
          missing.push(name);
        }
      }
      if (missing.length > 0) {
        throw new Error(
          `Secret grant refused: no project secret named ${missing.join(", ")} exists for this workspace. Store the secret first, then grant it.`,
        );
      }
      const at = now();
      const expiresAt = new Date(at.getTime() + SECRETS_GRANT_TTL_MS);
      const grantRef = `grant-${randomUUID()}`;
      const metadata = await deps.store.listMetadata(input.workspaceId);
      const grants: Array<{ name: string; grantedAt: Date; expiresAt: Date }> = [];
      for (const name of unique) {
        const secretId = metadata.find((entry) => entry.name === name)?.id;
        const secretRef = secretId ? projectSecretRef(secretId) : name;
        // An explicit re-grant refreshes the TTL window and is the ONLY path
        // back after revoke/stale — the grant action itself is audited.
        await deps.prisma.codingSecretGrant.upsert({
          where: {
            workspaceId_taskRunId_secretName: {
              workspaceId: input.workspaceId,
              taskRunId: input.taskRunId,
              secretName: name,
            },
          },
          create: {
            id: randomUUID(),
            workspaceId: input.workspaceId,
            taskRunId: input.taskRunId,
            secretName: name,
            secretRef,
            grantRef,
            grantedAt: at,
            expiresAt,
            revokedAt: null,
          },
          update: {
            secretRef,
            grantRef,
            grantedAt: at,
            expiresAt,
            revokedAt: null,
          },
        });
        grants.push({ name, grantedAt: at, expiresAt });
        await audit({
          actor: input.actor,
          botId: input.botId,
          workspaceId: input.workspaceId,
          taskRunId: input.taskRunId,
          secretName: name,
          secretRef,
          mechanism: "grant",
          ttl: SECRETS_GRANT_TTL_SECONDS,
          grantRef,
        });
      }
      return { grantRef, grants, disclosure: SECRETS_CONFIDENTIALITY_DISCLOSURE };
    },

    async resolveGrantedSecrets(input) {
      const support = secretsRuntimeSupport(deps.driverKind);
      if (!support.enabled) throw new SecretsDisabledError(deps.driverKind);
      const rows = await deps.prisma.codingSecretGrant.findMany({
        where: { workspaceId: input.workspaceId, taskRunId: input.taskRunId },
      });
      const env: Record<string, string> = {};
      const granted: string[] = [];
      const refused: Array<{ name: string; reason: string }> = [];
      const at = now();
      for (const row of rows) {
        if (row.revokedAt) {
          refused.push({ name: row.secretName, reason: "revoked" });
          continue;
        }
        if (row.expiresAt.getTime() <= at.getTime()) {
          refused.push({ name: row.secretName, reason: "expired" });
          await auditedOnce(
            {
              actor: "system:ttl",
              botId: input.botId ?? "",
              workspaceId: row.workspaceId,
              taskRunId: row.taskRunId,
              secretName: row.secretName,
              secretRef: row.secretRef,
              mechanism: "expire",
              ttl: SECRETS_GRANT_TTL_SECONDS,
              grantRef: row.grantRef,
            },
            "expire",
          );
          continue;
        }
        const rotatedAt = await deps.store.rotationOf(input.workspaceId, row.secretName);
        if (rotatedAt && rotatedAt.getTime() > row.grantedAt.getTime()) {
          refused.push({ name: row.secretName, reason: "stale" });
          await auditedOnce(
            {
              actor: "settings:rotation",
              botId: input.botId ?? "",
              workspaceId: row.workspaceId,
              taskRunId: row.taskRunId,
              secretName: row.secretName,
              secretRef: row.secretRef,
              mechanism: "stale",
              ttl: SECRETS_GRANT_TTL_SECONDS,
              grantRef: row.grantRef,
            },
            "stale",
          );
          continue;
        }
        env[row.secretName] = await deps.store.getDecrypted(input.workspaceId, row.secretName);
        granted.push(row.secretName);
      }
      return { env, granted, refused };
    },

    async prepareTaskSecretInjection(input) {
      const support = secretsRuntimeSupport(deps.driverKind);
      if (!support.enabled) throw new SecretsDisabledError(deps.driverKind);
      const resolved = await service.resolveGrantedSecrets({
        workspaceId: input.workspaceId,
        taskRunId: input.taskRunId,
        botId: input.botId,
      });
      if (resolved.refused.length > 0) {
        throw new SecretGrantRefusedError(resolved.refused);
      }
      const names = Object.keys(resolved.env);
      if (names.length === 0) {
        return { injected: false, names: [], refused: [], auditHead: null };
      }
      const provider = input.provider as SecretInjectionProvider | null;
      if (!provider || typeof provider.applySecretGrant !== "function") {
        // T21 structural fail-closed: no capability, no injection, explicit.
        throw new SecretInjectionUnsupportedError();
      }
      const rows = await deps.prisma.codingSecretGrant.findMany({
        where: { workspaceId: input.workspaceId, taskRunId: input.taskRunId },
      });
      const grantRef = rows[0]?.grantRef ?? `grant-${randomUUID()}`;
      let head: SecretsAuditHead = { seq: 0, hash: SECRETS_AUDIT_GENESIS_HASH };
      for (const name of names) {
        head = await audit({
          actor: "system:spawn",
          botId: input.botId ?? "",
          workspaceId: input.workspaceId,
          taskRunId: input.taskRunId,
          secretName: name,
          secretRef: name,
          mechanism: "inject",
          ttl: SECRETS_GRANT_TTL_SECONDS,
          grantRef,
        });
      }
      // Audit-then-act: the entries above are durable before any value moves.
      await provider.applySecretGrant(input.taskId, resolved.env, { grantRef, auditHead: head });
      if (input.sessionId) {
        await checkpointSecretsAuditHead({
          prisma: deps.prisma as unknown as PrismaClient,
          sessionId: input.sessionId,
          head,
        });
      }
      return { injected: true, names, refused: [], auditHead: head };
    },

    async revokeGrant(input) {
      const support = secretsRuntimeSupport(deps.driverKind);
      if (!support.enabled) throw new SecretsDisabledError(deps.driverKind);
      const force = input.force ?? false;
      if (force && !input.stopNow) {
        throw new Error(
          "revoke --force requires the task stop handle; refusing to pretend the task was stopped.",
        );
      }
      const at = now();
      const rows = await deps.prisma.codingSecretGrant.findMany({
        where: { workspaceId: input.workspaceId, taskRunId: input.taskRunId },
      });
      const active = rows.filter((row) => !row.revokedAt);
      await deps.prisma.codingSecretGrant.updateMany({
        where: { workspaceId: input.workspaceId, taskRunId: input.taskRunId, revokedAt: null },
        data: { revokedAt: at },
      });
      for (const row of active) {
        await audit({
          actor: input.actor,
          botId: input.botId,
          workspaceId: row.workspaceId,
          taskRunId: row.taskRunId,
          secretName: row.secretName,
          secretRef: row.secretRef,
          mechanism: force ? "revoke-force" : "revoke",
          ttl: SECRETS_GRANT_TTL_SECONDS,
          grantRef: row.grantRef,
        });
      }
      let forced = false;
      if (force && input.stopNow) {
        await input.stopNow();
        forced = true;
      }
      return {
        revoked: active.map((row) => row.secretName),
        forced,
        disclosure: force
          ? "Revoked with --force: the task was stopped now."
          : "Revoked without --force: revocation is enforced at the task's next start (documented); the running task is not interrupted.",
      };
    },

    async rotateSecret(input) {
      const support = secretsRuntimeSupport(deps.driverKind);
      if (!support.enabled) throw new SecretsDisabledError(deps.driverKind);
      const result = await deps.store.set(input);
      await audit({
        actor: "settings:rotation",
        botId: input.botId ?? "",
        workspaceId: input.workspaceId,
        taskRunId: "",
        secretName: input.name,
        secretRef: projectSecretRef(result.id),
        mechanism: "rotate",
        ttl: SECRETS_GRANT_TTL_SECONDS,
        grantRef: "n/a",
      });
    },
  };
  return service;
}
