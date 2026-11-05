-- Apply BEFORE prisma db push. Safe to rerun on an existing db-push database.
-- npx prisma db execute --file prisma/game-catalog.sql
-- npx prisma db execute --file prisma/catalog-vectors.sql
-- npx prisma db push
-- npx prisma generate
BEGIN;
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "GameCatalog"
  ADD COLUMN IF NOT EXISTS "rawgId" INTEGER,
  ADD COLUMN IF NOT EXISTS "rawgSlug" TEXT,
  ADD COLUMN IF NOT EXISTS "genres" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "seriesHints" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "multiplayer" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "coop" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "onlineCoop" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "localCoop" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "metadataSource" TEXT,
  ADD COLUMN IF NOT EXISTS "metadataUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "featureVector" vector(128),
  ADD COLUMN IF NOT EXISTS "featureVectorVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "featureContentHash" TEXT,
  ADD COLUMN IF NOT EXISTS "featureVectorUpdatedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "GameCatalog_rawgId_idx" ON "GameCatalog"("rawgId");
-- Exact cosine search is sufficient for the initial catalog. Add ANN indexes only
-- after measuring recall/latency; no Scout query consumes these vectors yet.
COMMIT;
