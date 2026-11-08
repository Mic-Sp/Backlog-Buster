import { buildCatalogVector, CATALOG_VECTOR_DIMENSIONS, CATALOG_VECTOR_VERSION, normalizeFeatureList, normalizeVector } from "@/lib/catalog-vector";
import { gameLineage } from "@/lib/franchise";
import { isPositiveTasteRating } from "@/lib/taste-signals";
import { normalizeGameTitle } from "@/lib/game-title";
import { completedRuns, REPLAY_TASTE_MULTIPLIER } from "@/lib/playthroughs";

export const PLAYER_TASTE_VERSION = "player-taste-v5";
export const MAX_TASTE_ANCHORS = 8;
export const NEGATIVE_TASTE_WEIGHT = .25;
export const HALL_OF_FAME_WEIGHT_MULTIPLIER = 1.35;
export type TasteLibraryGame = {
  id: number; title: string; releaseYear: number | null; status: string; rating: number | null;
  pinnedOrder: number | null; platform: string; franchise: string | null; earnedXp: number;
  playthroughCount?: number;
};
export type CatalogTitle = { key: string; title: string; releaseYear: number | null };
export type StoredTasteGame = CatalogTitle & {
  genre: string | null; genres: string[]; seriesHints: string[]; estimatedHours: number | null;
  featureVectorVersion: string | null; vectorText: string;
};
export type TasteAnchor = {
  key: string; title: string; rating: number | null; weight: number; platform: string; hallOfFame: boolean;
  genres: string[]; series: string[]; estimatedHours: number | null;
};
type PositiveTasteProfile = {
  values: number[]; vectorVersion: string; version: string;
  source: "hall-of-fame" | "completed-favorites" | "active-pinned" | "cold-start";
  anchors: TasteAnchor[]; genres: { name: string; weight: number }[];
  series: { name: string; weight: number }[]; preferredHours: number | null;
};
export type NegativeTasteAnchor = {
  key: string; title: string; rating: 1 | 2 | null; source: "dismissed" | "low-rated";
  weight: number; genres: string[]; series: string[];
};
export type PlayerTasteProfile = PositiveTasteProfile & {
  negativeValues: number[] | null; negativeAnchors: NegativeTasteAnchor[];
  negativeGenres: { name: string; weight: number }[];
  negativeSeries: { name: string; weight: number }[];
};

const isActiveOrPinned = (game: TasteLibraryGame) => game.status === "Playing" ||
  (game.status === "Backlog" && Number.isInteger(game.pinnedOrder) && game.pinnedOrder! > 0);

// Stored JSON has up to three slots; null/invalid/stale IDs cannot create anchors.
function hallOfFameIds(featuredTrophyIds: unknown): Set<number> {
  return new Set(Array.isArray(featuredTrophyIds) ? featuredTrophyIds.slice(0, 3).filter((id): id is number =>
    typeof id === "number" && Number.isSafeInteger(id) && id > 0 && id <= 2147483647) : []);
}

/** Explicit Hall of Fame intent overrides status/rating; queue pins retain their usual eligibility rules. */
export function potentialTasteGames(games: readonly TasteLibraryGame[], featuredTrophyIds: unknown = []): TasteLibraryGame[] {
  const featured = hallOfFameIds(featuredTrophyIds);
  return games.filter(game => featured.has(game.id) || (game.status === "Completed" && isPositiveTasteRating(game.rating)) ||
    (isActiveOrPinned(game) && (game.rating === null || isPositiveTasteRating(game.rating))));
}

/** Exact normalized title/year matching; undated library copies must have an unambiguous catalog match. */
export function matchTasteCatalogGame<T extends CatalogTitle>(game: Pick<TasteLibraryGame, "title" | "releaseYear">, catalog: readonly T[]): T | null {
  const title = normalizeGameTitle(game.title);
  if (!title) return null;
  const matches = catalog.filter(row => normalizeGameTitle(row.title) === title &&
    (game.releaseYear === null || game.releaseYear === row.releaseYear));
  return matches.length === 1 ? matches[0] : null;
}

