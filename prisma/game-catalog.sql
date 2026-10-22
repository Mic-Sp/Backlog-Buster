-- Additive deployment for existing databases (this repository uses prisma db push).
-- Optional cache: autocomplete also works before this table is deployed.
CREATE TABLE IF NOT EXISTS "GameCatalog" (
  "key" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "releaseYear" INTEGER,
  "platforms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "genre" TEXT,
  "estimatedHours" INTEGER,
  "coverUrl" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "GameCatalog_title_idx" ON "GameCatalog"("title");
