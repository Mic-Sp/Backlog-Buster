/* eslint-disable @typescript-eslint/no-require-imports -- Pure telemetry and real refresh/batch code with provider/database boundaries mocked. */
const test = require('node:test'), assert = require('node:assert/strict');
const { loader } = require('./helpers/social-fixture.cjs');
const { fixture: activityFixture, game } = require('./helpers/activity-fixture.cjs');
const pure = loader({ '@/lib/prisma': { prisma: {} } });
const { steamAchievementProgress: progress, importSteamProgress } = pure('src/lib/steam-progress.ts');
const { selectSteamAchievementTargets: targets } = pure('src/lib/steam-achievement-sync.ts');
const steamId = '76561198000000000';

test('Steam mastery requires valid nonzero exact completion; near-complete and no-achievement games never show 100%', () => {
  assert.deepEqual(progress({ steamAchievementsUnlocked: 38, steamAchievementsTotal: 50 }), { unlocked: 38, total: 50, percent: 76, mastered: false });
  assert.equal(progress({ steamAchievementsUnlocked: 50, steamAchievementsTotal: 50 }).mastered, true);
  assert.equal(progress({ steamAchievementsUnlocked: 0, steamAchievementsTotal: 0 }).mastered, false);
  assert.equal(progress({ steamAchievementsUnlocked: 999, steamAchievementsTotal: 1000 }).percent, 99);
  for (const [unlocked, total] of [[null, null], [undefined, 50], [-1, 5], [6, 5], [1.5, 5], [5, Infinity], [100001, 100001]]) assert.equal(progress({ steamAchievementsUnlocked: unlocked, steamAchievementsTotal: total }), null);
});

test('achievement targets prioritize Playing and recent activity ahead of favorites/pins; cache only known successful counts', () => {
  const now = new Date('2026-11-07T12:00:00Z');
  const games = Array.from({ length: 1000 }, (_, i) => ({ steamAppId: String(i + 1), recentMinutes: i }));
  games.push({ steamAppId: '1001', status: 'Playing' }, { steamAppId: '1002', hallOfFame: true }, { steamAppId: '1003', pinnedOrder: 1 });
  const selected = targets(games, now);
  assert.equal(selected.length, 6); assert.deepEqual(selected.slice(0, 3).map(g => g.steamAppId), ['1001', '1000', '999']);
  assert.equal(new Set(selected.map(g => g.steamAppId)).size, 6);
  assert.equal(targets([{ steamAppId: '108710', status: 'Playing', total: null, syncedAt: now }], now).length, 1, 'Unknown totals cannot be suppressed by old attempts');
  assert.deepEqual(targets([{ steamAppId: '1', status: 'Playing', total: 67, syncedAt: new Date(now - 1000) }], now), []);
  assert.equal(targets([{ steamAppId: '1', status: 'Playing', total: 67, syncedAt: new Date(now - 86400000) }], now).length, 1);
  assert.equal(targets([{ steamAppId: '1', status: 'Playing', total: 67, syncedAt: new Date(+now + 999999) }], now).length, 1, 'Future imported timestamps cannot permanently suppress progress');
  assert.equal(targets([{ steamAppId: '1' }, { steamAppId: 'invalid', status: 'Playing' }], now).length, 0);
  assert.deepEqual(targets([...games].reverse(), now), selected);
});

test('bounded achievement fetching uses two workers, tolerates private/no-stats failures and stops dispatch on a provider cooldown', async () => {
  let active = 0, peak = 0, calls = 0;
  const load = loader({ '@/lib/prisma': { prisma: {} }, '@/lib/steam': { fetchSteamAchievements: async (_id, appId, signal) => {
    assert(signal instanceof AbortSignal); calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    if (appId === '2') throw Error('PRIVATE_PROVIDER_ERROR');
    return appId === '3' ? null : { unlocked: 1, total: 2 };
  } } });
  const result = await load('src/lib/steam-achievement-sync.ts').fetchSteamAchievementBatch(steamId, Array.from({ length: 100 }, (_, i) => ({ steamAppId: String(i + 1) })));
  assert.equal(calls, 6); assert.equal(peak, 2); assert.equal(result.size, 4); assert.equal(result.has('2'), false); assert.equal(result.has('3'), false);
  assert.deepEqual(result.get('1').counts, { unlocked: 1, total: 2 });
  calls = 0;
  let limited;
  limited = loader({ '@/lib/prisma': { prisma: {} }, '@/lib/steam': { fetchSteamAchievements: async () => {
    calls++; throw new (limited('src/lib/action-result.ts').RateLimitError)(30);
  } } });
  await limited('src/lib/steam-achievement-sync.ts').fetchSteamAchievementBatch(steamId, Array.from({ length: 20 }, (_, i) => ({ steamAppId: String(i + 1) })));
  assert(calls <= 2, 'Do not dispatch the rest of the queue once Steam rejects the rate');
});

