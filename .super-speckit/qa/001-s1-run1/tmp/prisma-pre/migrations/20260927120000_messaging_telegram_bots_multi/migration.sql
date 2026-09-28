-- Multiple Telegram bots per user and per deployment: every row becomes its
-- own adapter slot keyed `telegram-u<id>`, so connections coexist instead of
-- the last one taking over the single "telegram" slot.
DROP INDEX "messaging_telegram_bots_userId_key";
CREATE INDEX "messaging_telegram_bots_userId_idx" ON "messaging_telegram_bots"("userId");

-- Telegram-side numeric bot user id (from getMe); lets userConnect update a
-- user's existing row for the same bot instead of adding a duplicate.
ALTER TABLE "messaging_telegram_bots" ADD COLUMN "telegramBotId" TEXT;
