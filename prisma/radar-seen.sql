-- Additive and repeatable. Feed snapshots remain global/public.
CREATE TABLE IF NOT EXISTS "RadarSeen" (
  "userId" TEXT NOT NULL REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "catalogKey" TEXT NOT NULL,
  "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "catalogKey")
);
