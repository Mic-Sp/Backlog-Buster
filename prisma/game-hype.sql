-- Additive and repeatable, matching the repository's SQL migration workflow.
-- Existing games receive Interested (2) without changing their other fields.
BEGIN;
ALTER TABLE "Game" ADD COLUMN IF NOT EXISTS "hypeLevel" INTEGER NOT NULL DEFAULT 2;
CREATE INDEX IF NOT EXISTS "Game_userId_status_hypeLevel_idx" ON "Game"("userId", "status", "hypeLevel");
COMMIT;
