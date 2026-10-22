import { matchChronologyGame, normalizeChronologyTitle, type CanonicalGame } from "@/lib/chronology-titles";
import { isReleasedYear } from "@/lib/game-release";

type SagaGame = { id: number; title: string; releaseYear: number | null };

/** Local, deterministic fallback only. Never queries an AI provider or shared cache. */
export function buildReleaseYearOrder(games: readonly SagaGame[]): Map<number, number> {
  const year = (value: number | null) => typeof value === "number" && Number.isSafeInteger(value) && value >= 1800 && value <= 2100 ? value : Infinity;
  const ordered = [...games].sort((left, right) => {
    const leftYear = year(left.releaseYear), rightYear = year(right.releaseYear);
    if (leftYear !== rightYear) return leftYear - rightYear;
    const leftTitle = normalizeChronologyTitle(left.title), rightTitle = normalizeChronologyTitle(right.title);
    return (leftTitle < rightTitle ? -1 : leftTitle > rightTitle ? 1 : 0) || left.id - right.id;
  });
  return new Map(ordered.map((game, index) => [game.id, index + 1]));
}

/** Global canon is a sort key only. Every owned item gets a distinct compact rank or a null tail. */
export function buildAssignedSagaOrder(games: readonly SagaGame[], canon: CanonicalGame[], localFallback = false): Map<number, number | null> {
  const assigned = new Map<number, number | null>(games.map(game => [game.id, null]));
  const released = games.filter(game => isReleasedYear(game.releaseYear));
  if (localFallback) {
    for (const [id, rank] of buildReleaseYearOrder(released)) assigned.set(id, rank);
    return assigned;
  }
  const matched = released.flatMap(game => {
    const entry = matchChronologyGame(canon, game);
    return entry ? [{ game, canonicalRank: entry.chronologicalRank }] : [];
  }).sort((a, b) => a.canonicalRank - b.canonicalRank ||
    a.game.releaseYear! - b.game.releaseYear! || a.game.title.localeCompare(b.game.title, "en") || a.game.id - b.game.id);
  matched.forEach(({ game }, index) => assigned.set(game.id, index + 1));
  return assigned;
}
