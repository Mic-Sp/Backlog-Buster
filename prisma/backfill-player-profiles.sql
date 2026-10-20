-- Additive upgrade for this project's existing db-push database.
-- Apply with: npx prisma db execute --file prisma/backfill-player-profiles.sql
-- Then run prisma db push and prisma generate. No existing column is renamed.
BEGIN;

-- Prevent owner IDs changing between backfill and foreign-key validation.
LOCK TABLE "Game", "UserAchievement" IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE player_backfill_integrity ON COMMIT DROP AS
SELECT
  (SELECT COUNT(*) FROM "Game") AS game_count,
  (SELECT md5(COALESCE(string_agg(to_jsonb(g)::text, '' ORDER BY g."id"), '')) FROM "Game" g) AS game_hash,
  (SELECT COUNT(*) FROM "UserAchievement") AS achievement_count,
  (SELECT md5(COALESCE(string_agg(to_jsonb(a)::text, '' ORDER BY a."id"), '')) FROM "UserAchievement" a) AS achievement_hash;

CREATE TABLE IF NOT EXISTS "Player" (
  "id" TEXT NOT NULL,
  "email" TEXT,
  "passwordHash" TEXT,
  "handle" TEXT,
  "operatorName" TEXT NOT NULL DEFAULT 'ANONYMOUS NETRUNNER',
  "tagline" TEXT NOT NULL DEFAULT 'One more gig. One more legend.',
  "neonAccent" TEXT NOT NULL DEFAULT 'CYAN',
  "avatarUrl" TEXT,
  "featuredTrophyIds" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Player_email_key" ON "Player"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "Player_handle_key" ON "Player"("handle");

-- Include getCurrentPlayerId()'s local ID even if its library is empty, plus
-- every owner from either legacy table. Preserve any existing Player profiles.
INSERT INTO "Player" ("id", "updatedAt")
SELECT owners."userId", CURRENT_TIMESTAMP
FROM (
  SELECT "userId" FROM "Game"
  UNION SELECT "userId" FROM "UserAchievement"
  UNION SELECT 'default-player'
) owners
ON CONFLICT ("id") DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Game_userId_fkey' AND conrelid = '"Game"'::regclass) THEN
    ALTER TABLE "Game" ADD CONSTRAINT "Game_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserAchievement_userId_fkey' AND conrelid = '"UserAchievement"'::regclass) THEN
    ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Abort the entire upgrade if a legacy row or value changed.
DO $$
DECLARE baseline RECORD;
BEGIN
  SELECT * INTO baseline FROM player_backfill_integrity;
  IF baseline.game_count <> (SELECT COUNT(*) FROM "Game")
    OR baseline.game_hash <> (SELECT md5(COALESCE(string_agg(to_jsonb(g)::text, '' ORDER BY g."id"), '')) FROM "Game" g)
    OR baseline.achievement_count <> (SELECT COUNT(*) FROM "UserAchievement")
    OR baseline.achievement_hash <> (SELECT md5(COALESCE(string_agg(to_jsonb(a)::text, '' ORDER BY a."id"), '')) FROM "UserAchievement" a)
  THEN
    RAISE EXCEPTION 'Player backfill changed legacy data; rolling back.';
  END IF;
END $$;

COMMIT;
