CREATE TABLE "WorkbenchHistoryResult" (
    "id" TEXT NOT NULL,
    "historyId" TEXT,
    "requestId" TEXT,
    "kind" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "metadata" JSONB,
    "savedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cleanedAt" TIMESTAMPTZ(3),
    "filesRemoved" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "WorkbenchHistoryResult_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkbenchHistoryResult_historyId_key" ON "WorkbenchHistoryResult"("historyId");
CREATE INDEX "WorkbenchHistoryResult_cleanedAt_savedAt_idx" ON "WorkbenchHistoryResult"("cleanedAt", "savedAt");
ALTER TABLE "WorkbenchHistoryResult" ADD CONSTRAINT "WorkbenchHistoryResult_historyId_fkey"
    FOREIGN KEY ("historyId") REFERENCES "UserHistory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "WorkbenchHistoryAttachment" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    CONSTRAINT "WorkbenchHistoryAttachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorkbenchHistoryAttachment_resultId_idx" ON "WorkbenchHistoryAttachment"("resultId");
ALTER TABLE "WorkbenchHistoryAttachment" ADD CONSTRAINT "WorkbenchHistoryAttachment_resultId_fkey"
    FOREIGN KEY ("resultId") REFERENCES "WorkbenchHistoryResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WorkbenchHistoryPolicy" (
    "uid" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "autoCleanup" BOOLEAN NOT NULL DEFAULT false,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "excludedRequestIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "lastCleanupAt" TIMESTAMPTZ(3),
    "lastAutoCleanupAt" TIMESTAMPTZ(3),
    "lastCleanup" JSONB,
    CONSTRAINT "WorkbenchHistoryPolicy_pkey" PRIMARY KEY ("uid")
);