test('the batch budget also bounds a provider promise that never settles', async t => {
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    assert.equal(milliseconds, 30000); const controller = new AbortController(); setTimeout(() => controller.abort(), 5); return controller.signal;
  });
  let calls = 0;
  const load = loader({ '@/lib/prisma': { prisma: {} }, '@/lib/steam': { fetchSteamAchievements: () => { calls++; return new Promise(() => {}); } } });
  const result = await load('src/lib/steam-achievement-sync.ts').fetchSteamAchievementBatch(steamId, Array.from({ length: 6 }, (_, i) => ({ steamAppId: String(i + 1) })));
  assert.equal(calls, 2); assert.equal(result.size, 0);
});

function refreshFixture(provider = async () => ({ unlocked: 38, total: 50 }), initial = {}) {
  let authenticated = true, sessionValid = true, linkedId = steamId, appId = '440', owner = 'owner', calls = 0;
  const row = { steamAchievementsUnlocked: 2, steamAchievementsTotal: 3, steamAchievementsSyncedAt: new Date('2020-01-01Z'), steamAchievementsCheckedAt: null, ...initial };
  let load;
  const writes = [];
  const prisma = {
    game: { findUnique: async ({ where }) => { assert.equal(where.userId, 'owner'); return where.id === 1 && owner === 'owner' ? { steamAppId: appId, steamAchievementsTotal: row.steamAchievementsTotal, steamAchievementsSyncedAt: row.steamAchievementsSyncedAt } : null; },
      updateMany: async ({ where, data }) => {
        writes.push({ where, data }); assert.equal(where.userId, 'owner'); assert.equal(where.player.steamId, steamId);
        assert.deepEqual(Object.keys(data).sort(), ['steamAchievementsCheckedAt', 'steamAchievementsSyncedAt', 'steamAchievementsTotal', 'steamAchievementsUnlocked']);
        assert.equal(where.player.email.not, null); assert.equal(where.player.OR[0].passwordHash.not, null);
        const requestedAt = data.steamAchievementsSyncedAt;
        if (!sessionValid || linkedId !== steamId || owner !== 'owner' || appId !== where.steamAppId ||
          (row.steamAchievementsSyncedAt > requestedAt && row.steamAchievementsSyncedAt <= new Date(+requestedAt + 300000) && row.steamAchievementsTotal !== null)) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      } },
    playerSession: { findUnique: async ({ where }) => {
      assert.equal(where.tokenHash, 'token'); assert.equal(where.userId, 'owner'); assert.equal(where.player.email.not, null); assert.equal(where.player.OR[0].passwordHash.not, null);
      return sessionValid ? { player: { steamId: linkedId } } : null;
    } },
  };
  load = loader({ '@/lib/prisma': { prisma }, '@/lib/player': { getAuthenticatedPlayerId: async () => {
    if (!authenticated) throw new (load('src/lib/action-result.ts').InputError)('Sign in'); return 'owner';
  } }, '@/lib/auth-session': { readSessionHash: async () => 'token' },
  '@/lib/api-resilience': pure('src/lib/api-resilience.ts'),
  '@/lib/steam': { fetchSteamAchievements: async (...args) => { calls++; return provider(...args); } } });
  return { run: () => load('src/lib/steam-achievement-sync.ts').refreshSteamGameAchievements(1), row, writes,
    get calls() { return calls; }, revoke: () => { sessionValid = false; }, signOut: () => { authenticated = false; }, relink: () => { linkedId = '76561198000000001'; }, foreign: () => { owner = 'other'; }, unlink: () => { appId = null; } };
}

test('on-demand refresh coalesces concurrent requests and only a successful read earns the per-game cooldown', async () => {
  const f = refreshFixture();
  const results = await Promise.all([f.run(), f.run(), f.run()]);
  assert(results.every(result => result.updated)); assert.equal(f.row.steamAchievementsUnlocked, 38); assert.equal(f.calls, 1);
  await assert.rejects(f.run(), /successfully refreshed recently/); assert.equal(f.calls, 1);
  for (const change of [f => f.foreign(), f => f.signOut(), f => f.unlink(), f => f.revoke()]) {
    const rejected = refreshFixture(); change(rejected); await assert.rejects(rejected.run()); assert.equal(rejected.calls, 0);
  }
});

