/* eslint-disable @typescript-eslint/no-require-imports -- Mock provider and transactional database boundaries. */
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
    cache.set(file, instance.exports);
    return instance.exports;
  }
  return load;
}
const rawg = loader()("src/lib/rawg.ts");
const provider = (name = "Portal 2", overrides = {}) => rawg.parseRawgCatalogGame({
  id: 4200, slug: "portal-2", name, released: "2011-04-19", playtime: 9,
  genres: [{ name: "Puzzle" }, { name: "Adventure" }], tags: [{ slug: "co-op" }, { slug: "online-co-op" }],
  platforms: [{ platform: { name: "PC" } }], ...overrides,
});

test("RAWG retains all genres, meaningful English tags, provider identity and positive co-op evidence", () => {
  const game = provider("Portal 2", { tags: [{ slug: "local-co-op", language: "eng" }, { slug: "puzzle", language: "eng" },
    { slug: "steam-cloud" }, { slug: "steam-achievements" }, { slug: "foreign", language: "rus" }, null] });
  assert.deepEqual(game.genres, ["adventure", "puzzle"]);
  assert.deepEqual(game.tags, ["local co op", "puzzle"]);
  assert.deepEqual(game.seriesHints, ["portal"]);
  assert.equal(game.rawgId, 4200);
  assert.equal(game.coop, true); assert.equal(game.multiplayer, true);
  assert.equal(game.localCoop, true); assert.equal(game.onlineCoop, null);
  const unknown = provider("Unrelated", { tags: [{ slug: "singleplayer" }], id: -1 });
  for (const flag of ["coop", "multiplayer", "onlineCoop", "localCoop"]) assert.equal(unknown[flag], null);
  assert.equal(unknown.rawgId, null);
  assert.deepEqual(provider("Titanfall 2").seriesHints, ["titanfall"], "Affinity neighbors must not become a Star Wars series hint");
  for (const value of [null, {}, { name: " " }, { name: "a".repeat(121) }]) assert.equal(rawg.parseRawgCatalogGame(value), null);
});

test("catalog upserts parameterize vectors and atomically project provider metadata without private fields", async () => {
  const calls = [];
  const tx = { gameCatalog: { upsert: async args => calls.push(["upsert", args]) },
    $executeRaw: async (strings, ...values) => { calls.push([strings.join("?"), values]); return 1; } };
  const store = loader({ "@/lib/prisma": { prisma: { $transaction: async work => {
    calls.push(["begin"]); await work(tx); calls.push(["commit"]);
  } } } })("src/lib/catalog-store.ts");
  await store.upsertCatalogGame({ ...provider(), userId: "private", notes: "secret", rating: 5 });
  assert.equal(calls[0][0], "begin"); assert.equal(calls.at(-1)[0], "commit");
  assert.match(calls[1][0], /pg_advisory_xact_lock/);
  const upsert = calls.find(call => call[0] === "upsert")[1];
  assert.deepEqual(upsert.where, { key: '["portal 2",2011]' });
  assert.equal(upsert.create.metadataSource, "rawg");
  for (const key of ["userId", "notes", "rating", "hoursPlayed", "earnedXp"]) assert(!Object.hasOwn(upsert.create, key));
  const update = calls.find(call => /UPDATE "GameCatalog"/.test(call[0]));
  assert.match(update[0], /\?::vector/);
  assert.equal(JSON.parse(update[1][0]).length, 128);
  assert.equal(update[1][1], "catalog-features-v1");
  assert.equal(await store.tryUpsertCatalogGame(provider("Bad", { id: null })), false);
});

test("a vector write failure rolls the metadata transaction back", async () => {
  let committed = false, staged = false;
  const store = loader({ "@/lib/prisma": { prisma: { $transaction: async work => {
    await work({ gameCatalog: { upsert: async () => { staged = true; } }, $executeRaw: async strings => {
      if (strings.join("").includes("UPDATE")) throw Error("vector extension missing");
      return 1;
    } });
    committed = staged;
  } } } })("src/lib/catalog-store.ts");
  assert.equal(await store.tryUpsertCatalogGame(provider()), false);
  assert.equal(staged, true); assert.equal(committed, false);
});