/** Resolve explicit feedback only; temporary scan exclusions must never enter here. */
export function matchNegativeTasteCatalogGames<T extends CatalogTitle>(
  games: readonly TasteLibraryGame[], catalog: readonly T[], dismissedTitles: readonly string[] = [],
) {
  const matches = new Map<string, { row: T; rating: 1 | 2 | null; source: "dismissed" | "low-rated"; franchise: string | null }>();
  for (const game of [...games].filter(game => game.rating === 1 || game.rating === 2)
    .sort((a, b) => a.rating! - b.rating! || a.id - b.id)) {
    const row = matchTasteCatalogGame(game, catalog);
    if (row && !matches.has(row.key)) matches.set(row.key, { row, rating: game.rating as 1 | 2, source: "low-rated", franchise: game.franchise });
  }
  for (const title of dismissedTitles) {
    // Dismissals carry no release year. Refuse ambiguous remake/edition matches,
    // just as we do for undated library anchors; the exact title stays excluded.
    const row = matchTasteCatalogGame({ title, releaseYear: null }, catalog);
    if (row) matches.set(row.key, { row, rating: matches.get(row.key)?.rating ?? null,
      source: "dismissed", franchise: matches.get(row.key)?.franchise ?? null });
  }
  return [...matches.values()].sort((a, b) => a.row.key.localeCompare(b.row.key));
}

export function parseTasteVector(text: string): number[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.some(value => typeof value !== "number")) return null;
    return normalizeVector(parsed, CATALOG_VECTOR_DIMENSIONS);
  } catch { return null; }
}

export function catalogSeries(game: Pick<StoredTasteGame, "title" | "seriesHints">): string[] {
  return normalizeFeatureList([...game.seriesHints.map(title => gameLineage({ title })), gameLineage({ title: game.title })]);
}

function coldStartProfile(): PositiveTasteProfile {
  // Fixed public positive prior; explicit negative feedback is applied afterward.
  const embedding = buildCatalogVector({ genres: ["Action", "Adventure", "RPG", "Puzzle"], estimatedHours: 20, releaseYear: 2020 });
  return { values: embedding.values, vectorVersion: CATALOG_VECTOR_VERSION, version: PLAYER_TASTE_VERSION,
    source: "cold-start", anchors: [], genres: [], series: [], preferredHours: null };
}

