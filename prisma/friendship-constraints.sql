-- Run after prisma db push: CHECK constraints cannot be expressed in Prisma.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Friendship_canonical_pair' AND conrelid = '"Friendship"'::regclass) THEN
    ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_canonical_pair"
      CHECK ("playerLowId" COLLATE "C" < "playerHighId" COLLATE "C");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Friendship_valid_state' AND conrelid = '"Friendship"'::regclass) THEN
    ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_valid_state" CHECK (
      ("status" = 'blocked' AND "requestedById" IS NULL AND ("blockedByLow" OR "blockedByHigh")) OR
      ("status" IN ('pending', 'accepted') AND "requestedById" IS NOT NULL AND
        "requestedById" IN ("playerLowId", "playerHighId") AND NOT "blockedByLow" AND NOT "blockedByHigh")
    );
  END IF;
END $$;
