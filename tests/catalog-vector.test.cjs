/* eslint-disable @typescript-eslint/no-require-imports -- Pure TypeScript modules loaded in Node tests. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCatalogModule } = require("../scripts/catalog-seed.cjs");
const { buildCatalogVector: build, normalizeVector, normalizeFeatureList, vectorLiteral,
  CATALOG_VECTOR_DIMENSIONS, CATALOG_VECTOR_VERSION } = loadCatalogModule("src/lib/catalog-vector.ts");
const norm = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
const similarity = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const sample = { genres: ["RPG", "Action"], tags: ["Story Rich", "Co-op"], seriesHints: ["Final Fantasy"], estimatedHours: 40, releaseYear: 2020 };

test("v1 has fixed dimensions, finite unit vectors, and canonical order/alias-independent hashes", () => {
  const a = build(sample), b = build({ ...sample, genre: "Role-playing", genres: ["ACTION", "Role Playing", "action"],
    tags: [" co op ", "story-rich", "Story Rich"], seriesHints: ["FINAL FANTASY", "Final Fantasy"] });
  assert.equal(a.dimensions, 128);
  assert.equal(a.values.length, CATALOG_VECTOR_DIMENSIONS);
  assert.equal(a.version, CATALOG_VECTOR_VERSION);
  assert.match(a.contentHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(a, b);
  assert(a.values.every(Number.isFinite));
  assert(Math.abs(norm(a.values) - 1) < 1e-12);
  assert.equal(vectorLiteral(a.values), `[${a.values.join(",")}]`);
  assert.deepEqual(normalizeFeatureList(["  Action  ", "ACTION", "Rôle-playing", "", " "]), ["action", "rpg"]);
});

test("missing, zero, nonfinite, negative, and out-of-range numeric metadata stays finite and bounded", () => {
  const empty = build({});
  for (const value of [undefined, null, NaN, Infinity, -Infinity, -4, 0]) {
    assert.deepEqual(build({ estimatedHours: value, releaseYear: value }), empty);
  }
  assert.equal(empty.values.filter(Boolean).length, 2, "Only dedicated duration/era unknown bins are populated");
  assert(Math.abs(norm(empty.values) - 1) < 1e-12);
  assert.deepEqual(build({ estimatedHours: 1e20, releaseYear: 9999 }), build({ estimatedHours: 10000, releaseYear: 2030 }));
  assert.deepEqual(build({ estimatedHours: .01, releaseYear: 1800 }), build({ estimatedHours: 1, releaseYear: 1970 }));
  assert.notEqual(build({ estimatedHours: 10 }).contentHash, build({ estimatedHours: 100 }).contentHash);
});

test("features improve same-taste cosine similarity and keep categorical groups isolated", () => {
  const a = build(sample).values;
  const nearby = build({ ...sample, estimatedHours: 42, releaseYear: 2021 }).values;
  const unrelated = build({ genres: ["Racing"], tags: ["Arcade"], seriesHints: ["Need for Speed"], estimatedHours: 4, releaseYear: 1990 }).values;
  assert(similarity(a, nearby) > .98);
  assert(similarity(a, nearby) > similarity(a, unrelated) + .4);
  const genre = build({ genres: ["Action"] }).values;
  const tag = build({ tags: ["Action"] }).values;
  assert(genre.slice(0, 32).some(Boolean));
  assert(tag.slice(0, 32).every(value => value === 0));
  assert(genre.slice(32, 112).every(value => value === 0));
});

test("vector normalization rejects invalid/zero vectors and handles extreme finite magnitudes", () => {
  assert.throws(() => normalizeVector([], 0));
  for (const values of [[], [1, 2], Array(128).fill(0), [...Array(127).fill(0), NaN], [...Array(127).fill(0), Infinity]]) {
    assert.throws(() => normalizeVector(values));
    assert.throws(() => vectorLiteral(values));
  }
  const huge = normalizeVector(Array(128).fill(Number.MAX_VALUE));
  const tiny = normalizeVector(Array(128).fill(Number.MIN_VALUE));
  assert.deepEqual(huge, tiny);
  assert(Math.abs(norm(huge) - 1) < 1e-12);
});
