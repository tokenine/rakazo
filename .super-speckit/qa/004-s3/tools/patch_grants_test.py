"""One-shot S3 patch: test fake grant client gains upsert semantics."""
from pathlib import Path

path = Path("packages/adapters/src/coding-secret-grants.test.ts")
src = path.read_text()

old = """function fakeGrantClient() {
  const grantRows: Array<Record<string, unknown>> = [];
  const prisma = {
    codingSecretGrant: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        grantRows.push({ ...data });
        return data;
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
}"""

new = """function fakeGrantClient() {
  const grantRows: Array<Record<string, unknown>> = [];
  const prisma = {
    codingSecretGrant: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: {
          workspaceId_taskRunId_secretName: { workspaceId: string; taskRunId: string; secretName: string };
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
}"""

assert old in src, "fake client anchor not found"
path.write_text(src.replace(old, new, 1))
print("test fake patched")
