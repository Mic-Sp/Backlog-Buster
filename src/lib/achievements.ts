import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentPlayerId } from "@/lib/player";
import { buildSagaChains } from "@/lib/sagas";
import { isReleasedYear } from "@/lib/game-release";
import type { Prisma } from "@/generated/prisma/client";
import { appendActivityEvents } from "@/lib/activity-events";
import { completedRuns } from "@/lib/playthroughs";

export const achievementDefinitions = [
  { key: "first-blood", title: "First Blood", description: "Complete your first gig.", icon: "⚔", xpBonus: 100, target: 1 },
  { key: "street-kid", title: "Street Kid", description: "Complete 5 gigs.", icon: "⚡", xpBonus: 250, target: 5 },
  { key: "night-city-legend", title: "Night City Legend", description: "Complete 10 gigs.", icon: "👑", xpBonus: 1000, target: 10 },
  { key: "time-dilation", title: "Time Dilation", description: "Log 50 hours of play across your games.", icon: "⏱", xpBonus: 200, target: 50 },
  { key: "chronos-master", title: "Chronos Master", description: "Log 100 hours of play across your games.", icon: "⌛", xpBonus: 500, target: 100 },
  { key: "hardcore-netrunner", title: "Hardcore Netrunner", description: "Complete a gig at difficulty 3.", icon: "💀", xpBonus: 300, target: 1 },
  { key: "multi-deck", title: "Multi Deck", description: "Complete gigs on 2 different platforms.", icon: "🎮", xpBonus: 300, target: 2 },
  { key: "genre-specialist", title: "Genre Specialist", description: "Complete 3 gigs in the same genre.", icon: "🎯", xpBonus: 400, target: 3 },
  { key: "cyberware-critic", title: "Cyberware Critic", description: "Log a star rating on 5 completed gigs.", icon: "⭐", xpBonus: 350, target: 5 },
  { key: "second-heart", title: "Second Heart", description: "Revive a Flatlined gig and see it through to completion.", icon: "⚡", xpBonus: 400, target: 1 },
  { key: "saga-completionist", title: "Saga Completionist", description: "Complete every game in a multi-game Saga Chain (minimum 2 games in the saga).", icon: "⛓️", xpBonus: 500, target: 1 },
  { key: "new-game-plus", title: "New Game+", description: "Complete a second playthrough of any gig.", icon: "⟳", xpBonus: 300, target: 2 },
] as const;

export type Achievement = {
  key: typeof achievementDefinitions[number]["key"];
  title: string;
  description: string;
  icon: string;
  xpBonus: number;
  target: number;
  current: number;
  unlocked: boolean;
  unlockedAt: string | null;
  xpAwarded: number;
};

/** Caller holds the deck lock; imports use this inside their transaction to stay quiet. */
export async function syncAchievementsForPlayer(tx: Prisma.TransactionClient, userId: string, emitActivity = true): Promise<Achievement[]> {
  const [games, existing] = await Promise.all([
    tx.game.findMany({
      where: { userId },
      select: { id: true, title: true, franchise: true, releaseYear: true, status: true, playthroughCount: true, wasFlatlined: true, lengthHours: true, hoursPlayed: true, difficulty: true, platform: true, genre: true, rating: true },
    }),
    tx.userAchievement.findMany({ where: { userId } }),
  ]);
  const completed = games.filter((game) => game.status === "Completed");
  const { chains } = buildSagaChains(games);
  const currentYear = new Date().getFullYear();
  const releasedIds = new Set(games.filter((game) => isReleasedYear(game.releaseYear, currentYear)).map((game) => game.id));
  const completedSagaCount = chains.filter((chain) => chain.completed === chain.total &&
    chain.gameIds.filter((id) => releasedIds.has(id)).length >= 2).length;
  const totalHours = games.reduce((sum, game) => {
    if (game.status === "Completed") return sum + Math.max(game.lengthHours, game.hoursPlayed);
    if (game.status === "Playing" || game.status === "Flatlined") return sum + game.hoursPlayed;
    return sum;
  }, 0);
  const genreCounts = new Map<string, number>();
  for (const game of completed) {
    const genre = game.genre?.trim().toLowerCase();
    if (genre) genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
  }
  const progress: Record<Achievement["key"], number> = {
    "first-blood": completed.length,
    "street-kid": completed.length,
    "night-city-legend": completed.length,
    "time-dilation": totalHours,
    "chronos-master": totalHours,
    "hardcore-netrunner": completed.filter((game) => game.difficulty === 3).length,
    "multi-deck": new Set(completed.map((game) => game.platform.trim().toLowerCase()).filter(Boolean)).size,
    "genre-specialist": Math.max(0, ...genreCounts.values()),
    "cyberware-critic": completed.filter((game) => typeof game.rating === "number" && game.rating >= 1 && game.rating <= 5).length,
    "second-heart": completed.filter((game) => game.wasFlatlined).length,
    "saga-completionist": completedSagaCount,
    "new-game-plus": Math.max(0, ...games.map(completedRuns)),
  };
  const owned = new Set(existing.map((achievement) => achievement.achievementKey));
  const newlyEligible = achievementDefinitions.filter((definition) =>
    !owned.has(definition.key) && progress[definition.key] >= definition.target,
  );

  let persisted = existing;
  if (newlyEligible.length > 0) {
    // PostgreSQL's unique constraint plus ON CONFLICT protects parallel renders/actions.
    // Existing bonus amounts and timestamps are never overwritten.
    const inserted = await tx.userAchievement.createManyAndReturn({
      data: newlyEligible.map((definition) => ({ userId, achievementKey: definition.key, xpAwarded: definition.xpBonus })),
      skipDuplicates: true,
    });
    if (emitActivity) await appendActivityEvents(tx, userId, inserted.flatMap(achievement => {
      const definition = achievementDefinitions.find(entry => entry.key === achievement.achievementKey);
      return definition ? [{ type: "achievement_unlocked" as const, achievementId: achievement.id,
        deduplicationKey: `achievement:${achievement.id}`, metadata: { achievementKey: definition.key, title: definition.title } }] : [];
    }));
    persisted = await tx.userAchievement.findMany({ where: { userId } });
  }
  const byKey = new Map(persisted.map((achievement) => [achievement.achievementKey, achievement]));
  return achievementDefinitions.map((definition) => {
    const saved = byKey.get(definition.key);
    return {
      ...definition,
      current: progress[definition.key],
      unlocked: Boolean(saved),
      unlockedAt: saved?.unlockedAt.toISOString() ?? null,
      xpAwarded: saved?.xpAwarded ?? 0,
    };
  });
}

export async function syncAndGetAchievements(userId?: string): Promise<Achievement[]> {
  const actorId = userId ?? await getCurrentPlayerId();
  return prisma.$transaction(async tx => {
    // Share the import/reset lock so a page render cannot publish bulk-awarded unlocks.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`backlogbuster-deck:${actorId}`}, 0))`;
    return syncAchievementsForPlayer(tx, actorId);
  }, { timeout: 15000 });
}
