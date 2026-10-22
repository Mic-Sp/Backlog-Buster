/* eslint-disable @typescript-eslint/no-require-imports -- Serialized rollback fixtures exercise real admin guards without a live database. */
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
  class AuthenticationRequiredError extends Error { constructor() { super("Sign in"); this.name = "AuthenticationRequiredError"; } }
  let db = {
    players: [
      { id: "a", email: "a@test.com", passwordHash: "hash-a", isAdmin: true, isOwner: true },
      { id: "b", email: "b@test.com", passwordHash: "hash-b", isAdmin: true, isOwner: false },
      { id: "member", email: "member@test.com", passwordHash: "hash-member", isAdmin: false, isOwner: false },
      { id: "default-player", email: null, passwordHash: null, isAdmin: false, isOwner: false },
    ],
    sessions: [
      ...["a", "b", "member", "member"].map((userId, index) => ({ id: index, userId, expiresAt: new Date(Date.now() + 600000) })),
      ...["a", "member", "b"].map((userId, index) => ({ id: index + 4, userId, expiresAt: new Date(index === 2 ? Date.now() : 0) })),
    ], games: [{ userId: "member" }], achievements: [{ userId: "member" }],
  };
  const initial = structuredClone(db), calls = { transactions: 0, deletes: [], updates: [], paths: [] };
  const state = { onLock: () => {}, failRevocation: false, failUpdate: false, adminCount: null };
  const matches = (player, where) => player.id === where.id && player.email !== null && player.passwordHash !== null && (where.isAdmin === undefined || player.isAdmin === where.isAdmin);
  const tx = {
    $executeRaw: async sql => { assert.match(sql.join(""), /backlogbuster-account-registration/); state.onLock(); },
    player: {
      findUnique: async ({ where, select }) => {
        assert.deepEqual(where.AND, [{ email: { not: null }, passwordHash: { not: null } }]);
        assert.deepEqual(select, { id: true, email: true, isAdmin: true, isOwner: true });
        const player = db.players.find(p => matches(p, where));
        return player ? Object.fromEntries(Object.keys(select).map(key => [key, player[key]])) : null;
      },
      count: async ({ where }) => {
        assert.deepEqual(where, { email: { not: null }, passwordHash: { not: null }, isAdmin: true });
        return state.adminCount ?? db.players.filter(p => p.isAdmin && p.email !== null && p.passwordHash !== null).length;
      },
      update: async ({ where, data, select }) => {
        assert.deepEqual(Object.keys(data), ["isAdmin"]); assert.deepEqual(select, { id: true });
        const player = db.players.find(p => matches(p, where));
        if (!player || state.failUpdate) throw Object.assign(Error("PRIVATE stale record"), { code: "P2025" });
        calls.updates.push({ where, data }); Object.assign(player, data); return { id: player.id };
      },
    },
    playerSession: { deleteMany: async ({ where }) => {
      if (state.failRevocation) throw Error("PRIVATE deletion failure");
      calls.deletes.push(where);
      const matches = session => (!where.userId || session.userId === where.userId) && (!where.expiresAt ||
        (where.expiresAt.gt ? session.expiresAt > where.expiresAt.gt : session.expiresAt <= where.expiresAt.lte));
      const removed = db.sessions.filter(matches); db.sessions = db.sessions.filter(s => !matches(s));
      return { count: removed.length };
    } },
  };
  let tail = Promise.resolve();
  const prisma = {
    playerSession: { findUnique: async ({ where }) => {
      assert(where.expiresAt.gt instanceof Date); assert.deepEqual(where.player, { email: { not: null }, passwordHash: { not: null } });
      const player = db.players.find(p => p.id === where.tokenHash);
      const session = db.sessions.find(s => s.userId === where.tokenHash && s.expiresAt > where.expiresAt.gt);
      return player && session ? { player: { id: player.id, isAdmin: player.isAdmin, isOwner: player.isOwner } } : null;
    } },
    $transaction: async (work, options) => {
      assert.equal(options.timeout, 15000); calls.transactions++;
      const previous = tail; let release; tail = new Promise(resolve => { release = resolve; });
      await previous; const before = structuredClone(db);
      try { return await work(tx); } catch (error) { db = before; throw error; } finally { release(); }
    },
  };
  const actions = (actor = "a") => loader({
    "@/lib/prisma": { prisma }, "@/lib/player": { AuthenticationRequiredError },
    "@/lib/auth-session": { readSessionHash: async () => actor },
    "next/cache": { revalidatePath: (...args) => calls.paths.push(args) },
  })("src/app/admin-actions.ts");
  return { actions, state, calls, initial, get db() { return db; } };
}

test("all new actions reject non-admin and missing/revoked sessions before mutation", async () => {
  for (const actor of ["member", null, "missing"]) {
    const f = fixture(), a = f.actions(actor);
    for (const result of [await a.adminRevokePlayerSessions("b"), await a.adminPruneExpiredSessions(), await a.adminSetPlayerAdmin("member", true)]) {
      assert.match(result.error, actor === "member" ? /Admin access required/ : /Sign in/);
    }
    assert.equal(f.calls.transactions, 0); assert.deepEqual(f.db, f.initial);
  }
});

test("force sign-out revokes only the target's active sessions, preserves credentials and safely rejects self", async () => {
  const f = fixture(), a = f.actions();
  assert.deepEqual(await a.adminRevokePlayerSessions("member"), { success: true, revokedCount: 2 });
  assert.deepEqual(f.db.players, f.initial.players); assert.deepEqual(f.db.games, f.initial.games);
  assert(f.db.sessions.some(s => s.userId === "member" && s.expiresAt.getTime() === 0), "Expired rows remain for pruning");
  assert.deepEqual(f.db.sessions.filter(s => s.userId !== "member"), f.initial.sessions.filter(s => s.userId !== "member"));
  assert.deepEqual(await a.adminRevokePlayerSessions("member"), { success: true, revokedCount: 0 });
  assert.match((await a.adminRevokePlayerSessions("a")).error, /own session/);
  assert.deepEqual(await a.adminRevokePlayerSessions("b"), { success: true, revokedCount: 1 });
  assert.match((await f.actions("b").adminPruneExpiredSessions()).error, /Sign in/);
});

