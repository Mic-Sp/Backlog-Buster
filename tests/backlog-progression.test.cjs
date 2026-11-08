/* eslint-disable @typescript-eslint/no-require-imports -- Exercise real pure TS engines with deterministic draws. */
const test = require('node:test'), assert = require('node:assert/strict');
const { loadCatalogModule: load } = require('../scripts/catalog-seed.cjs');
const { selectBacklogRecommendations: select, gameLineage } = load('src/lib/backlog-advisor.ts');
const { getSagaName, buildSagaChains } = load('src/lib/sagas.ts');
const { parseSequelNumber } = load('src/lib/chronology-titles.ts');
const { resolveOwnedSagaProgression: resolve } = load('src/lib/saga-chronology.ts');
const { buildPlayerTasteProfile, scoreOwnedTasteGames, catalogSeries } = load('src/lib/player-taste.ts');
const { CATALOG_VECTOR_VERSION } = load('src/lib/catalog-vector.ts');
const game = (id, title, fields = {}) => ({ id, title, platform: 'PC', genre: 'RPG', status: 'Backlog',
  lengthHours: 40, difficulty: 3, releaseYear: 2020, rating: null, earnedXp: 0,
  createdAt: new Date('2020-01-01Z'), pinnedOrder: null, franchise: null, chronologicalOrder: null, ...fields });
const ids = result => [result.continuationPick?.game.id, result.palateCleanserPick?.game.id].filter(id => id != null);
const vector = index => Array.from({ length: 128 }, (_, i) => Number(i === index));
const row = (game, index, fields = {}) => ({ key: `key-${game.id}`, title: game.title, releaseYear: game.releaseYear,
  genre: game.genre, genres: [game.genre], seriesHints: [], estimatedHours: game.lengthHours,
  featureVectorVersion: CATALOG_VECTOR_VERSION, vectorText: JSON.stringify(vector(index)), ...fields });

test('RE4 precedes RE7 after RE2/3, even with a modern remake year, pin and stronger vector on RE7', () => {
  const games = [game(2, 'Resident Evil 2', { status: 'Completed', rating: 5, releaseYear: 1998 }),
    game(3, 'Resident Evil 3', { status: 'Completed', rating: 5, releaseYear: 1999 }),
    game(4, 'Resident Evil 4 Remake', { releaseYear: 2023 }),
    game(7, 'Resident Evil 7: Biohazard', { releaseYear: 2017, pinnedOrder: 1 })];
  for (const random of [() => 0, () => .999]) {
    const result = select(games, [], random, new Map([[7, { similarity: 1, reason: 'Strong taste fit.' }]]));
    assert.deepEqual(ids(result), [4]);
    assert.match(result.continuationPick.reason, /next sequential owned installment after your completed Resident Evil 3/);
    assert.doesNotMatch(result.continuationPick.reason, /favorites match: favorites match:/i);
  }
});

test('VIII, IX, XII, subtitles, editions and franchise aliases share identity across all consumers', () => {
  const games = ['Final Fantasy VIII', 'Final Fantasy IX Remastered', 'Final Fantasy XII: The Zodiac Age', 'FFIX'].map((title, i) => game(i + 1, title));
  assert.equal(new Set(games.map(gameLineage)).size, 1);
  assert.equal(new Set(games.map(getSagaName)).size, 1);
  assert.equal(buildSagaChains(games).chains[0].total, 4);
  for (const entry of games) assert.deepEqual(catalogSeries({ title: entry.title, seriesHints: ['Final Fantasy'] }), ['final fantasy']);
  for (const [a, b] of [['Yakuza 0', 'Like a Dragon: Infinite Wealth'], ['Biohazard 4', 'Resident Evil 7'], ['The Witcher 2', 'Witcher 3']]) {
    assert.equal(gameLineage({ title: a }), gameLineage({ title: b }));
  }
  assert.equal(gameLineage({ title: 'Custom title', franchise: 'Like a Dragon' }), gameLineage({ title: 'Yakuza 0' }));
  assert.equal(getSagaName({ title: 'Final Fantasy XII', franchise: 'My Personal Saga' }), 'My Personal Saga');
  const taste = buildPlayerTasteProfile([game(1, 'Yakuza 0', { status: 'Completed', rating: 5, franchise: 'Yakuza' })],
    [row(game(1, 'Yakuza 0'), 0, { seriesHints: ['Like a Dragon'] })]);
  assert.deepEqual(taste.series, [{ name: 'yakuza like a dragon', weight: 1 }]);
});

test('numeral parsing retains zero, Roman XII and numbered subentries without mistaking edition years for sequels', () => {
  for (const [title, expected] of [['Yakuza 0', 0], ['Final Fantasy VIII', 8], ['Final Fantasy IX', 9], ['Final Fantasy XII', 12],
    ['Final Fantasy X-2', 10.2], ['FFIX', 9], ['FF XII', 12], ['Game 2 Remastered (2020) (Switch)', 2], ['Game (2020)', null], ['Game 2020', null]]) {
    assert.equal(parseSequelNumber(title), expected, title);
  }
});

