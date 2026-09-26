-- Client browser command channel: server → desktop app browser commands.
CREATE TABLE "client_browser_commands" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT,
    "runId" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "client_browser_commands_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "client_browser_commands_userId_status_idx" ON "client_browser_commands"("userId", "status");

-- Desktop availability heartbeat (one row per user).
CREATE TABLE "client_browser_sessions" (
    "userId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appVersion" TEXT,
    CONSTRAINT "client_browser_sessions_pkey" PRIMARY KEY ("userId")
);
