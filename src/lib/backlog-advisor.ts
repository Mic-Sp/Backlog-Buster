import { isReleasedYear } from "@/lib/game-release";

export const MAX_ADVISOR_HISTORY = 10_000;
export type AdvisorGame = {
  id: number; title: string; platform: string; genre: string | null;
  lengthHours: number; difficulty: number; coverUrl: string | null;
  releaseYear: number | null; status: string; rating: number | null;
  earnedXp: number; createdAt: Date; pinnedOrder: number | null;
  franchise: string | null; chronologicalOrder: number | null;
};
export type BacklogRecommendation = {
  game: Pick<AdvisorGame, "id" | "title" | "platform" | "genre" | "lengthHours" | "difficulty" | "coverUrl" | "releaseYear">;
  reason: string;
};
export type BacklogRecommendations = {
  continuationPick: BacklogRecommendation | null;
  palateCleanserPick: BacklogRecommendation | null;
  seenGameIds: number[];
};
const normalize = (value: string | null) => value?.trim().toLowerCase() ?? "";
const lineage = (game: AdvisorGame) => normalize(game.franchise) || normalize(game.title)
  .split(/[:–—-]/)[0].replace(/\b(?:remastered|remake|viii|vii|iii|vi|iv|ix|ii|i|v|x)\b|\d+/g, " ").replace(/\s+/g, " ").trim();
const newest = (a: AdvisorGame, b: AdvisorGame) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id;

function weightedPick(candidates: AdvisorGame[], score: (game: AdvisorGame) => number, random: () => number) {
  const scored = candidates.map(game => ({ game, score: score(game) }));
  const best = Math.max(...scored.map(candidate => candidate.score));
  const tier = scored.filter(candidate => candidate.score >= best * .7);
  const total = tier.reduce((sum, candidate) => sum + candidate.score ** 2, 0);
  let roll = random() * total;
  for (const candidate of tier) {
    roll -= candidate.score ** 2;
    if (roll < 0) return candidate.game;
  }
  return tier[tier.length - 1].game;
}

function recommendation(game: AdvisorGame, reason: string): BacklogRecommendation {
  return { game: {
    id: game.id, title: game.title, platform: game.platform, genre: game.genre,
    lengthHours: game.lengthHours, difficulty: game.difficulty, coverUrl: game.coverUrl, releaseYear: game.releaseYear,
  }, reason };
}

