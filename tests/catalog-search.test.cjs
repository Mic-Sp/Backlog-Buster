/* eslint-disable @typescript-eslint/no-require-imports -- Mock server/database/provider boundaries. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");

function loader(mocks) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.resolve(__dirname, "..", file), instance = new Module(filename, module);
    instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = (name) => name === "server-only" ? {} : Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`) : original(name);
    instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
    cache.set(file, instance.exports);
    return instance.exports;
  }
  return load;
}

const game = (title, releaseYear = 2020) => ({ title, releaseYear, platforms: ["PC"], genre: "Puzzle", estimatedHours: 12, coverUrl: null });
function fixture({ local = [], remote = [], readError = false, writeError = false, providerError = false } = {}) {
  const reads = [], searches = [], writes = [];
  const load = loader({
    "@/lib/prisma": { prisma: {
      gameCatalog: {
        findMany: async (args) => { reads.push(args); if (readError) throw Error("db offline"); return structuredClone(local); },
        upsert: (args) => { writes.push(args); return Promise.resolve(args.create); },
      },
      $transaction: async (operations) => { if (writeError) throw Error("db offline"); return Promise.all(operations); },
    } },
    "@/lib/rawg": { searchRawgGames: async (query) => { searches.push(query); if (providerError) throw Error("provider failed"); return structuredClone(remote); } },
  });
  return { ...load("src/lib/catalog-search.ts"), reads, searches, writes };
}

test("invalid, short and oversized queries return [] without DB/provider calls", async () => {
  const f = fixture();
  for (const query of [undefined, null, 42, {}, "", " ", "a", " a ", "a".repeat(121), "po\u0000rtal"]) {
    assert.deepEqual(await f.searchCatalog(query), []);
  }
  assert.equal(f.reads.length, 0);
  assert.equal(f.searches.length, 0);
  await f.searchCatalog("po");
  assert.equal(f.searches.length, 1);
});

test("local search selects only public fields and supplements with canonical provider results", async () => {
  const f = fixture({ local: [game("Portal 2"), game("Portal")], remote: [game("portal"), game("Portal Stories")] });
  const results = await f.searchCatalog("  Portal  ");
  assert.deepEqual(results.map(row => row.title), ["Portal", "Portal 2", "Portal Stories"]);
  assert.deepEqual(f.reads[0], {
    where: { title: { contains: "Portal", mode: "insensitive" } }, take: 8,
    select: { title: true, releaseYear: true, platforms: true, genre: true, estimatedHours: true, coverUrl: true },
    orderBy: [{ title: "asc" }, { releaseYear: "desc" }],
  });
  assert.deepEqual(f.searches, ["Portal"]);
  assert.equal(f.writes.length, 2);
  assert(f.writes.every(write => !Object.hasOwn(write.create, "userId")));
});

test("full local hits avoid provider calls and results stop at eight", async () => {
  const local = Array.from({ length: 8 }, (_, i) => game(`Portal ${i}`));
  const f = fixture({ local });
  assert.equal((await f.searchCatalog("portal")).length, 8);
  assert.deepEqual(f.searches, []);
  assert.deepEqual(f.writes, []);
  const partial = fixture({ local: local.slice(0, 3), remote: Array.from({ length: 8 }, (_, i) => game(`Portal other ${i}`)) });
  assert.equal((await partial.searchCatalog("portal")).length, 8);
});

test("deduplication preserves different release years and numbered sequels", async () => {
  const f = fixture({ remote: [game("Doom", 1993), game("DOOM", 1993), game("Doom", 2016), game("Doom II", 1994), game("Doom 3", 2004)] });
  assert.deepEqual((await f.searchCatalog("doom")).map(row => [row.title, row.releaseYear]), [["Doom", 1993], ["Doom", 2016], ["Doom II", 1994], ["Doom 3", 2004]]);
});

test("concurrent requests and normalized repeated queries share cache; callers cannot mutate it", async () => {
  const f = fixture({ remote: [game("Portal 2")] });
  const values = await Promise.all(Array.from({ length: 20 }, () => f.searchCatalog(" Portal   2 ")));
  assert.equal(f.reads.length, 1);
  assert.equal(f.searches.length, 1);
  values[0][0].platforms.push("corrupted");
  values[0][0].title = "corrupted";
  assert.deepEqual(await f.searchCatalog("portal 2"), [game("Portal 2")]);
  assert.deepEqual(values[1], [game("Portal 2")]);
});

test("cache expires after 30 seconds and distinct query keys stay independent", async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    const f = fixture();
    await f.searchCatalog("portal");
    now += 29999;
    await f.searchCatalog("PORTAL");
    assert.equal(f.searches.length, 1);
    now += 2;
    await f.searchCatalog("portal");
    await f.searchCatalog("doom");
    assert.equal(f.searches.length, 3);
  } finally { Date.now = realNow; }
});

test("cache evicts old entries when its 256-entry capacity is reached", async () => {
  const f = fixture();
  for (let i = 0; i <= 256; i++) await f.searchCatalog(`title ${i}`);
  await f.searchCatalog("title 256");
  assert.equal(f.searches.length, 257);
  await f.searchCatalog("title 0");
  assert.equal(f.searches.length, 258);
});

test("provider and database errors preserve local/remote successes and cache empty fallbacks", async () => {
  const local = fixture({ local: [game("Portal")], providerError: true });
  assert.deepEqual(await local.searchCatalog("portal"), [game("Portal")]);
  await local.searchCatalog("portal");
  assert.equal(local.searches.length, 1);
  const offline = fixture({ readError: true, writeError: true, remote: [game("Portal")] });
  assert.deepEqual(await offline.searchCatalog("portal"), [game("Portal")]);
  const empty = fixture({ readError: true, providerError: true });
  assert.deepEqual(await empty.searchCatalog("portal"), []);
  assert.deepEqual(await empty.searchCatalog("portal"), []);
  assert.equal(empty.searches.length, 1);
});

async function rawgFixture(work) {
  const previous = process.env.RAWG_API_KEY;
  process.env.RAWG_API_KEY = "fixture-key";
  try { return await work(); }
  finally { if (previous === undefined) delete process.env.RAWG_API_KEY; else process.env.RAWG_API_KEY = previous; }
}

test("RAWG search normalizes canonical titles, optional metadata, platforms, and safe cover URLs", async () => rawgFixture(async () => {
  const requests = [];
  const load = loader({ "@/lib/api-resilience": { resilientFetch: async (url, options) => {
    requests.push({ url: new URL(url), options });
    return Response.json({ results: [
      { name: "  Portal   2 ", released: "2011-04-19", playtime: 8.6, genres: [null, { name: " Puzzle " }], platforms: [null, { platform: null }, { platform: { name: " PC " } }, { platform: { name: "PC" } }], background_image: "https://media.rawg.io/media/games/portal.jpg" },
      { name: "Unknown", released: "bad", playtime: 0, genres: {}, platforms: {}, background_image: "javascript:bad" },
      { name: "Negative", released: "0000-01-01", playtime: -1, background_image: "not a URL" },
      null, {}, { name: " " }, { name: 42 },
    ] });
  } } });
  const results = await load("src/lib/rawg.ts").searchRawgGames("portal & 2");
  assert.deepEqual(results, [
    { title: "Portal 2", releaseYear: 2011, estimatedHours: 9, platforms: ["PC"], genre: "Puzzle", coverUrl: "https://media.rawg.io/media/resize/640/-/games/portal.jpg" },
    { title: "Unknown", releaseYear: null, estimatedHours: null, platforms: [], genre: null, coverUrl: null },
    { title: "Negative", releaseYear: null, estimatedHours: null, platforms: [], genre: null, coverUrl: null },
  ]);
  assert.equal(requests[0].url.origin, "https://api.rawg.io");
  assert.equal(requests[0].url.searchParams.get("page_size"), "8");
  assert.equal(requests[0].url.searchParams.get("search"), "portal & 2");
  assert.equal(requests[0].options.cache, "no-store");
  assert(requests[0].options.signal instanceof AbortSignal);
}));

test("missing/blank RAWG keys skip requests; auth, quota, timeout, network and malformed responses return []", async () => rawgFixture(async () => {
  let calls = 0;
  const missing = loader({ "@/lib/api-resilience": { resilientFetch: async () => { calls++; throw Error("unexpected request"); } } })("src/lib/rawg.ts");
  for (const key of [undefined, "", " "]) {
    if (key === undefined) delete process.env.RAWG_API_KEY; else process.env.RAWG_API_KEY = key;
    assert.deepEqual(await missing.searchRawgGames("portal"), []);
  }
  assert.equal(calls, 0);
  process.env.RAWG_API_KEY = "fixture-key";
  const { RateLimitError } = loader({})("src/lib/action-result.ts");
  for (const fetch of [
    ...[401, 403, 429, 500, 503].map(status => async () => new Response(null, { status })),
    async () => { throw new DOMException("timeout", "TimeoutError"); },
    async () => { throw new RateLimitError(30); },
    async () => { throw Error("network error"); },
    async () => new Response("invalid JSON"),
    ...[null, {}, { results: null }, { results: [null, "bad", []] }].map(payload => async () => Response.json(payload)),
  ]) {
    const rawg = loader({ "@/lib/api-resilience": { resilientFetch: fetch } })("src/lib/rawg.ts");
    assert.deepEqual(await rawg.searchRawgGames("portal"), []);
  }
}));

test("endpoint reads q, returns the lightweight array, and disables HTTP caching", async () => {
  const queries = [];
  const GET = loader({
    "@/lib/player": { getAuthenticatedPlayerId: async () => "player" },
    "@/lib/catalog-search": { searchCatalog: async (query) => { queries.push(query); return query ? [game("Portal")] : []; } },
  })("src/app/api/catalog/search/route.ts").GET;
  const response = await GET(new Request("https://example.com/api/catalog/search?q=portal"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), [game("Portal")]);
  assert.deepEqual(await (await GET(new Request("https://example.com/api/catalog/search"))).json(), []);
  assert.deepEqual(queries, ["portal", ""]);
});

test("endpoint quietly returns [] for auth and unexpected service failures", async () => {
  for (const authFails of [true, false]) {
    let calls = 0;
    const GET = loader({
      "@/lib/player": { getAuthenticatedPlayerId: async () => { if (authFails) throw Error("sign in"); return "player"; } },
      "@/lib/catalog-search": { searchCatalog: async () => { calls++; throw Error("unavailable"); } },
    })("src/app/api/catalog/search/route.ts").GET;
    const response = await GET(new Request("https://example.com/api/catalog/search?q=portal"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
    assert.equal(calls, authFails ? 0 : 1);
  }
});
