/* eslint-disable @typescript-eslint/no-require-imports -- Isolate sessions, provider requests and transactional database writes. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.resolve(__dirname, "..", file), instance = new Module(filename, module);
    instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = name => name === "server-only" ? {} : Object.hasOwn(mocks, name) ? mocks[name]
      : name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`) : original(name);
    instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
    cache.set(file, instance.exports); return instance.exports;
  }
  return load;
}
const { parseSteamIdentifier } = loader()("src/lib/steam.ts");
const steamId = "76561198000000000";
const incoming = (id, title = `Steam Game ${id}`, minutes = 90) => ({ steamAppId: String(id), title, playtimeMinutes: minutes, hoursPlayed: minutes / 60,
  coverUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg` });
const saved = (id, extra = {}) => ({ id, userId: "owner", title: `Steam Game ${id}`, platform: "PC", steamAppId: null,
  hoursPlayed: 0, status: "Backlog", lengthHours: 20, difficulty: 2, earnedXp: 0, rating: null, notes: null, pinnedOrder: null, ...extra });
const request = (extra = {}) => ({ identifier: steamId, ...extra });

function fixture(initial = [], snapshot = [], options = {}) {
  let games = structuredClone(initial), player = { id: "owner", steamId: options.linkedSteamId ?? null,
    steamAutoSyncAttemptedAt: options.attemptedAt ?? null, steamLastSyncedAt: null }, token = "owner-token", revoked = false;
  let inTransaction = false, sequence = Promise.resolve(), providerCalls = 0, nextId = 10000;
  const rawgCalls = [], cacheCalls = [], locks = [], updateBatches = [], createBatches = [], guardCalls = [];
  const selectRows = ({ where, select }) => {
    assert.deepEqual(where, { userId: "owner" });
    return games.filter(game => game.userId === "owner").map(game => Object.fromEntries(Object.keys(select).map(key => [key, game[key]])));
  };
  const assertUnique = (appId, exceptId) => {
    if (games.some(game => game.userId === "owner" && game.steamAppId === appId && game.id !== exceptId)) throw Error("Duplicate Steam AppID");
  };
  const tx = {
    $executeRaw: async (strings, ...values) => {
      assert(inTransaction);
      const sql = strings.join("?");
      if (sql.includes("pg_advisory_xact_lock")) {
        assert.equal(values[0], "backlogbuster-deck:owner"); locks.push(values[0]); return 1;
      }
      assert.match(sql, /UPDATE "Game"/);
      assert.match(sql, /game\."userId" = \?/);
      assert.match(sql, /GREATEST/);
      assert.doesNotMatch(sql, /earnedXp|rating|status|notes/);
      const [json, userId] = values; assert.equal(userId, "owner");
      const changes = JSON.parse(json); updateBatches.push(changes);
      if (options.failUpdates) throw Error("private database detail");
      let count = 0;
      for (const change of changes) {
        const game = games.find(game => game.id === change.id && game.userId === userId);
        if (!game) continue;
        assertUnique(change.steamAppId, game.id);
        if (options.concurrentHours) game.hoursPlayed = Math.max(game.hoursPlayed, options.concurrentHours);
        game.steamAppId = change.steamAppId;
        game.hoursPlayed = Math.max(game.hoursPlayed, change.hoursPlayed ?? game.hoursPlayed);
        count++;
      }
      return count;
    },
    playerSession: { findUnique: async ({ where }) => {
      assert(inTransaction); assert.equal(where.tokenHash, "owner-token"); assert.equal(where.userId, "owner");
      assert(where.expiresAt.gt instanceof Date); assert(where.player.email.not === null);
      const automatic = where.player.steamAutoSyncAttemptedAt;
      const staleLink = automatic && (where.player.steamId !== player.steamId || automatic.getTime() !== player.steamAutoSyncAttemptedAt?.getTime());
      return revoked || staleLink ? null : { tokenHash: "owner-token" };
    } },
    game: { findMany: async args => selectRows(args), createMany: async ({ data }) => {
      assert(inTransaction); createBatches.push(data);
      if (options.failCreateBatch === createBatches.length) throw Error("private database detail");
      for (const row of data) {
        assert.equal(row.userId, "owner"); assertUnique(row.steamAppId);
        games.push(saved(nextId++, row));
      }
      return { count: data.length };
    } },
    player: { update: async ({ where, data, select }) => {
      assert(inTransaction); assert.deepEqual(where, { id: "owner" }); assert.deepEqual(select, { id: true });
      assert.deepEqual(Object.keys(data), ["steamId", "steamLastSyncedAt"]); assert(data.steamLastSyncedAt instanceof Date);
      Object.assign(player, data); return { id: "owner" };
    } },
  };
  const prisma = {
    playerSession: { findUnique: async ({ where }) => {
      assert.equal(where.tokenHash, "owner-token"); assert(where.player.email.not === null && where.player.passwordHash.not === null);
      return revoked ? null : { player: { id: "owner", operatorName: "Owner", handle: "owner" } };
    } },
    game: { findMany: async args => selectRows(args) },
    gameCatalog: { findMany: async args => {
      assert(!inTransaction); cacheCalls.push(args);
      if (options.cacheFailure) throw Error("Optional table unavailable");
      const titles = args.where.title.in.map(title => title.toLowerCase());
      assert.equal(args.where.title.mode, "insensitive");
      return (options.catalog ?? []).filter(row => titles.includes(row.title.toLowerCase()));
    } },
    $transaction: (work, settings) => {
      assert.equal(settings.timeout, 15000);
      const result = sequence.then(async () => {
        options.beforeTransaction?.(games);
        const beforeGames = structuredClone(games), beforePlayer = structuredClone(player);
        inTransaction = true;
        try { return await work(tx); }
        catch (error) { games = beforeGames; player = beforePlayer; throw error; }
        finally { inTransaction = false; }
      });
      sequence = result.catch(() => {}); return result;
    },
  };
  const load = loader({
    "@/lib/prisma": { prisma }, "@/lib/auth-session": { readSessionHash: async () => token },
    "@/lib/api-resilience": { guardedRequest: async (id, feature, input, work) => {
      assert.equal(id, "owner"); assert(["steam-sync", "steam-auto-sync"].includes(feature)); guardCalls.push({ feature, input: JSON.parse(input) }); return work();
    } },
    "@/lib/steam": { parseSteamIdentifier, fetchSteamLibrary: async identifier => {
      assert(!inTransaction); assert.equal(identifier, steamId); providerCalls++;
      if (options.providerFailure) throw Error("Steam unavailable");
      return { steamId, games: structuredClone(snapshot) };
    } },
    "@/lib/rawg": { lookupRawgGame: async (title, report, signal) => {
      assert(!inTransaction); assert.equal(report, false); assert(signal instanceof AbortSignal);
      rawgCalls.push(title);
      if (options.revokeDuringEnrichment) revoked = true;
      return options.rawg ? options.rawg(title, signal) : null;
    } },
  });
  return { vault: load("src/lib/library-vault.ts"), rawgCalls, cacheCalls, locks, updateBatches, createBatches, guardCalls,
    get games() { return games; }, get player() { return player; }, get providerCalls() { return providerCalls; },
    signOut: () => { token = null; }, revoke: () => { revoked = true; }, relink: id => { player.steamId = id; } };
}

test("650-game sync batches writes/cache reads and caps RAWG at three lookups; repeats are idempotent", async () => {
  const f = fixture([], Array.from({ length: 650 }, (_, i) => incoming(i + 1)));
  assert.deepEqual(await f.vault.syncSteamLibraryGames(request()), { userId: "owner", summary: { steamId, addedCount: 650, updatedCount: 0, skippedCount: 0 } });
  assert.equal(f.rawgCalls.length, 3); assert.equal(f.cacheCalls.length, 2);
  assert.deepEqual(f.createBatches.map(batch => batch.length), [500, 150]); assert.equal(f.updateBatches.length, 0);
  assert.equal(f.player.steamId, steamId);
  assert(f.player.steamLastSyncedAt instanceof Date);
  assert(f.games.every(game => game.platform === "PC" && game.status === "Backlog" && game.hoursPlayed === 1 && game.earnedXp === 0 && game.lengthHours === 10));
  assert.equal(f.games[0].coverUrl, incoming(1).coverUrl);
  assert.deepEqual((await f.vault.syncSteamLibraryGames(request())).summary, { steamId, addedCount: 0, updatedCount: 0, skippedCount: 650 });
  assert.equal(f.rawgCalls.length, 3); assert.equal(f.cacheCalls.length, 2); assert.equal(f.games.length, 650); assert.equal(f.locks.length, 2);
});

test("AppID wins over renamed titles; normalized legacy PC copies link once without touching consoles or foreign players", async () => {
  const initial = [saved(1, { title: "Dark Souls III", hoursPlayed: 4, status: "Completed", earnedXp: 800, rating: 5, notes: "Personal log" }),
    saved(2, { title: "Console Only", platform: "PS5" }), saved(3, { title: "My edited title", steamAppId: "30", hoursPlayed: 50 }),
    saved(4, { title: "Conflict", steamAppId: "999" }), saved(90, { userId: "other", title: "Dark Souls III" })];
  const f = fixture(initial, [incoming(10, "Dárk Souls: 3", 600), incoming(20, "Console Only"), incoming(30, "Provider rename"), incoming(40, "Conflict")]);
  const result = await f.vault.syncSteamLibraryGames(request({ userId: "other" }));
  assert.deepEqual(result.summary, { steamId, addedCount: 2, updatedCount: 1, skippedCount: 1 });
  assert.deepEqual(f.games.find(game => game.id === 1), { ...initial[0], steamAppId: "10" });
  for (const id of [2, 3, 4, 90]) assert.deepEqual(f.games.find(game => game.id === id), initial.find(game => game.id === id));
  assert.equal(f.games.filter(game => game.steamAppId === "20").length, 1);
  assert.equal(f.games.filter(game => game.steamAppId === "40").length, 1);
  assert.equal(f.rawgCalls.length, 2, "only newly added games need metadata");
});

test("one legacy row cannot be claimed by two different Steam apps with identical titles", async () => {
  const f = fixture([saved(1, { title: "Same Name", platform: " Windows " })], [incoming(10, "Same Name"), incoming(20, "Same Name")]);
  assert.deepEqual((await f.vault.syncSteamLibraryGames(request())).summary, { steamId, addedCount: 1, updatedCount: 1, skippedCount: 0 });
  assert.deepEqual(f.games.map(game => game.steamAppId).sort(), ["10", "20"]);
});

test("opt-in playtime updates only increase hours and preserve completed XP, statuses, ratings and notes", async () => {
  const initial = [saved(1, { steamAppId: "1", hoursPlayed: 1 }), saved(2, { steamAppId: "2", hoursPlayed: 8 }),
    saved(3, { steamAppId: "3", hoursPlayed: 4, status: "Completed", earnedXp: 800, rating: 5, notes: "Do not replace" }),
    saved(4, { steamAppId: "4", hoursPlayed: 2 })];
  const f = fixture(initial, [incoming(1, "Steam Game 1", 190), incoming(2, "Steam Game 2", 360), incoming(3, "Steam Game 3", 3000), incoming(4, "Steam Game 4", 179)]);
  assert.equal((await f.vault.syncSteamLibraryGames(request())).summary.updatedCount, 0);
  const result = await f.vault.syncSteamLibraryGames(request({ updateHoursPlayed: true }));
  assert.deepEqual(result.summary, { steamId, addedCount: 0, updatedCount: 2, skippedCount: 2 });
  assert.deepEqual(f.games.map(game => game.hoursPlayed), [3, 8, 50, 2]);
  assert.deepEqual(f.games[2], { ...initial[2], hoursPlayed: 50 });
  assert.equal(f.updateBatches.length, 1);
  assert.equal((await f.vault.syncSteamLibraryGames(request({ updateHoursPlayed: true }))).summary.updatedCount, 0);
});

test("large playtime refreshes use two batch updates without per-game metadata requests", async () => {
  const original = Array.from({ length: 650 }, (_, i) => saved(i + 1, { steamAppId: String(i + 1), hoursPlayed: 2, status: "Completed", earnedXp: 400 }));
  const f = fixture(original, Array.from({ length: 650 }, (_, i) => incoming(i + 1, `Steam Game ${i + 1}`, 600)));
  assert.deepEqual((await f.vault.syncSteamLibraryGames(request({ updateHoursPlayed: true }))).summary, { steamId, addedCount: 0, updatedCount: 650, skippedCount: 0 });
  assert.deepEqual(f.updateBatches.map(batch => batch.length), [500, 150]);
  assert.equal(f.createBatches.length, 0); assert.equal(f.rawgCalls.length, 0); assert.equal(f.cacheCalls.length, 0);
  assert(f.games.every(game => game.hoursPlayed === 10 && game.status === "Completed" && game.earnedXp === 400));
});

test("unplayed filtering uses minutes so sub-hour sessions are included; stored hours are bounded integers", async () => {
  const f = fixture([], [incoming(1, "Zero", 0), incoming(2, "Half an hour", 30), incoming(3, "Very long", 600001)]);
  assert.deepEqual((await f.vault.syncSteamLibraryGames(request({ includeUnplayed: false }))).summary, { steamId, addedCount: 2, updatedCount: 0, skippedCount: 1 });
  assert.deepEqual(f.games.map(game => game.hoursPlayed), [0, 10000]);
  assert.deepEqual((await f.vault.syncSteamLibraryGames(request())).summary, { steamId, addedCount: 1, updatedCount: 0, skippedCount: 2 });
});

test("catalog is checked first, ambiguous remakes are not guessed, and native metadata survives missing cache/RAWG", async () => {
  const cached = { title: "Cached", genre: "RPG", releaseYear: 2020, coverUrl: "https://example.com/cached.jpg", estimatedHours: 42 };
  const f = fixture([], [incoming(1, "cached"), incoming(2, "Fresh"), incoming(3, "Remake")], {
    catalog: [cached, { ...cached, title: "Remake", releaseYear: 1990 }, { ...cached, title: "Remake", releaseYear: 2020 }],
    rawg: async title => title === "Fresh" ? { genre: "Adventure", releaseYear: 2021, coverUrl: "https://example.com/fresh.jpg", playtime: 18, platforms: ["PC"] } : null,
  });
  await f.vault.syncSteamLibraryGames(request());
  assert.deepEqual(f.rawgCalls.sort(), ["Fresh", "Remake"]);
  assert.equal(f.games[0].lengthHours, 42); assert.equal(f.games[0].coverUrl, cached.coverUrl); assert.equal(f.games[0].releaseYear, 2020);
  assert.equal(f.games[1].lengthHours, 18); assert.equal(f.games[1].genre, "Adventure");
  assert.equal(f.games[2].releaseYear, null); assert.equal(f.games[2].coverUrl, incoming(3).coverUrl);
  const unavailable = fixture([], [incoming(10)], { cacheFailure: true, rawg: async () => { throw Error("429"); } });
  assert.equal((await unavailable.vault.syncSteamLibraryGames(request())).summary.addedCount, 1);
  assert.equal(unavailable.games[0].coverUrl, incoming(10).coverUrl);
});

test("metadata work has a hard two-second budget even when a coalesced RAWG promise never settles", async t => {
  t.mock.method(AbortSignal, "timeout", ms => {
    assert.equal(ms, 2000);
    const controller = new AbortController(); setTimeout(() => controller.abort(), 5); return controller.signal;
  });
  const f = fixture([], Array.from({ length: 300 }, (_, i) => incoming(i + 1)), { rawg: () => new Promise(() => {}) });
  assert.equal((await f.vault.syncSteamLibraryGames(request())).summary.addedCount, 300);
  assert.equal(f.rawgCalls.length, 3);
});

test("missing/revoked sessions and invalid options stop writes and account linking", async () => {
  const signedOut = fixture([], [incoming(1)]); signedOut.signOut();
  await assert.rejects(signedOut.vault.syncSteamLibraryGames(request()), /Sign in/); assert.equal(signedOut.providerCalls, 0);
  const invalid = fixture();
  for (const value of [null, [], request({ includeUnplayed: "true" }), request({ updateHoursPlayed: 1 }), { identifier: "https://evil.example" }]) {
    await assert.rejects(invalid.vault.syncSteamLibraryGames(value));
  }
  assert.equal(invalid.providerCalls, 0); assert.equal(invalid.player.steamId, null);
  const revoked = fixture([], [incoming(1)], { revokeDuringEnrichment: true });
  await assert.rejects(revoked.vault.syncSteamLibraryGames(request()), /session expired/);
  assert.equal(revoked.games.length, 0); assert.equal(revoked.player.steamId, null);
  const failed = fixture([], [], { providerFailure: true });
  await assert.rejects(failed.vault.syncSteamLibraryGames(request()), /Steam unavailable/); assert.equal(failed.player.steamId, null);
});

test("transaction failures roll back batch inserts, playtime changes and Steam account linking", async () => {
  const large = fixture([], Array.from({ length: 650 }, (_, i) => incoming(i + 1)), { failCreateBatch: 2 });
  await assert.rejects(large.vault.syncSteamLibraryGames(request())); assert.equal(large.games.length, 0); assert.equal(large.player.steamId, null);
  const original = saved(1);
  const failedUpdate = fixture([original], [incoming(1), incoming(2)], { failUpdates: true });
  await assert.rejects(failedUpdate.vault.syncSteamLibraryGames(request({ updateHoursPlayed: true })));
  assert.deepEqual(failedUpdate.games, [original]); assert.equal(failedUpdate.player.steamId, null);
});

test("matching is repeated under the lock and batch updates retain concurrently logged hours", async () => {
  const f = fixture([], [incoming(1)], { beforeTransaction: games => { if (!games.length) games.push(saved(1)); }, concurrentHours: 9 });
  assert.deepEqual((await f.vault.syncSteamLibraryGames(request({ updateHoursPlayed: true }))).summary, { steamId, addedCount: 0, updatedCount: 1, skippedCount: 0 });
  assert.equal(f.games.length, 1); assert.equal(f.games[0].hoursPlayed, 9);
  const parallel = fixture([], [incoming(1)]);
  const results = await Promise.all([parallel.vault.syncSteamLibraryGames(request()), parallel.vault.syncSteamLibraryGames(request())]);
  assert.deepEqual(results.map(result => result.summary.addedCount), [1, 0]); assert.equal(parallel.games.length, 1);
});

test("server action syncs achievements once, revalidates once and exposes only the summary", async () => {
  const calls = [];
  const summary = { steamId, addedCount: 3, updatedCount: 2, skippedCount: 1 };
  let fail = false;
  const actions = loader({
    "next/cache": { revalidatePath: path => calls.push(["refresh", path]) },
    "@/lib/library-vault": { syncSteamLibraryGames: async payload => { assert.deepEqual(payload, request()); if (fail) throw Error("private DB details"); return { userId: "owner", summary }; } },
    "@/lib/achievements": { syncAndGetAchievements: async userId => calls.push(["achievements", userId]) },
    "@/lib/prisma": {}, "@/lib/player": {}, "@/lib/rawg": {}, "@/lib/recommendations": {},
  })("src/app/actions.ts");
  assert.deepEqual(await actions.syncSteamLibrary(request()), summary);
  assert.deepEqual(calls, [["achievements", "owner"], ["refresh", "/"]]);
  fail = true; const result = await actions.syncSteamLibrary(request()); assert(result.error); assert(!result.error.includes("private"));
  assert.equal(calls.length, 2);
});

test("background sync reuses safe writes and has a separate short cooldown from manual sync", async () => {
  const attemptedAt = new Date();
  const original = saved(1, { steamAppId: "1", status: "Completed", hoursPlayed: 3, earnedXp: 400 });
  const f = fixture([original], [incoming(1, "Steam Game 1", 600), incoming(2, "Newly played", 60), incoming(3, "Unplayed", 0)], { linkedSteamId: steamId, attemptedAt });
  const result = await f.vault.syncSteamLibraryForSession(request({ includeUnplayed: false, updateHoursPlayed: true }),
    { userId: "owner", tokenHash: "owner-token" }, { steamId, attemptedAt });
  assert.deepEqual(result.summary, { steamId, addedCount: 1, updatedCount: 1, skippedCount: 1 });
  assert.deepEqual(f.games[0], { ...original, hoursPlayed: 10 });
  assert.equal(f.guardCalls[0].feature, "steam-auto-sync");
  assert.equal(f.games[1].status, "Backlog"); assert.equal(f.games[1].earnedXp, 0);
  await f.vault.syncSteamLibraryGames(request());
  assert.equal(f.guardCalls[1].feature, "steam-sync", "manual sync ignores the daily attempt window");
});

test("logout or a relink while automatic work is pending stops all background writes", async () => {
  const attemptedAt = new Date();
  for (const change of [f => f.revoke(), f => f.relink("76561198000000001")]) {
    const f = fixture([], [incoming(1)], { linkedSteamId: steamId, attemptedAt });
    change(f);
    await assert.rejects(f.vault.syncSteamLibraryForSession(request(), { userId: "owner", tokenHash: "owner-token" }, { steamId, attemptedAt }), /session expired/);
    assert.equal(f.games.length, 0); assert.equal(f.player.steamLastSyncedAt, null);
  }
});
