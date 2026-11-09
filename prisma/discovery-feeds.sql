-- Additive rollout: safe for existing catalog/player data, no table rebuilds.
ALTER TABLE "GameCatalog" ADD COLUMN IF NOT EXISTS "releaseDate" DATE;
CREATE INDEX IF NOT EXISTS "GameCatalog_releaseDate_idx" ON "GameCatalog"("releaseDate");
CREATE TABLE IF NOT EXISTS "DiscoveryFeed" (
  "kind" TEXT PRIMARY KEY,
  "items" JSONB NOT NULL DEFAULT '[]',
  "source" TEXT NOT NULL DEFAULT 'local',
  "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "leaseId" TEXT,
  "leaseUntil" TIMESTAMP(3)
);
