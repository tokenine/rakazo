-- Skill Store: category for store-installed skills, per-user enable/disable
-- (disabled skills stay visible in the UI but leave prompts and skill_read),
-- and the store slug that marks a row as uninstallable from the store page.
ALTER TABLE "agent_skills" ADD COLUMN "category" TEXT;
ALTER TABLE "agent_skills" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "agent_skills" ADD COLUMN "storeKey" TEXT;
