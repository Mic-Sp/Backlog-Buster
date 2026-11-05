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
const canonical = (games, source = "rawg") => structuredClone(games).map((game, index) => ({ ...game,
  rawgId: source === "rawg" ? index + 1 : null, rawgSlug: null,
  ...(source === "igdb" ? { metadataSource: "igdb", igdbId: index + 1 } : {}),
  genres: [game.genre].filter(Boolean), tags: [], seriesHints: [], multiplayer: null, coop: null, onlineCoop: null, localCoop: null }));
function fixture({ local = [], remote = [], igdbRemote = [], readError = false, writeError = false,
  providerError = false, igdbError = false, rawgSearch, igdbSearch } = {}) {
  const reads = [], searches = [], igdbSearches = [], writes = [], vectors = [];
  const load = loader({
    "@/lib/prisma": { prisma: {
      gameCatalog: {
        findMany: async (args) => { reads.push(args); if (readError) throw Error("db offline"); return structuredClone(local); },
        upsert: (args) => { writes.push(args); return Promise.resolve(args.create); },
      },
      $transaction: async (work) => {
        if (writeError) throw Error("db offline");
        return work({ $executeRaw: async (sql, ...values) => { if (sql.join("").includes("UPDATE")) vectors.push(values); return 1; }, gameCatalog: {
          findUnique: async () => null,
          upsert: async (args) => { writes.push(args); return args.create; },
        } });
      },
    } },
    "@/lib/rawg": { searchRawgGames: async (query, reportErrors, options) => {
      searches.push(query); if (providerError) throw Error("provider failed");
      if (rawgSearch) return rawgSearch(query, reportErrors, options);
      return canonical(remote);
    } },
    "@/lib/igdb-catalog": { searchIgdbGames: async (query, signal) => {
      igdbSearches.push(query); if (igdbError) throw Error("IGDB failed");
      if (igdbSearch) return igdbSearch(query, signal);
      return canonical(igdbRemote, "igdb");
    } },
  });
  return { ...load("src/lib/catalog-search.ts"), reads, searches, igdbSearches, writes, vectors };
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
  assert.deepEqual(f.igdbSearches, []);
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

// Speed up the actual timeout path while asserting the production budget is 2000ms.
async function shortProviderTimeouts(work) {
  const original = AbortSignal.timeout, timers = [], budgets = [];
  AbortSignal.timeout = ms => {
    budgets.push(ms);
    if (ms !== 2000) return original(ms);
    const controller = new AbortController();
    timers.push(setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), 20));
    return controller.signal;
  };
  try { return await work(budgets); }
  finally { AbortSignal.timeout = original; timers.forEach(clearTimeout); }
}

test("RAWG timeout aborts its request and falls back to IGDB with a fresh two-second budget", async () => shortProviderTimeouts(async budgets => {
  let rawgSignal;
  const f = fixture({ local: [game("Portal")], igdbRemote: [game("portal"), game("Portal 2")],
    rawgSearch: (_query, reportErrors, options) => {
      assert.equal(reportErrors, true);
      assert.equal(options.retry, false);
      rawgSignal = options.signal;
      // An uncooperative upstream must not keep autocomplete waiting either.
      return new Promise(() => {});
    }, igdbSearch: (_query, signal) => {
      assert(rawgSignal.aborted);
      assert.equal(signal.aborted, false);
      return canonical([game("portal"), game("Portal 2")], "igdb");
    } });
  assert.deepEqual(await f.searchCatalog("portal"), [game("Portal"), game("Portal 2")]);
  assert.deepEqual(budgets, [2000, 2000]);
  assert.deepEqual(f.igdbSearches, ["portal"]);
  assert.equal(f.writes.length, 2);
  assert(f.writes.every(write => write.create.metadataSource === "igdb" && write.create.rawgId === null));
  assert(f.writes.every(write => !Object.hasOwn(write.update, "rawgId")));
  assert.equal(f.vectors.length, 2);
  assert(f.vectors.every(values => JSON.parse(values[0]).length === 128));
  await f.searchCatalog("PORTAL");
  assert.equal(f.searches.length, 1);
  assert.equal(f.igdbSearches.length, 1);
}));

test("RAWG failures and empty/unconfigured results use IGDB; RAWG successes skip IGDB", async () => {
  for (const providerError of [true, false]) {
    const f = fixture({ providerError, igdbRemote: [game("Portal 2")] });
    assert.deepEqual(await f.searchCatalog("portal"), [game("Portal 2")]);
    assert.deepEqual(f.igdbSearches, ["portal"]);
  }
  const success = fixture({ remote: [game("Portal 2")], igdbError: true });
  assert.deepEqual(await success.searchCatalog("portal"), [game("Portal 2")]);
  assert.deepEqual(success.igdbSearches, []);
});

