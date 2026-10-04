-- 004-code-mode Slice 5 (T29): authenticated preview sharing.
-- Additive only: two new tables with their indexes; no existing table is
-- altered, renamed, or dropped.
--
-- Private by default: previews exist only for workspace members and explicit
-- PreviewAccess grants. The grant is token-backed so the token can be revoked
-- without deleting the row (a later migration can harden token storage).
--
-- Protected path: additive-only migration. Flagged for independent review
-- before merge.

CREATE TABLE "previews" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "previews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "previews_workspaceId_idx" ON "previews"("workspaceId");

CREATE TABLE "preview_accesses" (
  "id" TEXT NOT NULL,
  "previewId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "preview_accesses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "preview_accesses_previewId_userId_key" ON "preview_accesses"("previewId", "userId");

CREATE INDEX "preview_accesses_userId_idx" ON "preview_accesses"("userId");
