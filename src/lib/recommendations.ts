import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentPlayerId } from "@/lib/player";
import { lookupRawgGame, resizeRawgImageUrl } from "@/lib/rawg";
import { resolveRawgPlaytime } from "@/lib/game-playtime";
import { normalizeGameTitle } from "@/lib/game-title";
import { isReleasedYear } from "@/lib/game-release";
import { franchiseAffinities, genreNeighbors, generalDiscovery } from "@/lib/scout-catalog";
import type { ScoutAnchor, ScoutDebug } from "@/lib/scout-debug";
import { createScoutVectorDebug } from "@/lib/scout-debug";
import type { VectorRecommendationOptions } from "@/lib/vector-recommendations";
import { getAIScoutCandidates } from "@/lib/scout-ai";
import { getDismissedRecommendationTitles } from "@/lib/recommendation-dismissals";

import { selectBacklogRecommendations, type AdvisorGame, type BacklogRecommendations } from "@/lib/backlog-advisor";
export type { BacklogRecommendation, BacklogRecommendations } from "@/lib/backlog-advisor";

/** Catalog discovery; diagnostics are opt-in and authorized by the calling Scout action. */
export async function getVectorRecommendations(userId?: string, excludedTitles: readonly string[] = [], options: VectorRecommendationOptions = {}) {
  userId ??= await getCurrentPlayerId();
  const dismissed = await getDismissedRecommendationTitles(userId);
  const exclusions = [...new Set([...excludedTitles, ...dismissed])];
  const games = await prisma.game.findMany({ where: { userId }, select: {
    id: true, title: true, releaseYear: true, status: true, rating: true, pinnedOrder: true,
    platform: true, franchise: true, earnedXp: true,
  } });
  const { recommendCatalogGames } = await import("@/lib/vector-recommendations");
  return recommendCatalogGames(games, exclusions, options);
}

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
  // Permanent preferences join the full exclusion list before ANY provider or
  // static reserve selection. They are never capped to the client history limit.
  const dismissed = await getDismissedRecommendationTitles(userId);
  extraExcludedTitles = [...new Set([...extraExcludedTitles, ...dismissed])];
  const games = await prisma.game.findMany({
    where: { userId },
    select: { title: true, platform: true, genre: true, status: true, rating: true, earnedXp: true },
  });
  const currentYear = new Date().getFullYear();
  const recommendations: ExternalRecommendation[] = [];
  const excluded = new Set([...games.map((game) => game.title), ...extraExcludedTitles].map(normalizeGameTitle));
  const attemptedTitles: string[] = [];
  if (debug) { debug.excludedCount = excluded.size; debug.vector = createScoutVectorDebug(); }

  const vectorStarted = performance.now();
  try {
    const result = await getVectorRecommendations(userId, extraExcludedTitles, { collectDiagnostics: Boolean(debug) });
    if (debug) {
      debug.vector.status = "passed";
      debug.vector.vectorVersion = result.vectorVersion;
      debug.vector.tasteSource = result.tasteSource;
      debug.vector.anchorCount = result.anchorCount;
      if (result.diagnostics) {
        debug.vector.queryLatencyMs = result.diagnostics.queryLatencyMs;
        debug.vector.candidateCount = result.diagnostics.candidateCount;
        debug.vector.filteredCount = result.diagnostics.filteredCount;
        debug.vector.coverage = result.diagnostics.coverage;
        debug.anchors = result.diagnostics.anchors;
      }
    }
    const preferredPlatforms = new Set(games.map(game => normalize(game.platform)));
    for (const pick of result.recommendations) {
      if (recommendations.length >= 3) break;
      const key = normalizeGameTitle(pick.title);
      if (!key || excluded.has(key) || !isReleasedYear(pick.releaseYear, currentYear)) {
        if (debug) debug.vector.filteredCount++;
        continue;
      }
      excluded.add(key); attemptedTitles.push(pick.title);
      // Preserve the exact public card contract: vector scores and diagnostics stay server/admin-only.
      recommendations.push({ title: pick.title,
        platform: pick.platforms.find(platform => preferredPlatforms.has(normalize(platform))) ?? pick.platforms[0] ?? "PC",
        genre: pick.genre, releaseYear: pick.releaseYear, coverUrl: pick.coverUrl ? resizeRawgImageUrl(pick.coverUrl) : null,
        lengthHours: resolveRawgPlaytime(pick.estimatedHours, pick.genre) ?? 10, difficulty: 2, reason: pick.reason });
      if (debug) {
        debug.picks.push({ title: pick.title, source: "vector" });
        debug.vector.picks.push({ title: pick.title, cosineSimilarity: pick.cosineSimilarity, score: pick.score, scores: pick.scores });
      }
    }
  } catch {
    if (debug) { debug.vector.status = "failed"; debug.vector.fallbackReason = "Vector discovery unavailable; using the provider fallback."; }
  } finally {
    if (debug) { debug.vector.latencyMs = performance.now() - vectorStarted; debug.vector.returnedCount = recommendations.length; }
  }
  if (recommendations.length < 3 && debug) {
    debug.fallbackTriggered = true;
    debug.vector.fallbackReason ??= `Vector catalog supplied ${recommendations.length} eligible picks; filling remaining slots via the provider fallback.`;
  }

  async function appendEnrichedCandidates(candidates: ScoutCandidate[], source: "live-ai" | "deterministic-fallback") {
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
        } catch {
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

  async function appendLocalCatalogFallback(candidates: ScoutCandidate[]) {
    try {
      const catalog = await prisma.gameCatalog.findMany({
        where: { releaseYear: { gt: 0, lte: currentYear } },
        select: { title: true, platforms: true, genre: true, releaseYear: true, coverUrl: true, estimatedHours: true },
        orderBy: [{ title: "asc" }, { key: "asc" }],
      });
      const curated = new Map(candidates.map((candidate, index) => [normalizeGameTitle(candidate.title), { candidate, index }]));
      // Prefer curated taste neighbors, then use the stored released catalog as
      // a reserve, including when vector retrieval or taste seeds are unavailable.
      catalog.sort((a, b) => (curated.get(normalizeGameTitle(a.title))?.index ?? Number.MAX_SAFE_INTEGER)
        - (curated.get(normalizeGameTitle(b.title))?.index ?? Number.MAX_SAFE_INTEGER));
      const platforms = new Set(games.map(game => normalize(game.platform)));
      for (const game of catalog) {
        if (recommendations.length >= 3) break;
        const key = normalizeGameTitle(game.title);
        if (!key || excluded.has(key) || !isReleasedYear(game.releaseYear, currentYear)) continue;
        const hint = curated.get(key)?.candidate;
        excluded.add(key);
        recommendations.push({ title: game.title,
          platform: game.platforms.find(platform => platforms.has(normalize(platform))) ?? game.platforms[0] ?? "PC",
          genre: game.genre, releaseYear: game.releaseYear, coverUrl: game.coverUrl ? resizeRawgImageUrl(game.coverUrl) : null,
          lengthHours: resolveRawgPlaytime(game.estimatedHours, game.genre) ?? 10, difficulty: 2,
          reason: hint?.reason ?? "A released discovery pick from the local game catalog." });
        if (debug) {
          debug.playtimeStatus = "Local catalog estimates normalized with genre floors and a 1–10,000-hour clamp; no external metadata request.";
          debug.picks.push({ title: game.title, source: "deterministic-fallback", ...(hint?.anchor ? { anchor: hint.anchor } : {}) });
        }
      }
    } catch {
      // An unavailable local reserve must not discard successful vector picks.
      if (debug) debug.fallbackReason = "Gemini API cooldown active; local catalog reserve unavailable. Returning available vector picks.";
    }
  }

  let geminiCooldownActive = false;
  if (recommendations.length < 3) {
    try {
      const providerExclusions = [...extraExcludedTitles, ...recommendations.map(pick => pick.title)];
      const result = debug ? await getAIScoutCandidates(userId, games, providerExclusions, debug)
        : await getAIScoutCandidates(userId, games, providerExclusions);
      geminiCooldownActive = result.cooldownRemainingSeconds > 0;
      if (geminiCooldownActive && debug) {
        debug.vector.fallbackReason = `Vector catalog supplied ${recommendations.length} eligible picks; Gemini API cooldown active, filling remaining slots from the local catalog.`;
      }
      await appendEnrichedCandidates(result.candidates, "live-ai");
    } catch {
      // Keep any vector successes through missing configuration, invalid AI output or provider outages.
    }
  }
  // DEMO TALKING POINT: Deterministic fallback if Gemini fails schema validation or yields fewer than three usable picks.
  if (recommendations.length < 3) {
    if (debug) {
      debug.fallbackTriggered = true;
      debug.fallbackReason ??= "Fewer than three usable AI picks after ownership/session exclusions and RAWG release/lookup checks.";
    }
    const fallback = selectStaticScoutCandidates(games, [...extraExcludedTitles, ...attemptedTitles]);
    if (geminiCooldownActive) await appendLocalCatalogFallback(fallback);
    else await appendEnrichedCandidates(fallback, "deterministic-fallback");
  }
  // A dismissal can be saved in another tab while an upstream scan is running.
  const latestDismissals = new Set(await getDismissedRecommendationTitles(userId));
  const visible = recommendations.filter(pick => !latestDismissals.has(normalizeGameTitle(pick.title)));
  if (debug) {
    debug.picks = debug.picks.filter(pick => !latestDismissals.has(normalizeGameTitle(pick.title)));
    debug.vector.picks = debug.vector.picks.filter(pick => !latestDismissals.has(normalizeGameTitle(pick.title)));
    const aiCount = debug.picks.filter(pick => pick.source === "live-ai").length;
    const vectorCount = debug.picks.filter(pick => pick.source === "vector").length;
    const fallbackCount = debug.picks.length - aiCount - vectorCount;
    const providerCount = aiCount + fallbackCount;
    debug.source = vectorCount ? providerCount ? "mixed" : "vector"
      : aiCount && fallbackCount ? "mixed" : aiCount ? "live-ai" : fallbackCount ? "deterministic-fallback" : "none";
    debug.engineSource = vectorCount ? providerCount ? "mixed" : "vector" : providerCount ? geminiCooldownActive ? "local-fallback" : "gemini-fallback" : "none";
    if (vectorCount && !geminiCooldownActive) debug.playtimeStatus = "Catalog and RAWG estimates normalized with genre floors and a 1–10,000-hour clamp; Gemini playtime is not accepted.";
    // Serving the catalog costs zero; failed Gemini attempts can still incur usage.
    debug.estimatedCostUsd = aiCount ? debug.attemptedCallCostUsd : 0;
  }
  return visible.slice(0, 3);
}
