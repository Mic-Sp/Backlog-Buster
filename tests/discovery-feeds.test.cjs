/* eslint-disable @typescript-eslint/no-require-imports -- Isolate provider/database boundaries. */
const test = require('node:test'), assert = require('node:assert/strict');
const { loader } = require('./helpers/social-fixture.cjs');
const now = new Date('2026-11-09T12:00:00Z');
const pure = loader(), { FEED_TTL_MS, filterDiscoveryCards, inReleaseWindow } = pure('src/lib/discovery-feed-types.ts');
const game = (title, date = '2026-11-10') => ({ key: JSON.stringify([title.toLowerCase(), 2026]), title, releaseYear: 2026,
  releaseDate: date, platforms: ['PC'], genre: 'RPG', estimatedHours: null, coverUrl: null, signal: 'release' });
function fixture({ remote = [game('Upcoming')], local = [game('Local')], community = [], previous, provider, brokenRead = false } = {}) {
  const rows = new Map(previous ? [['radar', structuredClone(previous)]] : []), calls = [], writes = [], queries = [];
  const prisma = {
    discoveryFeed: {
      findUnique: async ({ where }) => { if (brokenRead) throw Error('schema missing'); return structuredClone(rows.get(where.kind) ?? null); },
      updateMany: async ({ where, data }) => { const row = rows.get(where.kind); if (row.leaseId !== where.leaseId) return { count: 0 };
        Object.assign(row, structuredClone(data)); return { count: 1 }; },
    },
    gameCatalog: { findMany: async () => local },
    $queryRaw: async (sql, ...values) => {
      queries.push(sql.join(''));
      if (!sql.join('').includes('INSERT')) return community;
      const [kind, stamp, , leaseId] = values, row = rows.get(kind);
      if (row && (row.expiresAt > stamp || row.leaseUntil > new Date())) return [];
      rows.set(kind, { ...(row ?? { items: [], source: 'local', expiresAt: new Date(0), refreshedAt: stamp }),
        leaseId, leaseUntil: new Date(Date.now() + 120000) });
      return [{ kind }];
    },
  };
  const mocks = { '@/lib/prisma': { prisma }, '@/lib/discovery-providers': { fetchDiscoveryProvider: async (...args) => {
    calls.push(args); return provider ? provider(...args) : { games: remote, source: remote.length ? 'igdb' : 'local' };
  } }, '@/lib/catalog-store': {
    catalogIdentity: g => JSON.stringify([g.title.toLowerCase(), g.releaseYear]),
    catalogSuggestion: ({ title, releaseYear, platforms, genre, estimatedHours, coverUrl }) => ({ title, releaseYear, platforms, genre, estimatedHours, coverUrl }),
    tryUpsertCatalogGame: async game => { writes.push(game); return true; },
  } };
  return { rows, calls, queries, writes, read: loader(mocks)('src/lib/discovery-feeds.ts').getDiscoveryFeed,
    replica: () => loader(mocks)('src/lib/discovery-feeds.ts').getDiscoveryFeed };
}
test('18-hour shared feed TTL: users, tabs and independent server instances spend no extra quota before exact expiry', async () => {
  const f = fixture();
  await f.read('radar', now);
  assert.equal(f.rows.get('radar').expiresAt.getTime(), now.getTime() + FEED_TTL_MS);
  for (const read of [f.read, f.replica()]) {
    const result = await read('radar', new Date(now.getTime() + FEED_TTL_MS - 1));
    assert.equal(result.items[0].title, 'Upcoming');
  }
  assert.equal(f.calls.length, 1);
  await f.read('radar', new Date(now.getTime() + FEED_TTL_MS));
  assert.equal(f.calls.length, 2);
});
test('refresh lease coalesces different instances, returns stale feed, and recovers interrupted refreshes', async () => {
  let resolve;
  const previous = { items: [game('Saved')], source: 'igdb', refreshedAt: now, expiresAt: new Date(0) };
  const f = fixture({ previous, provider: () => new Promise(done => { resolve = done; }) });
  const first = f.read('radar', now);
  while (!resolve) await new Promise(done => setImmediate(done));
  assert.equal((await f.replica()('radar', now)).items[0].title, 'Saved');
  assert.equal(f.calls.length, 1);
  resolve({ games: [game('Fresh')], source: 'igdb' }); await first;
  f.rows.get('radar').expiresAt = new Date(0); f.rows.get('radar').leaseUntil = new Date(0);
  const recovered = f.read('radar', now);
  await new Promise(done => setImmediate(done)); resolve({ games: [], source: 'local' }); await recovered;
  assert.equal(f.calls.length, 2);
});
test('provider quota errors/missing keys cache stale/local/empty fallback for full TTL', async () => {
  for (const local of [[game('Local')], []]) {
    const f = fixture({ remote: [], local, provider: async () => { throw Error('429'); } });
    const result = await f.read('radar', now);
    assert.equal(result.source, 'local'); assert.equal(result.items.length, local.length);
    await f.replica()('radar', now); assert.equal(f.calls.length, 1);
  }
  const previous = { items: [game('Saved')], source: 'igdb', refreshedAt: now, expiresAt: new Date(0) };
  const f = fixture({ previous, remote: [], local: [] });
  assert.equal((await f.read('radar', now)).items[0].title, 'Saved');
});
test('cache schema outage never bypasses durable quota coordination', async () => {
  const f = fixture({ brokenRead: true });
  assert.equal((await f.read('radar', now)).items[0].title, 'Local');
  assert.equal(f.calls.length, 0);
});
test('radar uses inclusive -60/+90 UTC days and never invents dates for year-only games', () => {
  for (const date of ['2026-09-10', '2027-02-07']) assert(inReleaseWindow(date, now));
  for (const date of ['2026-09-09', '2027-02-08', null, 'unknown']) assert(!inReleaseWindow(date, now));
  assert.deepEqual(filterDiscoveryCards([game('Café Adventure II'), game('Cafe Adventure 2'), game('Known'), game('No date', null)],
    ['CAFÉ ADVENTURE 2™'], 'radar', now).map(g => g.title), ['Known']);
});
test('popular blends recent provider releases and community titles without duplicate titles or player data', async () => {
  const f = fixture({ remote: [game('Release'), game('Both')], community: [game('Community'), game('Both')] });
  const result = await f.read('popular', now);
  assert.deepEqual(result.items.map(g => [g.title, g.signal]), [['Release', 'release'], ['Community', 'community'], ['Both', 'release']]);
  assert(f.queries.some(query => query.includes('COUNT(DISTINCT g."userId")') && query.includes('steamRecentMinutes') && query.includes('30 days')));
  assert(!JSON.stringify(result).includes('userId'));
});

