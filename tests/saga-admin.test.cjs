/* eslint-disable @typescript-eslint/no-require-imports -- Exercise real actions and admin guard with isolated session/database boundaries. */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");

function loader(mocks) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.resolve(__dirname, "..", file), instance = new Module(filename, module);
    instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = name => name === "server-only" ? {} : Object.hasOwn(mocks, name) ? mocks[name]
      : name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`) : original(name);
    instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, filename);
    cache.set(file, instance.exports); return instance.exports;
  }
  return load;
}

function fixture({ admin = false, active = true, status = "hit", localFallback = false, providerRetry = undefined } = {}) {
  class AuthenticationRequiredError extends Error {
    constructor() { super("Sign in"); this.name = "AuthenticationRequiredError"; }
  }
  const state = { admin, active, onResolve: () => {}, onInspect: () => {}, stale: false };
  const calls = { reads: 0, resolutions: 0, inspections: 0, writes: 0, forced: [] };
  const members = [
    { id: 1, title: "Saga One", releaseYear: 2000, chronologicalOrder: null },
    { id: 2, title: "Saga Two", releaseYear: 2005, chronologicalOrder: null },
  ].map(game => ({ ...game, franchise: "Test Saga", status: "Backlog" }));
  const snapshot = {
    status, source: "igdb+gemini", updatedAt: new Date(Date.now() - 60000).toISOString(),
    canonicalGames: members.map((game, index) => ({ title: game.title, releaseYear: game.releaseYear, chronologicalRank: index + 1 })),
    geminiError: "PRIVATE provider diagnostic",
    geminiPayload: { candidates: [], requestBody: "PRIVATE exact request", rawResponse: "PRIVATE raw response", rawTimeline: "PRIVATE raw timeline" },
  };
  const getAuthenticatedPlayerId = async () => {
    if (!state.active) throw new AuthenticationRequiredError();
    return "owner";
  };
  const prisma = {
    playerSession: { findUnique: async ({ where, select }) => {
      assert.equal(where.tokenHash, "verified-token-hash");
      assert(where.expiresAt.gt instanceof Date);
      assert.deepEqual(where.player, { email: { not: null }, passwordHash: { not: null } });
      assert.deepEqual(select, { player: { select: { id: true, isAdmin: true, isOwner: true } } });
      return state.active ? { player: { id: "owner", isAdmin: state.admin } } : null;
    } },
    game: {
      findMany: async ({ where }) => { assert.deepEqual(where, { userId: "owner" }); calls.reads++; return members; },
      update: args => args,
    },
    $transaction: async jobs => {
      if (state.stale) throw new Error("Concurrent edit");
      for (const { where, data } of jobs) {
        assert.equal(where.userId, "owner"); calls.writes++;
        members.find(game => game.id === where.id).chronologicalOrder = data.chronologicalOrder;
      }
    },
  };
  const load = loader({
    "next/cache": { revalidatePath() {} },
    "@/lib/prisma": { prisma },
    "@/lib/player": { AuthenticationRequiredError, getAuthenticatedPlayerId },
    "@/lib/auth-session": { readSessionHash: async () => state.active ? "verified-token-hash" : null },
    "@/lib/saga-chronology-cache": {
      FRANCHISE_REFRESH_COOLDOWN_MS: 300000,
      inspectSagaChronologyCache: async () => { calls.inspections++; state.onInspect(); return snapshot; },
      resolveCachedSagaChronology: async (_name, _games, _provider, options) => {
        calls.resolutions++; calls.forced.push(options.forceRefresh); state.onResolve();
        return { debug: snapshot, localFallback, retryAfterSeconds: providerRetry };
      },
    },
    "@/lib/library-vault": {}, "@/lib/achievements": {}, "@/lib/rawg": {}, "@/lib/recommendations": {}, "@/lib/saga-lore": {},
  });
  const actions = load("src/app/actions.ts");
  const key = load("src/lib/sagas.ts").buildSagaChains(members).chains[0].key;
  return { state, calls, members, snapshot, inspect: () => actions.getSagaChronologyDebug(key), run: force => actions.autoDetectSagaOrder(key, force) };
}

function assertNoDiagnostics(result) {
  assert(!Object.hasOwn(result, "debug"), "Diagnostics must be omitted entirely");
  assert(!JSON.stringify(result).includes("PRIVATE"));
  for (const key of Object.keys(result)) {
    assert(["updatedCount", "message", "retryAfterSeconds", "refreshRetryAfterSeconds"].includes(key), `Unexpected response field: ${key}`);
  }
}

test("anonymous, expired/revoked sessions and regular users cannot inspect or force refresh", async () => {
  for (const settings of [{ active: false }, { active: false, admin: true }, { admin: false }]) {
    const f = fixture(settings);
    for (const result of [await f.inspect(), await f.run(true)]) {
      assert.match(result.error, settings.active === false ? /Sign in/ : /Admin access required/);
      assert(!Object.hasOwn(result, "debug"));
    }
    assert.deepEqual(f.calls, { reads: 0, resolutions: 0, inspections: 0, writes: 0, forced: [] });
  }
});

test("regular scans preserve ordering and provider/refresh cooldowns while omitting all diagnostics on every success path", async () => {
  for (const settings of [
    {}, { status: "miss" }, { status: "refreshed" },
    { status: "refresh-deferred", providerRetry: 17 },
    { status: "fallback", localFallback: true },
  ]) {
    const f = fixture(settings), result = await f.run();
    assert.equal(result.updatedCount, 2); assertNoDiagnostics(result);
    assert.deepEqual(f.members.map(game => game.chronologicalOrder), [1, 2]);
    assert.equal(f.calls.writes, 2); assert.deepEqual(f.calls.forced, [false]);
    if (settings.status === "refresh-deferred") {
      assert.equal(result.retryAfterSeconds, 17);
      assert(result.refreshRetryAfterSeconds >= 239 && result.refreshRetryAfterSeconds <= 240);
    } else assert.equal(result.refreshRetryAfterSeconds, 0);
  }
});

test("authenticated admins retain inspection, normal scan diagnostics and forced refresh", async () => {
  const f = fixture({ admin: true });
  assert.equal((await f.inspect()).debug.canonicalGames.length, 2);
  assert.equal(f.calls.writes, 0); assert.equal(f.calls.resolutions, 0);
  for (const force of [false, true]) {
    const result = await f.run(force);
    assert.equal(result.updatedCount, 2);
    assert.equal(result.debug.geminiPayload.rawResponse, "PRIVATE raw response");
    assert.equal(result.debug.mappings.length, 2);
  }
  assert.deepEqual(f.calls.forced, [false, true]);
});

test("demotion during a scan strips normal diagnostics and denies forced saves and inspection results", async () => {
  const normal = fixture({ admin: true });
  normal.state.onResolve = () => { normal.state.admin = false; };
  const result = await normal.run();
  assert.equal(result.updatedCount, 2); assertNoDiagnostics(result);
  const forced = fixture({ admin: true });
  forced.state.onResolve = () => { forced.state.admin = false; };
  assert.match((await forced.run(true)).error, /Admin access required/);
  assert.equal(forced.calls.writes, 0);
  const inspection = fixture({ admin: true });
  inspection.state.onInspect = () => { inspection.state.admin = false; };
  assert.match((await inspection.inspect()).error, /Admin access required/);
});

test("logout during a slow scan prevents saves and debug responses; concurrent edits also return no diagnostics", async () => {
  for (const admin of [false, true]) {
    const f = fixture({ admin });
    f.state.onResolve = () => { f.state.active = false; };
    const result = await f.run();
    assert.match(result.error, /Sign in/); assert(!Object.hasOwn(result, "debug"));
    assert.equal(f.calls.writes, 0);
  }
  const f = fixture({ admin: true }); f.state.stale = true;
  const result = await f.run();
  assert.match(result.error, /saga changed/); assert(!Object.hasOwn(result, "debug"));
});
