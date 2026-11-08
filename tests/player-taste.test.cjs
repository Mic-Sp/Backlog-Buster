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
  const shiftNorm = Math.sqrt(1 + .25 ** 2);
  assert(Math.abs(result.values[1] - 2 / Math.sqrt(5) / shiftNorm) < 1e-12);
  assert(Math.abs(result.values[2] - 1 / Math.sqrt(5) / shiftNorm) < 1e-12);
  assert(Math.abs(result.values[3] + .25 / shiftNorm) < 1e-12);
  assert.equal(result.values[4], 0); assert.equal(result.values[5], 0);
  assert.equal(result.preferredHours, 30);
  assert.deepEqual(result.genres, [{ name: "rpg", weight: 1 }]);
  assert(Math.abs(norm(result.values) - 1) < 1e-12);
});

test("without matched rated completions, active then pinned intent supplies positives and low ratings supply negatives", () => {
  const result = taste.buildPlayerTasteProfile([
    game(1, { rating: null, status: "Playing" }), game(2, { rating: 4, status: "Backlog", pinnedOrder: 1 }),
    game(3, { rating: 1, status: "Playing", pinnedOrder: 1 }), game(4, { rating: 3, status: "Backlog", pinnedOrder: 2 }),
    game(5, { rating: null }), game(6, { rating: null, status: "Flatlined" }), game(7, { rating: null, status: "Backlog" }),
  ], Array.from({ length: 7 }, (_, index) => row(index + 1)));
  assert.equal(result.source, "active-pinned");
  assert.deepEqual(result.anchors.map(anchor => anchor.key), ["key-1", "key-2"]);
  assert.deepEqual(result.anchors.map(anchor => anchor.weight), [1, .75]);
  assert(result.values[3] < 0); assert.equal(result.negativeAnchors.length, 1);
  assert(result.values.slice(4).every(value => value === 0));
});

test("matched favorites take precedence over active/pinned games and duplicate platform copies count once", () => {
  const games = [game(1), game(2, { status: "Playing" }), game(3, { status: "Backlog", pinnedOrder: 1 }),
    game(11, { title: "GAME I", platform: "Console", rating: 4 })];
  const result = taste.buildPlayerTasteProfile(games, [row(1), row(2), row(3)]);
  assert.equal(result.source, "completed-favorites");
  assert.equal(result.anchors.length, 1); assert.equal(result.anchors[0].rating, 5);
  assert.deepEqual(result.values, vector(1));
});

