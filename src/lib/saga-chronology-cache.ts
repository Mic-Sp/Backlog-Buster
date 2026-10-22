import "server-only";
import { prisma } from "@/lib/prisma";
import { InputError } from "@/lib/action-result";
import { normalizeFranchiseKey } from "@/lib/franchise-key";
import type { SagaCacheSnapshot } from "@/lib/saga-debug";
import type { LoreLookup } from "@/lib/saga-lore";

import { collapseChronologyGames, matchChronologyGame, normalizeChronologyTitle, type CanonicalGame, type FranchiseCanon } from "@/lib/chronology-titles";
type SagaTitle = { title: string; releaseYear: number | null };
type Canon = { games: CanonicalGame[]; source: string };
const select = { games: true, source: true, updatedAt: true } as const;
export const FRANCHISE_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
type Resolution = { order: Record<string, number>; cacheHit: boolean; unmatchedTitles?: string[]; refreshDeferred?: boolean; localFallback?: boolean; debug: SagaCacheSnapshot; notice?: string; retryAfterSeconds?: number };
const loreSource = (source: string) => ["igdb+gemini", "gemini-canon", "gemini"].includes(source);

function snapshot(canon: Canon | null, row: unknown, status: SagaCacheSnapshot["status"]): SagaCacheSnapshot {
  const date = record(row) ? row.updatedAt : null;
  const time = date instanceof Date ? date.getTime() : typeof date === "string" ? Date.parse(date) : NaN;
  return { status, source: canon?.source ?? "fallback", updatedAt: Number.isFinite(time) ? new Date(time).toISOString() : null, canonicalGames: canon?.games ?? [] };
}

/** Read-only inspection: does not claim a refresh lease, call IGDB, or change ranks. */
export async function inspectSagaChronologyCache(sagaName: string): Promise<SagaCacheSnapshot> {
  const slug = normalizeFranchiseKey(sagaName);
  if (!slug || sagaName.length > 120) throw new InputError("Choose a valid saga.");
  const row = await prisma.franchiseChronology.findUnique({ where: { slug }, select });
  const canon = readCanon(row);
  return snapshot(canon, row, canon ? "hit" : "miss");
}

