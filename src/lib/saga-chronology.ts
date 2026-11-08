import { baseChronologyTitle, compareChronologyTitles, matchChronologyGame, normalizeChronologyTitle, parseSequelNumber, type CanonicalGame } from "@/lib/chronology-titles";
import { isReleasedYear } from "@/lib/game-release";
import { gameLineage, getFranchiseName } from "@/lib/franchise";

type SagaGame = { id: number; title: string; releaseYear: number | null };

export type OwnedSequenceGame = SagaGame & { status: string; franchise?: string | null; chronologicalOrder?: number | null };

/** Saved story ranks lead; unranked games form a numeral/release-order tail.
 * Resolve once for the whole library, BEFORE session exclusions or slot scoring.
 * Flatlined games represent abandoned adventures and do not block progression.
 */
export function resolveOwnedSagaProgression<T extends OwnedSequenceGame>(games: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const game of games) {
    const key = gameLineage(game);
    const members = groups.get(key) ?? [];
    members.push(game);
    groups.set(key, members);
  }
  const eligibleBacklogIds = new Set<number>();
  const previousCompleted = new Map<number, T>();
  for (const members of groups.values()) {
    const sequence = (game: T) => parseSequelNumber(game.title) ??
      (normalizeChronologyTitle(baseChronologyTitle(game.title)) === normalizeChronologyTitle(getFranchiseName(game) ?? "") ? 1 : null);
    const numbered = members.flatMap(game => {
      const number = sequence(game);
      return number === null ? [] : [{ game, number }];
    });
    const dated = numbered.filter(entry => entry.game.releaseYear != null)
      .sort((a, b) => a.game.releaseYear! - b.game.releaseYear!);
    const precedingNumbers: number[] = [];
    for (const entry of dated) precedingNumbers.push(Math.max(precedingNumbers.at(-1) ?? -Infinity, entry.number));
    // Place unnumbered subtitles relative to dated numbered installments. This
    // gives every item one fixed sort key (pairwise numeral/year fallbacks can
    // create non-transitive comparators). With no evidence, use release order.
    const fallbackKey = (game: T) => {
      const number = sequence(game);
      if (number !== null) return number;
      if (game.releaseYear == null) return Infinity;
      let low = 0, high = dated.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (dated[middle].game.releaseYear! <= game.releaseYear) low = middle + 1;
        else high = middle;
      }
      return low ? precedingNumbers[low - 1] + .5 : numbered.length ? -.5 : 0;
    };
    const fallbackKeys = new Map(members.map(game => [game.id, fallbackKey(game)]));
    const ordered = [...members].sort((a, b) => {
      const ar = a.chronologicalOrder ?? Infinity, br = b.chronologicalOrder ?? Infinity;
      if (ar !== br) return ar - br;
      const an = fallbackKeys.get(a.id)!, bn = fallbackKeys.get(b.id)!;
      if (an !== bn) return an - bn;
      const ay = a.releaseYear ?? Infinity, by = b.releaseYear ?? Infinity;
      if (ay !== by) return ay - by;
      return compareChronologyTitles(normalizeChronologyTitle(a.title), normalizeChronologyTitle(b.title)) || a.id - b.id;
    });
    const first = ordered.find(game => game.status === "Playing" || game.status === "Backlog");
    if (!first || first.status !== "Backlog") continue;
    eligibleBacklogIds.add(first.id);
    const index = ordered.indexOf(first);
    const previous = ordered.slice(0, index).reverse().find(game => game.status === "Completed");
    if (previous) previousCompleted.set(first.id, previous);
  }
  return { eligibleBacklogIds, previousCompleted };
}

/** Local, deterministic fallback only. Never queries an AI provider or shared cache. */
export function buildReleaseYearOrder(games: readonly SagaGame[]): Map<number, number> {
  const year = (value: number | null) => typeof value === "number" && Number.isSafeInteger(value) && value >= 1800 && value <= 2100 ? value : Infinity;
  const ordered = [...games].sort((left, right) => {
    const leftYear = year(left.releaseYear), rightYear = year(right.releaseYear);
    if (leftYear !== rightYear) return leftYear - rightYear;
    const leftTitle = normalizeChronologyTitle(left.title), rightTitle = normalizeChronologyTitle(right.title);
    return compareChronologyTitles(leftTitle, rightTitle) || left.id - right.id;
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
    a.game.releaseYear! - b.game.releaseYear! || compareChronologyTitles(a.game.title, b.game.title) || a.game.id - b.game.id);
  matched.forEach(({ game }, index) => assigned.set(game.id, index + 1));
  return assigned;
}
