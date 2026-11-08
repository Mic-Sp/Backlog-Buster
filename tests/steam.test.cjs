/* eslint-disable @typescript-eslint/no-require-imports -- Mock Steam transport; never use live credentials. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.resolve(__dirname, "..", file), instance = new Module(filename, module);
    instance.filename = filename;
    instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = name => name === "server-only" ? {} : Object.hasOwn(mocks, name) ? mocks[name]
      : name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`) : original(name);
    instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, filename);
    cache.set(file, instance.exports);
    return instance.exports;
  }
  return load;
}
const steamId = "76561198000000000";
const steam = loader()("src/lib/steam.ts");
const isError = code => error => error.name === "SteamAPIError" && error.code === code;
const envelope = response => Response.json({ response });
const owned = (appid = 440, minutes = 90) => ({ appid, name: " Team   Fortress 2 ", playtime_forever: minutes });

function configured(t) {
  const before = process.env.STEAM_API_KEY;
  process.env.STEAM_API_KEY = " fixture-steam-secret ";
  t.after(() => { if (before === undefined) delete process.env.STEAM_API_KEY; else process.env.STEAM_API_KEY = before; });
}
function fixture(respond) {
  const requests = [];
  const load = loader({ "@/lib/api-resilience": {
    resilientFetch: async (url, options) => { requests.push({ url: new URL(url), options }); return respond(requests.length, url, options); },
    retryAfterSeconds: value => Number(value) || 10,
  } });
  return { ...load("src/lib/steam.ts"), requests, load };
}

test("parses SteamID64 strings, Steam profile URLs and custom vanity names", () => {
  for (const input of [steamId, ` ${steamId} `, `https://steamcommunity.com/profiles/${steamId}/`,
    `http://www.steamcommunity.com/profiles/${steamId}?l=english#games`, `steamcommunity.com/profiles/${steamId}`]) {
    assert.deepEqual(steam.parseSteamIdentifier(input), { kind: "steamId", value: steamId });
  }
  for (const input of ["Cool_Player-2", "https://steamcommunity.com/id/Cool_Player-2/", "www.steamcommunity.com/id/Cool_Player-2", "https://steamcommunity.com/id/Cool%5FPlayer-2"]) {
    assert.deepEqual(steam.parseSteamIdentifier(input), { kind: "vanity", value: "Cool_Player-2" });
  }
  assert.deepEqual(steam.parseSteamIdentifier("76561202255233023"), { kind: "steamId", value: "76561202255233023" });
});

test("rejects malformed IDs, unsafe URLs, encoded paths and unsupported profile paths locally", () => {
  for (const value of [null, 76561198000000000, "", " ", "x".repeat(513), "76561197960265728", "76561202255233024", "99999999999999999",
    "https://evil.example/id/player", "https://steamcommunity.com.evil.example/id/player", "https://steamcommunity.com@evil.example/id/player",
    "https://evil@steamcommunity.com/id/player", "https://steamcommunity.com:8443/id/player", "file://steamcommunity.com/id/player",
    "https://steamcommunity.com/groups/player", `https://steamcommunity.com/profiles/${steamId}/games`, "https://steamcommunity.com/profiles/not-an-id",
    "https://steamcommunity.com/id/a%2Fb", "https://steamcommunity.com/id/%ZZ", "player/name", "player name", "player\nname", "player\\name"]) {
    assert.throws(() => steam.parseSteamIdentifier(value), isError("INVALID_IDENTIFIER"), String(value));
  }
});

test("converts integer minutes without losing short sessions or fractional hours", () => {
  for (const [minutes, hours] of [[0, 0], [1, 1 / 60], [30, 0.5], [60, 1], [90, 1.5], [125, 125 / 60], [600001, 600001 / 60]]) {
    assert.equal(steam.steamMinutesToHours(minutes), hours);
  }
  for (const value of [-1, 1.5, NaN, Infinity, "60", null, 4294967296]) assert.throws(() => steam.steamMinutesToHours(value), isError("INVALID_RESPONSE"));
});

test("missing/blank keys and invalid identifiers never dispatch a request; numeric resolution stays local", async t => {
  configured(t);
  const f = fixture(() => assert.fail("No network request expected"));
  for (const key of [undefined, "", "  "]) {
    if (key === undefined) delete process.env.STEAM_API_KEY; else process.env.STEAM_API_KEY = key;
    await assert.rejects(f.fetchSteamLibrary(steamId), isError("MISSING_API_KEY"));
    await assert.rejects(f.resolveSteamId("vanity"), isError("MISSING_API_KEY"));
    assert.equal(await f.resolveSteamId(steamId), steamId);
  }
  await assert.rejects(f.fetchSteamLibrary("https://evil.example/id/test"), isError("INVALID_IDENTIFIER"));
  assert.equal(f.requests.length, 0);
});

test("vanity resolution precedes one owned-games request with app info and played free games enabled", async t => {
  configured(t);
  const f = fixture(call => call === 1 ? envelope({ success: 1, steamid: steamId })
    : envelope({ game_count: 2, games: [owned(), { appid: 4294967295, playtime_forever: 1 }] }));
  const result = await f.fetchSteamLibrary("https://steamcommunity.com/id/test-player");
  assert.deepEqual(result, { steamId, games: [
    { steamAppId: "440", title: "Team Fortress 2", playtimeMinutes: 90, hoursPlayed: 1.5, recentMinutes: 0, coverUrl: "https://cdn.cloudflare.steamstatic.com/steam/apps/440/header.jpg" },
    { steamAppId: "4294967295", title: "Steam App 4294967295", playtimeMinutes: 1, hoursPlayed: 1 / 60, recentMinutes: 0, coverUrl: "https://cdn.cloudflare.steamstatic.com/steam/apps/4294967295/header.jpg" },
  ] });
  assert.equal(f.requests.length, 2);
  const [resolve, library] = f.requests;
  assert.equal(resolve.url.pathname, "/ISteamUser/ResolveVanityURL/v1/");
  assert.equal(resolve.url.searchParams.get("vanityurl"), "test-player");
  assert.equal(resolve.url.searchParams.get("url_type"), "1");
  assert.equal(library.url.pathname, "/IPlayerService/GetOwnedGames/v1/");
  assert.deepEqual(JSON.parse(library.url.searchParams.get("input_json")), { steamid: steamId, include_appinfo: true, include_played_free_games: true });
  for (const { url, options } of f.requests) {
    assert.equal(url.origin, "https://api.steampowered.com");
    assert.equal(url.searchParams.get("key"), "fixture-steam-secret");
    assert.equal(options.method, "GET"); assert.equal(options.cache, "no-store"); assert.equal(options.redirect, "error");
    assert(options.signal instanceof AbortSignal);
  }
  const serialized = JSON.stringify(result);
  for (const forbidden of ["fixture-steam-secret", "rating", "status", "lengthHours", "earnedXp"]) assert(!serialized.includes(forbidden));
});

test("ID inputs bypass vanity resolution; visible empty libraries are valid", async t => {
  configured(t);
  for (const response of [{ game_count: 0 }, { game_count: 0, games: [] }]) {
    const f = fixture(() => envelope(response));
    assert.deepEqual(await f.fetchSteamLibrary(steamId), { steamId, games: [] });
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].url.pathname, "/IPlayerService/GetOwnedGames/v1/");
  }
});

test("unknown vanity names return a clear error and never query a library", async t => {
  configured(t);
  const f = fixture(() => envelope({ success: 42, message: "No match" }));
  await assert.rejects(f.fetchSteamLibrary("does-not-exist"), error => isError("VANITY_NOT_FOUND")(error) && /vanity name/.test(error.message));
  assert.equal(f.requests.length, 1);
  for (const response of [{ success: 1, steamid: 76561198000000000 }, { success: 1, steamid: "bad" }, { success: 0 }]) {
    await assert.rejects(fixture(() => envelope(response)).resolveSteamId("vanity"), isError("INVALID_RESPONSE"));
  }
});

test("hidden or unavailable libraries produce privacy guidance rather than an empty import", async t => {
  configured(t);
  await assert.rejects(fixture(() => envelope({})).fetchSteamLibrary(steamId), error =>
    isError("PRIVATE_LIBRARY")(error) && /profile and Game details to Public/.test(error.message));
});

test("malformed envelopes, counts, rows, duplicate apps and playtimes reject the snapshot", async t => {
  configured(t);
  for (const payload of [{}, { response: null }, { response: [] }, { response: { game_count: "1" } },
    { response: { game_count: 1 } }, { response: { game_count: 2, games: [owned()] } },
    ...[null, {}, owned(-1), owned(1.5), owned(4294967296), owned(440, -1), owned(440, "60")].map(game => ({ response: { game_count: 1, games: [game] } })),
    { response: { game_count: 2, games: [owned(), owned()] } }]) {
    await assert.rejects(fixture(() => Response.json(payload)).fetchSteamLibrary(steamId), isError("INVALID_RESPONSE"));
  }
  await assert.rejects(fixture(() => new Response("secret provider HTML")).fetchSteamLibrary(steamId), isError("INVALID_RESPONSE"));
});

test("HTTP, timeouts and transport failures are sanitized; rate-limit retry metadata survives", async t => {
  configured(t);
  for (const [status, code] of [[401, "API_KEY_REJECTED"], [403, "API_KEY_REJECTED"], [500, "UPSTREAM_ERROR"], [302, "UPSTREAM_ERROR"]]) {
    await assert.rejects(fixture(() => new Response("fixture-steam-secret provider details", { status })).fetchSteamLibrary(steamId), error =>
      isError(code)(error) && !error.message.includes("fixture-steam-secret"));
  }
  for (const name of ["TimeoutError", "AbortError"]) {
    await assert.rejects(fixture(() => { throw new DOMException("fixture-steam-secret", name); }).fetchSteamLibrary(steamId), isError("TIMEOUT"));
    await assert.rejects(fixture(() => ({ status: 200, ok: true, json: async () => { throw new DOMException("fixture-steam-secret", name); } })).fetchSteamLibrary(steamId), isError("TIMEOUT"));
  }
  await assert.rejects(fixture(() => { throw new Error("https://api.steampowered.com/?key=fixture-steam-secret"); }).fetchSteamLibrary(steamId), error =>
    isError("UPSTREAM_ERROR")(error) && !JSON.stringify(error).includes("fixture-steam-secret") && !error.message.includes("fixture-steam-secret"));
  await assert.rejects(fixture(() => new Response("", { status: 429, headers: { "Retry-After": "23" } })).fetchSteamLibrary(steamId), error => error.retryAfterSeconds === 23);
  const f = fixture(() => { throw new (f.load("src/lib/action-result.ts").RateLimitError)(37); });
  await assert.rejects(f.fetchSteamLibrary(steamId), error => error.retryAfterSeconds === 37);
});

test("the real resilience wrapper coalesces library bursts and retains upstream cooldowns", async t => {
  configured(t);
  const before = global.fetch;
  t.after(() => { global.fetch = before; });
  let calls = 0;
  global.fetch = async () => { calls++; return envelope({ game_count: 1, games: [owned()] }); };
  const real = loader()("src/lib/steam.ts");
  const libraries = await Promise.all(Array.from({ length: 10 }, () => real.fetchSteamLibrary(steamId)));
  assert.equal(calls, 1);
  libraries[0].games[0].title = "Changed";
  assert.equal(libraries[1].games[0].title, "Team Fortress 2");
  const limited = loader()("src/lib/steam.ts");
  global.fetch = async () => { calls++; return new Response("", { status: 503, headers: { "Retry-After": "30" } }); };
  await assert.rejects(limited.fetchSteamLibrary(steamId), error => error.retryAfterSeconds === 30);
  const afterLimit = calls;
  await assert.rejects(limited.fetchSteamLibrary(steamId), error => error.retryAfterSeconds > 0);
  assert.equal(calls, afterLimit);
});

test("owned games capture two-week minutes, default absent activity to zero and isolate malformed optional telemetry", async t => {
  configured(t);
  for (const [value, expected] of [[252, 252], [0, 0], [undefined, 0], [-1, null], [20161, null], [1.5, null], ['60', null]]) {
    const f = fixture(() => envelope({ game_count: 1, games: [{ ...owned(), playtime_2weeks: value }] }));
    assert.equal((await f.fetchSteamLibrary(steamId)).games[0].recentMinutes, expected);
  }
});

test("achievement adapter reads playerstats, validates each achievement and distinguishes none from private/unknown", async t => {
  configured(t);
  const rows = [0, 1, 1].map((achieved, i) => ({ apiname: `ACH_${i}`, achieved }));
  const f = fixture(() => Response.json({ playerstats: { success: true, steamID: steamId, achievements: rows } }));
  assert.deepEqual(await f.fetchSteamAchievements(steamId, '440'), { unlocked: 2, total: 3 });
  assert.equal(f.requests[0].url.pathname, '/ISteamUserStats/GetPlayerAchievements/v0001/');
  assert.equal(f.requests[0].url.searchParams.get('steamid'), steamId); assert.equal(f.requests[0].url.searchParams.get('appid'), '440');
  assert.equal(f.requests[0].url.searchParams.get('l'), 'english');
  assert.equal(f.requests[0].options.redirect, 'error'); assert(f.requests[0].options.signal instanceof AbortSignal);
  const empty = fixture(() => Response.json({ playerstats: { success: true, achievements: [] } }));
  assert.deepEqual(await empty.fetchSteamAchievements(steamId, '440'), { unlocked: 0, total: 0 });
  for (const playerstats of [{ success: false, error: 'Requested app has no stats' }, { success: true },
    { success: true, steamID: 'another-account', achievements: rows },
    ...[[{ apiname: 'A', achieved: 2 }], [{ apiname: 'A', achieved: 1 }, { apiname: 'A', achieved: 1 }], [null], [{ achieved: 1 }]].map(achievements => ({ success: true, achievements }))]) {
    assert.equal(await fixture(() => Response.json({ playerstats })).fetchSteamAchievements(steamId, '440'), null);
  }
  const invalid = fixture(() => assert.fail('Invalid identity cannot dispatch'));
  for (const appId of ['0', '-1', '4294967296', '440/key', 440]) await assert.rejects(invalid.fetchSteamAchievements(steamId, appId));
  await assert.rejects(invalid.fetchSteamAchievements('bad', '440'));
});

test('live Steam privacy envelope is distinct from invalid API keys and never leaks the raw provider body', async t => {
  configured(t);
  const payload = { playerstats: { error: 'Profile is not public', success: false } };
  for (const status of [200, 403]) {
    const f = fixture(() => Response.json(payload, { status }));
    await assert.rejects(f.fetchSteamAchievements(steamId, '108710'), error => isError('PRIVATE_ACHIEVEMENTS')(error) &&
      /My profile and Game details to Public/.test(error.message) && !error.message.includes('fixture-steam-secret'));
  }
  await assert.rejects(fixture(() => new Response('Access denied for fixture-steam-secret', { status: 403 })).fetchSteamAchievements(steamId, '108710'), isError('API_KEY_REJECTED'));
});

test('Alan Wake, Marvel Rivals and Final Fantasy IX counts parse including a valid zero-unlock profile', async t => {
  configured(t);
  for (const [appId, unlocked, total] of [['108710', 19, 67], ['2767030', 4, 49], ['377840', 0, 85]]) {
    const f = fixture(() => Response.json({ playerstats: { success: true, steamID: steamId,
      achievements: Array.from({ length: total }, (_, i) => ({ apiname: `ACH_${i}`, achieved: i < unlocked ? 1 : 0, unlocktime: 0 })) } }));
    assert.deepEqual(await f.fetchSteamAchievements(steamId, appId), { unlocked, total });
    assert.equal(f.requests[0].url.searchParams.get('l'), 'english');
  }
});

test('achievement requests retain a full ten-second budget instead of the old premature 2.5-second abort', async t => {
  configured(t);
  const budgets = [];
  t.mock.method(AbortSignal, 'timeout', milliseconds => { budgets.push(milliseconds); return new AbortController().signal; });
  const f = fixture(() => Response.json({ playerstats: { success: true, achievements: [{ apiname: 'FIRST', achieved: 1 }] } }));
  assert.deepEqual(await f.fetchSteamAchievements(steamId, '108710'), { unlocked: 1, total: 1 });
  assert.deepEqual(budgets, [10000]);
});
