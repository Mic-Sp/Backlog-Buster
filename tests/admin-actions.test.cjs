/* eslint-disable @typescript-eslint/no-require-imports -- Mock database/session boundaries; never purge live caches. */
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

function fixture() {
  class AuthenticationRequiredError extends Error {
    constructor() { super("Sign in"); this.name = "AuthenticationRequiredError"; }
  }
  const state = { active: true, admin: true, fail: false, onRead: () => {} };
  const calls = { queries: 0, aggregates: 0, deletes: [], refreshes: [] };
  const players = [
    { id: "owner", operatorName: "Admin", handle: "admin", email: "admin@example.com", passwordHash: "PRIVATE_HASH", isAdmin: true, isOwner: true, createdAt: new Date("2020-02-01Z"), updatedAt: new Date("2020-03-01Z") },
    { id: "member", operatorName: "Member", handle: null, email: "member@example.com", passwordHash: "PRIVATE_HASH", isAdmin: false, isOwner: false, createdAt: new Date("2020-01-01Z"), updatedAt: new Date("2020-01-02Z") },
    { id: "default-player", email: null, passwordHash: null, isAdmin: false },
  ];
  const caches = [{ slug: "saga-one" }, { slug: "saga-two" }];
  function read() { calls.queries++; if (state.fail) throw new Error("PRIVATE database connection secret"); state.onRead(); }
  function registered(where) {
    assert.deepEqual({ email: where.email, passwordHash: where.passwordHash }, { email: { not: null }, passwordHash: { not: null } });
    return players.filter(player => player.email !== null && player.passwordHash !== null && (!where.isAdmin || player.isAdmin));
  }
  function group(rows, fields) {
    return async args => {
      read(); calls.aggregates++;
      assert.deepEqual(args.by, ["userId"]);
      const ids = args.where.userId.in;
      assert(ids.every(id => id === "owner" || id === "member"));
      assert.deepEqual(Object.keys(args).sort(), ["by", "where", ...fields].sort());
      if (fields.includes("_max")) assert.deepEqual(Object.keys(args._max), [fields.includes("_sum") && !fields.includes("_count") ? "unlockedAt" : "createdAt"]);
      return rows.filter(row => ids.includes(row.userId));
    };
  }
  const prisma = {
    playerSession: {
      findUnique: async ({ where }) => {
        assert.equal(where.tokenHash, "verified-hash"); assert(where.expiresAt.gt instanceof Date);
        assert.deepEqual(where.player, { email: { not: null }, passwordHash: { not: null } });
        return state.active ? { player: { id: "owner", isAdmin: state.admin } } : null;
      },
      groupBy: async args => {
        if (args._count) {
          assert(args.where.expiresAt.gt instanceof Date);
          return group([{ userId: "owner", _count: { _all: 2 } }], ["_count"])(args);
        }
        return group([{ userId: "owner", _max: { createdAt: new Date("2020-06-01Z") } }], ["_max"])(args);
      },
    },
    player: {
      count: async ({ where }) => { read(); return registered(where).length; },
      findMany: async ({ where, select, skip, take, orderBy }) => {
        read();
        assert.deepEqual(Object.keys(select).sort(), ["id", "operatorName", "handle", "email", "isAdmin", "isOwner", "createdAt", "updatedAt"].sort());
        assert.deepEqual(orderBy, [{ createdAt: "desc" }, { id: "asc" }]);
        return registered(where).slice(skip, skip + take);
      },
    },
    game: {
      count: async () => { read(); return 9; },
      groupBy: group([{ userId: "owner", _count: { _all: 3 }, _sum: { earnedXp: 1250 }, _max: { createdAt: new Date("2020-04-01Z") } }], ["_count", "_sum", "_max"]),
    },
    userAchievement: { groupBy: group([{ userId: "owner", _sum: { xpAwarded: 100 }, _max: { unlockedAt: new Date("2020-07-01Z") } }], ["_sum", "_max"]) },
    franchiseChronology: {
      count: async () => { read(); return caches.length; },
      deleteMany: async ({ where }) => {
        read(); calls.deletes.push(where);
        const matching = caches.filter(row => !where.slug || row.slug === where.slug);
        for (const row of matching) caches.splice(caches.indexOf(row), 1);
        return { count: matching.length };
      },
    },
    $transaction: async (work, options) => { assert.deepEqual(options, { isolationLevel: "RepeatableRead" }); return work(prisma); },
  };
  const load = loader({
    "@/lib/prisma": { prisma },
    "@/lib/player": { AuthenticationRequiredError },
    "@/lib/auth-session": { readSessionHash: async () => state.active ? "verified-hash" : null },
    "next/cache": { revalidatePath: (...args) => calls.refreshes.push(args) },
  });
  return { actions: load("src/app/admin-actions.ts"), state, calls, caches };
}

test("every admin action rejects missing/revoked sessions and regular accounts before reading telemetry or deleting caches", async () => {
  for (const state of [{ active: false }, { admin: false }]) {
    const f = fixture(); Object.assign(f.state, state);
    for (const result of [await f.actions.getAdminSystemOverview(), await f.actions.getAdminPlayerDirectory(), await f.actions.purgeSagaChronologyCache({ kind: "all" })]) {
      assert.match(result.error, state.active === false ? /Sign in/ : /Admin access required/);
    }
    assert.equal(f.calls.queries, 0); assert.equal(f.calls.deletes.length, 0); assert.equal(f.caches.length, 2);
  }
});

