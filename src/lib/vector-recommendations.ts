import "server-only";
import { prisma } from "@/lib/prisma";
import { CATALOG_VECTOR_VERSION, normalizeFeatureList, normalizeVector, vectorLiteral } from "@/lib/catalog-vector";
import { normalizeGameTitle } from "@/lib/game-title";
import { isReleasedYear } from "@/lib/game-release";
import type { CatalogSuggestion } from "@/lib/catalog-types";
import { buildPlayerTasteProfile, catalogSeries, matchTasteCatalogGame, potentialTasteGames,
  type CatalogTitle, type PlayerTasteProfile, type StoredTasteGame, type TasteLibraryGame } from "@/lib/player-taste";

export type CosineCandidate = CatalogSuggestion & { key: string; genres: string[]; seriesHints: string[]; distance: number };
export type VectorRecommendation = CosineCandidate & {
  cosineSimilarity: number; score: number; reason: string;
  scores: { cosine: number; series: number; genre: number; playtime: number };
};
export type VectorRecommendationResult = {
  tasteSource: PlayerTasteProfile["source"]; anchorCount: number; vectorVersion: string;
  recommendations: VectorRecommendation[];
  diagnostics?: VectorRetrievalDiagnostics;
};
export type VectorCatalogCoverage = { total: number; embedded: number; current: number; released: number; eligible: number };
export type VectorRetrievalDiagnostics = {
  queryLatencyMs: number; candidateCount: number; filteredCount: number;
  coverage: VectorCatalogCoverage | null; anchors: { title: string; rating: number | null }[];
};
export type VectorRecommendationOptions = { limit?: number; currentYear?: number; collectDiagnostics?: boolean };

function bounds(limit: number, currentYear: number, maximum: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) throw new Error(`Recommendation limit must be from 1 to ${maximum}.`);
  if (!Number.isInteger(currentYear) || currentYear < 1800 || currentYear > 9999) throw new Error("Invalid recommendation year.");
}

/** Lower distance wins. Explicit casts keep Prisma's unsupported vector type outside result deserialization. */
export async function retrieveCosineCandidates(values: readonly number[], excludedKeys: readonly string[] = [],
  { limit = 30, currentYear = new Date().getFullYear() }: VectorRecommendationOptions = {}): Promise<CosineCandidate[]> {
  bounds(limit, currentYear, 1000);
  const queryVector = vectorLiteral(normalizeVector(values));
  return prisma.$queryRaw<CosineCandidate[]>`
    SELECT "key", "title", "releaseYear", "platforms", "genre", "genres", "seriesHints", "estimatedHours", "coverUrl",
      "featureVector" <=> ${queryVector}::vector AS distance
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
  candidates: readonly T[], ownedTitles: readonly string[], recentlySeen: readonly string[], currentYear = new Date().getFullYear(),
): T[] {
  const excluded = new Set([...ownedTitles, ...recentlySeen].map(normalizeGameTitle));
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
      genre: .10 * genreScore, playtime: .05 * playtimeFit };
    const seriesAnchor = taste.anchors.find(anchor => anchor.series.some(name => matchingSeries.some(signal => signal.name === name)));
    const genreAnchor = taste.anchors.find(anchor => anchor.genres.some(name => matchingGenres.some(signal => signal.name === name)));
    let reason = taste.source === "cold-start" ? "A broad discovery pick while your taste profile develops."
      : seriesAnchor ? `Series affinity with ${seriesAnchor.title.slice(0, 80)}.`
      : genreAnchor ? `Genre continuity from ${genreAnchor.title.slice(0, 80)}.`
      : taste.source === "completed-favorites" ? "Similar features to your highly rated completions."
      : "Similar features to your active or pinned games.";
    if (playtimeFit >= .75) reason += ` Fits your roughly ${Math.round(taste.preferredHours!)}h preference.`;
    return { ...candidate, cosineSimilarity, scores, score: scores.cosine + scores.series + scores.genre + scores.playtime, reason };
  }).sort((a, b) => b.score - a.score || a.distance - b.distance || a.key.localeCompare(b.key));
}

/** Server-only engine. Callers supply their authenticated player's library; this function never writes or calls providers. */
export async function recommendCatalogGames(games: readonly TasteLibraryGame[], recentlySeen: readonly string[] = [],
  { limit = 3, currentYear = new Date().getFullYear(), collectDiagnostics = false }: VectorRecommendationOptions = {}): Promise<VectorRecommendationResult> {
  bounds(limit, currentYear, 20);
  // Initial catalog is small (89 rows). Build the normalization index in JS to reuse the exact
  // ownership helper, including accents/numerals, without introducing another PostgreSQL extension.
  const titles = await prisma.gameCatalog.findMany({
    where: { featureVectorVersion: CATALOG_VECTOR_VERSION }, select: { key: true, title: true, releaseYear: true },
  });
  const anchorKeys = [...new Set(potentialTasteGames(games).flatMap(game => {
    const match = matchTasteCatalogGame(game, titles);
    return match ? [match.key] : [];
  }))];
  const stored = anchorKeys.length ? await prisma.$queryRaw<StoredTasteGame[]>`
    SELECT "key", "title", "releaseYear", "genre", "genres", "seriesHints", "estimatedHours", "featureVectorVersion",
      "featureVector"::text AS "vectorText"
    FROM "GameCatalog"
    WHERE "key" IN (SELECT jsonb_array_elements_text(${JSON.stringify(anchorKeys)}::jsonb))
      AND "featureVector" IS NOT NULL AND "featureVectorVersion" = ${CATALOG_VECTOR_VERSION}
  ` : [];
  const taste = buildPlayerTasteProfile(games, stored);
  const ownedTitles = games.map(game => game.title);
  const blocked = new Set([...ownedTitles, ...recentlySeen].map(normalizeGameTitle));
  const excludedKeys = (titles as CatalogTitle[]).filter(game => blocked.has(normalizeGameTitle(game.title))).map(game => game.key);
  // Exclusions enter SQL BEFORE LIMIT, so an owned/seen-heavy top tier cannot starve the reserve pool.
  const queryStarted = performance.now();
  const candidates = await retrieveCosineCandidates(taste.values, excludedKeys, { limit: Math.max(30, limit * 5), currentYear });
  const queryLatencyMs = performance.now() - queryStarted;
  const eligible = filterVectorCandidates(candidates, ownedTitles, recentlySeen, currentYear);
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
      coverage, anchors: taste.anchors.map(({ title, rating }) => ({ title, rating })) };
  }
  return { tasteSource: taste.source, anchorCount: taste.anchors.length, vectorVersion: taste.vectorVersion,
    ...(diagnostics ? { diagnostics } : {}),
    recommendations: rerankVectorCandidates(eligible, taste).slice(0, limit) };
}
