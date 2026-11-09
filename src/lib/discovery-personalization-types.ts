import type { DiscoveryCard, DiscoverySnapshot } from "@/lib/discovery-feed-types";

export const HIGH_TASTE_THRESHOLD = .8;
export type DiscoveryAffinity = {
  similarity: number | null;
  matchPercent: number | null;
  highTasteMatch: boolean;
  sagaFollow: string | null;
};
export type PersonalizedDiscoveryCard = DiscoveryCard & { affinity: DiscoveryAffinity };
export type PersonalizedDiscoveryFeed = Omit<DiscoverySnapshot, "items"> & {
  items: PersonalizedDiscoveryCard[];
  unseenCount: number;
  hasTasteProfile: boolean;
};
export type DiscoverySort = "default" | "best-match";
export const isInterestMatch = (game: PersonalizedDiscoveryCard) => game.affinity.highTasteMatch || Boolean(game.affinity.sagaFollow);

/** Percentages stay pure cosine; saga affinity is a separate, explicit sorting boost. */
export function sortDiscoveryCards<T extends PersonalizedDiscoveryCard>(items: readonly T[], mode: DiscoverySort, radar = false): T[] {
  const ranked = items.map((game, index) => ({ game, index }));
  if (mode === "best-match") ranked.sort((a, b) =>
    ((b.game.affinity.similarity ?? 0) + (b.game.affinity.sagaFollow ? .15 : 0)) -
    ((a.game.affinity.similarity ?? 0) + (a.game.affinity.sagaFollow ? .15 : 0)) || a.index - b.index);
  else if (radar) ranked.sort((a, b) => (a.game.releaseDate ?? "9999").localeCompare(b.game.releaseDate ?? "9999") || a.index - b.index);
  return ranked.map(({ game }) => game);
}

export function unseenRadarKeys(items: readonly PersonalizedDiscoveryCard[], seenKeys: readonly string[]): string[] {
  const seen = new Set(seenKeys);
  return [...new Set(items.filter(game => isInterestMatch(game) && !seen.has(game.key)).map(game => game.key))];
}
