-- Initial/default repair for Steam-linked rows. Explicit categories always win.
UPDATE "Game" SET "ownershipType" = 'Digital'::"OwnershipType"
WHERE "steamAppId" IS NOT NULL AND "ownershipType" IS NULL;