test("overview counts registered accounts, all tracked games and saga caches without returning private records", async () => {
  const f = fixture();
  assert.deepEqual(await f.actions.getAdminSystemOverview(), { registeredAccountCount: 2, adminAccountCount: 1, trackedGameCount: 9, cachedSagaCount: 2 });
});

test("directory serializes safe paginated summaries, includes achievement XP, and handles accounts without games/sessions", async () => {
  const f = fixture(), result = await f.actions.getAdminPlayerDirectory();
  assert.deepEqual({ page: result.page, pageSize: result.pageSize, totalCount: result.totalCount, pageCount: result.pageCount }, { page: 1, pageSize: 50, totalCount: 2, pageCount: 1 });
  assert.equal(result.players.length, 2);
  const [admin, member] = result.players;
  assert.deepEqual(admin, {
    id: "owner", operatorName: "Admin", handle: "admin", email: "admin@example.com", isAdmin: true, isOwner: true,
    gameCount: 3, totalXp: 1350, level: 3, activeSessionCount: 2,
    createdAt: "2020-02-01T00:00:00.000Z", updatedAt: "2020-03-01T00:00:00.000Z",
    latestSessionAt: "2020-06-01T00:00:00.000Z", lastRecordedActivityAt: "2020-07-01T00:00:00.000Z",
  });
  assert.equal(member.gameCount, 0); assert.equal(member.totalXp, 0); assert.equal(member.level, 1);
  assert.equal(member.activeSessionCount, 0);
  assert.equal(member.latestSessionAt, null); assert.equal(member.lastRecordedActivityAt, member.updatedAt);
  const serialized = JSON.stringify(result);
  for (const value of ["PRIVATE", "passwordHash", "tokenHash", "accessToken", "expiresAt"]) assert(!serialized.includes(value));
  const next = await f.actions.getAdminPlayerDirectory(2, 1);
  assert.equal(next.players.length, 1); assert.equal(next.players[0].id, "member"); assert.equal(next.pageCount, 2);
  const before = f.calls.aggregates;
  assert.deepEqual((await f.actions.getAdminPlayerDirectory(3, 1)).players, []);
  assert.equal(f.calls.aggregates, before, "Empty pages skip aggregates");
});

test("invalid pagination and malformed purge requests fail validation without database access", async () => {
  const f = fixture();
  for (const args of [[0], [-1], [1.5], [NaN], [1, 0], [1, 101], [1, "50"], [Infinity], [Number.MAX_SAFE_INTEGER, 100], [100000000, 100]]) {
    assert.match((await f.actions.getAdminPlayerDirectory(...args)).error, /valid directory page/);
  }
  for (const scope of [undefined, null, [], {}, "all", { kind: "unknown" }, { kind: "saga" }, { kind: "saga", slug: "" }, { kind: "saga", slug: "Test Saga" }, { kind: "saga", slug: "x".repeat(241) }, { kind: "saga", slug: { not: "" } }]) {
    assert.equal(typeof (await f.actions.purgeSagaChronologyCache(scope)).error, "string");
  }
  assert.equal(f.calls.queries, 0); assert.equal(f.calls.deletes.length, 0);
});

test("cache maintenance deletes only the specified public chronology records, is idempotent, and revalidates UI", async () => {
  const f = fixture();
  assert.deepEqual(await f.actions.purgeSagaChronologyCache({ kind: "saga", slug: "saga-one" }), { success: true, deletedCount: 1 });
  assert.deepEqual(f.caches, [{ slug: "saga-two" }]);
  assert.deepEqual(await f.actions.purgeSagaChronologyCache({ kind: "saga", slug: "saga-one" }), { success: true, deletedCount: 0 });
  assert.deepEqual(await f.actions.purgeSagaChronologyCache({ kind: "all" }), { success: true, deletedCount: 1 });
  assert.deepEqual(await f.actions.purgeSagaChronologyCache({ kind: "all" }), { success: true, deletedCount: 0 });
  assert.deepEqual(f.calls.deletes, [{ slug: "saga-one" }, { slug: "saga-one" }, {}, {}]);
  assert(f.calls.refreshes.every(args => args[0] === "/" && args[1] === "layout"));
});

test("database errors are sanitized and demotion/revocation during telemetry reads discards sensitive results", async () => {
  const f = fixture(); f.state.fail = true;
  for (const result of [await f.actions.getAdminSystemOverview(), await f.actions.getAdminPlayerDirectory(), await f.actions.purgeSagaChronologyCache({ kind: "all" })]) {
    assert.equal(typeof result.error, "string"); assert(!JSON.stringify(result).includes("PRIVATE"));
  }
  for (const action of ["getAdminSystemOverview", "getAdminPlayerDirectory"]) {
    for (const change of [{ admin: false }, { active: false }]) {
      const slow = fixture(); slow.state.onRead = () => Object.assign(slow.state, change);
      const result = await slow.actions[action]();
      assert.match(result.error, change.active === false ? /Sign in/ : /Admin access required/);
      assert(!Object.hasOwn(result, "players")); assert(!Object.hasOwn(result, "registeredAccountCount"));
    }
  }
});
