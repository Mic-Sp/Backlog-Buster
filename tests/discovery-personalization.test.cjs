/* eslint-disable @typescript-eslint/no-require-imports -- Exercise real scoring/actions with isolated storage. */
const test = require('node:test'), assert = require('node:assert/strict');
const { loader } = require('./helpers/social-fixture.cjs');
const load = loader(), scoring = load('src/lib/discovery-scoring.ts'), types = load('src/lib/discovery-personalization-types.ts');
const { CATALOG_VECTOR_VERSION } = load('src/lib/catalog-vector.ts');
const { buildPlayerTasteProfile } = load('src/lib/player-taste.ts');
const now = new Date(), date = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const vector = (x, y = 0) => [x, y, ...Array(126).fill(0)];
const card = (key, title = key, extra = {}) => ({ key, title, releaseYear: now.getUTCFullYear(), releaseDate: date(10), platforms: ['PC'], genre: 'RPG',
  coverUrl: null, estimatedHours: 20, signal: 'release', ...extra });
const row = (game, values, extra = {}) => ({ ...game, genres: ['RPG'], seriesHints: [], featureVectorVersion: CATALOG_VECTOR_VERSION, vectorText: JSON.stringify(values), ...extra });
const library = (id, game, extra = {}) => ({ id, title: game.title, releaseYear: game.releaseYear, platform: 'PC', franchise: null,
  status: 'Completed', rating: 5, earnedXp: 100, pinnedOrder: null, playthroughCount: 1, hoursPlayed: 0, ...extra });

test('radar cosine threshold is inclusive at 80%, respects stored vector space, and never fabricates a cold-start taste match', () => {
  const seed = card('Seed'), high = card('High'), below = card('Below'), missing = card('Missing'), stale = card('Stale');
  const rows = [row(seed, vector(1)), row(high, vector(.8, .6)), row(below, vector(.799, Math.sqrt(1 - .799 ** 2))), row(stale, vector(1), { featureVectorVersion: 'other-space' })];
  const result = scoring.scoreDiscoveryCards([high, below, missing, stale], [library(1, seed)], rows, rows, [], []);
  assert.deepEqual(result.cards.map(g => [g.affinity.matchPercent, g.affinity.highTasteMatch]), [[80, true], [79, false], [null, false], [null, false]]);
  const cold = scoring.scoreDiscoveryCards([high], [], rows, rows, [], []);
  assert.equal(cold.hasTasteProfile, false); assert.equal(cold.cards[0].affinity.matchPercent, null); assert.equal(cold.cards[0].affinity.highTasteMatch, false);
  assert.equal(scoring.scoreDiscoveryCards([high], [library(1, seed)], [row(seed, vector(1)), row(high, vector(0))], rows, [], []).cards[0].affinity.similarity, null);
});
test('radar uses the identical Hall of Fame/replay-weighted profile and immediately incorporates Rocchio dismissals', () => {
  const seed = card('Seed'), other = card('Other'), candidate = card('Candidate'), negative = card('Negative');
  const rows = [row(seed, vector(1)), row(other, vector(0, 1)), row(candidate, vector(.8, .6)), row(negative, vector(.6, .8))];
  const games = [library(1, seed, { playthroughCount: 2 }), library(2, other)];
  const profile = buildPlayerTasteProfile(games, rows, [], rows, [1]);
  const scored = scoring.scoreDiscoveryCards([candidate], games, rows, rows, [], [1]);
  assert(Math.abs(scored.cards[0].affinity.similarity - (.8 * profile.values[0] + .6 * profile.values[1])) < 1e-12);
  const before = scoring.scoreDiscoveryCards([candidate], [games[0]], rows, rows, [], []);
  const after = scoring.scoreDiscoveryCards([candidate], [games[0]], rows, rows, [negative.title], []);
  assert.equal(before.cards[0].affinity.highTasteMatch, true); assert.equal(after.cards[0].affinity.highTasteMatch, false);
  assert(after.cards[0].affinity.matchPercent < before.cards[0].affinity.matchPercent);
});
test('Saga Follow uses played/high-rated history, normalized aliases and safe cached canon, never vector neighbors alone', () => {
  const owned = library(1, card('old', 'Biohazard 4'), { franchise: 'Resident Evil', status: 'Flatlined', rating: 1, playthroughCount: 0, hoursPlayed: 4 });
  const sequel = card('new', 'Resident Evil IX');
  assert.equal(scoring.sagaFollowFor(sequel, scoring.sagaHistory([owned]), [], now), 'Resident Evil');
  for (const entry of [library(1, card('Zelda', 'The Legend of Zelda: Breath of the Wild'), { status: 'Playing', rating: null }),
    library(1, card('Zelda', 'Zelda'), { status: 'Backlog', rating: 4, playthroughCount: 0 })]) {
    assert.equal(scoring.sagaFollowFor(card('new', 'The Legend of Zelda: A New Chronicle'), scoring.sagaHistory([entry]), [], now), 'Legend of Zelda');
  }
  const backlog = { ...owned, status: 'Backlog', rating: null, playthroughCount: 0, hoursPlayed: 0 };
  assert.equal(scoring.sagaFollowFor(sequel, scoring.sagaHistory([backlog]), [], now), null);
  assert.equal(scoring.sagaFollowFor({ ...sequel, releaseDate: date(-90) }, [owned], [], now), null);
  assert.equal(scoring.sagaFollowFor(card('neighbor', 'Unrelated RPG'), [owned], [], now), null);
  const canon = { slug: 'astral', displayName: 'Astral Saga', games: [
    { title: 'Moonrise', releaseYear: 2000, chronologicalRank: 1, aliases: ['Moonrise Remastered'] },
    { title: 'Starlight', releaseYear: now.getUTCFullYear(), chronologicalRank: 2 },
  ] };
  assert.equal(scoring.sagaFollowFor(card('next', 'Starlight'), [library(1, card('old', 'Moonrise Remastered', { releaseYear: 2020 }))], [canon], now), 'Astral Saga');
  const ambiguous = { ...canon, games: [...canon.games, { ...canon.games[1], releaseYear: 1990, chronologicalRank: 3 }] };
  assert.equal(scoring.sagaFollowFor(card('ambiguous', 'Starlight', { releaseYear: null }), [library(1, card('old', 'Moonrise'))], [ambiguous], now), null);
});
test('sort modes preserve Trending order, use release dates for Radar, and stably rank cosine plus saga affinity', () => {
  const items = [card('A', 'A', { releaseDate: date(20) }), card('B', 'B', { releaseDate: date(-10) }), card('C', 'C', { releaseDate: date(0) })]
    .map((game, index) => ({ ...game, affinity: { similarity: [.7, .9, .9][index], matchPercent: 90, highTasteMatch: true, sagaFollow: index === 0 ? 'Saga' : null } }));
  assert.deepEqual(types.sortDiscoveryCards(items, 'default').map(g => g.key), ['A', 'B', 'C']);
  assert.deepEqual(types.sortDiscoveryCards(items, 'default', true).map(g => g.key), ['B', 'C', 'A']);
  assert.deepEqual(types.sortDiscoveryCards(items, 'best-match').map(g => g.key), ['B', 'C', 'A']);
  items[0].affinity.similarity = .8;
  assert.equal(types.sortDiscoveryCards(items, 'best-match')[0].key, 'A');
  assert.deepEqual(items.map(g => g.key), ['A', 'B', 'C']);
});

