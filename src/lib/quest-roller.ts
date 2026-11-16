import { normalizeHypeLevel } from "@/lib/hype";
import { isUnreleasedYear } from "@/lib/game-release";

export type RollGame = {
  id: number; hypeLevel?: number; status?: string; releaseYear?: number | null;
  lengthHours: number; genre: string | null; platform: string;
};
export type QuestRollOptions = {
  hypeWeighted?: boolean; iceboxMode?: boolean; time?: string; genre?: string; platform?: string;
  currentYear?: number;
};

/** Ordinary eligibility/filters run before the Tier 1 fallback is considered. */
export function questRollPool<T extends RollGame>(games: readonly T[], {
  iceboxMode = false, time = "all", genre = "", platform = "", currentYear = new Date().getFullYear(),
}: QuestRollOptions = {}): { candidates: T[]; automaticFallback: boolean } {
  const filtered = games.filter(game => (!game.status || game.status === "Backlog") && !isUnreleasedYear(game.releaseYear, currentYear) &&
    (time === "all" || time === "quick" && game.lengthHours <= 15 || time === "standard" && game.lengthHours >= 16 && game.lengthHours <= 40 || time === "epic" && game.lengthHours >= 40) &&
    (!genre || game.genre?.trim() === genre) && (!platform || game.platform.trim() === platform));
  const normal = filtered.filter(game => normalizeHypeLevel(game.hypeLevel) !== 1);
  const automaticFallback = !iceboxMode && normal.length === 0 && filtered.length > 0;
  return { candidates: iceboxMode || automaticFallback ? filtered : normal, automaticFallback };
}

/** Independent weighted draws allow repeats so even a two-game pool stays 3:1. */
export function pickQuest<T extends RollGame>(candidates: readonly T[], { hypeWeighted = true }: QuestRollOptions = {}, random = Math.random): T | null {
  if (!candidates.length) return null;
  const weight = (game: T) => hypeWeighted && normalizeHypeLevel(game.hypeLevel) === 3 ? 3 : 1;
  const total = candidates.reduce((sum, game) => sum + weight(game), 0);
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error("Random sample must be from 0 (inclusive) to 1 (exclusive).");
  let remaining = sample * total;
  for (const game of candidates) {
    remaining -= weight(game);
    if (remaining < 0) return game;
  }
  return candidates[candidates.length - 1];
}
