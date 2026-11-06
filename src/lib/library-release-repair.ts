import "server-only";
import { prisma } from "@/lib/prisma";
import { libraryMetadataKey, loadLibraryMetadata } from "@/lib/library-metadata";
import type { LibraryMetadata } from "@/lib/library-metadata";

/** One-time, restartable repair. Never replaces a known year or a player's existing genre. */
export async function repairLibraryReleaseYears(apply = false) {
  let cursor = 0, scanned = 0, updated = 0;
  const resolved = new Map<string, LibraryMetadata | null>();
  const repairs: { title: string; releaseYear: number; genre: string | null; count: number }[] = [];
  const unresolved = new Set<string>();
  for (;;) {
    const rows = await prisma.game.findMany({ where: { releaseYear: null, id: { gt: cursor } },
      orderBy: { id: "asc" }, take: 100, select: { id: true, userId: true, title: true, genre: true, steamAppId: true } });
    if (!rows.length) break;
    scanned += rows.length;
    const titles = [...new Map(rows.filter(row => !resolved.has(libraryMetadataKey(row)))
      .map(row => [libraryMetadataKey(row), { title: row.title, steamAppId: row.steamAppId }])).values()];
    // Small batches respect IGDB's shared dispatch gate without a provider request per library copy.
    for (let index = 0; index < titles.length; index++) {
      const batch = titles.slice(index, index + 1);
      const metadata = await loadLibraryMetadata(batch, batch.length);
      for (const game of batch) resolved.set(libraryMetadataKey(game), metadata.get(libraryMetadataKey(game)) ?? null);
    }
    for (const row of rows) {
      const info = resolved.get(libraryMetadataKey(row));
      if (!info?.releaseYear || info.releaseYear > new Date().getFullYear()) { unresolved.add(row.title); continue; }
      const data = { releaseYear: info.releaseYear, ...(!row.genre?.trim() && info.genre ? { genre: info.genre } : {}) };
      const count = apply ? (await prisma.game.updateMany({
        where: { id: row.id, userId: row.userId, releaseYear: null, genre: row.genre }, data,
      })).count : 1;
      updated += count;
      if (count) {
        const previous = repairs.find(repair => repair.title === row.title && repair.releaseYear === info.releaseYear);
        if (previous) previous.count += count;
        else repairs.push({ title: row.title, releaseYear: info.releaseYear, genre: data.genre ?? row.genre, count });
      }
    }
    cursor = rows[rows.length - 1].id;
  }
  return { applied: apply, scanned, updated, unresolved: [...unresolved], repairs };
}
