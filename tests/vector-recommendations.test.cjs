/* eslint-disable @typescript-eslint/no-require-imports -- Mock DB, auth, and provider boundaries. */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.resolve(__dirname, "..", file), instance = new Module(filename, module);
    instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = name => name === "server-only" ? {} : Object.hasOwn(mocks, name) ? mocks[name]
      : name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`) : original(name);
    instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText, filename);
    cache.set(file, instance.exports); return instance.exports;
  }
  return load;
}
const pure = loader({ "@/lib/prisma": { prisma: {} } });
const engine = pure("src/lib/vector-recommendations.ts");
const { buildPlayerTasteProfile } = pure("src/lib/player-taste.ts");
const { buildCatalogVector, CATALOG_VECTOR_VERSION } = pure("src/lib/catalog-vector.ts");
const candidate = (title, distance = .2, fields = {}) => ({ key: title, title, distance, releaseYear: 2020,
  platforms: ["PC"], genre: "RPG", genres: ["rpg"], seriesHints: [], estimatedHours: 20, coverUrl: null, ...fields });
const favorite = { id: 1, title: "Favorite Saga I", releaseYear: 2020, status: "Completed", rating: 5,
  pinnedOrder: null, platform: "PC", franchise: "Favorite Saga", earnedXp: 100 };
const stored = { key: "owned", title: favorite.title, releaseYear: 2020, genre: "RPG", genres: ["rpg"],
  seriesHints: ["Favorite Saga"], estimatedHours: 20, featureVectorVersion: CATALOG_VECTOR_VERSION,
  vectorText: JSON.stringify(buildCatalogVector({ genre: "RPG", estimatedHours: 20, releaseYear: 2020 }).values) };

test("exclusion filtering normalizes accents, punctuation and numerals, removes unreleased/unknown years, and deduplicates closest first", () => {
  const result = engine.filterVectorCandidates([
    candidate("Cafe Adventure II", .01), candidate("Seen: Game 3", .02), candidate("Future", .03, { releaseYear: 2027 }),
    candidate("Undated", .04, { releaseYear: null }), candidate("Invalid", NaN), candidate("Zero Year", .1, { releaseYear: 0 }),
    candidate("New Game II", .4), candidate("New Game 2", .2), candidate("Another", .3),
  ], ["Café Adventure 2"], ["SEEN GAME III"], 2026);
  assert.deepEqual(result.map(game => game.title), ["New Game 2", "Another"]);
});

test("cold-start ordering follows cosine distance with stable ties and honest reasons", () => {
  const taste = buildPlayerTasteProfile([], []);
  const result = engine.rerankVectorCandidates([candidate("Far", .7), candidate("Near", .1), candidate("Tie", .1)], taste);
  assert.deepEqual(result.map(game => game.title), ["Near", "Tie", "Far"]);
  assert.equal(result[0].cosineSimilarity, .9);
  assert.equal(result[0].scores.series, 0); assert.equal(result[0].scores.genre, 0); assert.equal(result[0].scores.playtime, 0);
  assert.match(result[0].reason, /broad discovery/i); assert.doesNotMatch(result[0].reason, /favorite|preference|rated/i);
});

test("hybrid signals can rerank nearby cosine candidates, while distant unrelated picks stay behind", () => {
  const taste = buildPlayerTasteProfile([favorite], [stored]);
  const result = engine.rerankVectorCandidates([
    candidate("Barely closer", .10, { genre: "Puzzle", genres: ["puzzle"], estimatedHours: 100 }),
    candidate("Favorite Saga II", .15), candidate("Unrelated", .8),
  ], taste);
  assert.equal(result[0].title, "Favorite Saga II");
  assert(result[0].scores.series > 0); assert(result[0].scores.genre > 0); assert.equal(result[0].scores.playtime, .05);
  assert.match(result[0].reason, /Series affinity with Favorite Saga I/); assert.match(result[0].reason, /20h preference/);
  assert.equal(result.at(-1).title, "Unrelated");
  assert(Math.abs(result[0].score - Object.values(result[0].scores).reduce((a, b) => a + b, 0)) < 1e-12);
  assert.deepEqual(result, engine.rerankVectorCandidates([...result].reverse(), taste));
});

test("genre continuity has a grounded reason; missing duration produces neither fit credit nor fabricated hours", () => {
  const taste = buildPlayerTasteProfile([favorite], [stored]);
  const [pick] = engine.rerankVectorCandidates([candidate("Different series", .2, { estimatedHours: null })], taste);
  assert.match(pick.reason, /Genre continuity from Favorite Saga I/);
  assert.equal(pick.scores.playtime, 0); assert.doesNotMatch(pick.reason, /hours|\dh preference/);
});

const negativeStored = (fields = {}) => ({ ...stored, key: "disliked", title: "Dread Saga I", genre: "Horror", genres: ["horror"],
  seriesHints: ["Dread Saga"], vectorText: JSON.stringify(buildCatalogVector({ genre: "Horror", tags: ["survival horror"], estimatedHours: 20, releaseYear: 2020 }).values), ...fields });

test("dismissed genre/series affinity lowers hybrid scores with a bounded, additive negative component", () => {
  const rows = [stored, negativeStored()];
  const before = buildPlayerTasteProfile([favorite], rows);
  const after = buildPlayerTasteProfile([favorite], rows, ["Dread Saga I"]);
  const games = [candidate("Dread Saga II", .1, { genre: "Horror", genres: ["horror"], seriesHints: ["Dread Saga"], negativeSimilarity: 1 }),
    candidate("Favorite Saga II", .2)];
  const baseline = engine.rerankVectorCandidates(games, before).find(pick => pick.title === "Dread Saga II");
  const ranked = engine.rerankVectorCandidates(games, after), disliked = ranked.find(pick => pick.title === "Dread Saga II");
  assert.equal(disliked.scores.negative, -.10);
  assert(Math.abs(disliked.score - (baseline.score - .10)) < 1e-12);
  assert.equal(ranked[0].title, "Favorite Saga II");
  for (const pick of ranked) {
    assert(pick.scores.negative >= -.10 && pick.scores.negative <= 0);
    assert(Math.abs(pick.score - Object.values(pick.scores).reduce((sum, value) => sum + value, 0)) < 1e-12);
  }
});

test("high negative cosine can penalize unlabelled features, while low/non-finite similarity cannot", () => {
  const taste = buildPlayerTasteProfile([favorite], [stored, negativeStored()], ["Dread Saga I"]);
  for (const [similarity, expected] of [[1, -.1], [.875, -.05], [.75, 0], [0, 0], [NaN, 0], [Infinity, 0], [undefined, 0]]) {
    const [pick] = engine.rerankVectorCandidates([candidate("Unknown", .1,
      { genre: null, genres: [], seriesHints: [], negativeSimilarity: similarity })], taste);
    assert(Math.abs(pick.scores.negative - expected) < 1e-12, String(similarity));
  }
});

test("genres shared with top positive anchors are protected, while an exclusively disliked series is still damped", () => {
  const taste = buildPlayerTasteProfile([favorite], [stored, negativeStored({ genre: "RPG", genres: ["rpg"] })], ["Dread Saga I"]);
  const result = engine.rerankVectorCandidates([
    candidate("Fresh RPG", .2, { negativeSimilarity: 1 }),
    candidate("Dread Saga II", .2, { seriesHints: ["Dread Saga"], negativeSimilarity: 1 }),
  ], taste);
  assert.equal(result[0].title, "Fresh RPG"); assert.equal(result[0].scores.negative, 0);
  assert(result[1].scores.negative < 0);
  const noFeedback = buildPlayerTasteProfile([favorite], [stored]);
  assert(engine.rerankVectorCandidates([candidate("Other", .2, { negativeSimilarity: 1 })], noFeedback).every(pick => pick.scores.negative === 0));
});

test("cosine SQL binds the vector/version/year/exclusions/limit and filters before ascending distance ordering", async () => {
  let query;
  const api = loader({ "@/lib/prisma": { prisma: { $queryRaw: async (strings, ...values) => {
    query = { sql: strings.join("?"), values }; return [candidate("Near", .1)];
  } } } })("src/lib/vector-recommendations.ts");
  const values = buildCatalogVector({ genre: "RPG" }).values;
  assert.equal((await api.retrieveCosineCandidates(values, ["quoted ' key"], { currentYear: 2026, limit: 7 }))[0].title, "Near");
  assert.match(query.sql, /<=> \?::vector/); assert.match(query.sql, /ORDER BY .*<=>.*ASC, "key" ASC/);
  assert.match(query.sql, /"featureVectorVersion" = \?/); assert.match(query.sql, /vector_norm/);
  assert(query.sql.indexOf("NOT IN") < query.sql.indexOf("ORDER BY"));
  assert(!query.sql.includes("quoted ' key"));
  assert.equal(JSON.parse(query.values[0]).length, 128);
  assert(query.values.includes(CATALOG_VECTOR_VERSION)); assert(query.values.includes(2026)); assert(query.values.includes(7));
  assert(query.values.includes(JSON.stringify(["quoted ' key"])));
  assert.equal(query.values[1], null, "No negative centroid yields SQL NULL, never a zero vector");
  for (const options of [{ limit: 0 }, { limit: 1001 }, { currentYear: NaN }]) await assert.rejects(api.retrieveCosineCandidates(values, [], options));
  await assert.rejects(api.retrieveCosineCandidates([1, 2]));
  await assert.rejects(api.retrieveCosineCandidates(values, [], { negativeValues: [1, 2] }));
});

test("retrieval loads dismissed and low-rated anchors, sends the shifted vector to pgvector, and keeps seen titles neutral", async () => {
  const disliked = negativeStored(), low = negativeStored({ key: "low", title: "Low Rated", genre: "Racing", genres: ["racing"],
    vectorText: JSON.stringify(buildCatalogVector({ genre: "Racing" }).values) });
  const seen = negativeStored({ key: "seen", title: "Seen Game" });
  const games = [favorite, { ...favorite, id: 2, title: low.title, rating: 2, franchise: null }];
  const calls = [];
  const api = loader({ "@/lib/prisma": { prisma: {
    gameCatalog: { findMany: async () => [stored, disliked, low, seen] },
    $queryRaw: async (strings, ...values) => {
      const sql = strings.join("?"); calls.push({ sql, values });
      if (sql.includes('AS "vectorText"')) {
        assert.deepEqual(new Set(JSON.parse(values[0])), new Set([stored.key, disliked.key, low.key]));
        return [stored, disliked, low];
      }
      assert.match(sql, /1 - \("featureVector" <=> \?::vector\) AS "negativeSimilarity"/);
      const queryVector = JSON.parse(values[0]), negativeVector = JSON.parse(values[1]);
      const before = buildPlayerTasteProfile([favorite], [stored]);
      const after = buildPlayerTasteProfile(games, [stored, disliked, low], [disliked.title]);
      assert.notDeepEqual(queryVector, before.values);
      assert(queryVector.every((value, index) => Math.abs(value - after.values[index]) < 1e-12));
      assert(negativeVector.every((value, index) => Math.abs(value - after.negativeValues[index]) < 1e-12));
      assert.deepEqual(new Set(JSON.parse(values[4])), new Set([stored.key, low.key, seen.key, disliked.key]));
      return [candidate("Horror Peer", .1, { genre: "Horror", genres: ["horror"], negativeSimilarity: .95 }), candidate("RPG Peer", .2)];
    },
  } } })("src/lib/vector-recommendations.ts");
  const result = await api.recommendCatalogGames(games, [seen.title], { dismissedTitles: [disliked.title] });
  assert.equal(result.negativeAnchorCount, 2); assert.equal(result.recommendations[0].title, "RPG Peer");
  assert(result.recommendations.find(p => p.title === "Horror Peer").scores.negative < 0);
  assert.equal(calls.length, 2);
});

test("engine excludes all normalized owned/seen catalog keys before retrieval and uses stored favorite vectors", async () => {
  const index = [stored, { key: "seen", title: "Café II", releaseYear: 2018 }, { key: "owned-remake", title: favorite.title, releaseYear: 2023 }];
  const calls = [];
  const api = loader({ "@/lib/prisma": { prisma: {
    gameCatalog: { findMany: async args => { assert.equal(args.where.featureVectorVersion, CATALOG_VECTOR_VERSION); return index; } },
    $queryRaw: async (strings, ...values) => {
      const sql = strings.join("?"); calls.push({ sql, values });
      if (sql.includes('AS "vectorText"')) return [stored];
      const excluded = JSON.parse(values[4]);
      assert.deepEqual(new Set(excluded), new Set(["owned", "owned-remake", "seen"]));
      return [candidate("Favorite Saga II", .1), candidate("Safe", .3), candidate("Future", 0, { releaseYear: 2027 })];
    },
  } } })("src/lib/vector-recommendations.ts");
  const result = await api.recommendCatalogGames([favorite], ["Cafe 2"], { currentYear: 2026, limit: 2 });
  assert.equal(result.tasteSource, "completed-favorites"); assert.equal(result.anchorCount, 1);
  assert.deepEqual(result.recommendations.map(pick => pick.title), ["Favorite Saga II", "Safe"]);
  assert.deepEqual(JSON.parse(calls[0].values[0]), ["owned"]);
  assert.equal(calls.length, 2);
});

test("cold start skips anchor-vector queries, remains read-only, and handles an empty catalog", async () => {
  let queries = 0;
  const api = loader({ "@/lib/prisma": { prisma: {
    gameCatalog: { findMany: async () => [] }, $queryRaw: async strings => {
      queries++; assert(!strings.join("").includes('AS "vectorText"')); return [];
    },
  } } })("src/lib/vector-recommendations.ts");
  assert.deepEqual(await api.recommendCatalogGames([]), { tasteSource: "cold-start", anchorCount: 0, negativeAnchorCount: 0,
    vectorVersion: CATALOG_VECTOR_VERSION, recommendations: [] });
  assert.equal(queries, 1);
});

test("dismissal keys exclude every normalized catalog variant before SQL LIMIT and at postfilter", async () => {
  const api = loader({ "@/lib/prisma": { prisma: {
    gameCatalog: { findMany: async () => [
      { key: "dismissed-a", title: "Café Adventure II", releaseYear: 2020 },
      { key: "dismissed-b", title: "CAFE Adventure 2™", releaseYear: 2021 },
      { key: "safe", title: "Safe", releaseYear: 2020 },
    ] },
    $queryRaw: async (strings, ...values) => {
      assert.deepEqual(JSON.parse(values[4]), ["dismissed-a", "dismissed-b"]);
      // Defense in depth even if a stale/provider adapter returns an excluded row.
      return [candidate("Café Adventure II", .01), candidate("Safe", .2)];
    },
  } } })("src/lib/vector-recommendations.ts");
  const result = await api.recommendCatalogGames([], ["cafe adventure 2"]);
  assert.deepEqual(result.recommendations.map(game => game.title), ["Safe"]);
});

test("optional diagnostics count vector coverage using version/release/exclusion guards and tolerate metric failures", async () => {
  for (const fail of [false, true]) {
    let coverageQueries = 0;
    const api = loader({ "@/lib/prisma": { prisma: {
      gameCatalog: { findMany: async () => [] },
      $queryRaw: async (strings, ...values) => {
        const sql = strings.join("?");
        if (!sql.includes("COUNT(*)")) return [candidate("Valid")];
        coverageQueries++;
        assert.match(sql, /"featureVectorVersion" = \?/); assert.match(sql, /vector_norm/);
        assert.match(sql, /"releaseYear" <= \?/); assert.match(sql, /NOT IN/);
        assert(values.includes(CATALOG_VECTOR_VERSION));
        if (fail) throw Error("private telemetry error");
        return [{ total: 89, embedded: 89, current: 89, released: 85, eligible: 85 }];
      },
    } } })("src/lib/vector-recommendations.ts");
    const ordinary = await api.recommendCatalogGames([]);
    assert(!Object.hasOwn(ordinary, "diagnostics")); assert.equal(coverageQueries, 0);
    const admin = await api.recommendCatalogGames([], [], { collectDiagnostics: true });
    assert.equal(admin.recommendations.length, 1); assert.equal(coverageQueries, 1);
    assert(admin.diagnostics.queryLatencyMs >= 0); assert.equal(admin.diagnostics.candidateCount, 1);
    assert.equal(admin.diagnostics.coverage?.total ?? null, fail ? null : 89);
    assert(!JSON.stringify(admin).includes("private telemetry error"));
  }
});

test("server entry resolves player identity and reads only that player's taste/ownership fields", async () => {
  const calls = [];
  const api = loader({
    "@/lib/player": { getCurrentPlayerId: async () => "current-player" },
    "@/lib/prisma": { prisma: { recommendationDismissal: { findMany: async ({ where }) => [{ titleKey: `${where.userId} dismissed` }] }, game: { findMany: async args => { calls.push(args); return [favorite]; } } } },
    "@/lib/vector-recommendations": { recommendCatalogGames: async (games, excluded, options) => { assert.deepEqual(games, [favorite]); assert.deepEqual(options.dismissedTitles, [excluded.at(-1)]); return { excluded }; } },
    "@/lib/rawg": {}, "@/lib/scout-ai": {},
  })("src/lib/recommendations.ts");
  assert.deepEqual(await api.getVectorRecommendations(undefined, ["Seen"]), { excluded: ["Seen", "current-player dismissed"] });
  assert.deepEqual(calls[0].where, { userId: "current-player" });
  assert(!calls[0].select.notes); assert(!calls[0].select.passwordHash);
  assert.deepEqual(await api.getVectorRecommendations("trusted-server-player"), { excluded: ["trusted-server-player dismissed"] });
  assert.deepEqual(calls[1].where, { userId: "trusted-server-player" });
});
