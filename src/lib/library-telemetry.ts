import type { LibraryGame } from "@/components/GameLibrary";

export type TelemetryGroup = {
  name: string;
  total: number;
  completed: number;
  hours: number;
  avgRating: number | null;
  ratedCount: number;
};

export type TelemetrySort = "hours" | "rating" | "games";

export function calculateLibraryTelemetry(games: Pick<LibraryGame, "status" | "lengthHours" | "hoursPlayed" | "rating" | "genre" | "platform">[]) {
  const genres = new Map<string, TelemetryGroup & { ratingSum: number }>();
  const platforms = new Map<string, TelemetryGroup & { ratingSum: number }>();
  const ratingCounts = [0, 0, 0, 0, 0];
  let completedCount = 0;
  let activeHours = 0;
  let backlogHours = 0;
  let ratingSum = 0;
  let ratedCount = 0;

  for (const game of games) {
    const hours = game.status === "Completed" ? Math.max(game.lengthHours, game.hoursPlayed)
      : game.status === "Playing" || game.status === "Flatlined" ? game.hoursPlayed : 0;
    if (game.status === "Completed") completedCount++;
    if (game.status === "Backlog") backlogHours += game.lengthHours;
    activeHours += hours;
    if (game.rating != null) {
      ratingSum += game.rating;
      ratedCount++;
      ratingCounts[game.rating - 1]++;
    }
    for (const [groups, name] of [
      [genres, game.genre?.trim() || "Uncategorized"],
      [platforms, game.platform.trim() || "Unknown Platform"],
    ] as const) {
      const key = name.toLowerCase();
      let group = groups.get(key);
      if (!group) {
        group = { name, total: 0, completed: 0, hours: 0, avgRating: null, ratedCount: 0, ratingSum: 0 };
        groups.set(key, group);
      }
      group.total++;
      if (game.status === "Completed") group.completed++;
      group.hours += hours;
      if (game.rating != null) {
        group.ratingSum += game.rating;
        group.ratedCount++;
        group.avgRating = group.ratingSum / group.ratedCount;
      }
    }
  }

  return {
    totalGames: games.length,
    completedCount,
    completionRate: games.length ? completedCount / games.length * 100 : 0,
    activeHours,
    backlogHours,
    avgRating: ratedCount ? ratingSum / ratedCount : null,
    ratedCount,
    distribution: [5, 4, 3, 2, 1].map((rating) => ({
      rating,
      count: ratingCounts[rating - 1],
      percentage: ratedCount ? ratingCounts[rating - 1] / ratedCount * 100 : 0,
    })),
    genres: [...genres.values()],
    platforms: [...platforms.values()],
  };
}

export function sortTelemetryGroups(groups: TelemetryGroup[], sort: TelemetrySort) {
  return [...groups].sort((left, right) => {
    const difference = sort === "rating" ? (right.avgRating ?? -1) - (left.avgRating ?? -1)
      : sort === "games" ? right.total - left.total : right.hours - left.hours;
    return difference || left.name.localeCompare(right.name);
  });
}
