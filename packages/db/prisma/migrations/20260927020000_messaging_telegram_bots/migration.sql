-- Per-user Telegram bots: each user registers their own BotFather token and
-- the deployment hosts a dedicated webhook + adapter for it.
CREATE TABLE "messaging_telegram_bots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "tokenCiphertext" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messaging_telegram_bots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "messaging_telegram_bots_userId_key" ON "messaging_telegram_bots"("userId");

ALTER TABLE "messaging_telegram_bots" ADD CONSTRAINT "messaging_telegram_bots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
