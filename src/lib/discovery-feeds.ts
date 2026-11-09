import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { catalogIdentity, catalogSuggestion, tryUpsertCatalogGame } from "@/lib/catalog-store";
import { fetchDiscoveryProvider } from "@/lib/discovery-providers";
import { FEED_TTL_MS, filterDiscoveryCards, releaseWindow, type DiscoveryCard, type DiscoveryKind, type DiscoverySnapshot } from "@/lib/discovery-feed-types";

const metadataSelect = { key: true, title: true, releaseYear: true, releaseDate: true, platforms: true,
  genre: true, estimatedHours: true, coverUrl: true } as const;
function card(game: Parameters<typeof catalogSuggestion>[0] & { key: string; releaseDate?: Date | string | null }, signal: DiscoveryCard["signal"]): DiscoveryCard {
  return { ...catalogSuggestion(game), key: game.key, releaseDate: game.releaseDate instanceof Date
    ? game.releaseDate.toISOString().slice(0, 10) : game.releaseDate ?? null, signal };
}
// JSON snapshots are written only by this module, never from client-supplied card data.
function cachedCards(items: unknown): DiscoveryCard[] {
  return Array.isArray(items) ? items as DiscoveryCard[] : [];
}
/** Notification and mutation paths never claim a refresh or invoke providers. */
export async function readCachedDiscoveryFeed(kind: DiscoveryKind): Promise<DiscoverySnapshot> {
  const row = await prisma.discoveryFeed.findUnique({ where: { kind } });
  return { items: filterDiscoveryCards(cachedCards(row?.items), [], kind), source: row?.source ?? "local",
    refreshedAt: row?.refreshedAt.toISOString() ?? null };
}
async function localCards(kind: DiscoveryKind, now: Date): Promise<DiscoveryCard[]> {
  const { start, end } = releaseWindow(now);
  const rows = await prisma.gameCatalog.findMany({
    where: kind === "radar" ? { releaseDate: { gte: start, lte: end } } : {},
    select: metadataSelect, orderBy: [{ releaseDate: { sort: "desc", nulls: "last" } }, { title: "asc" }], take: 48,
  });
  return rows.map(game => card(game, "catalog"));
}
async function communityCards(): Promise<DiscoveryCard[]> {
  // Only public catalog metadata leaves this query. Aggregate distinct players across
  // platforms; never return their identity, notes, ratings, or player-authored titles.
  const rows = await prisma.$queryRaw<(Parameters<typeof card>[0])[]>`
    SELECT c."key", c."title", c."releaseYear", c."releaseDate", c."platforms", c."genre", c."estimatedHours", c."coverUrl"
    FROM "GameCatalog" c JOIN "Game" g ON lower(trim(g."title")) = lower(c."title")
      AND (g."releaseYear" IS NULL OR c."releaseYear" IS NULL OR g."releaseYear" = c."releaseYear")
    WHERE g."userId" <> 'default-player'
    GROUP BY c."key"
    ORDER BY (COUNT(DISTINCT g."userId") + 2 * COUNT(DISTINCT g."userId") FILTER (WHERE g."status" = 'Playing' OR g."steamRecentMinutes" > 0)
      + COUNT(DISTINCT g."userId") FILTER (WHERE g."createdAt" >= CURRENT_TIMESTAMP - INTERVAL '30 days')) DESC, c."title" ASC
    LIMIT 24
  `;
  return rows.map(game => card(game, "community"));
}
function mergeCards(primary: DiscoveryCard[], secondary: DiscoveryCard[], kind: DiscoveryKind, now: Date) {
  // Interleave so provider releases and community favorites both have guaranteed space.
  const mixed = Array.from({ length: Math.max(primary.length, secondary.length) }, (_, i) => [primary[i], secondary[i]])
    .flat().filter((item): item is DiscoveryCard => Boolean(item));
  return filterDiscoveryCards(mixed, [], kind, now).slice(0, 48);
}

export async function getDiscoveryFeed(kind: DiscoveryKind, now = new Date()): Promise<DiscoverySnapshot> {
  const local = async () => localCards(kind, now).catch(() => []);
  let previous;
  try { previous = await prisma.discoveryFeed.findUnique({ where: { kind } }); }
  catch {
    // Without durable coordination, do not call providers on every browser request.
    return { items: await local(), source: "local", refreshedAt: null };
  }
  const snapshot = () => ({ items: filterDiscoveryCards(cachedCards(previous?.items), [], kind, now),
    source: previous?.source ?? "local", refreshedAt: previous?.refreshedAt.toISOString() ?? null });
  if (previous && previous.expiresAt.getTime() > now.getTime()) return snapshot();
  const leaseId = randomUUID();
  let claimed;
  try {
    claimed = await prisma.$queryRaw<{ kind: string }[]>`
      INSERT INTO "DiscoveryFeed" ("kind", "items", "source", "refreshedAt", "expiresAt", "leaseId", "leaseUntil")
      VALUES (${kind}, '[]'::jsonb, 'local', ${now}, ${new Date(0)}, ${leaseId}, CURRENT_TIMESTAMP + INTERVAL '2 minutes')
      ON CONFLICT ("kind") DO UPDATE SET "leaseId" = EXCLUDED."leaseId", "leaseUntil" = EXCLUDED."leaseUntil"
      WHERE "DiscoveryFeed"."expiresAt" <= ${now}
        AND ("DiscoveryFeed"."leaseUntil" IS NULL OR "DiscoveryFeed"."leaseUntil" <= CURRENT_TIMESTAMP)
      RETURNING "kind"
    `;
  } catch { return previous ? snapshot() : { items: await local(), source: "local", refreshedAt: null }; }
  if (!claimed.length) return previous ? snapshot() : { items: await local(), source: "local", refreshedAt: null };

  // A failed refresh still receives a full TTL, so missing keys/429s do not cause storms.
  const provider = await fetchDiscoveryProvider(kind, now).catch(() => ({ games: [], source: "local" }));
  const remote = provider.games.map(game => card({ ...game, key: catalogIdentity(game) }, "release"));
  const community = kind === "popular" ? await communityCards().catch(() => []) : [];
  let source = provider.source;
  let items = mergeCards(remote, community, kind, now);
  if (!remote.length) {
    source = "local";
    items = mergeCards(community, mergeCards(cachedCards(previous?.items), await local(), kind, now), kind, now);
  }
  const refreshedAt = new Date();
  const saved = await prisma.discoveryFeed.updateMany({ where: { kind, leaseId }, data: {
    items, source, refreshedAt, expiresAt: new Date(now.getTime() + FEED_TTL_MS), leaseId: null, leaseUntil: null,
  } });
  if (saved.count && provider.games.length) {
    // Keep catalog/vector ingestion bounded and reuse verified provider parsing.
    for (let i = 0; i < provider.games.length; i += 8) await Promise.all(provider.games.slice(i, i + 8).map(tryUpsertCatalogGame));
  }
  return { items, source, refreshedAt: refreshedAt.toISOString() };
}