/** Local selection only. History is scoped to the supplied player's eligible games. */
export function selectBacklogRecommendations(games: readonly AdvisorGame[], excludedGameIds: readonly number[] = [], random = Math.random): BacklogRecommendations {
  const backlog = games.filter(game => game.status === "Backlog" && isReleasedYear(game.releaseYear));
  if (!backlog.length) return { continuationPick: null, palateCleanserPick: null, seenGameIds: [] };
  const eligibleIds = new Set(backlog.map(game => game.id));
  let history = [...new Set(excludedGameIds.filter(id => eligibleIds.has(id)))];
  const completed = games.filter(game => game.status === "Completed").sort(newest);
  const favorites = completed.filter(game => game.rating !== null && game.rating >= 4)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || newest(a, b));
  const affinityHistory = favorites.length ? favorites : completed.filter(game => game.rating === null);
  const genres = new Map<string, { sum: number; count: number }>();
  for (const game of completed) {
    const genre = normalize(game.genre);
    if (!genre || game.rating === null) continue;
    const profile = genres.get(genre) ?? { sum: 0, count: 0 };
    profile.sum += game.rating; profile.count++; genres.set(genre, profile);
  }
  const favoriteFor = (game: AdvisorGame) => affinityHistory.find(previous => lineage(previous) && lineage(previous) === lineage(game));
  const nextInSaga = (game: AdvisorGame) => game.chronologicalOrder !== null && Boolean(game.franchise) &&
    completed.some(previous => normalize(previous.franchise) === normalize(game.franchise) && previous.chronologicalOrder !== null && previous.chronologicalOrder < game.chronologicalOrder!) &&
    !backlog.some(other => normalize(other.franchise) === normalize(game.franchise) && other.chronologicalOrder !== null && other.chronologicalOrder < game.chronologicalOrder!);
  const affinityScore = (game: AdvisorGame) => {
    const genre = genres.get(normalize(game.genre));
    const average = genre ? genre.sum / genre.count : 0;
    return 10 + (game.pinnedOrder != null ? 25 : 0) + (nextInSaga(game) ? 80 : 0) +
      (favoriteFor(game) ? 55 : 0) + (average >= 3.5 ? average * 8 : 0) +
      (affinityHistory.slice(0, 3).some(previous => normalize(previous.genre) && normalize(previous.genre) === normalize(game.genre)) ? 15 : 0);
  };
  // createdAt is the saved record's recency signal; there is no completedAt field.
  const anchor = games.filter(game => game.status === "Playing").sort(newest)[0] ??
    completed.find(game => game.lengthHours >= 25) ?? completed[0];
  const contrasts = (game: AdvisorGame, reference: AdvisorGame | undefined) => Boolean(reference && normalize(reference.genre) && normalize(game.genre) && normalize(reference.genre) !== normalize(game.genre));

  // Retain the last pair across a wrap when the pool is large enough. With two
  // or three games, some overlap between consecutive pairs is unavoidable.
  function wrapHistory() {
    const keep = Math.min(2, Math.max(0, backlog.length - 2));
    history = keep ? history.slice(-keep) : [];
  }
  const fresh = () => backlog.filter(game => !history.includes(game.id));
  if (!fresh().length) wrapHistory();
  const primary = weightedPick(fresh(), affinityScore, random);
  let alternatives = fresh().filter(game => game.id !== primary.id);
  if (!alternatives.length && backlog.length > 1) {
    // Consume the final unseen game before wrapping an odd-sized pool.
    wrapHistory();
    alternatives = fresh().filter(game => game.id !== primary.id);
  }
  const cleanserScore = (game: AdvisorGame) => 10 + (game.lengthHours <= 15 ? 25 : 0) +
    (anchor && game.lengthHours < anchor.lengthHours ? Math.min(30, (anchor.lengthHours - game.lengthHours) * 1.5) : 0) +
    (contrasts(game, anchor) ? 30 : 0) + (contrasts(game, primary) ? 15 : 0) +
    (anchor && game.difficulty < anchor.difficulty ? 5 : 0);
  const cleanser = alternatives.length ? weightedPick(alternatives, cleanserScore, random) : null;
  const favorite = favoriteFor(primary);
  const genre = genres.get(normalize(primary.genre));
  const signals = [
    nextInSaga(primary) ? `Next-in-saga progression: the next saved backlog chapter in ${primary.franchise}.` : "",
    favorite ? `Favorites match: shares a lineage with ${favorite.title}${favorite.rating !== null ? `, rated ${favorite.rating}/5` : " from your unrated completion history"}.` : "",
    genre && genre.sum / genre.count >= 3.5 ? `Genre affinity: ${primary.genre} averages ${(genre.sum / genre.count).toFixed(1)}/5 in your rated completions.` : "",
    primary.pinnedOrder != null ? "Pinned on your Up Next Deck, reflecting your own priorities." : "",
  ].filter(Boolean);
  let cleanserReason = "";
  if (cleanser) {
    const pacing = anchor
      ? cleanser.lengthHours < anchor.lengthHours
        ? `${cleanser.lengthHours}h cuts the commitment versus ${anchor.title} (${anchor.lengthHours}h).`
        : `${cleanser.lengthHours}h offers another pacing option beside ${anchor.title} (${anchor.lengthHours}h); it is not shorter than that adventure.`
      : `${cleanser.lengthHours}h offers an alternative commitment; no active or completed adventure is available for comparison.`;
    const contrast = contrasts(cleanser, anchor) ? ` Switch from ${anchor!.genre} to ${cleanser.genre}.`
      : contrasts(cleanser, primary) ? ` Explore ${cleanser.genre} alongside the affinity pick's ${primary.genre}.`
      : " The remaining choices offer no confirmed genre contrast; this is a pacing alternative.";
    cleanserReason = `Palette cleanser / pacing reset: ${pacing}${contrast}`;
  }
  return {
    continuationPick: recommendation(primary, `Affinity / favorites match: ${signals.join(" ") || `${primary.title} is a fresh ${primary.lengthHours}h backlog choice. No strong favorite, genre, deck or saga signal is available among the remaining choices yet.`}`),
    palateCleanserPick: cleanser ? recommendation(cleanser, cleanserReason) : null,
    seenGameIds: [...new Set([...history, primary.id, ...(cleanser ? [cleanser.id] : [])])].slice(-MAX_ADVISOR_HISTORY),
  };
}
