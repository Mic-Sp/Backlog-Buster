import { normalizeGameTitle } from "@/lib/game-title";
import { normalizeFeatureList } from "@/lib/catalog-vector";
import type { DiscoveredPlayer } from "@/lib/friendship-types";
import type { CoopMatch } from "@/lib/social-types";

export type CoopGame = { id: number; title: string; releaseYear: number | null; steamAppId: string | null;
  platform: string; status: string; hoursPlayed: number; coverUrl: string | null };
export type CoopLibrary = { player: Pick<DiscoveredPlayer, "id" | "handle" | "operatorName">; games: readonly CoopGame[] };
export type CoopCatalogGame = { title: string; releaseYear: number | null; coverUrl: string | null; tags: string[];
  multiplayer: boolean | null; coop: boolean | null; onlineCoop: boolean | null; localCoop: boolean | null };
export type CoopOptions = { includeUnknown?: boolean; includeFinished?: boolean; currentYear?: number };
const steam = (game: CoopGame) => game.steamAppId && /^[1-9]\d{0,9}$/.test(game.steamAppId) ? game.steamAppId : null;
const year = (game: Pick<CoopGame, "releaseYear">) => Number.isInteger(game.releaseYear) && game.releaseYear! >= 1800 && game.releaseYear! <= 2100 ? game.releaseYear : null;
const platform = (name: string) => /^(pc|steam|windows|microsoft windows|pc \(microsoft windows\)|pc \(windows\)|pc \(steam\))$/i.test(name.trim()) ? "pc" : name.trim().toLowerCase();
const copyRank = (game: CoopGame) => game.status === "Playing" ? 0 : game.status === "Backlog" ? 1 : 2;
function image(value: string | null) {
  try { const url = new URL(value ?? ""); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.toString() : null; }
  catch { return null; }
}

/** Positive catalog evidence only. Unknown metadata never becomes a claim of co-op. */
function capabilities(rows: CoopCatalogGame[]) {
  const tags = new Set(normalizeFeatureList(rows.flatMap(row => row.tags)));
  const online = rows.some(row => row.onlineCoop === true) || (!rows.some(row => row.onlineCoop === false) && ["online co op", "online coop"].some(tag => tags.has(tag)));
  const local = rows.some(row => row.localCoop === true) || (!rows.some(row => row.localCoop === false) && ["local co op", "local coop", "couch coop", "couch co op", "split screen co op"].some(tag => tags.has(tag)));
  const coop = online || local || rows.some(row => row.coop === true) || (!rows.some(row => row.coop === false) && ["coop", "cooperative"].some(tag => tags.has(tag)));
  const multiplayer = coop || rows.some(row => row.multiplayer === true) || (!rows.some(row => row.multiplayer === false) && ["multiplayer", "online multiplayer", "local multiplayer", "massively multiplayer"].some(tag => tags.has(tag)));
  return { capability: coop ? "coop" as const : multiplayer ? "multiplayer" as const : "unknown" as const,
    excluded: !multiplayer && rows.some(row => row.multiplayer === false),
    labels: [...(online ? ["Online co-op"] : []), ...(local ? ["Local co-op"] : []), ...(coop && !online && !local ? ["Co-op"] : []), ...(!coop && multiplayer ? ["Multiplayer"] : [])] };
}

