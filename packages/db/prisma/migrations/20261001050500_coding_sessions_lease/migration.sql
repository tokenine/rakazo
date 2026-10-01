-- 004-code-mode Slice 1 (T1): durable coding sessions + exclusive workspace
-- leases. Additive only: two new tables with their indexes; no existing table
-- is altered, renamed, or dropped. The engine value ("normal-pi" | "omp") is
-- validated in the application layer, matching the repo's String-column style.

CREATE TABLE "coding_sessions" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "engine" TEXT NOT NULL DEFAULT 'normal-pi',
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "threadId" TEXT,
  "title" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'active',
  "acceptance" JSONB,
  "refusals" INTEGER NOT NULL DEFAULT 0,
  "latestRunId" TEXT,
  "verification" JSONB,
  "continuationOf" TEXT,
  "engineChangeLabel" TEXT,
  "handoffSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "coding_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "coding_sessions_workspaceId_status_idx" ON "coding_sessions"("workspaceId", "status");
CREATE INDEX "coding_sessions_userId_createdAt_idx" ON "coding_sessions"("userId", "createdAt");
CREATE INDEX "coding_sessions_botId_idx" ON "coding_sessions"("botId");

CREATE TABLE "coding_workspace_leases" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "fence" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "coding_workspace_leases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "coding_workspace_leases_workspaceId_key" ON "coding_workspace_leases"("workspaceId");
CREATE INDEX "coding_workspace_leases_sessionId_idx" ON "coding_workspace_leases"("sessionId");
