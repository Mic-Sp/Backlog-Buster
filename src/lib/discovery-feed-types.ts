import type { CatalogSuggestion } from "@/lib/catalog-types";
import { normalizeGameTitle } from "@/lib/game-title";

export type DiscoveryKind = "radar" | "popular";
export type DiscoveryCard = CatalogSuggestion & {
  key: string;
  releaseDate: string | null;
  signal: "release" | "community" | "catalog";
};
export type DiscoverySnapshot = {
  items: DiscoveryCard[];
  source: string;
  refreshedAt: string | null;
};
export const FEED_TTL_MS = 18 * 60 * 60 * 1000;
const DAY = 86400000;
export function releaseWindow(now = new Date(), pastDays = 60) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { start: new Date(today - pastDays * DAY), end: new Date(today + 90 * DAY), today };
}
export function inReleaseWindow(date: string | null, now = new Date()) {
  if (!date) return false;
  const { start, end } = releaseWindow(now);
  const time = Date.parse(date);
  return time >= start.getTime() && time <= end.getTime();
}
export function filterDiscoveryCards(items: DiscoveryCard[], excluded: readonly string[], kind: DiscoveryKind, now = new Date()) {
  const hidden = new Set(excluded.map(normalizeGameTitle));
  const seen = new Set<string>();
  return items.filter(item => {
    const key = normalizeGameTitle(item.title);
    if (hidden.has(key) || seen.has(key) || (kind === "radar" && !inReleaseWindow(item.releaseDate, now))) return false;
    seen.add(key);
    return true;
  });
}
