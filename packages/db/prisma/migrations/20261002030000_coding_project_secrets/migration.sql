-- 004-code-mode Slice 3 (T14): per-project encrypted secrets. Additive only:
-- one new table with its indexes; no existing table is altered, renamed, or
-- dropped. Values are sealed with the deployment EncryptedSecretStore (the
-- docs/bot-secrets.md facility's AES-256-GCM primitive, record-bound), the
-- same at-rest encryption the bot_secrets table uses; the row itself carries
-- ciphertext + rotation metadata only. Protected path (super-speckit plan,
-- Risks): additive-only migration, flagged for independent review before
-- merge.

CREATE TABLE "coding_project_secrets" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "coding_project_secrets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "coding_project_secrets_workspaceId_name_key" ON "coding_project_secrets"("workspaceId", "name");
CREATE INDEX "coding_project_secrets_workspaceId_idx" ON "coding_project_secrets"("workspaceId");
