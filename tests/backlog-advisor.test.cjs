/* eslint-disable @typescript-eslint/no-require-imports -- Load the pure selector with deterministic random draws. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const filename = path.resolve(__dirname, '..', file), instance = new Module(filename, module);
  instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = instance.require.bind(instance);
  instance.require = name => name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : original(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
  cache.set(file, instance.exports); return instance.exports;
}
const { selectBacklogRecommendations: select } = load('src/lib/backlog-advisor.ts');
const game = (id, fields = {}) => ({ id, title: `Adventure ${id}`, status: 'Backlog', platform: 'PC', genre: 'RPG', lengthHours: 45, difficulty: 3, coverUrl: null, releaseYear: 2020, rating: null, earnedXp: 0, createdAt: new Date('2026-01-01'), pinnedOrder: null, franchise: null, chronologicalOrder: null, ...fields });
const favorite = game(100, { title: 'Favorite', status: 'Completed', rating: 5, lengthHours: 80 });
const ids = result => [result.continuationPick?.game.id, result.palateCleanserPick?.game.id].filter(id => id !== undefined);
const seededRandom = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

test('dual picks favor a favorite genre and a distinct shorter contrasting palette cleanser', () => {
  const result = select([favorite, game(1), game(2, { genre: 'Puzzle', lengthHours: 5, difficulty: 1 })], [], () => .5);
  assert.equal(result.continuationPick.game.id, 1);
  assert.equal(result.palateCleanserPick.game.id, 2);
  assert.match(result.continuationPick.reason, /Affinity \/ favorites match.*Genre affinity.*5.0\/5/);
  assert.match(result.palateCleanserPick.reason, /Palette cleanser.*cuts the commitment.*Switch from RPG to Puzzle/);
});

test('pinned priorities and verified next saga chapters supply affinity signals', () => {
  const previous = { ...favorite, franchise: 'Hero Saga', chronologicalOrder: 1 };
  const result = select([previous, game(1, { franchise: 'Hero Saga', chronologicalOrder: 2 }), game(2, { franchise: 'Hero Saga', chronologicalOrder: 3 }), game(3, { pinnedOrder: 1 })], [], () => 0);
  assert.equal(result.continuationPick.game.id, 1);
  assert.match(result.continuationPick.reason, /Next-in-saga progression/);
  const pinned = select([game(1), game(2, { pinnedOrder: 1 }), game(3)], [], () => 0);
  assert.equal(pinned.continuationPick.game.id, 2);
  assert.match(pinned.continuationPick.reason, /Pinned on your Up Next Deck/);
});

test('weighted top-tier draws vary both roles without selecting weak candidates', () => {
  const games = [favorite, game(1, { title: 'Favorite: Sequel' }), game(2, { title: 'Favorite: Another' }), game(3, { genre: 'Puzzle', lengthHours: 5 }), game(4, { genre: 'Puzzle', lengthHours: 7 }), game(5, { genre: 'Racing', lengthHours: 100 })];
  const low = select(games, [], () => 0), high = select(games, [], () => .999);
  assert.notEqual(low.continuationPick.game.id, high.continuationPick.game.id);
  assert.notEqual(low.palateCleanserPick.game.id, high.palateCleanserPick.game.id);
  assert([1, 2].includes(high.continuationPick.game.id));
  assert([3, 4].includes(high.palateCleanserPick.game.id));
});

test('session exclusions rotate six unseen games then wrap without repeating the last pair', () => {
  const games = [favorite, ...Array.from({ length: 6 }, (_, i) => game(i + 1, i >= 3 ? { genre: 'Puzzle', lengthHours: 5 } : {}))];
  let history = [], previous = [], seen = new Set();
  const random = seededRandom();
  for (let roll = 0; roll < 12; roll++) {
    const result = select(games, history, random), pair = ids(result);
    assert.equal(pair.length, 2); assert.notEqual(pair[0], pair[1]);
    assert(pair.every(id => !previous.includes(id)), `No immediate repeat on roll ${roll}`);
    if (roll < 3) for (const id of pair) { assert(!seen.has(id)); seen.add(id); }
    previous = pair; history = result.seenGameIds;
  }
  assert.equal(seen.size, 6);
});

test('odd and tiny pools wrap indefinitely, keeping a distinct pair when possible', () => {
  for (const size of [1, 2, 3, 5]) {
    const games = Array.from({ length: size }, (_, i) => game(i + 1));
    let history = [], shown = new Set();
    for (let roll = 0; roll < 12; roll++) {
      const result = select(games, history, seededRandom(roll + 1));
      const pair = ids(result);
      assert.equal(pair.length, Math.min(2, size)); assert.equal(new Set(pair).size, pair.length);
      pair.forEach(id => shown.add(id)); history = result.seenGameIds;
    }
    assert.equal(shown.size, size);
  }
});

test('stale exclusions, foreign IDs and ineligible games cannot yield empty or invalid picks', () => {
  const games = [game(1), game(2), game(3, { releaseYear: null }), game(4, { releaseYear: new Date().getFullYear() + 1 }), favorite, game(5, { status: 'Playing' }), game(6, { status: 'Flatlined' })];
  const result = select(games, [1, 2, 3, 4, 5, 6, 999], () => 0);
  assert.deepEqual(new Set(ids(result)), new Set([1, 2]));
  assert(result.seenGameIds.every(id => id === 1 || id === 2));
  assert.deepEqual(select([], [1]), { continuationPick: null, palateCleanserPick: null, seenGameIds: [] });
});

test('unrated history never invents star averages and low ratings are not favorite signals', () => {
  const unrated = select([{ ...favorite, rating: null }, game(1), game(2, { genre: 'Puzzle' })], [], () => 0);
  assert.doesNotMatch(unrated.continuationPick.reason, /averages/);
  const low = select([{ ...favorite, rating: 1 }, game(1), game(2)], [], () => 0);
  assert.doesNotMatch(low.continuationPick.reason, /Genre affinity|rated 1\/5/);
});
