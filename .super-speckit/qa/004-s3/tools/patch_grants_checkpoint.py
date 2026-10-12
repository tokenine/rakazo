"""One-shot S3 patch: grants service checkpoints the audit head on every event
when the caller provides the session context, so 'chain head matches run
record' (V10) holds after ANY event, not just injection."""
from pathlib import Path

path = Path("packages/adapters/src/coding-secret-grants.ts")
src = path.read_text()

# 1. resolveGrantedSecrets: accept + checkpoint sessionId (expire/stale events)
old = """  resolveGrantedSecrets(input: {
    workspaceId: string;
    taskRunId: string;
    botId?: string;
  }): Promise<{"""
new = """  resolveGrantedSecrets(input: {
    workspaceId: string;
    taskRunId: string;
    botId?: string;
    /** When present, expire/stale audits re-checkpoint the run-record head. */
    sessionId?: string;
  }): Promise<{"""
assert old in src, "resolve signature anchor"
src = src.replace(old, new, 1)

# 2. revokeGrant input + checkpoint after audits
old = """  revokeGrant(input: {
    workspaceId: string;
    taskRunId: string;
    botId: string;
    actor: string;
    force?: boolean;
    stopNow?: () => Promise<void>;
  }): Promise<{ revoked: string[]; forced: boolean; disclosure: string }>;"""
new = """  revokeGrant(input: {
    workspaceId: string;
    taskRunId: string;
    botId: string;
    actor: string;
    force?: boolean;
    stopNow?: () => Promise<void>;
    /** When present, the revoke audits re-checkpoint the run-record head. */
    sessionId?: string;
  }): Promise<{ revoked: string[]; forced: boolean; disclosure: string }>;"""
assert old in src, "revoke signature anchor"
src = src.replace(old, new, 1)

# 3. rotateSecret input + checkpoint
old = """  rotateSecret(input: {
    workspaceId: string;
    name: string;
    plaintext: string;
    botId?: string;
  }): Promise<void>;"""
new = """  rotateSecret(input: {
    workspaceId: string;
    name: string;
    plaintext: string;
    botId?: string;
    /** When present, the rotate audit re-checkpoints the run-record head. */
    sessionId?: string;
  }): Promise<void>;"""
assert old in src, "rotate signature anchor"
src = src.replace(old, new, 1)

# 4. resolve: checkpoint after expire/stale audits when sessionId provided
old = """      for (const row of rows) {
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
        }"""
new = """      let head: SecretsAuditHead | null = null;
      for (const row of rows) {
        if (row.revokedAt) {
          refused.push({ name: row.secretName, reason: "revoked" });
          continue;
        }
        if (row.expiresAt.getTime() <= at.getTime()) {
          refused.push({ name: row.secretName, reason: "expired" });
          head = await auditedOnce(
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
          head = await auditedOnce(
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
        }"""
assert old in src, "resolve body anchor"
src = src.replace(old, new, 1)

old = """        env[row.secretName] = await deps.store.getDecrypted(input.workspaceId, row.secretName);
        granted.push(row.secretName);
      }
      return { env, granted, refused };
    },"""
new = """        env[row.secretName] = await deps.store.getDecrypted(input.workspaceId, row.secretName);
        granted.push(row.secretName);
      }
      if (input.sessionId && head) {
        await checkpointSecretsAuditHead({
          prisma: deps.prisma as unknown as PrismaClient,
          sessionId: input.sessionId,
          head,
        });
      }
      return { env, granted, refused };
    },"""
assert old in src, "resolve return anchor"
src = src.replace(old, new, 1)

# 5. revoke: checkpoint after audits
old = """      for (const row of active) {
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
      }"""
new = """      let head: SecretsAuditHead | null = null;
      for (const row of active) {
        head = await audit({
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
      if (input.sessionId && head) {
        await checkpointSecretsAuditHead({
          prisma: deps.prisma as unknown as PrismaClient,
          sessionId: input.sessionId,
          head,
        });
      }"""
assert old in src, "revoke body anchor"
src = src.replace(old, new, 1)

# 6. rotate: checkpoint after audit
old = """      const result = await deps.store.set(input);
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
    },"""
new = """      const result = await deps.store.set(input);
      const head = await audit({
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
      if (input.sessionId) {
        await checkpointSecretsAuditHead({
          prisma: deps.prisma as unknown as PrismaClient,
          sessionId: input.sessionId,
          head,
        });
      }
    },"""
assert old in src, "rotate body anchor"
src = src.replace(old, new, 1)

path.write_text(src)
print("checkpoint-on-event patched")
