-- Lifecycle deletion is allowed; event rows are otherwise immutable.
CREATE OR REPLACE FUNCTION protect_activity_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Activity events are append-only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Player" WHERE "id" = NEW."actorId" AND "email" IS NOT NULL AND "passwordHash" IS NOT NULL) THEN
    RAISE EXCEPTION 'Activity requires a registered actor';
  END IF;
  IF NEW."gameId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Game" WHERE "id" = NEW."gameId" AND "userId" = NEW."actorId") THEN
    RAISE EXCEPTION 'Activity game must belong to the actor';
  END IF;
  IF NEW."achievementId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "UserAchievement" WHERE "id" = NEW."achievementId" AND "userId" = NEW."actorId") THEN
    RAISE EXCEPTION 'Activity achievement must belong to the actor';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "ActivityEvent_protect" ON "ActivityEvent";
CREATE TRIGGER "ActivityEvent_protect" BEFORE INSERT OR UPDATE ON "ActivityEvent"
FOR EACH ROW EXECUTE FUNCTION protect_activity_event();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ActivityEvent_valid_source' AND conrelid = '"ActivityEvent"'::regclass) THEN
    ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_valid_source" CHECK (
      ("type" IN ('game_started', 'game_completed', 'game_flatlined', 'rating_logged') AND "gameId" IS NOT NULL AND "achievementId" IS NULL) OR
      ("type" = 'achievement_unlocked' AND "achievementId" IS NOT NULL AND "gameId" IS NULL) OR
      ("type" = 'library_imported' AND "gameId" IS NULL AND "achievementId" IS NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ActivityEvent_object_payload' AND conrelid = '"ActivityEvent"'::regclass) THEN
    ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_object_payload" CHECK (jsonb_typeof("metadata") = 'object' AND length("deduplicationKey") BETWEEN 1 AND 200);
  END IF;
END $$;
