import { CATALOG_VECTOR_VERSION } from "@/lib/catalog-vector";
import { buildPlayerTasteProfile, matchTasteCatalogGame, parseTasteVector, type CatalogTitle, type StoredTasteGame, type TasteLibraryGame } from "@/lib/player-taste";
import { gameLineage, getFranchiseName } from "@/lib/franchise";
import { matchChronologyGame, type CanonicalGame } from "@/lib/chronology-titles";
import { normalizeFranchiseKey } from "@/lib/franchise-key";
import { completedRuns } from "@/lib/playthroughs";
import { inReleaseWindow, type DiscoveryCard } from "@/lib/discovery-feed-types";
import { HIGH_TASTE_THRESHOLD, type PersonalizedDiscoveryCard } from "@/lib/discovery-personalization-types";

export type DiscoveryLibraryGame = TasteLibraryGame & { hoursPlayed?: number };
export type FollowedCanon = { slug: string; displayName: string; games: CanonicalGame[] };
export function sagaHistory(games: readonly DiscoveryLibraryGame[]) {
  return games.filter(game => game.status === "Playing" || completedRuns(game) > 0 || (game.hoursPlayed ?? 0) > 0 || (game.rating ?? 0) >= 4);
}
export function sagaFollowFor(game: DiscoveryCard, history: readonly DiscoveryLibraryGame[], canons: readonly FollowedCanon[], now = new Date()): string | null {
  if (!inReleaseWindow(game.releaseDate, now)) return null;
  for (const canon of canons) {
    if (matchChronologyGame(canon.games, game) && history.some(owned => matchChronologyGame(canon.games, owned))) return canon.displayName;
  }
  // Use the same local franchise resolver as Saga Chains. Feature-vector neighbors
  // and catalog seriesHints alone are not membership evidence.
  const lineage = gameLineage(game);
  const match = history.find(owned => gameLineage(owned) === lineage);
  return match && normalizeFranchiseKey(lineage) ? getFranchiseName(match) : null;
}

export function scoreDiscoveryCards(items: readonly DiscoveryCard[], games: readonly DiscoveryLibraryGame[], stored: readonly StoredTasteGame[],
  titles: readonly CatalogTitle[], dismissed: readonly string[], featured: unknown, canons: readonly FollowedCanon[] = [], now = new Date()) {
  const taste = buildPlayerTasteProfile(games, stored, dismissed, titles, featured);
  const history = sagaHistory(games);
  const cards: PersonalizedDiscoveryCard[] = items.map(game => {
    const match = matchTasteCatalogGame(game, titles);
    const row = match && stored.find(row => row.key === match.key && row.featureVectorVersion === CATALOG_VECTOR_VERSION);
    const vector = row ? parseTasteVector(row.vectorText) : null;
    // A generic cold-start prior must not masquerade as the player's personal taste.
    const similarity = vector && taste.anchors.length
      ? Math.max(-1, Math.min(1, vector.reduce((sum, value, index) => sum + value * taste.values[index], 0))) : null;
    return { ...game, affinity: { similarity, matchPercent: similarity === null ? null : Math.floor(Math.max(0, similarity) * 100 + 1e-8),
      highTasteMatch: similarity !== null && similarity >= HIGH_TASTE_THRESHOLD - 1e-12,
      sagaFollow: sagaFollowFor(game, history, canons, now) } };
  });
  return { cards, hasTasteProfile: taste.anchors.length > 0 };
}
