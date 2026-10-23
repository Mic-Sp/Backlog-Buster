import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentPlayerId } from "@/lib/player";
import { lookupRawgGame, resizeRawgImageUrl } from "@/lib/rawg";
import { resolveRawgPlaytime } from "@/lib/game-playtime";
import { normalizeGameTitle } from "@/lib/game-title";
import { isReleasedYear } from "@/lib/game-release";
import { franchiseAffinities, genreNeighbors, generalDiscovery } from "@/lib/scout-catalog";
import type { ScoutAnchor, ScoutDebug } from "@/lib/scout-debug";
import { getAIScoutCandidates } from "@/lib/scout-ai";

import { selectBacklogRecommendations, type AdvisorGame, type BacklogRecommendations } from "@/lib/backlog-advisor";
export type { BacklogRecommendation, BacklogRecommendations } from "@/lib/backlog-advisor";

export type ExternalRecommendation = {
  title: string;
  platform: string;
  genre: string | null;
  releaseYear: number | null;
  coverUrl: string | null;
  lengthHours: number;
  difficulty: 2;
  reason: string;
};

const normalize = (value: string | null) => value?.trim().toLowerCase() ?? "";

export async function getBacklogRecommendations(userId?: string, excludedGameIds: readonly number[] = []): Promise<BacklogRecommendations> {
  userId ??= await getCurrentPlayerId();
  const games = await prisma.game.findMany({
    where: { userId },
    select: {
      id: true, title: true, platform: true, genre: true, lengthHours: true,
      difficulty: true, coverUrl: true, releaseYear: true, status: true, rating: true,
      earnedXp: true, createdAt: true, pinnedOrder: true, franchise: true, chronologicalOrder: true,
    },
  });
  const result = selectBacklogRecommendations(games, excludedGameIds);
  for (const pick of [result.continuationPick, result.palateCleanserPick]) {
    if (pick?.game.coverUrl) pick.game.coverUrl = resizeRawgImageUrl(pick.game.coverUrl);
  }
  return result;
}

type ScoutLibraryGame = Pick<AdvisorGame, "title" | "platform" | "genre" | "status" | "rating" | "earnedXp">;
type ScoutCandidate = { title: string; reason: string; preferredPlatform: string; anchor?: ScoutAnchor };