test("pruning removes expired rows across accounts, including the expiry boundary, while retaining active sessions", async () => {
  const f = fixture(), a = f.actions();
  assert.deepEqual(await a.adminPruneExpiredSessions(), { success: true, deletedCount: 3 });
  assert.equal(f.db.sessions.length, 4); assert(f.db.sessions.every(s => s.expiresAt > new Date()));
  assert.deepEqual(await a.adminPruneExpiredSessions(), { success: true, deletedCount: 0 });
  assert.deepEqual(f.db.players, f.initial.players); assert.deepEqual(f.db.achievements, f.initial.achievements);
});

test("promotion/demotion persist roles, revoke target sessions and are idempotent without changing the caller", async () => {
  const f = fixture(), a = f.actions();
  assert.deepEqual(await a.adminSetPlayerAdmin("member", true), { success: true, isAdmin: true, changed: true });
  assert(f.db.players.find(p => p.id === "member").isAdmin); assert(f.db.sessions.every(s => s.userId !== "member"));
  assert.equal(f.db.players.find(p => p.id === "member").passwordHash, "hash-member");
  assert.deepEqual(await a.adminSetPlayerAdmin("member", true), { success: true, isAdmin: true, changed: false });
  assert.equal(f.calls.updates.length, 1);
  assert.deepEqual(await a.adminSetPlayerAdmin("b", false), { success: true, isAdmin: false, changed: true });
  assert.equal(f.db.players.find(p => p.id === "b").isAdmin, false);
  assert(f.db.sessions.some(s => s.userId === "a" && s.expiresAt > new Date()));
  assert.match((await a.adminSetPlayerAdmin("a", false)).error, /own active admin/);
  assert.match((await a.adminSetPlayerAdmin("a", true)).error, /Owner account is protected/);
});

test("unclaimed/missing accounts and malformed IDs/roles are rejected; last-admin defense prevents demotion", async () => {
  const f = fixture(), a = f.actions();
  for (const id of ["default-player", "missing", "", " ", null, {}, "x".repeat(129)]) {
    assert.equal(typeof (await a.adminRevokePlayerSessions(id)).error, "string");
    assert.equal(typeof (await a.adminSetPlayerAdmin(id, true)).error, "string");
  }
  for (const role of [null, undefined, "false", 0, {}]) assert.match((await a.adminSetPlayerAdmin("member", role)).error, /valid admin role/);
  f.state.adminCount = 1; assert.match((await a.adminSetPlayerAdmin("b", false)).error, /At least one/);
  assert.deepEqual(f.db, f.initial);
});

test("competing admins cannot demote one another and leave zero admins", async () => {
  const f = fixture(), a = f.actions("a"), b = f.actions("b");
  const results = await Promise.all([a.adminSetPlayerAdmin("b", false), b.adminSetPlayerAdmin("a", false)]);
  assert.equal(results.filter(r => r.success).length, 1); assert.equal(results.filter(r => r.error).length, 1);
  assert.equal(f.db.players.filter(p => p.isAdmin).length, 1);
});

test("authorization is rechecked after lock waits and role/session mutations roll back together on failure", async () => {
  for (const run of [a => a.adminRevokePlayerSessions("member"), a => a.adminPruneExpiredSessions(), a => a.adminSetPlayerAdmin("member", true)]) {
    const f = fixture(); f.state.onLock = () => { f.db.players.find(p => p.id === "a").isAdmin = false; };
    assert.match((await run(f.actions())).error, /Admin access required/);
    const broken = fixture(); broken.state.failRevocation = true;
    const result = await run(broken.actions());
    assert.equal(typeof result.error, "string"); assert(!JSON.stringify(result).includes("PRIVATE")); assert.deepEqual(broken.db, broken.initial);
  }
  const f = fixture(); f.state.failUpdate = true;
  assert.match((await f.actions().adminSetPlayerAdmin("member", true)).error, /unavailable or changed/); assert.deepEqual(f.db, f.initial);
});

test("self-service account wipe cannot delete an admin or a player promoted after credential verification", async () => {
  for (const alreadyAdmin of [true, false]) {
    let attempted = false;
    const load = loader({
      "@/lib/account-security": {
        getCredentialSession: async () => ({ player: { id: "a", email: "a@test.com", passwordHash: "hash", isAdmin: alreadyAdmin }, tokenHash: "live" }),
        consumeCredentialAttempt: async () => 0,
      },
      "@/lib/auth-crypto": { verifyPassword: async () => true },
      "@/lib/auth-session": {}, "next/cache": {},
      "@/lib/prisma": { prisma: { $transaction: async work => work({
        $executeRaw: async () => {}, playerSession: { findUnique: async () => ({ tokenHash: "live" }) },
        player: { delete: async ({ where }) => { attempted = true; assert.equal(where.isAdmin, false); throw { code: "P2025" }; } },
      }) } },
    });
    const form = new FormData(); form.set("currentPassword", "password"); form.set("confirmation", "WIPE ARCHIVE");
    const result = await load("src/app/security-actions.ts").wipeOperatorAccount(form);
    assert.equal(typeof result.error, "string"); assert.equal(attempted, !alreadyAdmin);
    if (alreadyAdmin) assert.match(result.error, /demoted by the Owner/);
  }
});