test('discovery provider makes zero requests without credentials and RAWG 429 does not retry', async t => {
  const saved = Object.fromEntries(['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'RAWG_API_KEY'].map(key => [key, process.env[key]]));
  const oldFetch = global.fetch;
  t.after(() => { global.fetch = oldFetch; for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  for (const key of Object.keys(saved)) delete process.env[key];
  let calls = 0;
  global.fetch = async () => { calls++; return new Response(null, { status: 429 }); };
  const load = loader({ '@/lib/igdb-api': { queryIgdb: async () => assert.fail('IGDB unconfigured') },
    '@/lib/api-resilience': {} });
  const provider = load('src/lib/discovery-providers.ts');
  assert.deepEqual(await provider.fetchDiscoveryProvider('radar', now), { games: [], source: 'local' });
  assert.equal(calls, 0);
  process.env.RAWG_API_KEY = 'test';
  assert.deepEqual(await provider.fetchDiscoveryProvider('popular', now), { games: [], source: 'local' });
  assert.equal(calls, 1);
});

test('discovery actions authenticate, filter live library/dismissals, use cached metadata and serialize duplicate adds', async () => {
  const games = [], dismissals = [], invalidations = [], locks = [];
  let authorized = true, sequence = Promise.resolve();
  const cards = [game('New'), game('Café Adventure II'), game('Dismissed')];
  const prisma = { discoveryFeed: { findUnique: async () => ({ items: cards }) },
    game: { findMany: async ({ where }) => games.filter(g => g.userId === where.userId),
      create: async ({ data }) => { const row = { ...data, id: games.length + 1 }; games.push(row); return row; } },
    $transaction: work => { const run = sequence.then(() => work({ game: prisma.game,
      $executeRaw: async (sql, key) => { locks.push(key); } })); sequence = run.catch(() => {}); return run; },
  };
  const actions = loader({ '@/lib/prisma': { prisma }, '@/lib/player': { getAuthenticatedPlayerId: async () => {
    if (!authorized) { const error = Error('Sign in'); error.name = 'AuthenticationRequiredError'; throw error; } return 'alice';
  } }, '@/lib/discovery-feeds': { getDiscoveryFeed: async () => ({ items: cards, source: 'local', refreshedAt: null }),
    readCachedDiscoveryFeed: async () => ({ items: cards, source: 'local', refreshedAt: null }) },
  '@/lib/discovery-personalization': { saveRadarSeen: async () => {}, readDiscoveryNotifications: async () => ({ unseenCount: 0 }),
    personalizeDiscoveryFeed: async (userId, kind, feed) => ({ ...feed, unseenCount: 0, hasTasteProfile: false,
      items: filterDiscoveryCards(feed.items, [...games.filter(g => g.userId === userId).map(g => g.title), 'dismissed'], kind) }) },
  '@/lib/recommendation-dismissals': { getDismissedRecommendationTitles: async () => ['dismissed'],
    saveRecommendationDismissal: async title => { dismissals.push(title); return { titleKey: title.toLowerCase() }; } },
  'next/cache': { revalidatePath: path => invalidations.push(path) },
  })('src/app/discovery-actions.ts');
  games.push({ id: 7, title: 'Cafe Adventure 2', userId: 'alice' }, { id: 8, title: 'New', userId: 'bob' });
  const [first, duplicate] = await Promise.all([actions.actOnDiscoveryCard('popular', cards[0].key, 'add'), actions.actOnDiscoveryCard('popular', cards[0].key, 'add')]);
  assert.equal(first.added, true); assert.equal(duplicate.added, false);
  assert.equal(games.filter(g => g.userId === 'alice' && g.title === 'New').length, 1);
  assert.equal(games.at(-1).status, 'Backlog'); assert.equal(games.at(-1).lengthHours, 10);
  assert.deepEqual(locks, ['backlogbuster-deck:alice', 'backlogbuster-deck:alice']);
  assert.equal((await actions.actOnDiscoveryCard('radar', cards[1].key, 'add')).added, false);
  assert.equal((await actions.fetchDiscoveryFeed('popular')).items.length, 0);
  await actions.actOnDiscoveryCard('popular', cards[2].key, 'dismiss');
  assert.deepEqual(dismissals, ['Dismissed']); assert.equal(invalidations.length, 3);
  assert.match((await actions.actOnDiscoveryCard('radar', 'forged', 'add')).error, /expired/);
  assert.match((await actions.actOnDiscoveryCard('bogus', 'key', 'add')).error, /tab/);
  assert.match((await actions.actOnDiscoveryCard('radar', 'key', 'remove')).error, /valid/);
  authorized = false;
  assert.match((await actions.actOnDiscoveryCard('popular', cards[0].key, 'add')).error, /Sign in/);
  assert.match((await actions.fetchDiscoveryFeed('popular')).error, /Sign in/);
});
