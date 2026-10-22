import { normalizeFranchiseKey } from "@/lib/franchise-key";

export type CanonicalGame = { title: string; releaseYear: number | null; chronologicalRank: number; aliases?: string[] };
export type FranchiseCanon = { games: CanonicalGame[]; source: string };

// Only explicit edition suffixes can be removed. Sequence markers are never removed.
const editionSuffix = /(?:\s+|\s*[-–—:]\s*|\s*\(\s*|\s*\[\s*)(?:(?:game of the year|goty|definitive|ultimate|deluxe|complete|enhanced|special) edition|director['’]?s cut|hd(?:\s+remaster(?:ed)?)?|remaster(?:ed)?|remake)\s*[)\]]?$/i;
function formattedTitle(title: string): string {
  return title.trim()
    .replace(/\s*(?:[-–—]\s*|\(|\[|\bfor\s+)(?:pc|steam|nintendo switch|switch|ps[1-5]|playstation\s*[1-5]?|xbox(?:\s+(?:one|360|series [xs]))?)\s*[)\]]?\s*$/i, "")
    .replace(/\(\s*(?:19|20)\d{2}\s*\)|\[\s*(?:19|20)\d{2}\s*\]/g, "")
    .replace(/\s+/g, " ").trim();
}
export function hasExplicitChronologyEdition(title: string): boolean {
  return editionSuffix.test(formattedTitle(title));
}
export function baseChronologyTitle(title: string): string {
  let base = formattedTitle(title), previous: string;
  do { previous = base; base = base.replace(editionSuffix, "").trim(); } while (base && base !== previous);
  return base || formattedTitle(title);
}

/** Reject aliases/links which would erase or change a sequel's sequence number. */
export function preservesChronologySequence(title: string, base: string): boolean {
  const left = normalizeChronologyTitle(baseChronologyTitle(title)), right = normalizeChronologyTitle(baseChronologyTitle(base));
  const numbers = (key: string) => key.match(/\d+/g) ?? [];
  const a = numbers(left), b = numbers(right);
  if (a.length) return a.join(".") === b.join(".");
  // Numberless official abbreviations (FFIX) remain usable, but bare franchise names cannot alias sequels.
  return !b.length || left !== right.replace(/\d+/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export function collapseChronologyGames(games: readonly CanonicalGame[], compactRanks = true): CanonicalGame[] {
  const grouped = new Map<string, CanonicalGame>();
  for (const game of [...games].sort((a, b) => a.chronologicalRank - b.chronologicalRank || (a.releaseYear ?? Infinity) - (b.releaseYear ?? Infinity) || a.title.localeCompare(b.title, "en"))) {
    const title = baseChronologyTitle(game.title), titleKey = normalizeChronologyTitle(title);
    if (!titleKey) continue;
    const editionProof = [game.title, ...(game.aliases ?? [])].some(alias => hasExplicitChronologyEdition(alias) &&
      preservesChronologySequence(alias, game.title) && normalizeChronologyTitle(baseChronologyTitle(alias)) === titleKey);
    // An unlinked same-name reboot in another year is a separate entity. Explicit editions may anchor to an earlier exact base.
    const original = editionProof ? games.filter(candidate => normalizeChronologyTitle(baseChronologyTitle(candidate.title)) === titleKey &&
      !hasExplicitChronologyEdition(candidate.title) && candidate.releaseYear != null && game.releaseYear != null && candidate.releaseYear <= game.releaseYear)
      .sort((a, b) => a.releaseYear! - b.releaseYear! || a.chronologicalRank - b.chronologicalRank)[0] : undefined;
    const releaseYear = original?.releaseYear ?? game.releaseYear;
    const key = `${titleKey}:${releaseYear ?? ""}`;
    const existing = grouped.get(key);
    const aliases = [game.title, ...(game.aliases ?? [])].filter(alias => alias !== title && preservesChronologySequence(alias, title));
    if (existing) existing.aliases = [...new Set([...(existing.aliases ?? []), ...aliases])].slice(0, 100);
    else grouped.set(key, { title, releaseYear, chronologicalRank: compactRanks ? grouped.size + 1 : original?.chronologicalRank ?? game.chronologicalRank,
      ...(aliases.length ? { aliases: [...new Set(aliases)].slice(0, 100) } : {}) });
  }
  return [...grouped.values()];
}

function roman(value: string): string {
  if (!/^(?:xl|l|x{0,3})(?:ix|iv|v?i{0,3})$/.test(value) || !value) return value;
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50 };
  const total = [...value].reduce((sum, char, index) => sum + (values[char] < (values[value[index + 1]] ?? 0) ? -values[char] : values[char]), 0);
  return total > 0 && total <= 50 ? String(total) : value;
}
export function normalizeChronologyTitle(title: string): string {
  const clean = title.replace(/\s*(?:[-–—]\s*|\(|\[|\bfor\s+)(?:pc|steam|nintendo switch|switch|ps[1-5]|playstation\s*[1-5]?|xbox(?:\s+(?:one|360|series [xs]))?)\s*[)\]]?\s*$/i, "");
  return normalizeFranchiseKey(clean).split("-").map((token, index) => {
    if (/^\d+$/.test(token) && token.length < 5) return String(Number(token));
    return index > 0 ? roman(token) : token;
  }).join("-");
}
export function explainChronologyMatch(games: CanonicalGame[], game: { title: string; releaseYear?: number | null }): { match: CanonicalGame | null; reason: string } {
  const canon = collapseChronologyGames(games, false);
  const exactKey = normalizeChronologyTitle(game.title), baseKey = normalizeChronologyTitle(baseChronologyTitle(game.title));
  // Exact canonical names beat aliases, including polluted aliases from a legacy cache.
  for (const aliases of [false, true]) {
    const matches = canon.filter(entry => preservesChronologySequence(game.title, entry.title) &&
      [entry.title, ...(aliases ? entry.aliases ?? [] : [])].some(name => preservesChronologySequence(name, entry.title) &&
        (normalizeChronologyTitle(name) === exactKey || normalizeChronologyTitle(baseChronologyTitle(name)) === baseKey)));
    if (matches.length === 1) return { match: matches[0], reason: aliases ? "Verified official alias / explicit edition match; sequence preserved." : "Exact normalized title / explicit edition match; sequence preserved." };
    if (matches.length > 1) {
      const dated = game.releaseYear == null ? [] : matches.filter(entry => entry.releaseYear === game.releaseYear);
      if (dated.length === 1) return { match: dated[0], reason: "Exact release year distinguishes unlinked same-name games; no story-equivalence assumption." };
      return { match: null, reason: `Ambiguous: ${matches.length} unlinked same-name candidates. No remake relationship or unique release year identifies this game.` };
    }
  }
  return { match: null, reason: games.length ? "No exact normalized title, safe official alias, or explicit edition match. Subtitle/series-prefix guesses are disabled." : "No canonical entries cached for this saga." };
}

export function matchChronologyGame(games: CanonicalGame[], game: { title: string; releaseYear?: number | null }): CanonicalGame | null {
  return explainChronologyMatch(games, game).match;
}
