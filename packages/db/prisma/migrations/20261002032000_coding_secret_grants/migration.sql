-- 004-code-mode Slice 3 (T15): durable secret grants per (workspace, taskRun).
-- Additive only: one new table with its indexes; no existing table is
-- altered, renamed, or dropped. Grant TTL/revocation/rotation-staleness must
-- survive restarts ("enforced at next start"), so grant state is durable.
-- Protected path: additive-only migration, flagged for independent review
-- before merge.

CREATE TABLE "coding_secret_grants" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "taskRunId" TEXT NOT NULL,
  "secretName" TEXT NOT NULL,
  "secretRef" TEXT NOT NULL,
  "grantRef" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "coding_secret_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "coding_secret_grants_workspaceId_taskRunId_secretName_key" ON "coding_secret_grants"("workspaceId", "taskRunId", "secretName");
CREATE INDEX "coding_secret_grants_workspaceId_taskRunId_idx" ON "coding_secret_grants"("workspaceId", "taskRunId");
