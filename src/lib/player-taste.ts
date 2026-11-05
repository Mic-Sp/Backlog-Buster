import { buildCatalogVector, CATALOG_VECTOR_DIMENSIONS, CATALOG_VECTOR_VERSION, normalizeFeatureList, normalizeVector } from "@/lib/catalog-vector";
import { gameLineage, isPositiveTasteRating } from "@/lib/backlog-advisor";
import { normalizeGameTitle } from "@/lib/game-title";

export const PLAYER_TASTE_VERSION = "player-taste-v1";
export const MAX_TASTE_ANCHORS = 8;
export type TasteLibraryGame = {
  id: number; title: string; releaseYear: number | null; status: string; rating: number | null;
  pinnedOrder: number | null; platform: string; franchise: string | null; earnedXp: number;
};
export type CatalogTitle = { key: string; title: string; releaseYear: number | null };
export type StoredTasteGame = CatalogTitle & {
  genre: string | null; genres: string[]; seriesHints: string[]; estimatedHours: number | null;
  featureVectorVersion: string | null; vectorText: string;
};
export type TasteAnchor = {
  key: string; title: string; rating: number | null; weight: number; platform: string;
  genres: string[]; series: string[]; estimatedHours: number | null;
};
export type PlayerTasteProfile = {
  values: number[]; vectorVersion: string; version: string;
  source: "completed-favorites" | "active-pinned" | "cold-start";
  anchors: TasteAnchor[]; genres: { name: string; weight: number }[];
  series: { name: string; weight: number }[]; preferredHours: number | null;
};

const isActiveOrPinned = (game: TasteLibraryGame) => game.status === "Playing" ||
  (game.status === "Backlog" && Number.isInteger(game.pinnedOrder) && game.pinnedOrder! > 0);

/** Unrated active/pinned intent is usable; every explicit rating below four is excluded. */
export function potentialTasteGames(games: readonly TasteLibraryGame[]): TasteLibraryGame[] {
  return games.filter(game => (game.status === "Completed" && isPositiveTasteRating(game.rating)) ||
    (isActiveOrPinned(game) && (game.rating === null || isPositiveTasteRating(game.rating))));
}

/** Exact normalized title/year matching; undated library copies must have an unambiguous catalog match. */
export function matchTasteCatalogGame<T extends CatalogTitle>(game: TasteLibraryGame, catalog: readonly T[]): T | null {
  const title = normalizeGameTitle(game.title);
  if (!title) return null;
  const matches = catalog.filter(row => normalizeGameTitle(row.title) === title &&
    (game.releaseYear === null || game.releaseYear === row.releaseYear));
  return matches.length === 1 ? matches[0] : null;
}

export function parseTasteVector(text: string): number[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.some(value => typeof value !== "number")) return null;
    return normalizeVector(parsed, CATALOG_VECTOR_DIMENSIONS);
  } catch { return null; }
}

export function catalogSeries(game: Pick<StoredTasteGame, "title" | "seriesHints">): string[] {
  return normalizeFeatureList([...game.seriesHints, gameLineage({ title: game.title, franchise: null })]);
}

function coldStartProfile(): PlayerTasteProfile {
  // Fixed public defaults: no dependency on low-rated history, locale, wall-clock time or provider calls.
  const embedding = buildCatalogVector({ genres: ["Action", "Adventure", "RPG", "Puzzle"], estimatedHours: 20, releaseYear: 2020 });
  return { values: embedding.values, vectorVersion: CATALOG_VECTOR_VERSION, version: PLAYER_TASTE_VERSION,
    source: "cold-start", anchors: [], genres: [], series: [], preferredHours: null };
}

export function buildPlayerTasteProfile(games: readonly TasteLibraryGame[], catalog: readonly StoredTasteGame[]): PlayerTasteProfile {
  const available = catalog.filter(row => row.featureVectorVersion === CATALOG_VECTOR_VERSION);
  const ranked = potentialTasteGames(games).map(game => {
    const row = matchTasteCatalogGame(game, available);
    const values = row ? parseTasteVector(row.vectorText) : null;
    return row && values ? { game, row, values } : null;
  }).filter(entry => entry !== null);
  const completed = ranked.filter(({ game }) => game.status === "Completed");
  const source = completed.length ? "completed-favorites" : "active-pinned";
  const ordered = (completed.length ? completed : ranked).sort((a, b) =>
    (completed.length ? b.game.rating! - a.game.rating! || b.game.earnedXp - a.game.earnedXp
      : Number(b.game.status === "Playing") - Number(a.game.status === "Playing") ||
        (a.game.pinnedOrder ?? Infinity) - (b.game.pinnedOrder ?? Infinity)) ||
    a.row.key.localeCompare(b.row.key) || a.game.id - b.game.id);
  const seen = new Set<string>();
  const selected = ordered.filter(({ row }) => {
    if (seen.has(row.key)) return false;
    seen.add(row.key); return true;
  }).slice(0, MAX_TASTE_ANCHORS);
  if (!selected.length) return coldStartProfile();
  const sum = Array<number>(CATALOG_VECTOR_DIMENSIONS).fill(0);
  const anchors: TasteAnchor[] = selected.map(({ game, row, values }) => {
    const weight = source === "completed-favorites" ? game.rating === 5 ? 2 : 1 : game.status === "Playing" ? 1 : .75;
    values.forEach((value, index) => { sum[index] += value * weight; });
    return { key: row.key, title: game.title, rating: game.rating, weight, platform: game.platform,
      genres: normalizeFeatureList([...row.genres, ...(row.genre ? [row.genre] : [])]),
      series: normalizeFeatureList([...catalogSeries(row), ...(game.franchise ? [game.franchise] : [])]),
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
