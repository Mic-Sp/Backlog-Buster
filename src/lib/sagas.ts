import { compareChronologyTitles } from "@/lib/chronology-titles";
import { gameLineage, getFranchiseName } from "@/lib/franchise";

type SagaGame = {
  id: number;
  title: string;
  status: string;
  franchise?: string | null;
};

export type SagaChain = {
  key: string;
  name: string;
  total: number;
  completed: number;
  gameIds: number[];
};

export type SagaOrderMode = "release" | "timeline";

export function parseChronologicalOrder(value: unknown): number | null {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  const rank = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  if (typeof rank !== "number" || !Number.isSafeInteger(rank) || rank < 1 || rank > 10000) {
    throw new Error("Timeline order must be a whole number from 1 to 10000, or blank.");
  }
  return rank;
}

export function compareSagaGames(
  left: { id: number; title: string; releaseYear: number | null; chronologicalOrder?: number | null },
  right: { id: number; title: string; releaseYear: number | null; chronologicalOrder?: number | null },
  mode: SagaOrderMode,
) {
  const leftRank = left.chronologicalOrder ?? Infinity;
  const rightRank = right.chronologicalOrder ?? Infinity;
  if (mode === "timeline") {
    if (leftRank !== rightRank) return leftRank - rightRank;
  }
  const leftYear = left.releaseYear ?? Infinity;
  const rightYear = right.releaseYear ?? Infinity;
  if (leftYear !== rightYear) return leftYear - rightYear;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return compareChronologyTitles(left.title, right.title) || left.id - right.id;
}

export const getSagaName = getFranchiseName;

export function buildSagaChains(games: readonly SagaGame[]) {
  const groups = new Map<string, SagaChain & { hasManualName: boolean }>();
  for (const game of games) {
    const name = getSagaName(game);
    if (!name) continue;
    const key = gameLineage(game);
    if (!key) continue;
    const manual = Boolean(game.franchise?.trim());
    let group = groups.get(key);
    if (!group) {
      group = { key, name, total: 0, completed: 0, gameIds: [], hasManualName: manual };
      groups.set(key, group);
    } else if (manual && !group.hasManualName) {
      group.name = name;
      group.hasManualName = true;
    }
    group.total++;
    if (game.status === "Completed") group.completed++;
    group.gameIds.push(game.id);
  }
  const chains: SagaChain[] = [...groups.values()].filter((group) => group.total >= 2)
    .map(({ key, name, total, completed, gameIds }) => ({ key, name, total, completed, gameIds }))
    .sort((left, right) => compareChronologyTitles(left.name, right.name));
  const byGameId = new Map<number, SagaChain>();
  for (const chain of chains) for (const id of chain.gameIds) byGameId.set(id, chain);
  return { chains, byGameId };
}