function fixture() {
  let user = 'alice', refreshes = 0, failCachedReads = false;
  const seed = card('Seed'), negative = card('Negative'), target = card('Target'), fresh = card('Fresh'), other = card('Other');
  const rows = [row(seed, vector(1)), row(negative, vector(.6, .8)), row(target, vector(.8, .6)), row(fresh, vector(1)), row(other, vector(0, 1))];
  const games = [library(1, seed, { userId: 'alice' }), library(2, other, { userId: 'bob' })], dismissals = [], seen = [], seenWrites = [];
  const feeds = { radar: { items: [negative, target], source: 'local', refreshedAt: null }, popular: { items: [negative, target], source: 'local', refreshedAt: null } };
  const prisma = {
    game: { findMany: async ({ where }) => games.filter(game => game.userId === where.userId),
      create: async ({ data }) => { const game = { id: games.length + 1, ...data }; games.push(game); return game; } },
    player: { findUnique: async () => ({ featuredTrophyIds: [] }) },
    recommendationDismissal: { findMany: async ({ where }) => dismissals.filter(entry => entry.userId === where.userId),
      upsert: async ({ create }) => { if (!dismissals.some(row => row.userId === create.userId && row.titleKey === create.titleKey)) dismissals.push(create); } },
    radarSeen: { findMany: async ({ where }) => seen.filter(entry => entry.userId === where.userId),
      createMany: async ({ data, skipDuplicates }) => { assert.equal(skipDuplicates, true); seenWrites.push(data);
        for (const entry of data) if (!seen.some(row => row.userId === entry.userId && row.catalogKey === entry.catalogKey)) seen.push(entry); return { count: data.length }; } },
    franchiseChronology: { findMany: async () => [] },
    discoveryFeed: { findUnique: async ({ where }) => feeds[where.kind] },
    $queryRaw: async (sql, keys) => { assert.match(sql.join(''), /vector_dims.*128/); return rows.filter(row => JSON.parse(keys).includes(row.key)); },
    $transaction: async work => work({ game: prisma.game, $executeRaw: async () => 1 }),
  };
  const auth = async () => { if (!user) { const error = Error(); error.name = 'AuthenticationRequiredError'; throw error; } return user; };
  const load = loader({ '@/lib/prisma': { prisma }, '@/lib/player': { getAuthenticatedPlayerId: auth, getOptionalAuthenticatedPlayerId: async () => user },
    '@/lib/taste-catalog': { loadTasteCatalog: async () => ({ titles: rows, stored: rows }) },
    '@/lib/discovery-feeds': { readCachedDiscoveryFeed: async kind => { if (failCachedReads) throw Error('offline'); return structuredClone(feeds[kind]); },
      getDiscoveryFeed: async kind => { refreshes++; return structuredClone(feeds[kind]); } },
    'next/cache': { revalidatePath() {} },
  });
  return { actions: load('src/app/discovery-actions.ts'), service: load('src/lib/discovery-personalization.ts'), route: load('src/app/api/discovery/notifications/route.ts'),
    prisma, feeds, games, rows, seen, seenWrites, negative, target, fresh, as: id => { user = id; },
    failCachedReads: () => { failCachedReads = true; }, get refreshes() { return refreshes; } };
}
test('notification acknowledgements are per-player, idempotent, authenticated, and limited to displayed keys from the current radar', async () => {
  const f = fixture();
  assert.equal((await f.route.GET()).headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await (await f.route.GET()).json()).unseenCount, 1); assert.equal(f.refreshes, 0);
  await f.actions.markRadarViewed(['forged', f.negative.key]); assert.equal(f.seen.length, 0);
  await f.actions.markRadarViewed([f.target.key]); await f.actions.markRadarViewed([f.target.key]);
  assert.equal(f.seen.length, 1); assert.equal((await f.service.readDiscoveryNotifications('alice')).unseenCount, 0);
  f.feeds.radar.items.push(f.fresh);
  await f.actions.markRadarViewed([f.target.key]);
  assert.equal((await f.service.readDiscoveryNotifications('alice')).unseenCount, 1, 'a newer snapshot stays unseen');
  f.as('bob');
  assert.equal((await f.actions.fetchDiscoveryFeed('radar')).unseenCount, 1, 'Bob sees his own different high match, independently of Alice’s seen state');
  assert.equal(f.seen.filter(row => row.userId === 'bob').length, 0);
  f.as(null);
  assert.match((await f.actions.markRadarViewed([f.fresh.key])).error, /Sign in/);
  assert.equal((await (await f.route.GET()).json()).unseenCount, 0);
});
test('dismiss action returns negatively steered percentages/highlights and notification state in the same response', async () => {
  const f = fixture();
  const before = await f.actions.fetchDiscoveryFeed('popular');
  assert.equal(before.items.find(game => game.key === f.target.key).affinity.matchPercent, 80);
  assert.equal(before.unseenCount, 1);
  const result = await f.actions.actOnDiscoveryCard('popular', f.negative.key, 'dismiss');
  assert(result.personalized); assert.equal(result.personalized.items.length, 1);
  assert.equal(result.personalized.items[0].affinity.highTasteMatch, false);
  assert(result.personalized.items[0].affinity.matchPercent < 80);
  assert.equal(result.personalized.unseenCount, 0);
  assert.equal((await f.actions.fetchDiscoveryFeed('radar')).items[0].affinity.highTasteMatch, false);
  assert.equal(f.refreshes, 2, 'the mutation itself never refreshes the public feed');
});
test('add actions remove highlighted releases from notifications and store durable interaction acknowledgements', async () => {
  const f = fixture();
  const result = await f.actions.actOnDiscoveryCard('radar', f.target.key, 'add');
  assert.equal(result.added, true); assert.equal(result.personalized.unseenCount, 0);
  assert(!result.personalized.items.some(game => game.key === f.target.key));
  assert(f.seen.some(row => row.userId === 'alice' && row.catalogKey === f.target.key));
  const duplicate = await f.actions.actOnDiscoveryCard('radar', f.target.key, 'add');
  assert.equal(duplicate.added, false);
  assert.match((await f.actions.markRadarViewed(Array(49).fill(f.target.key))).error, /48/);
});

test('a post-save scoring/cache failure does not misreport the committed action as a failed write', async () => {
  const f = fixture(); f.failCachedReads();
  const result = await f.actions.actOnDiscoveryCard('popular', f.negative.key, 'dismiss');
  assert.equal(result.added, false); assert.equal(result.personalized, null); assert(!result.error);
  const rows = await f.prisma.recommendationDismissal.findMany({ where: { userId: 'alice' } });
  assert.equal(rows[0].titleKey, f.negative.title.toLowerCase());
});
