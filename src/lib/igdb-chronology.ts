import "server-only";
import { queryIgdb } from "@/lib/igdb-api";
import { normalizeFranchiseKey } from "@/lib/franchise-key";
import { collapseChronologyGames, preservesChronologySequence, type CanonicalGame, type FranchiseCanon } from "@/lib/chronology-titles";

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function id(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 120 ? value.trim() : null; }
const groupKey = (name: string) => normalizeFranchiseKey(name).replace(/^the-/, "");
const oldTypes: Record<number, string> = { 0: "main-game", 4: "standalone-expansion", 6: "episode", 8: "remake", 9: "remaster", 10: "expanded-game", 11: "port" };
const allowedTypes = new Set(Object.values(oldTypes));
const dateLimit = Date.UTC(2101, 0, 1) / 1000;
function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= -5364662400 && value < dateLimit && value <= Date.now() / 1000;
}
type IgdbEntry = { id: number; title: string; releaseYear: number; aliases: string[]; date: number; row: Record<string, unknown> };

export function buildIgdbCanon(rows: unknown[]): CanonicalGame[] {
  const cleaned = new Map<number, IgdbEntry>();
  for (const row of rows) {
    if (!record(row) || !id(row.id)) continue;
    const type = record(row.game_type) && typeof row.game_type.type === "string" ? normalizeFranchiseKey(row.game_type.type) : typeof row.category === "number" ? oldTypes[row.category] : null;
    const title = text(row.name);
    if (!title || !type || !allowedTypes.has(type) ||
      /\b(soundtrack|season pass|cosmetic pack|skin pack|weapon pack)\b/i.test(title)) continue;
    const dates = [row.first_release_date, ...(Array.isArray(row.release_dates) ? row.release_dates.slice(0, 1000).flatMap(date => record(date) ? [date.date] : []) : [])].filter(timestamp);
    if (!dates.length) continue;
    const date = Math.min(...dates);
    const aliases = [text(row.slug), ...(Array.isArray(row.alternative_names) ? row.alternative_names.slice(0, 100).flatMap(name => record(name) ? [text(name.name)] : []) : [])];
    cleaned.set(row.id, { id: row.id, title, releaseYear: new Date(date * 1000).getUTCFullYear(), date, row,
      aliases: [...new Set(aliases.filter((name): name is string => name !== null && name !== title && preservesChronologySequence(name, title)))].slice(0, 100) });
  }
  // Only explicit edition relationships establish a shared story identity. parent_game
  // also describes expansions; a remake category or common title prefix is not proof.
  const parents = new Map<number, number[]>();
  function link(childId: unknown, parentId: unknown) {
    if (!id(childId) || !id(parentId) || childId === parentId) return;
    const child = cleaned.get(childId), parent = cleaned.get(parentId);
    if (!child || !parent || parent.date > child.date || !preservesChronologySequence(child.title, parent.title)) return;
    parents.set(childId, [...new Set([...(parents.get(childId) ?? []), parentId])]);
  }
  for (const game of cleaned.values()) {
    link(game.id, game.row.version_parent);
    for (const relation of ["remakes", "remasters", "ports"]) {
      const children = game.row[relation];
      if (Array.isArray(children)) for (const child of children) link(child, game.id);
    }
  }
  const compare = (a: IgdbEntry, b: IgdbEntry) =>
    a.date - b.date || a.title.localeCompare(b.title, "en") || a.id - b.id;
  function original(game: IgdbEntry): IgdbEntry {
    const visited = new Set<number>();
    let current = game;
    while (true) {
      if (visited.has(current.id)) return game; // Malformed/cyclic provider data must not merge identities.
      visited.add(current.id);
      const candidates = (parents.get(current.id) ?? []).map(parentId => cleaned.get(parentId)!).sort(compare);
      if (!candidates.length) return current;
      const parent = candidates[0];
      if (!preservesChronologySequence(game.title, parent.title)) return game;
      current = parent;
    }
  }
  const resolved = [...cleaned.values()].map(game => {
    const root = original(game);
    return { ...root, sourceId: game.id, aliases: [...new Set([root.title, ...root.aliases, game.title, ...game.aliases])]
      .filter(alias => alias !== root.title && preservesChronologySequence(alias, root.title)).slice(0, 100) };
  }).sort((a, b) => compare(a, b) || a.sourceId - b.sourceId);
  const games: CanonicalGame[] = resolved.map((game, index) => ({ title: game.title, releaseYear: game.releaseYear,
    chronologicalRank: index + 1, ...(game.aliases.length ? { aliases: game.aliases } : {}) }));
  return collapseChronologyGames(games);
}

/** Returns a complete, paginated public catalogue or null; never caches a truncated page. */
export async function getIgdbChronology(franchise: string): Promise<FranchiseCanon | null> {
  if (typeof franchise !== "string" || !franchise.trim() || franchise.trim().length > 120) return null;
  const name = franchise.trim().replace(/[\u0000-\u001f\u007f]/g, " ");
  const signal = AbortSignal.timeout(25000);
  try {
    const body = `search ${JSON.stringify(name)}; fields id,name,slug,games; limit 50;`;
    const groups = await Promise.all([queryIgdb("collections", body, signal), queryIgdb("franchises", body, signal)]);
    const exact = (rows: unknown[] | null) => (rows ?? []).filter((row): row is Record<string, unknown> => record(row) && id(row.id) &&
      ((typeof row.name === "string" && groupKey(row.name) === groupKey(name)) || (typeof row.slug === "string" && groupKey(row.slug) === groupKey(name))));
    const collections = exact(groups[0]), franchises = exact(groups[1]);
    if (!collections.length && !franchises.length) return null;
    const conditions: string[] = [];
    if (collections.length) conditions.push(`collections = (${collections.map(row => row.id).join(",")})`);
    if (franchises.length) {
      const ids = franchises.map(row => row.id).join(","); conditions.push(`franchises = (${ids})`, `franchise = (${ids})`);
    }
    const explicitIds = [...new Set([...collections, ...franchises].flatMap(row => Array.isArray(row.games) ? row.games.filter(id) : []))];
    if (explicitIds.length && explicitIds.length <= 1000) conditions.push(`id = (${explicitIds.join(",")})`);
    const rows: unknown[] = [];
    for (let offset = 0; offset < 5000; offset += 500) {
      const page = await queryIgdb("games", `fields id,name,slug,alternative_names.name,first_release_date,release_dates.date,game_type.type,version_parent,remakes,remasters,ports; where (${conditions.join(" | ")}); sort id asc; limit 500; offset ${offset};`, signal);
      if (!page) return null;
      rows.push(...page);
      if (page.length < 500) {
        const games = buildIgdbCanon(rows);
        return games.length ? { source: "igdb", games } : null;
      }
    }
    return null;
  } catch { return null; }
}