function buildPositiveTasteProfile(games: readonly TasteLibraryGame[], catalog: readonly StoredTasteGame[], matchingCatalog: readonly CatalogTitle[], featuredTrophyIds: unknown): PositiveTasteProfile {
  const featured = hallOfFameIds(featuredTrophyIds);
  const available = catalog.filter(row => row.featureVectorVersion === CATALOG_VECTOR_VERSION);
  const ranked = potentialTasteGames(games, featuredTrophyIds).map(game => {
    const match = matchTasteCatalogGame(game, matchingCatalog);
    const row = match ? available.find(row => row.key === match.key) : null;
    const values = row ? parseTasteVector(row.vectorText) : null;
    return row && values ? { game, row, values } : null;
  }).filter(entry => entry !== null);
  const completed = ranked.filter(({ game }) => game.status === "Completed" && isPositiveTasteRating(game.rating));
  // Reserve priority within the existing cap for explicit favorites, including
  // uncompleted games, before deduplicating platform copies by catalog key.
  const ordered = ranked.filter(({ game }) => featured.has(game.id) || !completed.length ||
    (game.status === "Completed" && isPositiveTasteRating(game.rating))).sort((a, b) =>
    Number(featured.has(b.game.id)) - Number(featured.has(a.game.id)) ||
    (completed.length ? (b.game.rating ?? 0) - (a.game.rating ?? 0) || b.game.earnedXp - a.game.earnedXp
      : Number(b.game.status === "Playing") - Number(a.game.status === "Playing") ||
        (a.game.pinnedOrder ?? Infinity) - (b.game.pinnedOrder ?? Infinity)) ||
    a.row.key.localeCompare(b.row.key) || a.game.id - b.game.id);
  const seen = new Set<string>();
  const selected = ordered.filter(({ row }) => {
    if (seen.has(row.key)) return false;
    seen.add(row.key); return true;
  }).slice(0, MAX_TASTE_ANCHORS);
  if (!selected.length) return coldStartProfile();
  const source = selected.some(({ game }) => featured.has(game.id)) ? "hall-of-fame"
    : completed.length ? "completed-favorites" : "active-pinned";
  const sum = Array<number>(CATALOG_VECTOR_DIMENSIONS).fill(0);
  const anchors: TasteAnchor[] = selected.map(({ game, row, values }) => {
    const hallOfFame = featured.has(game.id);
    // Hall of Fame pins always have a positive base; low ratings cannot invert
    // explicit favorite intent. Other anchors keep their existing base weights.
    const baseWeight = hallOfFame || completed.length > 0
      ? (game.rating === 5 ? 2 : 1) : (game.status === "Playing" ? 1 : .75);
    const weight = baseWeight * (hallOfFame ? HALL_OF_FAME_WEIGHT_MULTIPLIER : 1) *
      (completedRuns(game) >= 2 ? REPLAY_TASTE_MULTIPLIER : 1);
    values.forEach((value, index) => { sum[index] += value * weight; });
    return { key: row.key, title: game.title, rating: game.rating, weight, platform: game.platform, hallOfFame,
      genres: normalizeFeatureList([...row.genres, ...(row.genre ? [row.genre] : [])]),
      series: normalizeFeatureList([...catalogSeries(row), gameLineage(game)]),
      estimatedHours: row.estimatedHours !== null && Number.isFinite(row.estimatedHours) && row.estimatedHours > 0 ? row.estimatedHours : null };
  });
  let values: number[];
  try { values = normalizeVector(sum); } catch { return coldStartProfile(); }
  const totalWeight = anchors.reduce((total, anchor) => total + anchor.weight, 0);
  function aggregate(field: "genres" | "series") {
    const signals = new Map<string, number>();
    for (const anchor of anchors) for (const name of anchor[field]) {
      signals.set(name, (signals.get(name) ?? 0) + anchor.weight / anchor[field].length / totalWeight);
    }
    return [...signals].map(([name, weight]) => ({ name, weight })).sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
  }
  const timed = anchors.filter(anchor => anchor.estimatedHours !== null);
  const preferredHours = timed.length ? timed.reduce((total, anchor) => total + anchor.estimatedHours! * anchor.weight, 0) /
    timed.reduce((total, anchor) => total + anchor.weight, 0) : null;
  return { values, vectorVersion: CATALOG_VECTOR_VERSION, version: PLAYER_TASTE_VERSION, source, anchors,
    genres: aggregate("genres"), series: aggregate("series"), preferredHours };
}

/** Rocchio shift with a near-cancellation guard; malformed feedback also preserves P. */
export function shiftTasteVector(positive: readonly number[], negative: readonly number[] | null, beta = NEGATIVE_TASTE_WEIGHT): number[] {
  const p = normalizeVector(positive);
  if (!negative || !Number.isFinite(beta) || beta < 0) return p;
  try {
    const n = normalizeVector(negative);
    const shifted = p.map((value, index) => value - beta * n[index]);
    if (Math.hypot(...shifted) < 1e-8) return p;
    return normalizeVector(shifted);
  } catch { return p; }
}