test("IGDB updates preserve cached duration, RAWG identity and feature evidence, and rebuild the matching vector", async () => {
  const calls = [];
  const previous = provider();
  const incoming = loader({ "@/lib/igdb-api": {} })("src/lib/igdb-catalog.ts").parseIgdbCatalogGame({
    id: 73, name: "Portal 2", first_release_date: Date.UTC(2011, 3, 19) / 1000,
  });
  const store = loader({ "@/lib/prisma": { prisma: { $transaction: work => work({
    $executeRaw: async (sql, ...values) => { calls.push([sql.join("?"), values]); return 1; },
    gameCatalog: {
      findUnique: async () => { calls.push(["read"]); return previous; },
      upsert: async args => calls.push(["upsert", args]),
    },
  }) } } })("src/lib/catalog-store.ts");
  await store.upsertCatalogGame(incoming);
  assert.match(calls[0][0], /pg_advisory_xact_lock/);
  assert.equal(calls[1][0], "read");
  const update = calls.find(call => call[0] === "upsert")[1].update;
  for (const field of ["estimatedHours", "tags", "seriesHints", "multiplayer", "coop", "onlineCoop", "localCoop", "genres", "platforms"]) {
    assert.deepEqual(update[field], previous[field]);
  }
  assert(!Object.hasOwn(update, "rawgId"));
  assert(!Object.hasOwn(update, "rawgSlug"));
  assert.equal(update.metadataSource, "igdb");
  const vector = calls.find(call => /UPDATE "GameCatalog"/.test(call[0]))[1];
  const expected = loader()("src/lib/catalog-vector.ts").buildCatalogVector(update);
  assert.deepEqual(JSON.parse(vector[0]), expected.values);
  assert.equal(vector[2], expected.contentHash);
  assert.equal(await store.tryUpsertCatalogGame({ ...incoming, igdbId: 0 }), false);
});

test("single RAWG lookup persists canonical enrichment but preserves its legacy return shape on cache failure", async () => {
  const before = process.env.RAWG_API_KEY;
  process.env.RAWG_API_KEY = "fixture";
  const saved = [];
  try {
    const api = loader({
      "@/lib/api-resilience": { resilientFetch: async () => Response.json({ results: [{ id: 4200, name: "Portal 2", released: "2011-04-19",
        genres: [{ name: "Puzzle" }], playtime: 9, platforms: [{ platform: { name: "PC" } }], tags: [{ slug: "co-op" }] }] }) },
      "@/lib/catalog-store": { tryUpsertCatalogGame: async game => { saved.push(game); throw Error("offline"); } },
    })("src/lib/rawg.ts");
    assert.deepEqual(await api.lookupRawgGame("portal 2"), { coverUrl: null, genre: "Puzzle", releaseYear: 2011, playtime: 9, platforms: ["PC"] });
    assert.equal(saved[0].title, "Portal 2"); assert.equal(saved[0].coop, true);
  } finally { if (before === undefined) delete process.env.RAWG_API_KEY; else process.env.RAWG_API_KEY = before; }
});

test("seed-mode RAWG failures are sanitized and fail promptly while autocomplete keeps its empty fallback", async () => {
  const before = process.env.RAWG_API_KEY; process.env.RAWG_API_KEY = "fixture";
  try {
    for (const response of [async () => new Response(null, { status: 401 }), async () => Response.json({}),
      async () => { throw Error("secret provider URL"); }]) {
      const api = loader({ "@/lib/api-resilience": { resilientFetch: response } })("src/lib/rawg.ts");
      assert.deepEqual(await api.searchRawgGames("Portal"), []);
      await assert.rejects(api.searchRawgGames("Portal", true), error => /RAWG catalog lookup failed/.test(error.message) && !error.message.includes("secret"));
    }
  } finally { if (before === undefined) delete process.env.RAWG_API_KEY; else process.env.RAWG_API_KEY = before; }
});

