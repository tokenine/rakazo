-- 007-cli-auth-handshake: scoped, revocable CLI tokens (hashed storage).
CREATE TABLE "cli_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "cli_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cli_tokens_tokenHash_key" ON "cli_tokens"("tokenHash");
CREATE INDEX "cli_tokens_userId_idx" ON "cli_tokens"("userId");

ALTER TABLE "cli_tokens" ADD CONSTRAINT "cli_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
