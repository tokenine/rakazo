-- Expert catalog provenance + avatar preset reference on bots.
ALTER TABLE "bots" ADD COLUMN "expertKey" TEXT;
ALTER TABLE "bots" ADD COLUMN "avatarKey" TEXT;
