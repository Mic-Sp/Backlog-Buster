import { hypeSimilarityMultiplier, isHypedUnplayed } from "@/lib/hype";
import { isPositiveTasteRating } from "@/lib/taste-signals";

type SeedGame = {
  title: string; status: string; rating: number | null; earnedXp: number;
  hypeLevel?: number; hoursPlayed?: number; playthroughCount?: number;
};

/** Reserve room for both proven favorites and current anticipation before caps. */
export function rankScoutSeeds<T extends SeedGame>(games: readonly T[]): T[] {
  const rank = (a: T, b: T) => (b.rating ?? 0) - (a.rating ?? 0) ||
    hypeSimilarityMultiplier(b.hypeLevel) - hypeSimilarityMultiplier(a.hypeLevel) ||
    b.earnedXp - a.earnedXp || a.title.localeCompare(b.title);
  const completed = games.filter(game => game.status === "Completed");
  const favorites = completed.filter(game => isPositiveTasteRating(game.rating)).sort(rank);
  const hyped = games.filter(isHypedUnplayed).sort(rank);
  if (!favorites.length && !hyped.length) return completed.filter(game => game.rating === null).sort(rank);
  const result: T[] = [];
  for (let index = 0; index < Math.max(favorites.length, hyped.length); index++) {
    if (favorites[index]) result.push(favorites[index]);
    if (hyped[index]) result.push(hyped[index]);
  }
  return result;
}
