/* eslint-disable @typescript-eslint/no-require-imports -- Pure journal aggregation and portable recap contracts. */
const test = require('node:test'), assert = require('node:assert/strict');
const { loadCatalogModule } = require('../scripts/catalog-seed.cjs');
const { aggregateAnnualSummary: aggregate, buildAnnualReview, annualSummaryText } = loadCatalogModule('src/lib/year-in-review.ts');
const game = (id, fields = {}) => ({ id, title: `Game ${id}`, platform: 'PC', genre: 'RPG', status: 'Completed',
  completedAt: '2025-01-01', startedAt: null, playthroughCount: 1, hoursPlayed: 10, rating: 4, ...fields });

test('annual filtering uses valid latest-clear dates across current statuses without substituting library-added dates', () => {
  const games = [game(1), game(2, { completedAt: '2024-12-31' }), game(3, { completedAt: '2026-01-01' }),
    game(4, { completedAt: null, createdAt: '2025-06-01' }), game(5, { completedAt: '2025-02-30' }),
    game(6, { completedAt: '2025-06-01', status: 'Playing', playthroughCount: 2 }),
    game(7, { completedAt: '2025-06-01', status: 'Backlog', playthroughCount: 0 }),
    game(8, { completedAt: new Date('2025-12-31T00:00:00Z'), status: 'Flatlined', playthroughCount: 3 })];
  const before = structuredClone(games), recap = aggregate(games, 2025);
  assert.equal(recap.clearedGames, 3); assert.equal(recap.repeatClears, 2);
  assert.equal(recap.lifetimePlaythroughs, 6); assert.equal(recap.lifetimeReplays, 3);
  assert.equal(recap.highlights.first.title, 'Game 1'); assert.equal(recap.highlights.last.title, 'Game 8');
  assert.equal(buildAnnualReview(games, [], 2026).undatedClears, 2);
  assert.deepEqual(games, before, 'Aggregation must not sort or mutate saved records');
  for (const year of [0, 10000, NaN, 1.5, '2025']) assert.throws(() => aggregate(games, year), /year/);
});

