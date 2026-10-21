import "server-only";
import { InputError } from "@/lib/action-result";

import { prisma } from "@/lib/prisma";
import { getCurrentPlayerId } from "@/lib/player";
import type { PlayerProfile, PlayerProfileInput } from "@/lib/player-profile-types";

export const publicProfileSelect = {
  id: true, operatorName: true, tagline: true, neonAccent: true,
  avatarUrl: true, featuredTrophyIds: true, updatedAt: true,
} as const;

export function serializePlayerProfile(profile: {
  id: string; operatorName: string; tagline: string; neonAccent: string;
  avatarUrl: string | null; featuredTrophyIds: unknown; updatedAt: Date;
}): PlayerProfile {
  return {
    id: profile.id,
    operatorName: profile.operatorName,
    tagline: profile.tagline,
    neonAccent: profile.neonAccent === "GOLD" || profile.neonAccent === "MAGENTA" ? profile.neonAccent : "CYAN",
    avatarUrl: profile.avatarUrl,
    featuredTrophyIds: Array.isArray(profile.featuredTrophyIds)
      ? profile.featuredTrophyIds.slice(0, 3).map((id: unknown) => typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null)
      : [],
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export async function getCurrentPlayerProfile(): Promise<PlayerProfile> {
  const id = await getCurrentPlayerId();
  const profile = await prisma.player.upsert({
    where: { id }, create: { id }, update: {}, select: publicProfileSelect,
  });
  return serializePlayerProfile(profile);
}

export function validatePlayerProfile(input: unknown): PlayerProfileInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new InputError("Invalid player profile.");
  const value = input as Record<string, unknown>;
  if (typeof value.operatorName !== "string" || value.operatorName.trim().length > 28 ||
      typeof value.tagline !== "string" || value.tagline.trim().length > 64 ||
      typeof value.neonAccent !== "string" || !["CYAN", "GOLD", "MAGENTA"].includes(value.neonAccent) ||
      !Array.isArray(value.featuredTrophyIds) || value.featuredTrophyIds.length > 3 ||
      value.featuredTrophyIds.some((id: unknown) => id !== null &&
        (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1 || id > 2147483647))) {
    throw new InputError("Please provide a valid operator name, tagline, accent, and up to three trophies.");
  }
  const ids = value.featuredTrophyIds as (number | null)[];
  const selected = ids.filter((id) => id !== null);
  if (new Set(selected).size !== selected.length) throw new InputError("Choose a different trophy for each showcase slot.");
  const profile: PlayerProfileInput = {
    operatorName: value.operatorName.trim() || "ANONYMOUS NETRUNNER",
    tagline: value.tagline.trim() || "One more gig. One more legend.",
    neonAccent: value.neonAccent as PlayerProfile["neonAccent"],
    featuredTrophyIds: Array.from({ length: 3 }, (_, index) => ids[index] ?? null),
  };
  if (Object.hasOwn(value, "avatarUrl")) {
    if (value.avatarUrl !== null && typeof value.avatarUrl !== "string") throw new InputError("Invalid avatar URL.");
    const url = typeof value.avatarUrl === "string" ? value.avatarUrl.trim() : "";
    if (url.length > 2048) throw new InputError("Avatar URL is too long.");
    if (url) {
      let parsed: URL;
      try { parsed = new URL(url); } catch { throw new InputError("Use an HTTP or HTTPS avatar URL."); }
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new InputError("Use an HTTP or HTTPS avatar URL.");
    }
    profile.avatarUrl = url || null;
  }
  return profile;
}
