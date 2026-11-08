import "server-only";
import { prisma } from "@/lib/prisma";
import { CATALOG_VECTOR_VERSION, normalizeFeatureList, normalizeVector, vectorLiteral } from "@/lib/catalog-vector";
import { normalizeGameTitle } from "@/lib/game-title";
import { isReleasedYear } from "@/lib/game-release";
import { loadTasteCatalog } from "@/lib/taste-catalog";
import type { CatalogSuggestion } from "@/lib/catalog-types";
import { buildPlayerTasteProfile, catalogSeries, HALL_OF_FAME_WEIGHT_MULTIPLIER,
  type CatalogTitle, type PlayerTasteProfile, type TasteLibraryGame } from "@/lib/player-taste";

export type CosineCandidate = CatalogSuggestion & { key: string; genres: string[]; seriesHints: string[]; distance: number; negativeSimilarity?: number | null };
export type VectorRecommendation = CosineCandidate & {
  cosineSimilarity: number; score: number; reason: string;
  scores: { cosine: number; series: number; genre: number; playtime: number; negative: number };
};
export type VectorRecommendationResult = {
  tasteSource: PlayerTasteProfile["source"]; anchorCount: number; hallOfFameAnchorCount: number; negativeAnchorCount: number; vectorVersion: string;
  recommendations: VectorRecommendation[];
  diagnostics?: VectorRetrievalDiagnostics;
};
export type VectorCatalogCoverage = { total: number; embedded: number; current: number; released: number; eligible: number };
export type VectorRetrievalDiagnostics = {
  queryLatencyMs: number; candidateCount: number; filteredCount: number;
  coverage: VectorCatalogCoverage | null;
  anchors: { title: string; rating: number | null; hallOfFame: boolean; weight: number }[];
  hallOfFameWeightMultiplier: number;
};
export type VectorRecommendationOptions = {
  limit?: number; currentYear?: number; collectDiagnostics?: boolean; dismissedTitles?: readonly string[];
  // Authenticated player's stored JSON, distinct from Game.pinnedOrder queue intent.
  featuredTrophyIds?: unknown;
};
type CosineRetrievalOptions = Pick<VectorRecommendationOptions, "limit" | "currentYear"> & { negativeValues?: readonly number[] | null };

function bounds(limit: number, currentYear: number, maximum: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) throw new Error(`Recommendation limit must be from 1 to ${maximum}.`);
  if (!Number.isInteger(currentYear) || currentYear < 1800 || currentYear > 9999) throw new Error("Invalid recommendation year.");
}

/** Lower distance wins. Explicit casts keep Prisma's unsupported vector type outside result deserialization. */
export async function retrieveCosineCandidates(values: readonly number[], excludedKeys: readonly string[] = [],
  { limit = 30, currentYear = new Date().getFullYear(), negativeValues = null }: CosineRetrievalOptions = {}): Promise<CosineCandidate[]> {
  bounds(limit, currentYear, 1000);
  const queryVector = vectorLiteral(normalizeVector(values));
  const negativeVector = negativeValues ? vectorLiteral(normalizeVector(negativeValues)) : null;
  return prisma.$queryRaw<CosineCandidate[]>`
    SELECT "key", "title", "releaseYear", "platforms", "genre", "genres", "seriesHints", "estimatedHours", "coverUrl",
      "featureVector" <=> ${queryVector}::vector AS distance,
      1 - ("featureVector" <=> ${negativeVector}::vector) AS "negativeSimilarity"
    FROM "GameCatalog"
    WHERE "featureVector" IS NOT NULL AND "featureVectorVersion" = ${CATALOG_VECTOR_VERSION}
      AND vector_dims("featureVector") = 128 AND vector_norm("featureVector") > 0
      AND "releaseYear" > 0 AND "releaseYear" <= ${currentYear}
      AND "key" NOT IN (SELECT jsonb_array_elements_text(${JSON.stringify(excludedKeys)}::jsonb))
    ORDER BY "featureVector" <=> ${queryVector}::vector ASC, "key" ASC
    LIMIT ${limit}
  `;
}