test("cold start is deterministic and unrated/neutral history stays neutral while low ratings steer the default prior", () => {
  const empty = taste.buildPlayerTasteProfile([], []);
  assert.equal(empty.source, "cold-start"); assert.equal(empty.anchors.length, 0);
  assert.equal(empty.preferredHours, null); assert.deepEqual(empty.genres, []); assert.deepEqual(empty.series, []);
  assert(Math.abs(norm(empty.values) - 1) < 1e-12);
  for (const rating of [3, null, 6, NaN]) {
    assert.deepEqual(taste.buildPlayerTasteProfile([game(1, { rating })], [row(1)]), empty);
  }
  for (const rating of [1, 2]) {
    const negative = taste.buildPlayerTasteProfile([game(1, { status: "Backlog", rating, pinnedOrder: 1 })], [row(1)]);
    assert.equal(negative.source, "cold-start"); assert.equal(negative.anchors.length, 0);
    assert.equal(negative.negativeAnchors.length, 1); assert.notDeepEqual(negative.values, empty.values);
    assert(Math.abs(norm(negative.values) - 1) < 1e-12);
  }
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

const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);

test("Hall of Fame pin multiplies rating weight and rotates the normalized centroid toward that favorite", () => {
  const games = [game(1), game(2, { rating: 4 })], rows = [row(1), row(2, { genre: "Puzzle", estimatedHours: 10 })];
  const before = taste.buildPlayerTasteProfile(games, rows);
  const after = taste.buildPlayerTasteProfile(games, rows, [], rows, [null, 2]);
  assert.equal(after.source, "hall-of-fame");
  assert.equal(after.anchors[0].key, "key-2"); assert.equal(after.anchors[0].hallOfFame, true);
  assert.equal(after.anchors[0].weight, 1.35);
  assert.equal(after.anchors[1].weight, 2);
  assert(Math.abs(after.values[2] / after.values[1] - 1.35 / 2) < 1e-12);
  assert(dot(after.values, vector(2)) > dot(before.values, vector(2)));
  assert(after.genres.find(g => g.name === "puzzle").weight > before.genres.find(g => g.name === "puzzle").weight);
  assert(after.preferredHours < before.preferredHours);
  assert(Math.abs(norm(after.values) - 1) < 1e-12);
  const fiveStar = taste.buildPlayerTasteProfile([game(1), game(2)], rows, [], rows, [2]);
  assert.equal(fiveStar.anchors[0].weight, 2 * taste.HALL_OF_FAME_WEIGHT_MULTIPLIER);
  assert.deepEqual(taste.buildPlayerTasteProfile(games, rows, [], rows, []), before, "Unpinning restores ordinary weights");
});

test("Hall of Fame intent admits every status/rating alongside completions and overrides negative duplicates and dismissals", () => {
  for (const status of ["Backlog", "Playing", "Flatlined", "Completed"]) for (const rating of [null, 1, 2, 3, 4, 5]) {
    const games = [game(1), game(2, { status, rating }), game(20, { title: "Game II", rating: 1, platform: "Console" })];
    const rows = [row(1), row(2)];
    assert(taste.potentialTasteGames(games, [2]).some(game => game.id === 2));
    const profile = taste.buildPlayerTasteProfile(games, rows, ["GAME II™"], rows, [2]);
    const anchor = profile.anchors.find(anchor => anchor.key === "key-2");
    assert(anchor, `${status}/${rating}`); assert.equal(anchor.weight, (rating === 5 ? 2 : 1) * 1.35);
    assert.equal(profile.anchors.length, 2); assert.deepEqual(profile.negativeAnchors, []);
    assert.equal(profile.negativeValues, null); assert(profile.values[2] > 0);
  }
  const solo = taste.buildPlayerTasteProfile([game(2, { status: "Backlog", rating: null })], [row(2)], [], [row(2)], [2]);
  assert.equal(solo.source, "hall-of-fame"); assert.deepEqual(solo.values, vector(2));
});

test("Hall of Fame favorites survive the anchor cap and deduplication regardless of library or catalog order", () => {
  const games = Array.from({ length: 15 }, (_, i) => game(i + 1, { earnedXp: i + 1 }));
  games.push(game(20, { title: "Game I", rating: 1, status: "Backlog" }));
  const rows = games.slice(0, 15).map(game => row(game.id));
  const profile = taste.buildPlayerTasteProfile(games, rows, [], rows, [20, 2, 3]);
  assert.equal(profile.anchors.length, taste.MAX_TASTE_ANCHORS);
  assert.deepEqual(new Set(profile.anchors.filter(a => a.hallOfFame).map(a => a.key)), new Set(["key-1", "key-2", "key-3"]));
  assert.equal(profile.anchors.find(a => a.key === "key-1").rating, 1, "Pinned copy wins over an ordinary platform copy");
  assert.deepEqual(profile, taste.buildPlayerTasteProfile([...games].reverse(), [...rows].reverse(), [], rows, [20, 2, 3]));
  assert.deepEqual(profile, taste.buildPlayerTasteProfile(games, rows, [], rows, [3, 20, 2]), "Uniform boost does not depend on slot order");
});

test("Hall of Fame pins respect JSON slots, library ownership and valid unambiguous catalog vectors", () => {
  const games = [game(1, { rating: null, status: "Backlog" })], rows = [row(1)];
  const baseline = taste.buildPlayerTasteProfile(games, rows);
  for (const pins of [null, {}, "1", ["1", -1, 0], [999], [null, null, null, 1], [NaN, Infinity, 2147483648]]) {
    assert.deepEqual(taste.buildPlayerTasteProfile(games, rows, [], rows, pins), baseline);
  }
  const repeated = taste.buildPlayerTasteProfile(games, rows, [], rows, [1, 1, null]);
  assert.equal(repeated.anchors.length, 1); assert.equal(repeated.anchors[0].weight, 1.35);
  for (const fields of [{ vectorText: "bad" }, { vectorText: "[1,2]" },
    { vectorText: JSON.stringify(Array(128).fill(0)) }, { featureVectorVersion: "stale" }]) {
    assert.equal(taste.buildPlayerTasteProfile(games, [row(1, fields)], [], rows, [1]).source, "cold-start");
  }
  assert.equal(taste.buildPlayerTasteProfile(games, [], [], rows, [1]).source, "cold-start");
  const ambiguous = [row(1), row(2, { title: "Game 1", releaseYear: 2000 })];
  assert.equal(taste.buildPlayerTasteProfile([game(1, { releaseYear: null, status: "Backlog", rating: null })],
    rows, [], ambiguous, [1]).source, "cold-start");
});

test("dismissing a game shifts the normalized taste vector away from its stored features", () => {
  const rows = [row(1, { genre: "RPG" }), row(2, { genre: "Horror", title: "Café Horror II™" })];
  const before = taste.buildPlayerTasteProfile([game(1)], rows);
  const after = taste.buildPlayerTasteProfile([game(1)], rows, ["CAFE: Horror 2"]);
  assert.equal(after.negativeAnchors.length, 1); assert.equal(after.negativeAnchors[0].source, "dismissed");
  assert(dot(after.values, vector(2)) < dot(before.values, vector(2)));
  assert(dot(after.values, vector(1)) > .95, "Damped feedback retains strong positive alignment");
  assert(Math.abs(norm(after.values) - 1) < 1e-12); assert(Math.abs(norm(after.negativeValues) - 1) < 1e-12);
  assert.deepEqual(after.genres, before.genres); assert.deepEqual(after.negativeGenres, [{ name: "horror", weight: 1 }]);
});

test("negative centroid combines both 1–2 star games and dismissals, deduplicating library/platform/title variants", () => {
  const rows = [row(1), row(2, { genre: "Horror" }), row(3, { genre: "Racing" })];
  const games = [game(1), game(2, { rating: 1 }), game(20, { title: "GAME II", rating: 2, platform: "Console" })];
  const result = taste.buildPlayerTasteProfile(games, rows, ["Game 2", "GAME II™", "Game 3"]);
  assert.deepEqual(result.negativeAnchors.map(a => a.key), ["key-2", "key-3"]);
  assert.equal(result.negativeAnchors[0].rating, 1);
  assert(Math.abs(result.negativeValues[2] - Math.SQRT1_2) < 1e-12);
  assert(Math.abs(result.negativeValues[3] - Math.SQRT1_2) < 1e-12);
  assert.deepEqual(result, taste.buildPlayerTasteProfile([...games].reverse(), [...rows].reverse(), ["Game 3", "GAME II™", "Game 2"]));
});

test("new positive intent overrides a historical dismissal or low-rated copy of the same game", () => {
  const result = taste.buildPlayerTasteProfile([game(1), game(10, { title: "Game I", rating: 1, platform: "Console" })], [row(1)], ["Game I"]);
  assert.equal(result.anchors.length, 1); assert.deepEqual(result.negativeAnchors, []);
  assert.equal(result.negativeValues, null); assert.deepEqual(result.values, vector(1));
});

test("unknown, ambiguous, stale and malformed negative anchors never poison the taste vector", () => {
  const base = taste.buildPlayerTasteProfile([game(1)], [row(1)]);
  for (const fields of [{ vectorText: "bad" }, { vectorText: "[1,2]" }, { vectorText: JSON.stringify(Array(128).fill(0)) },
    { vectorText: JSON.stringify(Array(128).fill(null)) }, { featureVectorVersion: "stale-version" }]) {
    assert.deepEqual(taste.buildPlayerTasteProfile([game(1), game(2, { rating: 1 })], [row(1), row(2, fields)], ["Game 2", "Missing"]), base);
  }
  const ambiguous = [row(1), row(2), row(3, { title: "Game 2", releaseYear: 2000 })];
  assert.deepEqual(taste.buildPlayerTasteProfile([game(1)], ambiguous, ["Game 2"]), base);
});

test("full catalog ambiguity is preserved when only a subset of anchor vectors is loaded", () => {
  const old = row(1, { title: "Remake", releaseYear: 2000 }), newer = row(2, { title: "Remake", releaseYear: 2020 });
  const result = taste.buildPlayerTasteProfile([game(1, { title: "Remake", releaseYear: null }),
    game(2, { title: "Remake", releaseYear: 2000, rating: 1 })], [old], ["Remake"], [old, newer]);
  assert.equal(result.anchors.length, 0); assert.equal(result.negativeAnchors.length, 1);
  assert.equal(result.negativeAnchors[0].source, "low-rated");
});

test("zero/near-zero Rocchio cancellation falls back to P without NaNs, zero vectors or input mutation", () => {
  const p = vector(1), before = [...p];
  assert.deepEqual(taste.shiftTasteVector(p, p, 1), p);
  const near = [...p]; near[2] = 1e-12;
  assert.deepEqual(taste.shiftTasteVector(p, near, 1), p);
  assert.deepEqual(taste.shiftTasteVector(p, Array(128).fill(0)), p);
  assert.deepEqual(taste.shiftTasteVector(p, null), p); assert.deepEqual(p, before);
  const result = taste.buildPlayerTasteProfile([game(1)], [row(1), row(2), row(3, { vectorText: JSON.stringify(vector(2, -1)) })], ["Game 2", "Game 3"]);
  assert.equal(result.negativeValues, null); assert.deepEqual(result.values, p);
});