test("both provider timeouts return local matches and cache the graceful fallback", async () => shortProviderTimeouts(async budgets => {
  const signals = [];
  const never = signal => { signals.push(signal); return new Promise(() => {}); };
  const f = fixture({ local: [game("Portal")], rawgSearch: (_q, _r, options) => never(options.signal),
    igdbSearch: (_q, signal) => never(signal) });
  assert.deepEqual(await f.searchCatalog("portal"), [game("Portal")]);
  assert.deepEqual(budgets, [2000, 2000]);
  assert(signals.every(signal => signal.aborted));
  assert.deepEqual(await f.searchCatalog("PORTAL"), [game("Portal")]);
  assert.equal(f.searches.length, 1);
  assert.equal(f.igdbSearches.length, 1);
  assert.equal(f.writes.length, 0);
}));

test("both provider errors preserve local matches; database errors and IGDB write errors are optional", async () => {
  for (const local of [[], [game("Portal")]]) {
    const f = fixture({ local, providerError: true, igdbError: true });
    assert.deepEqual(await f.searchCatalog("portal"), local);
  }
  const offline = fixture({ readError: true, writeError: true, providerError: true, igdbRemote: [game("Portal")] });
  assert.deepEqual(await offline.searchCatalog("portal"), [game("Portal")]);
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
  assert.deepEqual(results.map(({ title, releaseYear, estimatedHours, platforms, genre, coverUrl }) =>
    ({ title, releaseYear, estimatedHours, platforms, genre, coverUrl })), [
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

test("IGDB normalizes canonical metadata and safely quotes name searches", async () => {
  const calls = [];
  const load = loader({ "@/lib/igdb-api": { queryIgdb: async (endpoint, body, signal) => {
    calls.push({ endpoint, body, signal });
    return [{ id: 73, name: "  Portal   2 ", first_release_date: Date.UTC(2011, 3, 19) / 1000,
      cover: { image_id: "co_123" }, genres: [null, { name: "Puzzle" }, { name: "Adventure" }],
      platforms: [null, { name: "PC" }, { name: "PC" }] },
    { id: 74, name: "Unknown", first_release_date: Infinity, cover: { image_id: "../unsafe" } },
    null, {}, { id: 0, name: "Bad" }, { id: 75, name: "a".repeat(121) }, { id: 76, name: "bad\u0000name" }];
  } } });
  const api = load("src/lib/igdb-catalog.ts"), signal = new AbortController().signal;
  const results = await api.searchIgdbGames('Portal "; fields *;', signal);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], { title: "Portal 2", releaseYear: 2011, genre: "Puzzle", genres: ["adventure", "puzzle"],
    platforms: ["PC"], estimatedHours: null, coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co_123.jpg",
    metadataSource: "igdb", igdbId: 73, rawgId: null, rawgSlug: null, tags: [], seriesHints: [],
    multiplayer: null, coop: null, onlineCoop: null, localCoop: null });
  assert.equal(results[1].releaseYear, null);
  assert.equal(results[1].coverUrl, null);
  assert.equal(calls[0].endpoint, "games");
  assert(calls[0].body.startsWith('search "Portal \\"; fields *;";'));
  assert(calls[0].body.includes("cover.image_id,first_release_date,genres.name,platforms.name; limit 8;"));
  assert.equal(calls[0].signal, signal);
});

function integratedFixture({ token = { accessToken: "cached-token", expiresAt: new Date(Date.now() + 5e9) }, tokenRead } = {}) {
  const writes = [], local = [game("Portal")];
  const tokenTable = { findUnique: tokenRead ?? (async () => token), upsert: async () => ({}), deleteMany: async () => ({ count: 0 }) };
  const prisma = { gameCatalog: { findMany: async () => local }, externalOAuthToken: tokenTable,
    $queryRaw: async () => [{ key: "claimed" }],
    $transaction: async work => work({ $executeRaw: async () => 1, externalOAuthToken: tokenTable,
      gameCatalog: { findUnique: async () => null, upsert: async args => { writes.push(args); } } }),
  };
  return { ...loader({ "@/lib/prisma": { prisma } })("src/lib/catalog-search.ts"), writes, local };
}
async function configuredProviders(work) {
  const before = [process.env.RAWG_API_KEY, process.env.TWITCH_CLIENT_ID, process.env.TWITCH_CLIENT_SECRET, global.fetch];
  process.env.RAWG_API_KEY = "fixture-key";
  process.env.TWITCH_CLIENT_ID = "fixture-client";
  process.env.TWITCH_CLIENT_SECRET = "fixture-secret";
  try { return await work(); }
  finally {
    for (const [i, key] of ["RAWG_API_KEY", "TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"].entries()) {
      if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i];
    }
    global.fetch = before[3];
  }
}

test("real RAWG failures immediately fall through to authenticated IGDB and persist its public metadata", async () => configuredProviders(async () => {
  for (const upstream of [
    ...[500, 503, 401, 429].map(status => async () => new Response(null, { status })),
    async () => { throw Error("network unavailable"); }, async () => Response.json({}),
  ]) {
    const f = integratedFixture(), calls = [];
    global.fetch = async (url, options) => {
      calls.push(url);
      if (url.startsWith("https://api.rawg.io/")) return upstream();
      assert.equal(url, "https://api.igdb.com/v4/games");
      assert.equal(options.headers["Client-ID"], "fixture-client");
      assert.equal(options.headers.Authorization, "Bearer cached-token");
      return Response.json([{ id: 73, name: "Portal 2", first_release_date: Date.UTC(2011, 0, 1) / 1000,
        genres: [{ name: "Puzzle" }], platforms: [{ name: "PC" }], cover: { image_id: "co123" } }]);
    };
    const result = await f.searchCatalog("portal");
    assert.deepEqual(result.map(row => row.title), ["Portal", "Portal 2"]);
    assert.equal(calls.length, 2, "RAWG 503/429 must not retry before IGDB fallback");
    assert.equal(f.writes[0].create.metadataSource, "igdb");
    assert(!Object.hasOwn(result[1], "igdbId"));
    assert(!Object.hasOwn(result[1], "metadataSource"));
  }
}));

test("unconfigured RAWG uses IGDB; both providers unconfigured or unreachable return local matches", async () => configuredProviders(async () => {
  delete process.env.RAWG_API_KEY;
  let calls = 0;
  global.fetch = async () => { calls++; return Response.json([{ id: 73, name: "Portal 2" }]); };
  assert.equal((await integratedFixture().searchCatalog("portal")).length, 2);
  assert.equal(calls, 1);
  delete process.env.TWITCH_CLIENT_SECRET;
  const missing = integratedFixture();
  assert.deepEqual(await missing.searchCatalog("portal"), missing.local);
  assert.equal(calls, 1);
  process.env.RAWG_API_KEY = "fixture-key";
  process.env.TWITCH_CLIENT_SECRET = "fixture-secret";
  global.fetch = async () => { throw Error("offline"); };
  const offline = integratedFixture();
  assert.deepEqual(await offline.searchCatalog("portal"), offline.local);
}));

test("the real RAWG fetch is aborted at two seconds before successful IGDB fallback", async () => configuredProviders(async () => shortProviderTimeouts(async () => {
  const f = integratedFixture();
  let rawgSignal;
  global.fetch = async (url, options) => {
    if (url.includes("api.rawg.io")) {
      rawgSignal = options.signal;
      return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
    }
    assert(rawgSignal.aborted);
    return Response.json([{ id: 73, name: "Portal 2" }]);
  };
  assert.equal((await f.searchCatalog("portal")).length, 2);
})));

test("slow Twitch refresh, shared auth waits, and IGDB response bodies cannot exceed the fallback budget", async () => configuredProviders(async () => shortProviderTimeouts(async () => {
  delete process.env.RAWG_API_KEY;
  let tokenSignal;
  global.fetch = async (url, options) => {
    assert.equal(url, "https://id.twitch.tv/oauth2/token");
    tokenSignal = options.signal;
    return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  };
  const refresh = integratedFixture({ token: null });
  assert.deepEqual(await refresh.searchCatalog("portal"), refresh.local);
  assert(tokenSignal.aborted);

  global.fetch = async () => assert.fail("Expired auth waits must not issue later game requests");
  const waiting = integratedFixture({ tokenRead: () => new Promise(() => {}) });
  assert.deepEqual(await waiting.searchCatalog("portal"), waiting.local);

  let bodySignal;
  global.fetch = async (_url, options) => {
    bodySignal = options.signal;
    return { ok: true, json: () => new Promise(() => {}) };
  };
  const body = integratedFixture();
  assert.deepEqual(await body.searchCatalog("portal"), body.local);
  assert(bodySignal.aborted);
})));

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
