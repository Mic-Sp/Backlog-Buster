/* eslint-disable @typescript-eslint/no-require-imports -- Deterministic distribution and eligibility tests. */
const test = require('node:test'), assert = require('node:assert/strict');
const { loader } = require('./helpers/social-fixture.cjs');
const { questRollPool, pickQuest } = loader()('src/lib/quest-roller.ts');
const game = (id, hypeLevel, extra = {}) => ({ id, hypeLevel, title: `Game ${id}`, status: 'Backlog', releaseYear: 2020,
  genre: 'RPG', platform: 'PC', lengthHours: 10, ...extra });

function distribution(pool, options, draws = 12000) {
  const counts = {};
  for (let index = 0; index < draws; index++) {
    const chosen = pickQuest(pool, options, () => (index + .5) / draws);
    counts[chosen.id] = (counts[chosen.id] ?? 0) + 1;
  }
  return counts;
}

test('Hype Weighted gives each Hyped game exactly 3× an Interested game’s sampling interval', () => {
  const games = [game(1, 1), game(2, 2), game(3, 3)];
  const before = structuredClone(games), { candidates, automaticFallback } = questRollPool(games);
  assert.deepEqual(candidates.map(game => game.id), [2, 3]); assert.equal(automaticFallback, false);
  for (const order of [candidates, [...candidates].reverse()]) assert.deepEqual(distribution(order, { hypeWeighted: true }), { 2: 3000, 3: 9000 });
  assert.deepEqual(distribution(candidates, { hypeWeighted: false }), { 2: 6000, 3: 6000 });
  assert.deepEqual(games, before);
});

test('Icebox Mode explicitly includes Backburner games at baseline weight alongside higher tiers', () => {
  const games = [game(1, 1), game(2, 2), game(3, 3)];
  const icebox = questRollPool(games, { iceboxMode: true });
  assert.deepEqual(icebox.candidates, games); assert.equal(icebox.automaticFallback, false);
  assert.deepEqual(distribution(icebox.candidates, { hypeWeighted: true }, 10000), { 1: 2000, 2: 2000, 3: 6000 });
  assert.deepEqual(distribution(icebox.candidates, { hypeWeighted: false }), { 1: 4000, 2: 4000, 3: 4000 });
  assert.deepEqual(questRollPool(games, { iceboxMode: false }).candidates.map(game => game.id), [2, 3]);
});

test('automatic fallback uses only filtered eligible Backburner games when no Tier 2/3 remains', () => {
  const games = [game(1, 1), game(2, 1, { genre: 'Puzzle', platform: 'PS5', lengthHours: 60 }),
    game(3, 3, { genre: 'Action', platform: 'Xbox', lengthHours: 25 }),
    game(4, 2, { status: 'Completed' }), game(5, 3, { status: 'Playing' }), game(6, 3, { releaseYear: 2100 })];
  for (const filter of [{ genre: 'RPG' }, { platform: 'PC' }, { time: 'quick' }]) {
    const pool = questRollPool(games, filter);
    assert.equal(pool.automaticFallback, true); assert.deepEqual(pool.candidates.map(game => game.id), [1]);
    assert.equal(pickQuest(pool.candidates).id, 1);
  }
  const allLow = questRollPool(games.slice(0, 2));
  assert.equal(allLow.automaticFallback, true); assert.deepEqual(distribution(allLow.candidates, {}), { 1: 6000, 2: 6000 });
  const normal = questRollPool(games); assert.equal(normal.automaticFallback, false); assert.deepEqual(normal.candidates.map(game => game.id), [3]);
  const empty = questRollPool(games, { genre: 'Missing' }); assert.deepEqual(empty, { candidates: [], automaticFallback: false });
  assert.equal(pickQuest(empty.candidates), null);
});

test('legacy hype defaults to Interested, and draws have explicit boundary behavior', () => {
  const legacy = game(1, undefined), hyped = game(2, 3);
  assert.deepEqual(questRollPool([legacy]).candidates, [legacy]);
  assert.equal(pickQuest([legacy, hyped], {}, () => 0), legacy);
  assert.equal(pickQuest([legacy, hyped], {}, () => .25), hyped);
  assert.equal(pickQuest([legacy, hyped], {}, () => 1 - Number.EPSILON), hyped);
  for (const invalid of [NaN, Infinity, -1, 1]) assert.throws(() => pickQuest([legacy], {}, () => invalid));
});
