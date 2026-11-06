/* eslint-disable @typescript-eslint/no-require-imports -- Isolate database claims, sync orchestration and the post-response lifecycle. */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
function loader(mocks = {}, exposeWorkspace = false) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.resolve(__dirname, "..", file), instance = new Module(filename, module);
    instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = name => name === "server-only" ? {} : Object.hasOwn(mocks, name) ? mocks[name]
      : exposeWorkspace && (name.startsWith("@/components/") || name === "./GameForm" || name === "next/link")
        ? new Proxy({ __esModule: true, default: () => null }, { get: (target, key) => key in target ? target[key] : () => null })
        : exposeWorkspace && name.startsWith("@/") ? {} : name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`) : original(name);
    const source = fs.readFileSync(filename, "utf8") + (exposeWorkspace && file === "src/app/page.tsx" ? "\nexport { PlayerWorkspace as testWorkspace };" : "");
    instance._compile(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
    cache.set(file, instance.exports); return instance.exports;
  }
  return load;
}
const DAY = 24 * 60 * 60 * 1000;
const steamId = "76561198000000000";
function configured(t) {
  const before = process.env.STEAM_API_KEY; process.env.STEAM_API_KEY = "mock-only-steam-key";
  t.after(() => { if (before === undefined) delete process.env.STEAM_API_KEY; else process.env.STEAM_API_KEY = before; });
}
function fixture(overrides = {}) {
  let now = Date.parse("2026-11-05T12:00:00Z"), queries = 0, validSession = true, fail = false, databaseFailure = false;
  const player = { id: "owner", email: "owner@example.test", passwordHash: "mock-hash", steamId,
    steamLastSyncedAt: null, steamAutoSyncAttemptedAt: null, ...overrides };
  const syncs = [], achievements = [], refreshes = [];
  const sync = loader({
    "@/lib/prisma": { prisma: { $queryRaw: async (strings, ...values) => {
      queries++;
      const sql = strings.join("?");
      assert.match(sql, /UPDATE "Player"/); assert.match(sql, /EXISTS[\s\S]*"PlayerSession"/);
      assert.match(sql, /"expiresAt" > CURRENT_TIMESTAMP/);
      assert.match(sql, /"steamLastSyncedAt" <= CURRENT_TIMESTAMP - INTERVAL '24 hours'/);
      assert.match(sql, /"steamAutoSyncAttemptedAt" <= CURRENT_TIMESTAMP - INTERVAL '24 hours'/);
      assert.deepEqual(values, ["owner", "session-token-hash"]);
      if (databaseFailure) throw Error("private database details");
      if (!validSession || !player.email || !player.passwordHash || !player.steamId ||
        [player.steamLastSyncedAt, player.steamAutoSyncAttemptedAt].some(value => value && value.getTime() > now - DAY)) return [];
      // No await between eligibility and claim: model the atomic UPDATE, not read/write races.
      player.steamAutoSyncAttemptedAt = new Date(now);
      return [{ steamId: player.steamId, attemptedAt: player.steamAutoSyncAttemptedAt }];
    } } },
    "@/lib/library-vault": { syncSteamLibraryForSession: async (payload, session, claim) => {
      syncs.push({ payload, session, claim });
      if (fail) throw Error("Steam profile is private or unavailable");
      player.steamLastSyncedAt = new Date(now);
      return { userId: player.id, summary: { steamId, addedCount: 1, updatedCount: 2, skippedCount: 0 } };
    } },
    "@/lib/achievements": { syncAndGetAchievements: async id => { achievements.push(id); } },
    "next/cache": { revalidatePath: path => { refreshes.push(path); } },
  })("src/lib/steam-auto-sync.ts").autoSyncSteamLibrary;
  return { run: () => sync("owner", "session-token-hash"), sync, player, syncs, achievements, refreshes,
    get queries() { return queries; }, advance: ms => { now += ms; }, setFailure: value => { fail = value; },
    revoke: () => { validSession = false; }, failDatabase: () => { databaseFailure = true; } };
}

test("linked players sync once per rolling 24 hours, including the exact boundary", async t => {
  configured(t); const f = fixture();
  assert.equal(await f.run(), true);
  assert.deepEqual(f.syncs[0].payload, { identifier: steamId, includeUnplayed: false, updateHoursPlayed: true });
  assert.deepEqual(f.syncs[0].session, { userId: "owner", tokenHash: "session-token-hash" });
  assert.equal(f.syncs[0].claim.steamId, steamId); assert(f.syncs[0].claim.attemptedAt instanceof Date);
  assert.equal(await f.run(), false);
  f.advance(DAY - 1); assert.equal(await f.run(), false);
  f.advance(1); assert.equal(await f.run(), true);
  assert.equal(f.syncs.length, 2); assert.deepEqual(f.achievements, []); assert.deepEqual(f.refreshes, ["/", "/"]);
});

test("recent manual successes and recent automatic failures independently suppress automatic refresh", async t => {
  configured(t);
  const recent = new Date("2026-11-05T11:00:00Z"), old = new Date("2026-11-02T12:00:00Z");
  for (const [success, attempt] of [[recent, null], [recent, old], [null, recent], [old, recent]]) {
    const f = fixture({ steamLastSyncedAt: success, steamAutoSyncAttemptedAt: attempt });
    assert.equal(await f.run(), false); assert.equal(f.syncs.length, 0);
  }
  assert.equal(await fixture({ steamLastSyncedAt: old, steamAutoSyncAttemptedAt: old }).run(), true);
});

test("parallel tabs and replicas produce only one successful database claim and provider sync", async t => {
  configured(t); const f = fixture();
  const results = await Promise.all(Array.from({ length: 30 }, () => f.run()));
  assert.equal(results.filter(Boolean).length, 1); assert.equal(f.syncs.length, 1);
  assert.equal(f.achievements.length, 0); assert.equal(f.refreshes.length, 1);
});

test("unlinked, local and revoked sessions never start Steam work", async t => {
  configured(t);
  for (const overrides of [{ steamId: null }, { steamId: "" }, { email: null }, { passwordHash: null }]) {
    const f = fixture(overrides); assert.equal(await f.run(), false); assert.equal(f.syncs.length, 0);
  }
  const revoked = fixture(); revoked.revoke(); assert.equal(await revoked.run(), false); assert.equal(revoked.player.steamAutoSyncAttemptedAt, null);
  const empty = fixture(); assert.equal(await empty.sync("", "session-token-hash"), false); assert.equal(await empty.sync("owner", ""), false); assert.equal(empty.queries, 0);
});

test("private profiles and provider failures are silent, retain the attempt cooldown, and never fake success", async t => {
  configured(t); const f = fixture(); f.setFailure(true);
  assert.equal(await f.run(), false); assert(f.player.steamAutoSyncAttemptedAt instanceof Date);
  assert.equal(f.player.steamLastSyncedAt, null); assert.equal(f.achievements.length, 0); assert.equal(f.refreshes.length, 0);
  assert.equal(await f.run(), false); assert.equal(f.syncs.length, 1);
  f.advance(DAY); f.setFailure(false); assert.equal(await f.run(), true); assert.equal(f.syncs.length, 2);
});

test("missing API configuration and database outages are harmless to the workspace", async t => {
  configured(t); const missing = fixture(); process.env.STEAM_API_KEY = " ";
  assert.equal(await missing.run(), false); assert.equal(missing.queries, 0);
  process.env.STEAM_API_KEY = "mock-only-steam-key";
  const offline = fixture(); offline.failDatabase(); assert.equal(await offline.run(), false); assert.equal(offline.syncs.length, 0);
});

test("workspace rendering schedules work after response without awaiting Steam or reading cookies later", async () => {
  const callbacks = [], syncs = [];
  let release, cookieReads = 0, phase = "render";
  const pending = new Promise(resolve => { release = resolve; });
  const page = loader({
    "next/server": { connection: async () => {}, after: work => { callbacks.push(work); } },
    "@/lib/player": { getCurrentPlayer: async () => ({ id: "owner", isLocal: false, isAdmin: false }) },
    "@/lib/auth-session": { readSessionHash: async () => { assert.equal(phase, "render"); cookieReads++; return "session-token-hash"; } },
    "@/lib/steam-auto-sync": { autoSyncSteamLibrary: async (...args) => { syncs.push(args); return pending; } },
  }, true)("src/app/page.tsx");
  const tree = await page.testWorkspace();
  assert(tree); assert.equal(cookieReads, 1); assert.equal(callbacks.length, 1); assert.equal(syncs.length, 0); assert.equal(page.maxDuration, 60);
  phase = "after"; const background = callbacks[0](); assert.deepEqual(syncs, [["owner", "session-token-hash"]]);
  release(true); await background;
});

test("anonymous and read-only local workspaces do not schedule automatic sync", async () => {
  for (const player of [null, { id: "default-player", isLocal: true, isAdmin: false }]) {
    const page = loader({
      "next/server": { connection: async () => {}, after: () => assert.fail("No automatic work expected") },
      "@/lib/player": { getCurrentPlayer: async () => player },
      "@/lib/auth-session": { readSessionHash: async () => assert.fail("No extra session read expected") },
    }, true)("src/app/page.tsx");
    assert(await page.testWorkspace());
  }
});
