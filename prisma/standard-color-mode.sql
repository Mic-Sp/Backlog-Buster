-- Add an independent Standard appearance preference without rewriting existing themes.
ALTER TABLE "Player" ADD COLUMN IF NOT EXISTS "preferredColorMode" TEXT NOT NULL DEFAULT 'system';