/** The first library is the viewer. Every result is shared by all selected participants. */
export function matchCoopBacklogs(libraries: readonly CoopLibrary[], catalog: readonly CoopCatalogGame[] = [], options: CoopOptions = {}): CoopMatch[] {
  if (libraries.length < 2 || new Set(libraries.map(library => library.player.id)).size !== libraries.length) return [];
  const currentYear = options.currentYear ?? new Date().getFullYear();
  const years = new Map<string, Set<number>>(), apps = new Map<string, Set<string>>();
  const add = <T>(map: Map<string, Set<T>>, key: string, value: T) => { const set = map.get(key) ?? new Set<T>(); set.add(value); map.set(key, set); };
  for (const library of libraries) for (const game of library.games) {
    const name = normalizeGameTitle(game.title), date = year(game), app = steam(game);
    if (date !== null) add(years, name, date);
    if (app) add(apps, JSON.stringify([name, date]), app);
  }
  const active = libraries.map(library => ({ player: library.player, games: library.games.filter(game =>
    normalizeGameTitle(game.title) && (game.status === "Backlog" || game.status === "Playing" || options.includeFinished && game.status === "Completed") &&
    (year(game) === null || year(game)! <= currentYear)) }));
  const indexed = active.slice(1).map(library => {
    const titles = new Map<string, CoopGame[]>(), ids = new Map<string, CoopGame[]>();
    for (const game of library.games) {
      const name = normalizeGameTitle(game.title), app = steam(game);
      titles.set(name, [...(titles.get(name) ?? []), game]);
      if (app) ids.set(app, [...(ids.get(app) ?? []), game]);
    }
    return { ...library, titles, ids };
  });
  const catalogTitles = new Map<string, CoopCatalogGame[]>();
  for (const row of catalog) { const name = normalizeGameTitle(row.title); catalogTitles.set(name, [...(catalogTitles.get(name) ?? []), row]); }
  const results = new Map<string, CoopMatch>();
  for (const anchor of active[0].games) {
    const name = normalizeGameTitle(anchor.title), app = steam(anchor), date = year(anchor);
    const compatible = (other: CoopGame) => {
      const otherApp = steam(other);
      if (app && otherApp) return app === otherApp;
      if (normalizeGameTitle(other.title) !== name) return false;
      const otherYear = year(other);
      if (date !== null && otherYear !== null) return date === otherYear;
      // An undated copy cannot bridge known remakes or distinct Steam editions.
      const knownYears = years.get(name);
      if ((knownYears?.size ?? 0) > 1) return false;
      const inferredYear = date ?? otherYear ?? [...(knownYears ?? [])][0] ?? null;
      return (apps.get(JSON.stringify([name, inferredYear]))?.size ?? 0) <= 1;
    };
    const copies: CoopGame[] = [anchor];
    for (const library of indexed) {
      const candidates = [...new Set([...(app ? library.ids.get(app) ?? [] : []), ...(library.titles.get(name) ?? [])])]
        .filter(compatible).sort((a, b) => Number(steam(b) === app && Boolean(app)) - Number(steam(a) === app && Boolean(app)) ||
          Number(platform(b.platform) === platform(anchor.platform)) - Number(platform(a.platform) === platform(anchor.platform)) || copyRank(a) - copyRank(b) || a.id - b.id);
      if (!candidates.length) break;
      copies.push(candidates[0]);
    }
    if (copies.length !== libraries.length) continue;
    const dates = new Set(copies.flatMap(game => year(game) === null ? [] : [year(game)!]));
    const releaseYear = date ?? (dates.size === 1 ? [...dates][0] : null);
    const appIds = new Set(copies.flatMap(game => steam(game) ? [steam(game)!] : []));
    const inferredApps = apps.get(JSON.stringify([name, releaseYear]));
    const canonicalApp = appIds.size === 1 ? [...appIds][0] : !appIds.size && inferredApps?.size === 1 ? [...inferredApps][0] : null;
    const key = canonicalApp ? `steam:${canonicalApp}` : JSON.stringify([name, releaseYear]);
    const names = new Set(copies.map(game => normalizeGameTitle(game.title)));
    let evidence = [...names].flatMap(title => catalogTitles.get(title) ?? []).filter(row => releaseYear === null || year(row) === releaseYear);
    if (releaseYear === null && new Set(evidence.map(row => row.releaseYear)).size > 1) evidence = [];
    const info = capabilities(evidence);
    if (info.excluded || info.capability === "unknown" && !options.includeUnknown) continue;
    const participants = copies.map((game, index) => ({ playerId: active[index].player.id, operatorName: active[index].player.operatorName,
      handle: active[index].player.handle, platform: game.platform, status: game.status,
      hoursPlayed: Number.isFinite(game.hoursPlayed) ? Math.max(0, Math.min(10000, game.hoursPlayed)) : 0 }));
    const match: CoopMatch = { key, title: evidence[0]?.title ?? anchor.title, releaseYear,
      coverUrl: image(evidence[0]?.coverUrl ?? anchor.coverUrl), capabilities: info.labels, capability: info.capability,
      samePlatform: new Set(participants.map(member => platform(member.platform))).size === 1, participants };
    const previous = results.get(key);
    if (!previous || match.samePlatform && !previous.samePlatform || match.samePlatform === previous.samePlatform &&
      copies.reduce((sum, game) => sum + copyRank(game), 0) < previous.participants.reduce((sum, member) => sum + (member.status === "Playing" ? 0 : member.status === "Backlog" ? 1 : 2), 0)) results.set(key, match);
  }
  const score = (match: CoopMatch) => (match.capability === "coop" ? 100 : match.capability === "multiplayer" ? 50 : 0) +
    (match.capabilities.includes("Online co-op") ? 10 : 0) + (match.samePlatform ? 5 : 0) - match.participants.filter(member => member.status === "Completed").length * 15;
  return [...results.values()].sort((a, b) => score(b) - score(a) || a.title.localeCompare(b.title, "en", { numeric: true }) || a.key.localeCompare(b.key));
}
