-- Run after db push, before serving the new client. Idempotent; invents no dates or activity.
UPDATE "Game" SET "playthroughCount" = 1 WHERE "status" = 'Completed' AND "playthroughCount" = 0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Game_valid_playthroughs' AND conrelid = '"Game"'::regclass) THEN
    ALTER TABLE "Game" ADD CONSTRAINT "Game_valid_playthroughs" CHECK (
      "playthroughCount" BETWEEN 0 AND 99 AND ("status" <> 'Completed' OR "playthroughCount" >= 1)
    );
  END IF;
END $$;