test('unknown counts ignore legacy attempt timestamps and even inconsistent imported success dates', async () => {
  const f = refreshFixture(async () => ({ unlocked: 19, total: 67 }), { steamAchievementsTotal: null, steamAchievementsUnlocked: null,
    steamAchievementsCheckedAt: new Date(), steamAchievementsSyncedAt: new Date(Date.now() + 60000) });
  assert.equal((await f.run()).updated, true); assert.equal(f.row.steamAchievementsUnlocked, 19);
});

test('failed/no-stats requests preserve successful counts without stamping cooldowns and can be retried immediately', async () => {
  for (const provider of [async () => null, async () => { throw Error('provider secret'); }]) {
    const f = refreshFixture(provider), previous = { ...f.row };
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await f.run(); assert.equal(result.updated, false); assert(!JSON.stringify(result).includes('provider secret'));
      assert.deepEqual(f.row, previous); assert.equal(f.writes.length, 0);
    }
    assert.equal(f.calls, 2);
  }
  const empty = refreshFixture(async () => ({ unlocked: 0, total: 0 }));
  assert.equal((await empty.run()).updated, true); assert.equal(progress(empty.row).mastered, false);
  await assert.rejects(empty.run(), /successfully refreshed recently/);
});

test('logout or Steam relinking during a refresh prevents its result from being persisted', async () => {
  for (const change of [f => f.revoke(), f => f.relink()]) {
    let f; f = refreshFixture(async () => { change(f); return { unlocked: 3, total: 3 }; });
    await assert.rejects(f.run(), /session or Steam link changed/); assert.equal(f.row.steamAchievementsUnlocked, 2);
  }
});

test('an older request cannot overwrite a newer successful progress snapshot', async () => {
  let f; f = refreshFixture(async () => {
    f.row.steamAchievementsSyncedAt = new Date(Date.now() + 1000); f.row.steamAchievementsUnlocked = 40;
    return { unlocked: 19, total: 67 };
  });
  await assert.rejects(f.run(), /newer progress was saved/); assert.equal(f.row.steamAchievementsUnlocked, 40);
});

test('JSON and CSV vault round-trips retain the Steam AppID, counts, recent minutes and full UTC snapshot timestamps', async () => {
  const fields = { steamAppId: '440', steamRecentMinutes: 252, steamAchievementsUnlocked: 38, steamAchievementsTotal: 50,
    steamLastSyncedAt: new Date('2026-11-07T12:34:56.789Z'), steamAchievementsCheckedAt: new Date('2026-11-07T12:35:00.000Z'), steamAchievementsSyncedAt: new Date('2026-11-07T12:35:01.123Z') };
  const source = activityFixture({ games: [game(1, fields)] });
  for (const mode of ['json', 'csv']) {
    const backup = await source.load('src/lib/library-vault.ts').getLibraryExport(mode);
    const target = activityFixture({ games: [] });
    const result = await target.actions.bulkImportGames({ mode, content: backup.content }); assert(!result.error, result.error);
    for (const [key, value] of Object.entries(fields)) assert.deepEqual(target.games[0][key], value, `${mode}/${key}`);
  }
  const legacy = importSteamProgress({}); assert.equal(legacy.steamAppId, null); assert.equal(legacy.steamRecentMinutes, null);
  for (const fields of [{ steamAppId: '0' }, { steamRecentMinutes: -1 }, { steamRecentMinutes: 20161 }, { steamAchievementsUnlocked: 5, steamAchievementsTotal: 3 },
    { steamAchievementsTotal: 5 }, { steamLastSyncedAt: '2026-02-30T00:00:00Z' }]) assert.throws(() => importSteamProgress(fields));
});

test('backup import deduplicates Steam identities independently of title edits and preserves the existing owner row', async () => {
  const f = activityFixture({ games: [game(1, { steamAppId: '440', title: 'My title' })] });
  const result = await f.actions.bulkImportGames({ mode: 'json', content: JSON.stringify([{ title: 'Provider title', steamAppId: '440' }, { title: 'New game', steamAppId: '550' }, { title: 'Another name', steamAppId: '550' }]) });
  assert(!result.error, result.error); assert.equal(result.importedCount, 1); assert.equal(result.duplicateCount, 2);
  assert.equal(f.games[0].title, 'My title'); assert.equal(f.games.length, 2);
});
