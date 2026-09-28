-- Mirror bot-generated images/documents (artifacts) to linked chat apps.
ALTER TABLE "messaging_outbound" ADD COLUMN "artifactId" TEXT;