test('all twelve monthly buckets and tied peaks count one dated clear per title, never lifetime run counts', () => {
  const games = Array.from({ length: 12 }, (_, index) => game(index + 1, { completedAt: `2025-${String(index + 1).padStart(2, '0')}-01` }));
  games.push(game(13, { completedAt: '2025-02-28', playthroughCount: 99 }), game(14, { completedAt: '2025-12-31T23:59:59.999Z' }));
  const recap = aggregate(games, 2025);
  assert.deepEqual(recap.months.map(month => month.month), ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
  assert.deepEqual(recap.months.map(month => month.count), [1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2]);
  assert.deepEqual(recap.peakMonths, ['Feb', 'Dec']);
  assert.equal(recap.months.reduce((sum, month) => sum + month.count, 0), recap.clearedGames);
  assert.equal(recap.repeatClears, 1); assert.equal(recap.lifetimePlaythroughs, 112);
});

test('hours are logged cohort totals; optional started games are added once without changing clear cadence or rating', () => {
  const games = [game(1, { startedAt: '2025-01-01', hoursPlayed: 20 }),
    game(2, { status: 'Playing', playthroughCount: 0, completedAt: null, startedAt: '2025-04-01', hoursPlayed: 6, rating: 1 }),
    game(3, { completedAt: '2026-01-01', startedAt: '2025-12-01', hoursPlayed: 50 }),
    game(4, { hoursPlayed: 0, lengthHours: 900 }), game(5, { completedAt: '2024-01-01', hoursPlayed: 100 })];
  const recap = aggregate(games, 2025);
  assert.equal(recap.clearedGames, 2); assert.equal(recap.startedGames, 3);
  assert.equal(recap.loggedHours, 20); assert.equal(recap.hoursIncludingStarts, 76);
  assert.equal(recap.averageRating, 4); assert.equal(recap.highlights.longest.title, 'Game 1');
  assert.equal(recap.months.reduce((sum, month) => sum + month.count, 0), 2);
  assert.match(annualSummaryText(recap, 'Ghost', false, true), /76h logged on cleared or started titles/);
  assert.match(annualSummaryText(recap, 'Ghost'), /20h logged on cleared titles/);
});

test('superlatives break rating ties by Hall of Fame, replays, hours, title and id with stable first/final dates', () => {
  const games = [game(9, { title: 'Zulu', rating: 5, hoursPlayed: 60 }),
    game(8, { title: 'Beta', rating: 5, hoursPlayed: 30, playthroughCount: 2 }),
    game(7, { title: 'Alpha', rating: 5, hoursPlayed: 30, playthroughCount: 2 }),
    game(6, { title: 'Pinned', rating: 4, playthroughCount: 3, completedAt: '2025-12-31' })];
  const base = aggregate(games, 2025);
  assert.equal(base.highlights.gameOfYear.title, 'Alpha'); assert.equal(base.highlights.longest.title, 'Zulu');
  assert.equal(base.highlights.first.title, 'Alpha'); assert.equal(base.highlights.last.title, 'Pinned');
  assert.equal(aggregate(games, 2025, [8]).highlights.gameOfYear.title, 'Beta');
  assert.equal(aggregate(games, 2025, [6]).highlights.gameOfYear.title, 'Alpha', 'Rating ranks before Hall of Fame');
  const unrated = games.map(game => ({ ...game, rating: null }));
  assert.equal(aggregate(unrated, 2025, [9]).highlights.gameOfYear.title, 'Zulu');
  assert.equal(aggregate(unrated, 2025).highlights.gameOfYear.title, 'Pinned');
  assert.deepEqual(base, aggregate([...games].reverse(), 2025));
  assert.deepEqual(aggregate(games, 2025, [8]), aggregate([...games].reverse(), 2025, [8]));
});

test('genre and platform ranking normalizes whitespace/case, counts titles and breaks ties by hours then name', () => {
  const games = [game(1, { genre: ' RPG ', platform: ' PC ', playthroughCount: 99 }),
    game(2, { genre: 'rpg', platform: 'pc' }), game(3, { genre: 'Puzzle', platform: 'Switch', hoursPlayed: 30 }),
    game(4, { genre: 'Puzzle', platform: 'Switch' }), game(5, { genre: '   ', platform: '' })];
  const recap = aggregate(games, 2025);
  assert.deepEqual(recap.topGenre, { name: 'Puzzle', count: 2 }); assert.deepEqual(recap.topPlatform, { name: 'Switch', count: 2 });
  assert.deepEqual(recap, aggregate([...games].reverse(), 2025));
  assert.equal(aggregate([game(1, { genre: 'Action' }), game(2, { genre: 'Puzzle' })], 2025).topGenre.name, 'Action');
  assert.equal(aggregate([game(1, { genre: null, platform: '' })], 2025).topGenre, null);
});

test('available years include starts and current year; default favors current completions or most recent past clear', () => {
  const games = [game(1, { completedAt: '2023-01-01', startedAt: '2022-12-31' }), game(2, { completedAt: '2025-01-01' })];
  const data = buildAnnualReview(games, [], 2026);
  assert.equal(data.defaultYear, 2025); assert.deepEqual(data.summaries.map(summary => summary.year), [2026, 2025, 2023, 2022]);
  assert.equal(buildAnnualReview([...games, game(3, { completedAt: '2026-01-01' })], [], 2026).defaultYear, 2026);
  assert.equal(buildAnnualReview([game(1, { completedAt: '2030-01-01' })], [], 2026).defaultYear, 2026);
  assert.equal(buildAnnualReview([game(1, { completedAt: null, startedAt: '2024-01-01' })], [], 2026).defaultYear, 2026);
});

test('empty years and missing measurements have honest null/zero values and no fabricated superlatives', () => {
  const recap = aggregate([game(1, { completedAt: '2024-01-01' })], 2025);
  assert.equal(recap.clearedGames, 0); assert.equal(recap.loggedHours, 0); assert.equal(recap.averageRating, null);
  assert.equal(recap.topGenre, null); assert.equal(recap.topPlatform, null); assert.deepEqual(recap.peakMonths, []);
  assert(recap.months.every(month => month.count === 0)); assert(Object.values(recap.highlights).every(value => value === null));
  assert.equal(buildAnnualReview([], [], 2026).defaultYear, 2026);
  const invalid = aggregate([game(1, { hoursPlayed: NaN, rating: 0 }), game(2, { hoursPlayed: Infinity, rating: 6 }), game(3, { hoursPlayed: -2, rating: 4.5 })], 2025);
  assert.equal(invalid.loggedHours, 0); assert.equal(invalid.ratedClears, 0); assert.equal(invalid.highlights.longest, null);
  assert(!JSON.stringify(invalid).includes('NaN'));
});

test('recap DTOs and copied text expose aggregates/highlights, never private library fields or identifiers', () => {
  const data = buildAnnualReview([game(1, { title: 'A <legend>', notes: 'PRIVATE_NOTES', review: 'SECRET_SPOILER', userId: 'PRIVATE_ID', ownershipType: 'Borrowed', steamAppId: 'PRIVATE_STEAM' })], [1], 2025);
  const json = JSON.stringify(data), summary = data.summaries[0];
  for (const secret of ['PRIVATE_NOTES', 'SECRET_SPOILER', 'PRIVATE_ID', 'PRIVATE_STEAM', 'Borrowed', '"id":']) assert(!json.includes(secret), secret);
  const text = annualSummaryText(summary, 'Ghost', true);
  assert.match(text, /THE YEARLY CHRONICLE/); assert.match(text, /Primary Realm: PC/); assert.match(text, /lifetime runs/);
  assert.match(text, /Earlier run dates are not stored/); assert(!text.includes('PRIVATE'));
});
