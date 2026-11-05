import { normalizeGameTitle } from "@/lib/game-title";

export type CommunityStatsGame = {
  id: number;
  userId: string;
  title: string;
  releaseYear: number | null;
  status: string;
  rating: number | null;
  hoursPlayed: number;
};

export type CommunityGameStats = {
  key: string;
  normalizedTitle: string;
  releaseYear: number | null;
  ratingAvg: number | null;
  ratingCount: number;
  ratingDistribution: { rating: number; count: number; percentage: number }[];
  completionAvgHours: number | null;
  completionMedianHours: number | null;
  completionCount: number;
};

/** Undated copies share a title-only bucket, separate from all known release years. */
export function getCommunityGameKey(title: string, releaseYear: number | null): string {
  const normalizedTitle = normalizeGameTitle(title);
  return JSON.stringify(releaseYear === null ? [normalizedTitle] : [normalizedTitle, releaseYear]);
}

/**
 * Aggregate a caller-supplied library snapshot without exposing player IDs.
 * Each player contributes once per metric: the lowest-ID copy with a valid rating,
 * and independently the lowest-ID Completed copy with positive logged hours.
 * Zero hours are unmeasured. Legacy auto-filled/imported positive hours cannot be
 * distinguished from measured hours with the current schema; callers must exclude
 * records known to contain estimates rather than measurements.
 */
export function aggregateCommunityStats(games: readonly CommunityStatsGame[]): CommunityGameStats[] {
  type Sample = { id: number; value: number };
  type Group = {
    key: string;
    normalizedTitle: string;
    releaseYear: number | null;
    ratings: Map<string, Sample>;
    completions: Map<string, Sample>;
  };
  const groups = new Map<string, Group>();

  for (const game of games) {
    const normalizedTitle = normalizeGameTitle(game.title);
    if (!normalizedTitle || !game.userId.trim()) continue;
    const key = getCommunityGameKey(game.title, game.releaseYear);
    let group = groups.get(key);
    if (!group) {
      group = { key, normalizedTitle, releaseYear: game.releaseYear, ratings: new Map(), completions: new Map() };
      groups.set(key, group);
    }
    const rating = game.rating;
    if (rating !== null && Number.isInteger(rating) && rating >= 1 && rating <= 5) {
      const previous = group.ratings.get(game.userId);
      if (!previous || game.id < previous.id) group.ratings.set(game.userId, { id: game.id, value: rating });
    }
    if (game.status === "Completed" && Number.isSafeInteger(game.hoursPlayed) && game.hoursPlayed > 0 && game.hoursPlayed <= 10000) {
      const previous = group.completions.get(game.userId);
      if (!previous || game.id < previous.id) group.completions.set(game.userId, { id: game.id, value: game.hoursPlayed });
    }
  }

  return [...groups.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map(group => {
    const ratings = [...group.ratings.values()].map(sample => sample.value);
    const hours = [...group.completions.values()].map(sample => sample.value).sort((a, b) => a - b);
    const middle = Math.floor(hours.length / 2);
    return {
      key: group.key,
      normalizedTitle: group.normalizedTitle,
      releaseYear: group.releaseYear,
      ratingAvg: ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : null,
      ratingCount: ratings.length,
      ratingDistribution: [1, 2, 3, 4, 5].map(rating => {
        const count = ratings.filter(value => value === rating).length;
        return { rating, count, percentage: ratings.length ? count / ratings.length * 100 : 0 };
      }),
      completionAvgHours: hours.length ? hours.reduce((sum, value) => sum + value, 0) / hours.length : null,
      completionMedianHours: hours.length ? (hours.length % 2 ? hours[middle] : (hours[middle - 1] + hours[middle]) / 2) : null,
      completionCount: hours.length,
    };
  });
}
