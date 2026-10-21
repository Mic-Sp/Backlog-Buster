import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentPlayerId } from "@/lib/player";
import { lookupRawgGame, resizeRawgImageUrl } from "@/lib/rawg";
import { resolveRawgPlaytime } from "@/lib/game-playtime";
import { normalizeGameTitle } from "@/lib/game-title";
import { isReleasedYear } from "@/lib/game-release";
import { franchiseAffinities, genreNeighbors, generalDiscovery } from "@/lib/scout-catalog";

type AdvisorGame = {
  id: number;
  title: string;
  platform: string;
  genre: string | null;
  lengthHours: number;
  difficulty: number;
  coverUrl: string | null;
  releaseYear: number | null;
  status: string;
  rating: number | null;
  earnedXp: number;
  createdAt: Date;
};

export type BacklogRecommendation = {
  game: Pick<AdvisorGame, "id" | "title" | "platform" | "genre" | "lengthHours" | "difficulty" | "coverUrl" | "releaseYear">;
  reason: string;
};

export type BacklogRecommendations = {
  continuationPick: BacklogRecommendation | null;
  palateCleanserPick: BacklogRecommendation | null;
};

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

function franchiseRoot(title: string) {
  return title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .split(/[:\-–—]/)[0]
    .replace(/\b(?:fallen\s+order|remastered|remake|rebirth|survivor)\b/g, " ")
    .replace(/\b(?:viii|vii|iii|vi|iv|ix|ii|i|v|x)\b/g, " ")
    .replace(/\d+/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}

function recommendation(game: AdvisorGame, reason: string): BacklogRecommendation {
  return {
    game: {
      id: game.id, title: game.title, platform: game.platform, genre: game.genre,
      lengthHours: game.lengthHours, difficulty: game.difficulty,
      coverUrl: game.coverUrl ? resizeRawgImageUrl(game.coverUrl) : null,
      releaseYear: game.releaseYear,
    },
    reason,
  };
}

function preferenceBand(game: AdvisorGame) {
  return game.rating !== null && game.rating >= 4 ? 2 : game.rating === null ? 1 : 0;
}

function compareHistory(left: AdvisorGame, right: AdvisorGame) {
  return preferenceBand(right) - preferenceBand(left) ||
    (right.rating ?? 0) - (left.rating ?? 0) || right.earnedXp - left.earnedXp ||
    right.createdAt.getTime() - left.createdAt.getTime() || left.id - right.id;
}

function compareCandidates(left: AdvisorGame, right: AdvisorGame) {
  return left.lengthHours - right.lengthHours || left.title.localeCompare(right.title) || left.id - right.id;
}

export async function getBacklogRecommendations(userId?: string): Promise<BacklogRecommendations> {
  userId ??= await getCurrentPlayerId();
  const games = await prisma.game.findMany({
    where: { userId },
    select: {
      id: true, title: true, platform: true, genre: true, lengthHours: true,
      difficulty: true, coverUrl: true, releaseYear: true, status: true, rating: true, earnedXp: true, createdAt: true,
    },
  });
  const completed = games.filter((game) => game.status === "Completed").sort(compareHistory);
  const playing = games.filter((game) => game.status === "Playing");
  const currentYear = new Date().getFullYear();
  const backlog = games.filter((game) => game.status === "Backlog" && isReleasedYear(game.releaseYear, currentYear)).sort(compareCandidates);
  if (!backlog.length) return { continuationPick: null, palateCleanserPick: null };

  let continuationPick: BacklogRecommendation | null = null;
  for (const predecessor of completed) {
    const root = franchiseRoot(predecessor.title);
    if (!root) continue;
    const match = backlog.filter((game) => franchiseRoot(game.title) === root)
      .sort((left, right) => Number(normalize(right.platform) === normalize(predecessor.platform)) -
        Number(normalize(left.platform) === normalize(predecessor.platform)) || compareCandidates(left, right))[0];
    if (match) {
      const verdict = predecessor.rating !== null ? `you rated ${predecessor.rating}/5 stars`
        : `you completed for ${predecessor.earnedXp.toLocaleString("en-US")} XP (unrated)`;
      continuationPick = recommendation(match,
        `Franchise continuity: ${match.title} shares a title lineage with ${predecessor.title}, which ${verdict}. Keep that familiar world in rotation.`);
      break;
    }
  }

  if (!continuationPick) {
    const profiles = new Map<string, { name: string; ratingSum: number; count: number; platforms: Map<string, number> }>();
    for (const game of completed) {
      const genre = normalize(game.genre);
      if (!genre || game.rating === null) continue;
      let profile = profiles.get(genre);
      if (!profile) {
        profile = { name: game.genre!.trim(), ratingSum: 0, count: 0, platforms: new Map() };
        profiles.set(genre, profile);
      }
      profile.ratingSum += game.rating;
      profile.count++;
      const platform = normalize(game.platform);
      profile.platforms.set(platform, (profile.platforms.get(platform) ?? 0) + 1);
    }
    const rankedGenres = [...profiles.entries()].sort(([keyA, left], [keyB, right]) =>
      right.ratingSum / right.count - left.ratingSum / left.count || right.count - left.count || keyA.localeCompare(keyB));
    for (const [genre, profile] of rankedGenres) {
      const match = backlog.filter((game) => normalize(game.genre) === genre).sort((left, right) =>
        (profile.platforms.get(normalize(right.platform)) ?? 0) - (profile.platforms.get(normalize(left.platform)) ?? 0) ||
        compareCandidates(left, right))[0];
      if (!match) continue;
      const platformReason = profile.platforms.has(normalize(match.platform)) ? ` It also matches your ${match.platform} play history.` : "";
      continuationPick = recommendation(match,
        `Genre affinity: ${profile.name} is your highest-rated genre with a backlog match, averaging ${(profile.ratingSum / profile.count).toFixed(1)}/5 across ${profile.count} rated completed gig${profile.count === 1 ? "" : "s"}.${platformReason}`);
      break;
    }
  }

  if (!continuationPick) {
    // Unrated history can still provide affinity, without inventing a star average.
    const unrated = completed.filter((game) => game.rating === null).sort((left, right) => right.earnedXp - left.earnedXp || compareHistory(left, right));
    for (const predecessor of unrated) {
      if (!normalize(predecessor.genre)) continue;
      const match = backlog.filter((game) => normalize(game.genre) === normalize(predecessor.genre))
        .sort((left, right) => Number(normalize(right.platform) === normalize(predecessor.platform)) -
          Number(normalize(left.platform) === normalize(predecessor.platform)) || compareCandidates(left, right))[0];
      if (match) {
        continuationPick = recommendation(match,
          `Unrated-history affinity: ${match.title} shares ${predecessor.genre?.trim()} with ${predecessor.title} (${predecessor.earnedXp.toLocaleString("en-US")} earned XP). No star-rating average is available for this match yet.`);
        break;
      }
    }
  }
  if (!continuationPick) {
    const starter = backlog[0];
    continuationPick = recommendation(starter,
      `No completed franchise or rated genre match is available yet. ${starter.title} is a ${starter.lengthHours}h starting point from your backlog; complete and rate gigs to build a stronger affinity signal.`);
  }

  const longest = (left: AdvisorGame, right: AdvisorGame) => right.lengthHours - left.lengthHours ||
    right.createdAt.getTime() - left.createdAt.getTime() || left.id - right.id;
  const anchor = [...playing].sort(longest)[0] ?? [...completed].sort(longest)[0];
  const contrasts = (game: AdvisorGame) => Boolean(anchor && normalize(anchor.genre) &&
    normalize(game.genre) && normalize(game.genre) !== normalize(anchor.genre));
  const continuationId = continuationPick.game.id;
  const candidates = backlog.filter((game) => backlog.length === 1 || game.id !== continuationId);
  const cleanser = candidates.sort((left, right) => {
    const leftQuick = left.lengthHours <= 15;
    const rightQuick = right.lengthHours <= 15;
    return Number(rightQuick) - Number(leftQuick) ||
      (leftQuick && rightQuick ? Number(contrasts(right)) - Number(contrasts(left)) : 0) ||
      left.lengthHours - right.lengthHours || Number(contrasts(right)) - Number(contrasts(left)) || compareCandidates(left, right);
  })[0];
  let reason: string;
  if (!anchor) {
    reason = `${cleanser.title} (${cleanser.lengthHours}h) is the shortest available alternative. There is no Playing or Completed anchor yet, so this pacing pick starts with commitment alone.`;
  } else {
    const context = `${anchor.status === "Playing" ? "active" : "completed"} anchor ${anchor.title} (${anchor.lengthHours}h)`;
    const pacing = cleanser.lengthHours < anchor.lengthHours
      ? `${cleanser.title} (${cleanser.lengthHours}h) cuts the commitment by ${anchor.lengthHours - cleanser.lengthHours}h versus your ${context}.`
      : `${cleanser.title} (${cleanser.lengthHours}h) is an available pacing option beside your ${context}; it is not shorter than that anchor.`;
    const contrast = contrasts(cleanser) ? ` Switch from ${anchor.genre?.trim()} to ${cleanser.genre?.trim()} for a change of pace.`
      : normalize(anchor.genre) && normalize(cleanser.genre) ? ` It stays in ${cleanser.genre?.trim()}; the shortest candidates offer no quick genre contrast.`
        : " A genre contrast cannot be confirmed because one of the saved genres is missing.";
    reason = pacing + contrast;
  }
  if (backlog.length === 1) reason = `Only one backlog gig is available, so both roles point to it. ${reason}`;
  return { continuationPick, palateCleanserPick: recommendation(cleanser, reason) };
}

export async function getExternalRecommendations(userId?: string): Promise<ExternalRecommendation[]> {
  userId ??= await getCurrentPlayerId();
  const games = await prisma.game.findMany({
    where: { userId },
    select: { title: true, platform: true, genre: true, status: true, rating: true, earnedXp: true },
  });
  const owned = new Set(games.map((game) => normalizeGameTitle(game.title)));
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
      if (owned.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { seed, candidates };
  });

  const selected: { title: string; reason: string; preferredPlatform: string }[] = [];
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
      selected.push({ title: candidate.title, reason: `${inspiration} ${candidate.basis}`, preferredPlatform: seed.platform });
      if (selected.length === candidateLimit) break;
    }
  }

  const currentYear = new Date().getFullYear();
  const recommendations: ExternalRecommendation[] = [];
  // Enrich three at a time, trying replacements only if a release year is missing or upcoming.
  for (let offset = 0; offset < selected.length && recommendations.length < 3; offset += 3) {
    const batch = await Promise.all(selected.slice(offset, offset + 3).map(async (candidate): Promise<ExternalRecommendation | null> => {
      const lookup = await lookupRawgGame(candidate.title, true);
      if (!lookup || !isReleasedYear(lookup.releaseYear, currentYear)) return null;
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
    }));
    recommendations.push(...batch.filter((pick): pick is ExternalRecommendation => pick !== null));
  }
  return recommendations.slice(0, 3);
}