test('Final Fantasy progresses VIII -> IX -> XII independently of random draw, input order and session history', () => {
  const games = [game(7, 'Final Fantasy VII', { status: 'Completed' }), game(8, 'Final Fantasy VIII'),
    game(9, 'Final Fantasy IX'), game(12, 'Final Fantasy XII')];
  for (const expected of [8, 9, 12]) {
    let history = [999, 7, 9, 12];
    for (let scan = 0; scan < 8; scan++) {
      const result = select(scan % 2 ? [...games].reverse() : games, history, () => .999);
      assert.deepEqual(ids(result), [expected]);
      assert.deepEqual(result.seenGameIds, [expected]);
      history = result.seenGameIds;
    }
    games.find(game => game.id === expected).status = 'Completed';
  }
});

test('Playing predecessor blocks later sequels in both slots, including stale-history and ranked cases', () => {
  for (const ranked of [false, true]) {
    const games = [game(1, 'Hero Saga I', { status: 'Completed', chronologicalOrder: ranked ? 1 : null }),
      game(2, 'Hero Saga II', { status: 'Playing', chronologicalOrder: ranked ? 2 : null }),
      game(3, 'Hero Saga III', { chronologicalOrder: ranked ? 3 : null })];
    assert.deepEqual(ids(select(games, [2, 3], () => .999)), []);
    assert.deepEqual(ids(select([...games, game(4, 'Portal'), game(5, 'Journey')], [3], () => .999)).sort(), [4, 5]);
    games[1].status = 'Completed';
    assert.deepEqual(ids(select(games, [3], () => .999)), [3]);
  }
});

test('two slots never offer the same franchise, including a ranked II/III pair and tiny-pool wraps', () => {
  const games = [game(1, 'Hero Saga I', { status: 'Completed', chronologicalOrder: 1 }),
    game(2, 'Hero Saga II', { chronologicalOrder: 2 }), game(3, 'Hero Saga III', { chronologicalOrder: 3, lengthHours: 2 }),
    game(4, 'Portal', { genre: 'Puzzle', lengthHours: 5 })];
  let history = [];
  for (let scan = 0; scan < 12; scan++) {
    const result = select(games, history, () => scan % 2 ? .999 : 0);
    assert.deepEqual(ids(result).sort(), [2, 4]);
    history = result.seenGameIds;
  }
  assert.deepEqual(ids(select(games.slice(0, 3), [2], () => 0)), [2]);
});

test('saved story ranks override numbers and release dates; partial ranks lead the unassigned tail deterministically', () => {
  const games = [game(1, 'Saga 1', { chronologicalOrder: 2, releaseYear: 1990 }),
    game(3, 'Saga 3', { chronologicalOrder: 1, releaseYear: 2010 }), game(2, 'Saga 2', { releaseYear: 2000 })];
  assert.deepEqual([...resolve(games).eligibleBacklogIds], [3]);
  games[1].status = 'Completed';
  assert.deepEqual([...resolve([...games].reverse()).eligibleBacklogIds], [1]);
  games[0].status = 'Completed';
  assert.deepEqual([...resolve(games).eligibleBacklogIds], [2]);
});

test('the cleanser also names a completed predecessor when a different franchise wins familiarity', () => {
  const games = [game(1, 'Separate Adventure', { pinnedOrder: 1 }),
    game(2, 'Resident Evil 3', { status: 'Completed', rating: 5 }), game(3, 'Resident Evil 4')];
  const result = select(games, [], () => 0, new Map([[1, { similarity: 1, reason: 'Taste fit.' }], [3, { similarity: -1, reason: 'Lower fit.' }]]));
  assert.equal(result.continuationPick.game.id, 1);
  assert.equal(result.palateCleanserPick.game.id, 3);
  assert.match(result.palateCleanserPick.reason, /Next sequential owned installment after your completed Resident Evil 3/);
});

test('zero precedes one; numberless bases precede sequels; abandoned entries do not block; missing dates remain playable', () => {
  for (const titles of [['Yakuza 0', 'Yakuza 1'], ['Portal', 'Portal 2'], ['Unknown Adventure', 'Unknown Adventure II']]) {
    const games = [game(1, titles[0], { releaseYear: null }), game(2, titles[1])];
    assert.deepEqual(ids(select(games, [], () => .999)), [1]);
    games[0].status = 'Flatlined';
    assert.deepEqual(ids(select(games, [], () => .999)), [2]);
  }
  const future = game(1, 'Future Saga 1', { releaseYear: new Date().getFullYear() + 1 });
  assert.deepEqual(ids(select([future, game(2, 'Future Saga 2')])), []);
});

