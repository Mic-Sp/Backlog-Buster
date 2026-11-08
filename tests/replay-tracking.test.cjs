/* eslint-disable @typescript-eslint/no-require-imports -- Exercise real actions, transactions and archive serialization offline. */
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, form, game } = require('./helpers/activity-fixture.cjs');
const { loadCatalogModule } = require('../scripts/catalog-seed.cjs');
const replay = loadCatalogModule('src/lib/playthroughs.ts');
const date = value => new Date(`${value}T00:00:00Z`);
const today = () => new Date().toISOString().slice(0, 10);
const edit = fields => form({ id: 1, status: 'Completed', lengthHours: 10, difficulty: 1, ...fields });
const log = (f, expected = 1) => f.actions.logGameReplay(form({ id: 1, expectedPlaythroughCount: expected }));

test('legacy counts, strict bounds, first clears and replay transitions follow a deterministic invariant', () => {
  assert.equal(replay.completedRuns({ status: 'Completed' }), 1);
  assert.equal(replay.completedRuns({ status: 'Playing' }), 0);
  assert.equal(replay.resolvePlaythroughCount({ status: 'Playing' }, 'Completed'), 1);
  assert.equal(replay.resolvePlaythroughCount({ status: 'Playing', playthroughCount: 1 }, 'Completed'), 2);
  assert.equal(replay.resolvePlaythroughCount({ status: 'Completed', playthroughCount: 2 }, 'Completed'), 2);
  assert.equal(replay.resolvePlaythroughCount({ status: 'Completed', playthroughCount: 2 }, 'Playing'), 2);
  assert.equal(replay.resolvePlaythroughCount({}, 'Completed', 0), 1);
  assert.equal(replay.resolvePlaythroughCount({}, 'Backlog', 0), 0);
  for (const count of [-1, 100, 1.2, NaN, Infinity, null, {}, true, '', 'two', '1.5']) assert.throws(() => replay.parsePlaythroughCount(count));
  for (const count of [0, 1, 2, 99]) assert.equal(replay.parsePlaythroughCount(String(count)), count);
  assert.throws(() => replay.resolvePlaythroughCount({ status: 'Playing', playthroughCount: 99 }, 'Completed'));
});

test('quick replay updates latest clear and feed context, preserves the original journal and verdict, and awards no extra base XP', async () => {
  const f = fixture({ games: [game(1, { status: 'Completed', earnedXp: 100, startedAt: date('2020-01-01'), completedAt: date('2020-02-01'), rating: 5, review: 'Still my favorite.', reviewSpoiler: true })] });
  const before = structuredClone(f.games[0]);
  assert(!(await log(f)).error);
  const after = f.games[0];
  assert.equal(after.playthroughCount, 2); assert.equal(after.status, 'Completed');
  assert.equal(after.completedAt.toISOString().slice(0, 10), today());
  for (const key of ['startedAt', 'rating', 'review', 'reviewSpoiler', 'notes', 'hoursPlayed', 'earnedXp']) assert.deepEqual(after[key], before[key], key);
  assert.equal(f.events.length, 1); assert.equal(f.events[0].type, 'game_completed');
  assert.equal(f.events[0].metadata.playthroughCount, 2); assert.equal(f.events[0].metadata.reviewSpoiler, true);
  assert(!JSON.stringify(f.events).includes('PRIVATE_NOTES'));
  assert((await log(f)).error, 'A stale/repeated request cannot count the same replay twice');
  assert.equal(f.games[0].playthroughCount, 2); assert.equal(f.events.length, 1);
  assert(!(await log(f, 2)).error); assert.equal(f.games[0].playthroughCount, 3);
});

test('parallel replay submissions serialize and a failed event write rolls the count and dates back', async () => {
  const f = fixture({ games: [game(1, { status: 'Completed' })] });
  const results = await Promise.all([log(f), log(f)]);
  assert.equal(results.filter(r => !r.error).length, 1); assert.equal(f.games[0].playthroughCount, 2);
  assert.equal(f.events.length, 1);
  const failed = fixture({ games: [game(1, { status: 'Completed', completedAt: date('2020-02-01') })] });
  failed.failEvents(); const before = structuredClone(failed.games[0]);
  assert((await log(failed)).error); assert.deepEqual(failed.games[0], before); assert.equal(failed.events.length, 0);
});

