-- Additive, repeatable rollout. No identity backfill from unverified steamId values.
ALTER TABLE "Player" ADD COLUMN IF NOT EXISTS "steamVerifiedId" TEXT;
ALTER TABLE "Player" ADD COLUMN IF NOT EXISTS "steamVerifiedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "Player_steamVerifiedId_key" ON "Player"("steamVerifiedId");
CREATE TABLE IF NOT EXISTS "SteamOpenIDAttempt" (
  "stateHash" TEXT NOT NULL PRIMARY KEY,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "SteamOpenIDAttempt_expiresAt_idx" ON "SteamOpenIDAttempt"("expiresAt");
CREATE TABLE IF NOT EXISTS "SteamOpenIDNonce" (
  "nonceHash" TEXT NOT NULL PRIMARY KEY,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "SteamOpenIDNonce_expiresAt_idx" ON "SteamOpenIDNonce"("expiresAt");