export function buildPlayerTasteProfile(
  games: readonly TasteLibraryGame[], catalog: readonly StoredTasteGame[], dismissedTitles: readonly string[] = [],
  matchingCatalog: readonly CatalogTitle[] = catalog,
  featuredTrophyIds: unknown = [],
): PlayerTasteProfile {
  const available = catalog.filter(row => row.featureVectorVersion === CATALOG_VECTOR_VERSION);
  // Preserve full-index ambiguity checks even when only anchor vectors were loaded.
  const matching = matchingCatalog === catalog ? available : matchingCatalog;
  const positive = buildPositiveTasteProfile(games, available, matching, featuredTrophyIds);
  // Fresh positive intent wins over an older dismissal or a low-rated platform
  // duplicate of the same catalog game. Never train both sides on the same row.
  const positiveKeys = new Set(potentialTasteGames(games, featuredTrophyIds).flatMap(game => {
    const row = matchTasteCatalogGame(game, matching);
    return row ? [row.key] : [];
  }));
  const sum = Array<number>(CATALOG_VECTOR_DIMENSIONS).fill(0);
  const negativeAnchors: NegativeTasteAnchor[] = [];
  for (const { row: match, rating, source, franchise } of matchNegativeTasteCatalogGames(games, matching, dismissedTitles)) {
    const row = available.find(row => row.key === match.key);
    if (!row) continue;
    if (positiveKeys.has(row.key)) continue;
    const values = parseTasteVector(row.vectorText);
    if (!values) continue;
    values.forEach((value, index) => { sum[index] += value; });
    negativeAnchors.push({ key: row.key, title: row.title, rating, source, weight: 1,
      genres: normalizeFeatureList([...row.genres, ...(row.genre ? [row.genre] : [])]),
      series: normalizeFeatureList([...catalogSeries(row), gameLineage({ title: row.title, franchise })]) });
  }
  let negativeValues: number[] | null = null;
  if (negativeAnchors.length) {
    try { negativeValues = normalizeVector(sum); } catch { /* Opposing feedback may have a zero centroid. */ }
  }
  function aggregate(field: "genres" | "series") {
    const signals = new Map<string, number>();
    for (const anchor of negativeAnchors) for (const name of anchor[field]) {
      signals.set(name, (signals.get(name) ?? 0) + 1 / anchor[field].length / negativeAnchors.length);
    }
    return [...signals].map(([name, weight]) => ({ name, weight })).sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
  }
  return { ...positive, values: shiftTasteVector(positive.values, negativeValues), negativeValues, negativeAnchors,
    negativeGenres: aggregate("genres"), negativeSeries: aggregate("series") };
}

export type OwnedTasteScore = { similarity: number; reason: string };

/** Local counterpart of catalog discovery: score owned vectors against exactly
 * the same weighted/negative-steered profile, without excluding owned titles.
 * Missing or ambiguous matches simply retain the advisor's heuristic score.
 */
export function scoreOwnedTasteGames(games: readonly TasteLibraryGame[], catalog: readonly StoredTasteGame[],
  dismissedTitles: readonly string[] = [], matchingCatalog: readonly CatalogTitle[] = catalog,
  featuredTrophyIds: unknown = []): Map<number, OwnedTasteScore> {
  const taste = buildPlayerTasteProfile(games, catalog, dismissedTitles, matchingCatalog, featuredTrophyIds);
  const scores = new Map<number, OwnedTasteScore>();
  if (!taste.anchors.length && !taste.negativeAnchors.length) return scores;
  const source = taste.source === "hall-of-fame" ? "Hall of Fame favorites" : taste.source === "completed-favorites"
    ? "highly rated completions" : taste.source === "active-pinned" ? "active and pinned games" : "developing taste profile";
  for (const game of games) {
    if (game.status !== "Backlog") continue;
    const match = matchTasteCatalogGame(game, matchingCatalog);
    const row = match ? catalog.find(row => row.key === match.key && row.featureVectorVersion === CATALOG_VECTOR_VERSION) : null;
    const values = row ? parseTasteVector(row.vectorText) : null;
    if (!values) continue;
    const similarity = Math.max(-1, Math.min(1, values.reduce((sum, value, index) => sum + value * taste.values[index], 0)));
    scores.set(game.id, { similarity,
      reason: `Taste fit: compared with your ${source}${taste.negativeAnchors.length ? ", adjusted for low ratings and dismissed recommendations" : ""}.` });
  }
  return scores;
}
