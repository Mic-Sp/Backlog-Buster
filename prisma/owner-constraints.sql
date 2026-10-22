-- Apply after prisma db push. These PostgreSQL constraints cannot be expressed
-- as a normal unique boolean: non-owner (false) must allow multiple accounts.
CREATE UNIQUE INDEX IF NOT EXISTS "Player_single_owner" ON "Player" ("isOwner") WHERE "isOwner" = true;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Player_owner_requires_admin' AND conrelid = '"Player"'::regclass) THEN
    ALTER TABLE "Player" ADD CONSTRAINT "Player_owner_requires_admin" CHECK (NOT "isOwner" OR "isAdmin");
  END IF;
END $$;

CREATE OR REPLACE FUNCTION protect_player_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isOwner" THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'The Owner account cannot be deleted';
    END IF;
    IF NOT NEW."isOwner" OR NOT NEW."isAdmin" OR NEW."id" <> OLD."id" THEN
      RAISE EXCEPTION 'Owner status and identity cannot be removed or transferred';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "Player_protect_owner" ON "Player";
CREATE TRIGGER "Player_protect_owner" BEFORE UPDATE OR DELETE ON "Player"
FOR EACH ROW EXECUTE FUNCTION protect_player_owner();
