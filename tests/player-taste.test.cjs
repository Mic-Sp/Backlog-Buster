/* eslint-disable @typescript-eslint/no-require-imports -- Pure server-side TS loaded without Next request APIs. */
const test = require("node:test"), assert = require("node:assert/strict");
const { loadCatalogModule } = require("../scripts/catalog-seed.cjs");
const taste = loadCatalogModule("src/lib/player-taste.ts");
const { CATALOG_VECTOR_VERSION } = loadCatalogModule("src/lib/catalog-vector.ts");
const vector = (index, magnitude = 1) => Array.from({ length: 128 }, (_, i) => i === index ? magnitude : 0);
const game = (id, fields = {}) => ({ id, title: `Game ${id}`, releaseYear: 2020, status: "Completed", rating: 5,
  pinnedOrder: null, platform: "PC", franchise: null, earnedXp: 100, ...fields });
const row = (id, fields = {}) => ({ key: `key-${id}`, title: `Game ${id}`, releaseYear: 2020, genre: "RPG", genres: [],
  seriesHints: [], estimatedHours: 20, featureVectorVersion: CATALOG_VECTOR_VERSION, vectorText: JSON.stringify(vector(id)), ...fields });
const norm = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));

test("completed favorites aggregate normalized stored vectors with 5-star weight twice 4-star weight", () => {
  const result = taste.buildPlayerTasteProfile([game(1), game(2, { rating: 4 }), game(3, { rating: 1, earnedXp: 999999 }),
    game(4, { rating: 3 }), game(5, { rating: null })], [row(1, { estimatedHours: 40, vectorText: JSON.stringify(vector(1, 10)) }), row(2, { estimatedHours: 10 }), row(3), row(4), row(5)]);
  assert.equal(result.source, "completed-favorites");
  assert.deepEqual(result.anchors.map(anchor => anchor.rating), [5, 4]);
  assert(Math.abs(result.values[1] - 2 / Math.sqrt(5)) < 1e-12);
  assert(Math.abs(result.values[2] - 1 / Math.sqrt(5)) < 1e-12);
  assert.equal(result.values[3], 0); assert.equal(result.values[4], 0); assert.equal(result.values[5], 0);
  assert.equal(result.preferredHours, 30);
  assert.deepEqual(result.genres, [{ name: "rpg", weight: 1 }]);
  assert(Math.abs(norm(result.values) - 1) < 1e-12);
});

test("without matched rated completions, active then pinned intent supplies anchors and low ratings never contribute", () => {
  const result = taste.buildPlayerTasteProfile([
    game(1, { rating: null, status: "Playing" }), game(2, { rating: 4, status: "Backlog", pinnedOrder: 1 }),
    game(3, { rating: 1, status: "Playing", pinnedOrder: 1 }), game(4, { rating: 3, status: "Backlog", pinnedOrder: 2 }),
    game(5, { rating: null }), game(6, { rating: null, status: "Flatlined" }), game(7, { rating: null, status: "Backlog" }),
  ], Array.from({ length: 7 }, (_, index) => row(index + 1)));
  assert.equal(result.source, "active-pinned");
  assert.deepEqual(result.anchors.map(anchor => anchor.key), ["key-1", "key-2"]);
  assert.deepEqual(result.anchors.map(anchor => anchor.weight), [1, .75]);
  assert(result.values.slice(3).every(value => value === 0));
});

test("matched favorites take precedence over active/pinned games and duplicate platform copies count once", () => {
  const games = [game(1), game(2, { status: "Playing" }), game(3, { status: "Backlog", pinnedOrder: 1 }),
    game(11, { title: "GAME I", platform: "Console", rating: 4 })];
  const result = taste.buildPlayerTasteProfile(games, [row(1), row(2), row(3)]);
  assert.equal(result.source, "completed-favorites");
  assert.equal(result.anchors.length, 1); assert.equal(result.anchors[0].rating, 5);
  assert.deepEqual(result.values, vector(1));
});

test("cold start is deterministic, normalized, and independent of low-rated or unrated completed history", () => {
  const empty = taste.buildPlayerTasteProfile([], []);
  assert.equal(empty.source, "cold-start"); assert.equal(empty.anchors.length, 0);
  assert.equal(empty.preferredHours, null); assert.deepEqual(empty.genres, []); assert.deepEqual(empty.series, []);
  assert(Math.abs(norm(empty.values) - 1) < 1e-12);
  for (const rating of [1, 2, 3, null, 6, NaN]) {
    assert.deepEqual(taste.buildPlayerTasteProfile([game(1, { rating })], [row(1)]), empty);
  }
  assert.deepEqual(taste.buildPlayerTasteProfile([game(1, { status: "Backlog", rating: 1, pinnedOrder: 1 })], [row(1)]), empty);
});

test("catalog matching respects canonical normalization and remake years, and refuses ambiguous undated anchors", () => {
  const rows = [row(1, { title: "Café Adventure II", releaseYear: 2000 }), row(2, { title: "Cafe Adventure 2", releaseYear: 2020 })];
  assert.equal(taste.matchTasteCatalogGame(game(1, { title: "Cafe Adventure 2", releaseYear: 2000 }), rows).key, "key-1");
  assert.equal(taste.matchTasteCatalogGame(game(1, { title: "Cafe Adventure 2", releaseYear: null }), rows), null);
  assert.equal(taste.matchTasteCatalogGame(game(1, { title: "Cafe Adventure 2", releaseYear: 2010 }), rows), null);
  assert.equal(taste.matchTasteCatalogGame(game(1, { title: "Cafe Adventure 2 Remastered", releaseYear: 2020 }), rows), null);
});

test("missing/stale/malformed/zero vectors never enter taste; valid active vectors remain a fallback", () => {
  for (const fields of [
    { vectorText: "broken" }, { vectorText: "{}" }, { vectorText: "[1,2]" },
    { vectorText: JSON.stringify(Array(128).fill(0)) }, { vectorText: JSON.stringify(Array(128).fill("1")) },
    { featureVectorVersion: "different-space" },
  ]) {
    const result = taste.buildPlayerTasteProfile([game(1), game(2, { status: "Playing", rating: null })], [row(1, fields), row(2)]);
    assert.equal(result.source, "active-pinned"); assert.deepEqual(result.values, vector(2));
  }
  assert.equal(taste.buildPlayerTasteProfile([game(1)], []).source, "cold-start");
});

test("anchor cap is deterministic under library/catalog reordering, with missing vectors not consuming slots", () => {
  const games = Array.from({ length: 15 }, (_, i) => game(i + 1, { earnedXp: i + 1 }));
  const rows = games.map(game => row(game.id));
  const result = taste.buildPlayerTasteProfile(games, rows);
  assert.equal(result.anchors.length, taste.MAX_TASTE_ANCHORS);
  assert.deepEqual(result, taste.buildPlayerTasteProfile([...games].reverse(), [...rows].reverse()));
  assert.equal(taste.buildPlayerTasteProfile(games, rows.slice(0, 2)).anchors.length, 2);
});