function knownOrder(canon: Canon, titles: SagaTitle[]): Record<string, number> {
  return Object.fromEntries(titles.flatMap(game => {
    const match = matchChronologyGame(canon.games, game);
    return match ? [[game.title.trim(), match.chronologicalRank]] : [];
  }));
}
function fallback(canon: Canon, titles: SagaTitle[], refreshDeferred = false): Omit<Resolution, "debug"> {
  const order = knownOrder(canon, titles);
  return { order, cacheHit: true, unmatchedTitles: titles.filter(game => !Object.hasOwn(order, game.title.trim())).map(game => game.title.trim()), refreshDeferred };
}
function refreshedRecently(row: unknown): boolean {
  if (!record(row)) return false;
  const time = row.updatedAt instanceof Date ? row.updatedAt.getTime() : typeof row.updatedAt === "string" ? Date.parse(row.updatedAt) : NaN;
  return Number.isFinite(time) && Date.now() - time < FRANCHISE_REFRESH_COOLDOWN_MS;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function year(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1800 && value <= 2100 ? value : null;
}
function readCanon(value: unknown): Canon | null {
  if (!record(value) || typeof value.source !== "string" || !value.source.trim() || value.source.length > 200 ||
    !Array.isArray(value.games) || !value.games.length || value.games.length > 10000) return null;
  const games: CanonicalGame[] = [], titles = new Set<string>(), ranks = new Set<number>();
  for (const game of value.games) {
    if (!record(game) || typeof game.title !== "string" || !game.title.trim() || game.title.length > 120 ||
      (game.releaseYear !== null && year(game.releaseYear) === null) ||
      typeof game.chronologicalRank !== "number" || !Number.isSafeInteger(game.chronologicalRank) ||
      game.chronologicalRank < 1 || game.chronologicalRank > 10000) return null;
    const key = `${normalizeChronologyTitle(game.title)}:${game.releaseYear ?? ""}`;
    if (!normalizeChronologyTitle(game.title) || titles.has(key) || ranks.has(game.chronologicalRank)) return null;
    titles.add(key); ranks.add(game.chronologicalRank);
    if (game.aliases !== undefined && (!Array.isArray(game.aliases) || game.aliases.length > 100 ||
      game.aliases.some(alias => typeof alias !== "string" || !alias.trim() || alias.length > 120))) return null;
    const aliases = Array.isArray(game.aliases) ? [...new Set((game.aliases as string[]).map(alias => alias.trim()))] : [];
    // Project only public metadata, even if an old JSON record contains extra properties.
    games.push({ title: game.title.trim(), releaseYear: game.releaseYear as number | null, chronologicalRank: game.chronologicalRank, ...(aliases.length ? { aliases } : {}) });
  }
  // Reading/applying a cache must preserve its global ranks, even for a sparse canon.
  return { games: collapseChronologyGames(games, false), source: value.source.trim() };
}
function matchingOrder(canon: Canon | null, titles: SagaTitle[]): Record<string, number> | null {
  if (!canon) return null;
  const order = knownOrder(canon, titles);
  return titles.every(game => Object.hasOwn(order, game.title.trim())) ? order : null;
}

export async function resolveCachedSagaChronology(
  sagaName: string,
  titles: SagaTitle[],
  lookup: (previous: FranchiseCanon | null) => Promise<LoreLookup | null>,
  options: { forceRefresh?: boolean } = {},
): Promise<Resolution> {
  const slug = normalizeFranchiseKey(sagaName);
  if (!slug || sagaName.length > 120 || !titles.length || titles.some(game =>
    typeof game.title !== "string" || !game.title.trim() || game.title.trim().length > 120 || !normalizeFranchiseKey(game.title))) {
    throw new InputError("Choose a valid saga and game titles.");
  }
  // Cache hits skip all upstream requests and provider rate limiting.
  let cachedRow = await prisma.franchiseChronology.findUnique({ where: { slug }, select });
  let cached = readCanon(cachedRow);
  const hit = matchingOrder(cached, titles);
  if (hit && !options.forceRefresh) return { order: hit, cacheHit: true, debug: snapshot(cached, cachedRow, "hit") };

  if (cached) {
    // Claim a persistent refresh window under the same global lock before doing network work.
    // Other operators/cold starts use known ranks while this refresh is pending or unresolved.
    const claim = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`backlogbuster-franchise:${slug}`}, 0))`;
      const row = await tx.franchiseChronology.findUnique({ where: { slug }, select });
      const latest = readCanon(row);
      if (!options.forceRefresh && latest && (matchingOrder(latest, titles) || refreshedRecently(row))) return { canon: latest, row, scan: false };
      if (latest) await tx.franchiseChronology.update({ where: { slug }, data: { updatedAt: new Date() }, select: { slug: true } });
      return { canon: latest, row, scan: true };
    });
    if (!claim.scan && claim.canon) return { ...fallback(claim.canon, titles, true), debug: snapshot(claim.canon, claim.row, "refresh-deferred") };
    cached = claim.canon;
    cachedRow = claim.row;
  }

  const existingTitles = new Set(cached?.games.map(game => normalizeChronologyTitle(game.title)));
  const localFallback = (): Resolution => cached
    ? { ...fallback(cached, titles), debug: snapshot(cached, cachedRow, "refresh-deferred"), notice: "Chronology provider unavailable — retained the existing cached timeline." }
    : { order: {}, cacheHit: false, localFallback: true, debug: snapshot(null, null, "fallback") };
  let upstream: LoreLookup | null;
  try { upstream = await lookup(cached); }
  catch { return localFallback(); }
  const diagnostics = { ...(upstream?.geminiError ? { geminiError: upstream.geminiError } : {}),
    ...(upstream?.geminiPayload ? { geminiPayload: upstream.geminiPayload } : {}) };
  // No verified roster means no assigned ranks, rather than ranking unknown titles.
  if (upstream?.source === "unverified" && !cached) return {
    order: {}, cacheHit: false, localFallback: false,
    debug: { ...snapshot(null, null, "fallback"), ...diagnostics }, notice: "No verified saga titles were found; unmatched games use the release-order tail.",
    retryAfterSeconds: upstream.retryAfterSeconds,
  };
  if (!upstream || !["igdb", "igdb+gemini", "gemini-canon"].includes(upstream.source)) {
    const result = localFallback();
    return { ...result, debug: { ...result.debug, ...diagnostics }, notice: cached ? "Lore ordering unavailable — retained the existing cached timeline." : upstream?.notice ?? result.notice, retryAfterSeconds: upstream?.retryAfterSeconds };
  }
  const canon = readCanon(upstream);
  if (!canon || canon.games.some((game, index) => game.chronologicalRank !== index + 1)) {
    const result = localFallback();
    return { ...result, debug: { ...result.debug, ...diagnostics, geminiError: upstream.geminiError ?? "Chronology provider returned an invalid canonical roster." } };
  }
  const notice = upstream.notice;
  const saved = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`backlogbuster-franchise:${slug}`}, 0))`;
    const latestRow = await tx.franchiseChronology.findUnique({ where: { slug }, select });
    const latest = readCanon(latestRow);
    // A quota failure is never allowed to replace an already-valid timeline,
    // including one written by another operator while this request was running.
    if (latest && !loreSource(canon.source)) return { canon: latest, row: latestRow, preserved: true };
    // A concurrent successful scan wins; never replace a larger canon with a stale subset.
    if (!options.forceRefresh && matchingOrder(latest, titles) && latest && loreSource(latest.source)) return { canon: latest, row: latestRow, preserved: true };
    if (latest?.games.some(game => !matchChronologyGame(canon.games, game) && !existingTitles.has(normalizeChronologyTitle(game.title)))) {
      throw new InputError("The shared canon expanded during this scan. Retry to include its new titles; no library ranks were changed.");
    }
    const data = { displayName: sagaName.trim().replace(/\s+/g, " "), games: canon.games, source: canon.source };
    const savedRow = await tx.franchiseChronology.upsert({ where: { slug }, create: { slug, ...data }, update: data, select: { updatedAt: true } });
    return { canon, row: savedRow, preserved: false };
  });
  const result = fallback(saved.canon, titles);
  const debug = { ...snapshot(saved.canon, saved.row, saved.preserved ? "hit" : cached ? "refreshed" : "miss"),
    ...diagnostics };
  const extra = { debug, notice: saved.preserved && !loreSource(canon.source) ? "Gemini lore ordering unavailable — retained the existing cached timeline without replacing it with release-order fallback." : notice,
    retryAfterSeconds: upstream.retryAfterSeconds };
  return result.unmatchedTitles?.length ? { ...result, cacheHit: saved.preserved, ...extra } : { order: result.order, cacheHit: saved.preserved, ...extra };
}