export function filterVectorCandidates<T extends Pick<CosineCandidate, "title" | "releaseYear" | "distance">>(
  candidates: readonly T[], ownedTitles: readonly string[], excludedTitles: readonly string[], currentYear = new Date().getFullYear(),
): T[] {
  const excluded = new Set([...ownedTitles, ...excludedTitles].map(normalizeGameTitle));
  // Choose the closest copy before collapsing normalized-title duplicates.
  return [...candidates].filter(candidate => Number.isFinite(candidate.distance) && isReleasedYear(candidate.releaseYear, currentYear))
    .sort((a, b) => a.distance - b.distance || a.title.localeCompare(b.title) || a.releaseYear! - b.releaseYear!)
    .filter(candidate => {
      const title = normalizeGameTitle(candidate.title);
      if (!title || excluded.has(title)) return false;
      excluded.add(title); return true;
    });
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const MAX_NEGATIVE_AFFINITY_PENALTY = .10;

function negativeAffinityPenalty(candidate: CosineCandidate, taste: PlayerTasteProfile, genres: string[], series: string[]): number {
  if (!taste.negativeAnchors.length) return 0;
  // Shared positive genres/series are protected. Exclusive disliked features
  // can still damp a horror RPG or a disliked franchise inside a favorite genre.
  const exclusiveAffinity = (field: "genres" | "series", names: string[]) => {
    const positive = new Set(taste[field].map(signal => signal.name));
    const negative = field === "genres" ? taste.negativeGenres : taste.negativeSeries;
    return negative.filter(signal => names.includes(signal.name) && !positive.has(signal.name))
      .reduce((sum, signal) => sum + signal.weight, 0);
  };
  const positiveOverlap = taste.genres.some(signal => genres.includes(signal.name)) || taste.series.some(signal => series.includes(signal.name));
  const cosineAffinity = !positiveOverlap && typeof candidate.negativeSimilarity === "number" && Number.isFinite(candidate.negativeSimilarity)
    ? clamp((candidate.negativeSimilarity - .75) / .25) : 0;
  const affinity = clamp(Math.max(cosineAffinity, exclusiveAffinity("genres", genres), exclusiveAffinity("series", series)));
  return affinity > 0 ? -MAX_NEGATIVE_AFFINITY_PENALTY * affinity : 0;
}

export function rerankVectorCandidates(candidates: readonly CosineCandidate[], taste: PlayerTasteProfile): VectorRecommendation[] {
  return candidates.filter(candidate => Number.isFinite(candidate.distance)).map(candidate => {
    const genres = normalizeFeatureList([...candidate.genres, ...(candidate.genre ? [candidate.genre] : [])]);
    const series = catalogSeries(candidate);
    const matchingSeries = taste.series.filter(signal => series.includes(signal.name));
    const matchingGenres = taste.genres.filter(signal => genres.includes(signal.name));
    const seriesScore = clamp(matchingSeries.reduce((sum, signal) => sum + signal.weight, 0));
    const genreScore = clamp(matchingGenres.reduce((sum, signal) => sum + signal.weight, 0));
    const hours = candidate.estimatedHours;
    const playtimeFit = hours !== null && Number.isFinite(hours) && hours > 0 && taste.preferredHours !== null
      ? Math.exp(-Math.abs(Math.log(hours / taste.preferredHours))) : 0;
    const cosineSimilarity = Math.max(-1, Math.min(1, 1 - candidate.distance));
    const scores = { cosine: .70 * Math.max(0, cosineSimilarity), series: .15 * seriesScore,
      genre: .10 * genreScore, playtime: .05 * playtimeFit, negative: negativeAffinityPenalty(candidate, taste, genres, series) };
    const seriesAnchor = taste.anchors.find(anchor => anchor.series.some(name => matchingSeries.some(signal => signal.name === name)));
    const genreAnchor = taste.anchors.find(anchor => anchor.genres.some(name => matchingGenres.some(signal => signal.name === name)));
    const anchorTitle = (anchor: PlayerTasteProfile["anchors"][number]) =>
      `${anchor.hallOfFame ? "your Hall of Fame favorite " : ""}${anchor.title.slice(0, 80)}`;
    let reason = taste.source === "cold-start" ? "A broad discovery pick while your taste profile develops."
      : seriesAnchor ? `Series affinity with ${anchorTitle(seriesAnchor)}.`
      : genreAnchor ? `Genre continuity from ${anchorTitle(genreAnchor)}.`
      : taste.source === "hall-of-fame" ? "Similar features to your Hall of Fame favorites and taste anchors."
      : taste.source === "completed-favorites" ? "Similar features to your highly rated completions."
      : "Similar features to your active or pinned games.";
    if (playtimeFit >= .75) reason += ` Fits your roughly ${Math.round(taste.preferredHours!)}h preference.`;
    return { ...candidate, cosineSimilarity, scores, score: scores.cosine + scores.series + scores.genre + scores.playtime + scores.negative, reason };
  }).sort((a, b) => b.score - a.score || a.distance - b.distance || a.key.localeCompare(b.key));
}

/** Server-only engine. Callers supply their authenticated player's library and full session/permanent exclusions; this function never writes or calls providers. */
export async function recommendCatalogGames(games: readonly TasteLibraryGame[], excludedTitles: readonly string[] = [],
  { limit = 3, currentYear = new Date().getFullYear(), collectDiagnostics = false, dismissedTitles = [], featuredTrophyIds = [] }: VectorRecommendationOptions = {}): Promise<VectorRecommendationResult> {
  bounds(limit, currentYear, 20);
  const { titles, stored } = await loadTasteCatalog(games, dismissedTitles, featuredTrophyIds);
  const taste = buildPlayerTasteProfile(games, stored, dismissedTitles, titles, featuredTrophyIds);
  const ownedTitles = games.map(game => game.title);
  const exclusions = [...excludedTitles, ...dismissedTitles];
  const blocked = new Set([...ownedTitles, ...exclusions].map(normalizeGameTitle));
  const excludedKeys = (titles as CatalogTitle[]).filter(game => blocked.has(normalizeGameTitle(game.title))).map(game => game.key);
  // Exclusions enter SQL BEFORE LIMIT, so an owned/seen/dismissed-heavy top tier cannot starve the reserve pool.
  const queryStarted = performance.now();
  const candidates = await retrieveCosineCandidates(taste.values, excludedKeys, { limit: Math.max(30, limit * 5), currentYear, negativeValues: taste.negativeValues });
  const queryLatencyMs = performance.now() - queryStarted;
  const eligible = filterVectorCandidates(candidates, ownedTitles, exclusions, currentYear);
  let diagnostics: VectorRetrievalDiagnostics | undefined;
  if (collectDiagnostics) {
    let coverage: VectorCatalogCoverage | null = null;
    try {
      const rows = await prisma.$queryRaw<VectorCatalogCoverage[]>`
        SELECT COUNT(*)::int AS total,
          COUNT("featureVector")::int AS embedded,
          COUNT(*) FILTER (WHERE "featureVector" IS NOT NULL AND "featureVectorVersion" = ${CATALOG_VECTOR_VERSION}
            AND vector_dims("featureVector") = 128 AND vector_norm("featureVector") > 0)::int AS current,
          COUNT(*) FILTER (WHERE "featureVector" IS NOT NULL AND "featureVectorVersion" = ${CATALOG_VECTOR_VERSION}
            AND vector_dims("featureVector") = 128 AND vector_norm("featureVector") > 0
            AND "releaseYear" > 0 AND "releaseYear" <= ${currentYear})::int AS released,
          COUNT(*) FILTER (WHERE "featureVector" IS NOT NULL AND "featureVectorVersion" = ${CATALOG_VECTOR_VERSION}
            AND vector_dims("featureVector") = 128 AND vector_norm("featureVector") > 0
            AND "releaseYear" > 0 AND "releaseYear" <= ${currentYear}
            AND "key" NOT IN (SELECT jsonb_array_elements_text(${JSON.stringify(excludedKeys)}::jsonb)))::int AS eligible
        FROM "GameCatalog"
      `;
      coverage = rows[0] ?? null;
    } catch { /* Optional admin metrics must not discard successful retrieval results. */ }
    diagnostics = { queryLatencyMs, candidateCount: candidates.length, filteredCount: candidates.length - eligible.length,
      coverage, anchors: taste.anchors.map(({ title, rating, hallOfFame, weight }) => ({ title, rating, hallOfFame, weight })),
      hallOfFameWeightMultiplier: HALL_OF_FAME_WEIGHT_MULTIPLIER };
  }
  return { tasteSource: taste.source, anchorCount: taste.anchors.length, negativeAnchorCount: taste.negativeAnchors.length, vectorVersion: taste.vectorVersion,
    hallOfFameAnchorCount: taste.anchors.filter(anchor => anchor.hallOfFame).length,
    ...(diagnostics ? { diagnostics } : {}),
    recommendations: rerankVectorCandidates(eligible, taste).slice(0, limit) };
}