test("seed combines curated/library inputs, requires matching provider titles/years, and resumes bounded batches", async () => {
  const before = process.env.RAWG_API_KEY; process.env.RAWG_API_KEY = "fixture";
  const saved = [], queries = [];
  try {
    const seed = loader({
      "@/lib/prisma": { prisma: { game: { findMany: async args => {
        assert.deepEqual(args.select, { title: true, releaseYear: true });
        return [{ title: "Library", releaseYear: 2020 }, { title: "Remake", releaseYear: 2020 }, { title: "Unknown", releaseYear: null }];
      } }, gameCatalog: { findMany: async () => [] } } },
      "@/lib/scout-catalog": { getScoutCatalogTitles: () => ["Curated", "Curated"] },
      "@/lib/rawg": { searchRawgGames: async title => { queries.push(title);
        return [provider(title === "Unknown" ? "Wrong match" : title, { released: title === "Remake" ? "1990-01-01" : "2020-01-01" })];
      } },
      "@/lib/catalog-store": { catalogIdentity: game => JSON.stringify([game.title.toLowerCase(), game.releaseYear]),
        upsertCatalogGame: async game => saved.push(game), backfillCatalogVectors: async () => 3 },
    })("src/lib/catalog-seed.ts").seedRecommendationCatalog;
    const first = await seed({ limit: 2 });
    assert.deepEqual(saved.map(game => game.title), ["Curated", "Library"]);
    assert(first.nextAfter);
    const second = await seed({ after: first.nextAfter });
    assert.equal(second.unmatched, 2); assert.equal(second.seeded, 0); assert.equal(second.nextAfter, null);
    assert.equal(new Set(queries).size, 4);
    await assert.rejects(seed({ limit: 0 }));
    delete process.env.RAWG_API_KEY;
    await assert.rejects(seed(), /RAWG_API_KEY/);
  } finally { if (before === undefined) delete process.env.RAWG_API_KEY; else process.env.RAWG_API_KEY = before; }
});

test("seed skips ambiguous provider matches and never claims a failed database write succeeded", async () => {
  const before = process.env.RAWG_API_KEY; process.env.RAWG_API_KEY = "fixture";
  try {
    let ambiguous = true;
    const seed = loader({
      "@/lib/prisma": { prisma: { game: { findMany: async () => [] }, gameCatalog: { findMany: async () => [] } } },
      "@/lib/scout-catalog": { getScoutCatalogTitles: () => ["Same Title"] },
      "@/lib/rawg": { searchRawgGames: async () => ambiguous ? [provider("Same Title"), provider("Same Title", { id: 2, released: "2020-01-01" })] : [provider("Same Title")] },
      "@/lib/catalog-store": { catalogIdentity: game => game.title,
        upsertCatalogGame: async () => { throw Error("db failure"); }, backfillCatalogVectors: async () => 0 },
    })("src/lib/catalog-seed.ts").seedRecommendationCatalog;
    assert.equal((await seed()).unmatched, 1);
    ambiguous = false;
    await assert.rejects(seed(), /db failure/);
  } finally { if (before === undefined) delete process.env.RAWG_API_KEY; else process.env.RAWG_API_KEY = before; }
});

test("backfill paginates, locks/rereads current metadata, and only counts missing or stale vectors", async () => {
  const rows = [{ key: "a" }, { key: "b" }], seen = [], queries = [];
  let pages = 0, locked = false;
  const store = loader({ "@/lib/prisma": { prisma: {
    gameCatalog: { findMany: async args => { queries.push(args); return pages++ === 0 ? rows : []; } },
    $transaction: async work => {
      locked = false;
      return work({
        gameCatalog: { findUnique: async args => {
          assert(locked); seen.push(args.where.key);
          return { genre: "Puzzle", genres: ["puzzle"], tags: ["updated while page was read"], seriesHints: [], estimatedHours: 9, releaseYear: 2011 };
        } },
        $executeRaw: async (strings, ...values) => {
          const sql = strings.join("?");
          if (sql.includes("pg_advisory_xact_lock")) { locked = true; return 1; }
          assert.match(sql, /"featureVector" IS NULL/);
          assert.match(sql, /"featureContentHash" IS DISTINCT FROM/);
          assert.match(sql, /"featureVectorVersion" IS DISTINCT FROM/);
          const { buildCatalogVector } = loader()("src/lib/catalog-vector.ts");
          const expected = buildCatalogVector({ genre: "Puzzle", tags: ["updated while page was read"], estimatedHours: 9, releaseYear: 2011 });
          assert.equal(values[2], expected.contentHash);
          return values[4] === "a" ? 1 : 0;
        },
      });
    },
  } } })("src/lib/catalog-store.ts");
  assert.equal(await store.backfillCatalogVectors(), 1);
  assert.deepEqual(seen, ["a", "b"]);
  assert.equal(queries[0].take, 100);
  assert.deepEqual(queries[1].cursor, { key: "b" });
  assert.equal(queries[1].skip, 1);
});