test('replays reject foreign, unauthenticated, unfinished, capped and malformed requests', async () => {
  for (const fields of [{ status: 'Playing', playthroughCount: 1 }, { status: 'Backlog' }, { status: 'Completed', userId: 'other' }, { status: 'Completed', playthroughCount: 99 }]) {
    const f = fixture({ games: [game(1, fields)] }), before = structuredClone(f.games[0]);
    assert((await log(f, fields.playthroughCount ?? 1)).error); assert.deepEqual(f.games[0], before);
  }
  const revoked = fixture({ games: [game(1, { status: 'Completed' })] }); revoked.revoke(); assert((await log(revoked)).error);
  const f = fixture({ games: [game(1, { status: 'Completed' })] });
  for (const expected of ['bad', '-1', '100', '1.5', '']) assert((await f.actions.logGameReplay(form({ id: 1, expectedPlaythroughCount: expected }))).error);
  assert.equal(f.games[0].playthroughCount, 1);
});

test('starting and finishing a replay via every completion entry point preserves history and increments once', async () => {
  for (const finish of ['completeGame', 'updateGame']) {
    const f = fixture({ games: [game(1, { status: 'Completed', startedAt: date('2020-01-01'), completedAt: date('2020-02-01'), rating: 4, review: 'A keeper.' })] });
    assert(!(await f.actions.startGame(edit({}))).error);
    assert.equal(f.games[0].playthroughCount, 1); assert.equal(f.games[0].rating, 4); assert.equal(f.games[0].review, 'A keeper.');
    assert.equal(f.games[0].completedAt.toISOString().slice(0, 10), '2020-02-01');
    const fields = { playthroughCount: 1, playthroughCountOriginal: 1, completedAt: '2020-02-01', completedAtOriginal: '2020-02-01' };
    assert(!(await f.actions[finish](edit(fields))).error);
    assert.equal(f.games[0].playthroughCount, 2); assert.equal(f.games[0].completedAt.toISOString().slice(0, 10), today());
    assert.equal(f.games[0].startedAt.toISOString().slice(0, 10), '2020-01-01');
    const events = f.events.length;
    await f.actions[finish](edit(fields)); assert.equal(f.games[0].playthroughCount, 2); assert.equal(f.events.length, events);
  }
});

test('manual corrections validate before writing; unchanged editor counts preserve fresher values and explicit replay dates win', async () => {
  const f = fixture({ games: [game(1, { status: 'Completed', playthroughCount: 3 })] });
  for (const count of [-1, 100, 1.5, 'wrong']) assert((await f.actions.updateGame(edit({ playthroughCount: count }))).error);
  assert.equal(f.games[0].playthroughCount, 3);
  await f.actions.updateGame(edit({ playthroughCount: 1, playthroughCountOriginal: 1 })); assert.equal(f.games[0].playthroughCount, 3);
  await f.actions.updateGame(edit({ playthroughCount: 4, completedAt: '2022-02-02' }));
  assert.equal(f.games[0].playthroughCount, 4); assert.equal(f.games[0].completedAt.toISOString().slice(0, 10), '2022-02-02');
  await f.actions.updateGame(edit({ playthroughCount: 0 })); assert.equal(f.games[0].playthroughCount, 1);
  await f.actions.updateGame(edit({ status: 'Backlog', playthroughCount: 0 })); assert.equal(f.games[0].playthroughCount, 0);
});

