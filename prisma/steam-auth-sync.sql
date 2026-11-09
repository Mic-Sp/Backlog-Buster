-- Additive and repeatable; no account or session backfill.
ALTER TABLE "Player" ADD COLUMN IF NOT EXISTS "steamLibrarySourceId" TEXT;
CREATE TABLE IF NOT EXISTS "SteamAuthSync" (
  "userId" TEXT NOT NULL PRIMARY KEY REFERENCES "Player"("id") ON DELETE CASCADE,
  "requestId" TEXT NOT NULL,
  "steamId" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseId" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "errorCode" TEXT,
  "addedCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