test('unnumbered subtitles use release evidence and wholly unnumbered sagas use deterministic release order', () => {
  const games = [game(1, 'Custom Saga: Prologue', { releaseYear: 2000 }), game(2, 'Custom Saga 2', { releaseYear: 2005 }),
    game(3, 'Custom Saga 3', { releaseYear: 2010 })];
  assert.deepEqual([...resolve(games).eligibleBacklogIds], [1]);
  games[0].status = 'Completed';
  assert.deepEqual([...resolve(games).eligibleBacklogIds], [2]);
  const unnumbered = [game(1, 'Mystery: Alpha', { releaseYear: null }), game(2, 'Mystery: Beta', { releaseYear: 2010 })];
  assert.deepEqual([...resolve(unnumbered).eligibleBacklogIds], [2]);
  assert.deepEqual([...resolve([...unnumbered].reverse()).eligibleBacklogIds], [2]);
});

test('cleanser recency follows completedAt and startedAt, with createdAt fallback for legacy rows', () => {
  const old = game(1, 'Old Completion', { status: 'Completed', rating: 5, createdAt: new Date('2025-01-01Z'), completedAt: new Date('2020-01-01Z') });
  const recent = game(2, 'Recent Completion', { status: 'Completed', rating: 5, createdAt: new Date('2019-01-01Z'), completedAt: new Date('2026-01-01Z') });
  const picks = [game(3, 'RPG Choice', { pinnedOrder: 1 }), game(4, 'Puzzle Choice', { genre: 'Puzzle', lengthHours: 5 })];
  assert.match(select([old, recent, ...picks], [], () => 0).palateCleanserPick.reason, /versus Recent Completion/);
  old.status = 'Playing'; old.startedAt = new Date('2021-01-01Z');
  recent.status = 'Playing'; recent.startedAt = new Date('2026-02-01Z');
  assert.match(select([old, recent, ...picks], [], () => 0).palateCleanserPick.reason, /versus Recent Completion/);
  recent.startedAt = null;
  assert.match(select([old, recent, ...picks], [], () => 0).palateCleanserPick.reason, /versus Old Completion/);
});

test('owned cosine scoring changes Familiar Path selection; missing, ambiguous and malformed vectors fall back', () => {
  const games = [game(1, 'Anchor', { status: 'Completed', rating: 5 }), game(2, 'Similar'), game(3, 'Different')];
  const rows = [row(games[0], 0), row(games[1], 0), row(games[2], 1)];
  assert.equal(select(games, [], () => .999).continuationPick.game.id, 3);
  const scores = scoreOwnedTasteGames(games, rows);
  assert.equal(select(games, [], () => .999, scores).continuationPick.game.id, 2);
  assert.match(select(games, [], () => 0, scores).continuationPick.reason, /Taste fit.*highly rated/);
  for (const fields of [{ vectorText: 'broken' }, { vectorText: '[0]' }, { vectorText: JSON.stringify(Array(128).fill(0)) }, { featureVectorVersion: 'stale' }]) {
    assert(!scoreOwnedTasteGames(games, [rows[0], { ...rows[1], ...fields }]).has(2));
  }
  assert(!scoreOwnedTasteGames(games, [rows[0]]).has(2));
  assert(!scoreOwnedTasteGames(games, [rows[0], rows[1], { ...rows[1], key: 'duplicate' }]).has(2));
  assert.equal(scoreOwnedTasteGames([games[1]], [rows[1]]).size, 0, 'No invented personalized cold-start signal');
});

test('owned scores inherit Hall of Fame/replay multipliers and negative ratings/dismissal steering', () => {
  const games = [game(1, 'Anchor One', { status: 'Completed', rating: 5 }), game(2, 'Anchor Two', { status: 'Completed', rating: 5 }),
    game(3, 'Candidate One'), game(4, 'Candidate Two'), game(5, 'Disliked', { status: 'Flatlined', rating: 1 })];
  const rows = [row(games[0], 0), row(games[1], 1), row(games[2], 0), row(games[3], 1), row(games[4], 0)];
  const positive = games.slice(0, 4);
  const baseline = scoreOwnedTasteGames(positive, rows);
  const featured = scoreOwnedTasteGames(positive, rows, [], rows, [1]);
  const replayed = scoreOwnedTasteGames(positive.map(g => g.id === 1 ? { ...g, playthroughCount: 2 } : g), rows, [], rows, [1]);
  assert(featured.get(3).similarity > baseline.get(3).similarity);
  assert(replayed.get(3).similarity > featured.get(3).similarity);
  const negative = scoreOwnedTasteGames(games, rows), dismissed = scoreOwnedTasteGames(positive, rows, ['Disliked']);
  assert(negative.get(3).similarity < baseline.get(3).similarity);
  assert(negative.get(4).similarity > baseline.get(4).similarity);
  assert.deepEqual(negative, dismissed);
  assert.match(negative.get(3).reason, /adjusted for low ratings and dismissed/);
  const profile = buildPlayerTasteProfile([{ ...games[0], playthroughCount: 2 }, games[1]], rows, [], rows, [1]);
  assert.equal(profile.anchors.find(a => a.key === 'key-1').weight, 2 * 1.35 * 1.15);
});
