import pathlib

p = pathlib.Path("packages/adapters/src/coding-secret-grants.ts")
s = p.read_text()

old = """      const rows = await deps.prisma.codingSecretGrant.findMany({
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
      await provider.applySecretGrant(input.taskId, resolved.env, { grantRef, auditHead: head });"""
new = """      const rows = await deps.prisma.codingSecretGrant.findMany({
        where: { workspaceId: input.workspaceId, taskRunId: input.taskRunId },
      });
      // S3 fix r2 (LOW-5): a partial re-grant leaves TWO grantRefs on one run.
      // Attribution is per-NAME from the name's OWN row — rows[0]'s ref must
      // never be stamped onto the whole batch (it mislabeled every inject
      // entry after a partial re-grant, and can belong to a name that is not
      // even part of this injection).
      const grantRefForName = (name: string): string =>
        rows.find((row) => row.secretName === name)?.grantRef ?? `grant-${randomUUID()}`;
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
          grantRef: grantRefForName(name),
        });
      }
      // Audit-then-act: the entries above are durable before any value moves.
      // The provider capability carries ONE batch ref (a single grant is the
      // norm); anchor it to the FIRST INJECTED name's own row. Per-name truth
      // for mixed batches lives in the inject audit entries above.
      await provider.applySecretGrant(input.taskId, resolved.env, {
        grantRef: grantRefForName(names[0]!),
        auditHead: head,
      });"""
assert s.count(old) == 1, "injection anchor"
s = s.replace(old, new)

p.write_text(s)
print("low5 fix applied")