// Pure deterministic fallback selection; RAWG enrichment remains in the caller.
function selectStaticScoutCandidates(
  games: readonly ScoutLibraryGame[],
  extraExcludedTitles: readonly string[] = [],
): ScoutCandidate[] {
  const excluded = new Set([...games.map((game) => game.title), ...extraExcludedTitles].map(normalizeGameTitle));
  const completed = games.filter((game) => game.status === "Completed");
  const favorites = completed.filter((game) => game.rating !== null && game.rating >= 4)
    .sort((left, right) => (right.rating ?? 0) - (left.rating ?? 0) || right.earnedXp - left.earnedXp || left.title.localeCompare(right.title));
  // Low ratings aren't positive taste signals; unrated completions use earned XP instead.
  const seeds = favorites.length ? favorites : completed.filter((game) => game.rating === null)
    .sort((left, right) => right.earnedXp - left.earnedXp || left.title.localeCompare(right.title));
  if (!seeds.length) return [];

  const pools = seeds.map((seed) => {
    const title = normalizeGameTitle(seed.title);
    const genre = normalize(seed.genre).replace(/role[ -]playing/g, "rpg");
    const franchiseTitles = Object.entries(franchiseAffinities)
      .filter(([key]) => title.includes(key)).flatMap(([, titles]) => titles);
    const genreTitles = Object.entries(genreNeighbors)
      .filter(([key]) => genre.includes(key)).flatMap(([, titles]) => titles);
    const seen = new Set<string>();
    const candidates = [
      ...franchiseTitles.map((candidate) => ({ title: candidate, basis: "A curated franchise/affinity follow-up." })),
      ...genreTitles.map((candidate) => ({ title: candidate, basis: `A curated neighbor to your ${seed.genre?.trim()} play history.` })),
      ...generalDiscovery.map((candidate) => ({ title: candidate, basis: "A broader curated discovery pick beyond your established favorites." })),
    ].filter((candidate) => {
      const key = normalizeGameTitle(candidate.title);
      if (excluded.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { seed, candidates };
  });

  const selected: ScoutCandidate[] = [];
  const selectedTitles = new Set<string>();
  // Keep a bounded reserve in case RAWG cannot confirm a candidate has been released.
  const candidateLimit = 9;
  // Round-robin favorites so three cards needn't all come from the same completed gig.
  for (let index = 0; selected.length < candidateLimit && pools.some((pool) => index < pool.candidates.length); index++) {
    for (const { seed, candidates } of pools) {
      const candidate = candidates[index];
      if (!candidate) continue;
      const key = normalizeGameTitle(candidate.title);
      if (selectedTitles.has(key)) continue;
      selectedTitles.add(key);
      const inspiration = seed.rating !== null ? `Recommended because you rated ${seed.title} ${seed.rating}★.`
        : `Recommended from your completed ${seed.title} (${seed.earnedXp.toLocaleString("en-US")} earned XP; unrated).`;
      selected.push({ title: candidate.title, reason: `${inspiration} ${candidate.basis}`, preferredPlatform: seed.platform, anchor: { title: seed.title, rating: seed.rating } });
      if (selected.length === candidateLimit) break;
    }
  }

  return selected;
}

export async function getExternalRecommendations(
  userId?: string,
  extraExcludedTitles: readonly string[] = [],
  debug?: ScoutDebug,
): Promise<ExternalRecommendation[]> {
  userId ??= await getCurrentPlayerId();
  const games = await prisma.game.findMany({
    where: { userId },
    select: { title: true, platform: true, genre: true, status: true, rating: true, earnedXp: true },
  });
  const currentYear = new Date().getFullYear();
  const recommendations: ExternalRecommendation[] = [];
  const excluded = new Set([...games.map((game) => game.title), ...extraExcludedTitles].map(normalizeGameTitle));
  const attemptedTitles: string[] = [];
  if (debug) debug.excludedCount = excluded.size;

  async function appendEnrichedCandidates(candidates: ScoutCandidate[], tolerateLookupErrors: boolean) {
    const source: "live-ai" | "deterministic-fallback" = tolerateLookupErrors ? "live-ai" : "deterministic-fallback";
    const selected = candidates.filter((candidate) => {
      const key = normalizeGameTitle(candidate.title);
      if (!key || excluded.has(key)) {
        if (debug) debug.filteredCount++;
        return false;
      }
      excluded.add(key);
      attemptedTitles.push(candidate.title);
      return true;
    });
    // Keep provider concurrency bounded and preserve candidate priority.
    for (let offset = 0; offset < selected.length && recommendations.length < 3; offset += 3) {
      const batch = await Promise.all(selected.slice(offset, offset + 3).map(async (candidate): Promise<ExternalRecommendation | null> => {
        try {
          const lookup = await lookupRawgGame(candidate.title, true);
          if (!lookup || !isReleasedYear(lookup.releaseYear, currentYear)) {
            if (debug) debug.metadataRejectedCount++;
            return null;
          }
          if (debug) debug.playtimeStatus = "RAWG estimates normalized with genre floors and a 1–10,000-hour clamp; AI playtime is not accepted.";
          return {
            title: candidate.title,
            platform: lookup.platforms.find((platform) => normalize(platform) === normalize(candidate.preferredPlatform)) ?? lookup.platforms[0] ?? "PC",
            genre: lookup.genre,
            releaseYear: lookup.releaseYear,
            coverUrl: lookup.coverUrl,
            lengthHours: resolveRawgPlaytime(lookup.playtime, lookup.genre) ?? 10,
            difficulty: 2,
            reason: candidate.reason,
          };
        } catch (error) {
          if (!tolerateLookupErrors) throw error;
          if (debug) debug.metadataRejectedCount++;
          return null;
        }
      }));
      const accepted = batch.filter((pick): pick is ExternalRecommendation => pick !== null).slice(0, 3 - recommendations.length);
      recommendations.push(...accepted);
      if (debug) debug.picks.push(...accepted.map(pick => {
        const anchor = candidates.find(candidate => candidate.title === pick.title)?.anchor;
        return { title: pick.title, source, ...(anchor ? { anchor } : {}) };
      }));
    }
  }

  try {
    const candidates = debug ? await getAIScoutCandidates(games, extraExcludedTitles, debug)
      : await getAIScoutCandidates(games, extraExcludedTitles);
    await appendEnrichedCandidates(candidates, true);
  } catch {
    // Missing configuration, timeouts, quota errors, and invalid AI output all
    // fall back to the deterministic catalog without exposing provider details.
  }
  // DEMO TALKING POINT: Deterministic fallback if Gemini fails schema validation or yields fewer than three usable picks.
  if (recommendations.length < 3) {
    if (debug) {
      debug.fallbackTriggered = true;
      debug.fallbackReason ??= "Fewer than three usable AI picks after ownership/session exclusions and RAWG release/lookup checks.";
    }
    const fallback = selectStaticScoutCandidates(games, [...extraExcludedTitles, ...attemptedTitles]);
    await appendEnrichedCandidates(fallback, false);
  }
  if (debug) {
    const aiCount = debug.picks.filter(pick => pick.source === "live-ai").length;
    const fallbackCount = debug.picks.length - aiCount;
    debug.source = aiCount && fallbackCount ? "mixed" : aiCount ? "live-ai" : fallbackCount ? "deterministic-fallback" : "none";
    // Serving the catalog costs zero; failed Gemini attempts can still incur usage.
    debug.estimatedCostUsd = aiCount ? debug.attemptedCallCostUsd : 0;
  }
  return recommendations.slice(0, 3);
}