test('New Game+ unlocks at a second clear on any game, awards XP only once and remains earned after corrections/deletion', async () => {
  const separate = fixture({ games: [game(1, { status: 'Completed' }), game(2, { status: 'Completed' })], realAchievements: true });
  assert.equal((await separate.load('src/lib/achievements.ts').syncAndGetAchievements('owner')).find(a => a.key === 'new-game-plus').unlocked, false, 'Two distinct first clears are not a replay');
  const f = fixture({ games: [game(1, { status: 'Completed' })], realAchievements: true });
  const sync = f.load('src/lib/achievements.ts').syncAndGetAchievements;
  const initial = await sync('owner'); assert.equal(initial.length, 12);
  assert.equal(initial.find(a => a.key === 'new-game-plus').unlocked, false);
  assert(!(await log(f)).error);
  const ng = f.achievements.find(a => a.achievementKey === 'new-game-plus'); assert(ng); assert.equal(ng.xpAwarded, 300);
  assert.equal(f.events.filter(e => e.type === 'achievement_unlocked' && e.metadata.achievementKey === 'new-game-plus').length, 1);
  await log(f, 2); await sync('owner');
  assert.equal((await sync('owner')).find(a => a.key === 'street-kid').current, 1, 'Other completion milestones still count distinct titles');
  assert.equal(f.achievements.filter(a => a.achievementKey === 'new-game-plus').length, 1);
  await f.actions.updateGame(edit({ playthroughCount: 1 }));
  assert.equal((await sync('owner')).find(a => a.key === 'new-game-plus').unlocked, true);
  await f.actions.deleteGame(form({ id: 1 })); assert(f.achievements.some(a => a.achievementKey === 'new-game-plus'));
  const active = fixture({ games: [game(1, { status: 'Playing', playthroughCount: 2 })], realAchievements: true });
  assert.equal((await active.load('src/lib/achievements.ts').syncAndGetAchievements('owner')).find(a => a.key === 'new-game-plus').unlocked, true);
});

test('JSON/CSV vault round-trips counts and dates, quietly restores NG+, and defaults legacy records without inventing clears', async () => {
  const source = fixture({ games: [game(1, { status: 'Completed', playthroughCount: 4, startedAt: date('2019-01-01'), completedAt: date('2022-02-02') })] });
  for (const format of ['json', 'csv']) {
    const backup = await source.load('src/lib/library-vault.ts').getLibraryExport(format);
    const restored = fixture({ games: [], realAchievements: true });
    const result = await restored.actions.bulkImportGames({ mode: format, content: backup.content }); assert(!result.error, result.error);
    assert.equal(restored.games[0].playthroughCount, 4); assert.equal(restored.games[0].completedAt.toISOString().slice(0, 10), '2022-02-02');
    assert(restored.achievements.some(a => a.achievementKey === 'new-game-plus'));
    assert.deepEqual(restored.events.map(e => e.type), ['library_imported']);
  }
  const { sanitizeImportedGame } = loadCatalogModule('src/lib/library-import.ts');
  assert.equal(sanitizeImportedGame({ title: 'Legacy', status: 'Completed' }).playthroughCount, 1);
  assert.equal(sanitizeImportedGame({ title: 'Legacy', status: 'Playing' }).playthroughCount, 0);
  assert.equal(sanitizeImportedGame({ title: 'Replay', status: 'Playing', playthroughCount: 2 }).playthroughCount, 2);
  for (const count of [-1, 100, 1.5, 'wrong']) assert.throws(() => sanitizeImportedGame({ title: 'Invalid', playthroughCount: count }));
});

test('activity projection accepts only bounded clear counts on completion events', () => {
  const { safeActivityPayload } = fixture().writer;
  for (const count of [1, 2, 99]) assert.equal(safeActivityPayload('game_completed', { title: 'Game', platform: 'PC', playthroughCount: count }).metadata.playthroughCount, count);
  for (const count of [0, -1, 100, 1.5, '2', {}]) assert(!Object.hasOwn(safeActivityPayload('game_completed', { title: 'Game', platform: 'PC', playthroughCount: count }).metadata, 'playthroughCount'));
  assert(!Object.hasOwn(safeActivityPayload('game_started', { title: 'Game', platform: 'PC', playthroughCount: 2 }).metadata, 'playthroughCount'));
});
