-- Multi-session agents: a bot may own several threads (sessions). Existing
-- bot threads become the bot's primary session, so every legacy botId-keyed
-- caller (messaging, routines, web shell) keeps landing on the same thread.
DROP INDEX "threads_botId_key";
CREATE INDEX "threads_botId_idx" ON "threads"("botId");

ALTER TABLE "threads" ADD COLUMN "name" TEXT;
ALTER TABLE "threads" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- Every existing bot thread is the bot's only session today, so it is primary.
UPDATE "threads" SET "isPrimary" = true WHERE "botId" IS NOT NULL;

-- At most one primary session per bot (group/external threads are never primary).
CREATE UNIQUE INDEX "threads_botId_isPrimary_key" ON "threads"("botId")
  WHERE "isPrimary" AND "botId" IS NOT NULL;
