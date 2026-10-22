/* eslint-disable @typescript-eslint/no-require-imports -- Rollback-only database fixtures; never alter live accounts. */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.resolve(__dirname, "..", file), instance = new Module(filename, module);
    instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = name => name === "server-only" ? {} : Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`) : original(name);
    instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
    cache.set(file, instance.exports); return instance.exports;
  }
  return load;
}
const crypto = loader()("src/lib/auth-crypto.ts");

function fixture({ realHash = false, owner = false } = {}) {
  class AuthenticationRequiredError extends Error { constructor() { super("Sign in"); this.name = "AuthenticationRequiredError"; } }
  const state = { active: true, admin: true, failRevocation: false, failDelete: false, failUpdateCode: null, onHash: () => {}, onLock: () => {}, onDelete: () => {} };
  const actorId = owner ? "primary-owner" : "admin";
  let db = {
    players: [
      { id: "primary-owner", email: "primary@example.com", passwordHash: "owner-hash", isAdmin: true, isOwner: true, handle: "primary" },
      { id: "admin", email: "admin@example.com", passwordHash: "old-admin-hash", isAdmin: true, isOwner: false, handle: "main" },
      { id: "member", email: "member@example.com", passwordHash: "old-member-hash", isAdmin: false, isOwner: false, handle: "test-user" },
      { id: "other-admin", email: "other@example.com", passwordHash: "old-other-hash", isAdmin: true, isOwner: false, handle: null },
      { id: "default-player", email: null, passwordHash: null, isAdmin: false, isOwner: false, handle: null },
    ],
    sessions: ["primary-owner", "admin", "member", "member", "other-admin"].map((userId, id) => ({ userId, id, expiresAt: new Date(Date.now() + 600000) })),
    games: ["member", "admin"].map(userId => ({ userId })), achievements: [{ userId: "member" }],
    cache: [{ slug: "public-saga" }], bootstrap: { id: "initial-admin-v1" },
  };
  const initial = structuredClone(db), calls = { hashes: [], transactions: 0, writes: 0, paths: [] };
  function target(where) {
    assert.deepEqual(where.AND, [{ email: { not: null }, passwordHash: { not: null } }]);
    return db.players.find(p => p.id === where.id && p.email !== null && p.passwordHash !== null && (where.isAdmin === undefined || p.isAdmin === where.isAdmin) && (where.email === undefined || p.email === where.email));
  }
  const missing = () => { throw Object.assign(new Error("PRIVATE record missing"), { code: "P2025" }); };
  const tx = {
    $executeRaw: async strings => { assert.match(strings.join(""), /backlogbuster-account-registration/); state.onLock(); },
    player: {
      findUnique: async ({ where, select }) => {
        assert.deepEqual(select, { id: true, email: true, isAdmin: true, isOwner: true });
        const p = target(where); return p ? Object.fromEntries(Object.keys(select).map(key => [key, p[key]])) : null;
      },
      count: async () => db.players.filter(p => p.isAdmin && p.email && p.passwordHash).length,
      findFirst: async ({ where, select }) => {
        assert.deepEqual(select, { id: true }); assert.equal(where.email.mode, "insensitive");
        const literal = where.email.equals.replace(/\\([\\%_])/g, "$1");
        assert.equal(where.email.equals, literal.replace(/[\\%_]/g, "\\$&"), "Email pattern characters must be escaped");
        const p = db.players.find(player => player.id !== where.id.not && player.email?.toLowerCase() === literal.toLowerCase());
        return p ? { id: p.id } : null;
      },
      update: async ({ where, data, select }) => {
        assert.deepEqual(select, { id: true }); assert.equal(Object.keys(data).length, 1); assert(["passwordHash", "email", "isAdmin", "preferredLayoutMode"].includes(Object.keys(data)[0]));
        const p = target(where); if (!p) missing();
        if (state.failUpdateCode) throw Object.assign(new Error("PRIVATE update failed"), { code: state.failUpdateCode });
        if (data.email) assert.equal(where.email, p.email, "Email update guards the current credential snapshot");
        if (data.preferredLayoutMode) { assert.equal(where.isOwner, false); if (!owner) assert.equal(where.isAdmin, false); }
        calls.writes++; Object.assign(p, data); return { id: p.id };
      },
      delete: async ({ where, select }) => {
        assert.equal(where.isOwner, false); if (!owner) assert.equal(where.isAdmin, false); assert.deepEqual(select, { handle: true }); state.onDelete();
        const p = target(where); if (!p) missing(); if (state.failDelete) throw Error("PRIVATE delete failed"); calls.writes++;
        db.players = db.players.filter(row => row.id !== p.id);
        // Model the schema's ON DELETE CASCADE, rather than manual unrelated deletes.
        for (const table of ["sessions", "games", "achievements"]) db[table] = db[table].filter(row => row.userId !== p.id);
        return { handle: p.handle };
      },
    },
    playerSession: { deleteMany: async ({ where }) => {
      assert.deepEqual(Object.keys(where).sort(), ["userId", "player", ...(where.expiresAt ? ["expiresAt"] : [])].sort()); assert.equal(where.player.isOwner, false); if (state.failRevocation) throw Error("PRIVATE revocation failed");
      const before = db.sessions.length;
      db.sessions = db.sessions.filter(row => row.userId !== where.userId || (where.expiresAt && row.expiresAt <= where.expiresAt.gt));
      return { count: before - db.sessions.length };
    } },
  };
  const prisma = {
    playerSession: { findUnique: async ({ where }) => {
      assert(where.expiresAt.gt instanceof Date); assert.deepEqual(where.player, { email: { not: null }, passwordHash: { not: null } });
      return state.active && db.sessions.some(s => s.userId === actorId) ? { player: { id: actorId, isAdmin: state.admin, isOwner: owner } } : null;
    } },
    $transaction: async (work, options) => {
      assert.equal(options.timeout, 15000); calls.transactions++; const before = structuredClone(db);
      try { return await work(tx); } catch (error) { db = before; throw error; }
    },
  };
  const load = loader({
    "@/lib/prisma": { prisma }, "@/lib/player": { AuthenticationRequiredError },
    "@/lib/auth-session": { readSessionHash: async () => state.active ? "verified" : null },
    "@/lib/auth-crypto": { hashPassword: async password => { calls.hashes.push(password); state.onHash(); return realHash ? crypto.hashPassword(password) : "new-private-hash"; } },
    "next/cache": { revalidatePath: (...args) => calls.paths.push(args) },
  });
  return { actions: load("src/app/admin-actions.ts"), state, calls, initial, get db() { return db; } };
}

test("account actions reject regular users and missing/revoked admin sessions before hashing or mutations", async () => {
  for (const change of [{ active: false }, { admin: false }]) {
    const f = fixture(); Object.assign(f.state, change);
    for (const result of [await f.actions.adminResetPlayerPassword("member", "new password"), await f.actions.adminDeletePlayerAccount("member"), await f.actions.adminUpdatePlayerEmail("member", "new@example.com")]) {
      assert.match(result.error, change.active === false ? /Sign in/ : /Admin access required/);
    }
    assert.equal(f.calls.transactions, 0); assert.equal(f.calls.hashes.length, 0); assert.deepEqual(f.db, f.initial);
  }
});

test("reset uses the actual shared scrypt implementation, preserves password characters, and revokes only target sessions", async () => {
  const f = fixture({ realHash: true }), password = " exact new password ";
  assert.deepEqual(await f.actions.adminResetPlayerPassword("member", password), { success: true });
  const hash = f.db.players.find(p => p.id === "member").passwordHash;
  assert.match(hash, /^scrypt\$131072\$8\$1\$/);
  assert(await crypto.verifyPassword(password, hash)); assert.equal(await crypto.verifyPassword(password.trim(), hash), false);
  assert.deepEqual(f.calls.hashes, [password]);
  assert(f.db.sessions.every(s => s.userId !== "member"));
  assert.deepEqual(f.db.sessions, f.initial.sessions.filter(s => s.userId !== "member"));
  assert.deepEqual(f.db.games, f.initial.games); assert.deepEqual(f.db.achievements, f.initial.achievements);
});

test("password validation matches auth/security rules at the boundaries and rejects malformed target IDs", async () => {
  const f = fixture();
  for (const password of [undefined, null, 12345678, {}, "", "short", " ".repeat(8), "\t\n".repeat(8), "x".repeat(129)]) {
    assert.match((await f.actions.adminResetPlayerPassword("member", password)).error, /8–128/);
  }
  for (const id of [null, undefined, {}, "", "  ", "x".repeat(129)]) {
    assert.equal(typeof (await f.actions.adminResetPlayerPassword(id, "new password")).error, "string");
    assert.equal(typeof (await f.actions.adminDeletePlayerAccount(id)).error, "string");
  }
  assert.equal(f.calls.hashes.length, 0); assert.equal(f.calls.transactions, 0);
  for (const password of ["x".repeat(8), "x".repeat(128), "       x"]) {
    assert.deepEqual(await f.actions.adminResetPlayerPassword("member", password), { success: true });
    assert.equal(f.calls.hashes.at(-1), password);
  }
});

test("reset rolls back its hash when session revocation fails, and rejects missing/unclaimed accounts", async () => {
  const f = fixture(); f.state.failRevocation = true;
  const failed = await f.actions.adminResetPlayerPassword("member", "new password");
  assert.equal(typeof failed.error, "string"); assert(!JSON.stringify(failed).includes("PRIVATE")); assert.deepEqual(f.db, f.initial);
  f.state.failRevocation = false;
  for (const id of ["missing", "default-player"]) {
    assert.match((await f.actions.adminResetPlayerPassword(id, "new password")).error, /existing registered/);
    assert.deepEqual(f.db, f.initial);
  }
});

test("deletion cascades target-owned data, preserves other accounts/shared state, and invalidates its public dossier", async () => {
  const f = fixture();
  assert.deepEqual(await f.actions.adminDeletePlayerAccount("member"), { success: true });
  assert(f.db.players.every(p => p.id !== "member"));
  for (const table of ["sessions", "games", "achievements"]) assert.deepEqual(f.db[table], f.initial[table].filter(row => row.userId !== "member"));
  assert.deepEqual(f.db.cache, f.initial.cache); assert.deepEqual(f.db.bootstrap, f.initial.bootstrap);
  assert.deepEqual(f.calls.paths, [["/", "layout"], ["/dossier/test-user"]]);
});

test("deletion blocks self, all other admins, missing accounts, unclaimed local archives and concurrent promotions", async () => {
  const f = fixture();
  for (const [id, pattern] of [["admin", /own active admin/], ["other-admin", /Only the Owner/], ["missing", /existing registered/], ["default-player", /local archives/]]) {
    assert.match((await f.actions.adminDeletePlayerAccount(id)).error, pattern); assert.deepEqual(f.db, f.initial);
  }
  f.state.onDelete = () => { f.db.players.find(p => p.id === "member").isAdmin = true; };
  assert.match((await f.actions.adminDeletePlayerAccount("member")).error, /unavailable or changed/);
  assert(f.db.players.some(p => p.id === "member")); assert.equal(f.calls.writes, 0);
});

test("admin authorization is rechecked after password hashing and lock waits, and failed deletion rolls back", async () => {
  for (const action of ["adminResetPlayerPassword", "adminDeletePlayerAccount"]) {
    for (const change of [{ active: false }, { admin: false }]) {
      const f = fixture(); f.state.onLock = () => Object.assign(f.state, change);
      assert.equal(typeof (await f.actions[action]("member", "new password")).error, "string"); assert.deepEqual(f.db, f.initial);
    }
  }
  const f = fixture(); f.state.onHash = () => { f.state.admin = false; };
  assert.match((await f.actions.adminResetPlayerPassword("member", "new password")).error, /Admin access required/); assert.deepEqual(f.db, f.initial);
  const broken = fixture(); broken.state.failDelete = true;
  const result = await broken.actions.adminDeletePlayerAccount("member");
  assert.equal(typeof result.error, "string"); assert(!JSON.stringify(result).includes("PRIVATE")); assert.deepEqual(broken.db, broken.initial);
});

test("claimed default-player is treated as a registered account and self-reset through admin tools is blocked", async () => {
  const claimed = fixture(), player = claimed.db.players.find(p => p.id === "default-player");
  player.email = "claimed@example.com"; player.passwordHash = "claimed-hash";
  assert.deepEqual(await claimed.actions.adminResetPlayerPassword("default-player", "new password"), { success: true });
  assert.deepEqual(await claimed.actions.adminDeletePlayerAccount("default-player"), { success: true });
  const self = fixture();
  assert.match((await self.actions.adminResetPlayerPassword("admin", "new password")).error, /Only the Owner/);
  assert.deepEqual(self.db, self.initial);
});

test("an in-flight login cannot create a session with credentials superseded by a password reset", async () => {
  let reset = false, created = 0;
  const load = loader({
    "next/cache": { revalidatePath() {} }, "next/navigation": { redirect: () => { throw new Error("redirect-success"); } },
    "@/lib/prisma": { prisma: { player: { findFirst: async () => ({ id: "member", email: "Member@Example.com", passwordHash: "verified-old-hash" }) } } },
    "@/lib/auth-crypto": { verifyPassword: async () => true },
    "@/lib/auth-session": {
      consumeAuthAttempt: async () => true,
      createPlayerSession: async (id, beforeCreate) => {
        assert.equal(id, "member");
        await beforeCreate({
          $executeRaw: async sql => assert.match(sql.join(""), /backlogbuster-account-registration/),
          player: { findUnique: async ({ where }) => { assert.deepEqual(where, { id: "member", email: "Member@Example.com", passwordHash: "verified-old-hash" }); return reset ? null : { id: "member" }; } },
        });
        created++;
      },
    },
  });
  const form = new FormData(); form.set("email", "member@example.com"); form.set("password", "old password");
  const { authenticate } = load("src/app/auth-actions.ts");
  reset = true;
  assert.match((await authenticate("login", {}, form)).error, /Credentials changed/); assert.equal(created, 0);
  reset = false;
  await assert.rejects(() => authenticate("login", {}, form), /redirect-success/); assert.equal(created, 1);
});

test("admin email changes persist normalized values and atomically revoke only the target's sessions", async () => {
  const f = fixture();
  const result = await f.actions.adminUpdatePlayerEmail("member", "  NEW.Address+tag@Example.COM  ");
  assert.deepEqual(result, { success: true, email: "new.address+tag@example.com" });
  const target = f.db.players.find(player => player.id === "member");
  assert.equal(target.email, result.email); assert.equal(target.passwordHash, "old-member-hash"); assert.equal(target.isAdmin, false);
  assert.deepEqual(f.db.sessions, f.initial.sessions.filter(session => session.userId !== "member"));
  assert.deepEqual(f.db.games, f.initial.games); assert.deepEqual(f.db.achievements, f.initial.achievements);
  assert.deepEqual(f.calls.paths, [["/", "layout"]]); assert.equal(f.calls.hashes.length, 0);
  assert(!JSON.stringify(result).includes("Hash"));
});

test("admin email validation shares auth limits, rejects malformed/no-op emails and invalid targets cleanly", async () => {
  const f = fixture();
  for (const email of [undefined, null, {}, 123, "", "  ", "bad", "@example.com", "a@", "a@@b.com", "a b@example.com", "a@example", "x".repeat(243) + "@example.com"]) {
    assert.match((await f.actions.adminUpdatePlayerEmail("member", email)).error, /valid new email/);
  }
  for (const id of [undefined, null, {}, "", "  ", "x".repeat(129)]) {
    assert.match((await f.actions.adminUpdatePlayerEmail(id, "new@example.com")).error, /valid registered player/);
  }
  assert.equal(f.calls.transactions, 0); assert.deepEqual(f.db, f.initial);
  assert.match((await f.actions.adminUpdatePlayerEmail("member", " MEMBER@EXAMPLE.COM ")).error, /changed email/);
  for (const id of ["missing", "default-player"]) assert.match((await f.actions.adminUpdatePlayerEmail(id, "new@example.com")).error, /existing registered/);
  assert.deepEqual(f.db, f.initial);
  const email = "x".repeat(242) + "@example.com";
  assert.equal(email.length, 254); assert.deepEqual(await f.actions.adminUpdatePlayerEmail("member", email), { success: true, email });
});

test("email duplicates are rejected case-insensitively, including literal lookup pattern characters", async () => {
  const f = fixture(); f.db.players.find(player => player.id === "other-admin").email = "TAKEN@Example.COM";
  const before = structuredClone(f.db);
  assert.match((await f.actions.adminUpdatePlayerEmail("member", " taken@example.com ")).error, /already in use/);
  assert.deepEqual(f.db, before);
  // A literal underscore is not an arbitrary character; a percent is not a wildcard.
  f.db.players.find(player => player.id === "other-admin").email = "aXb@example.com";
  assert.deepEqual(await f.actions.adminUpdatePlayerEmail("member", "A_B@example.com"), { success: true, email: "a_b@example.com" });
  assert.deepEqual(await f.actions.adminUpdatePlayerEmail("member", "A%B@example.com"), { success: true, email: "a%b@example.com" });
  f.db.players.find(player => player.id === "other-admin").email = "literal_%@example.com";
  assert.match((await f.actions.adminUpdatePlayerEmail("member", "LITERAL_%@example.com")).error, /already in use/);
});

test("email unique-constraint races, stale targets and session-revocation failures roll back safely", async () => {
  for (const code of ["P2002", "P2025"]) {
    const f = fixture(); f.state.failUpdateCode = code;
    const result = await f.actions.adminUpdatePlayerEmail("member", "new@example.com");
    assert.match(result.error, code === "P2002" ? /already in use/ : /unavailable or changed/);
    assert.deepEqual(f.db, f.initial); assert(!JSON.stringify(result).includes("PRIVATE"));
  }
  const f = fixture(); f.state.failRevocation = true;
  const result = await f.actions.adminUpdatePlayerEmail("member", "new@example.com");
  assert.equal(typeof result.error, "string"); assert(!JSON.stringify(result).includes("PRIVATE")); assert.deepEqual(f.db, f.initial);
});

test("email changes recheck admin authorization after lock waits; self-updates through admin tools are blocked", async () => {
  for (const change of [{ active: false }, { admin: false }]) {
    const f = fixture(); f.state.onLock = () => Object.assign(f.state, change);
    assert.match((await f.actions.adminUpdatePlayerEmail("member", "new@example.com")).error, change.active === false ? /Sign in/ : /Admin access required/);
    assert.deepEqual(f.db, f.initial);
  }
  const f = fixture();
  assert.match((await f.actions.adminUpdatePlayerEmail("admin", "new-admin@example.com")).error, /Only the Owner/);
  assert.deepEqual(f.db, f.initial);
});

test("standard admins cannot mutate the Owner or peer admins, or promote ordinary users", async () => {
  for (const id of ["primary-owner", "other-admin"]) {
    for (const run of [
      a => a.adminResetPlayerPassword(id, "new password"),
      a => a.adminUpdatePlayerEmail(id, "new@example.com"),
      a => a.adminRevokePlayerSessions(id),
      a => a.adminSetPlayerAdmin(id, false),
      a => a.adminSetPlayerAdmin(id, true),
      a => a.adminDeletePlayerAccount(id),
    ]) {
      const f = fixture(), result = await run(f.actions);
      assert.match(result.error, id === "primary-owner" ? /Owner account is protected/ : /Only the Owner/);
      assert.deepEqual(f.db, f.initial); assert.equal(f.calls.writes, 0);
    }
  }
  const f = fixture();
  assert.match((await f.actions.adminSetPlayerAdmin("member", true)).error, /Only the Owner/);
  assert.deepEqual(f.db, f.initial);
});

test("Owner can manage admins, but cannot target the Owner through any admin mutation", async () => {
  const f = fixture({ owner: true }), a = f.actions;
  assert.deepEqual(await a.adminResetPlayerPassword("other-admin", "new password"), { success: true });
  assert.deepEqual(await a.adminUpdatePlayerEmail("other-admin", "Updated@Example.com"), { success: true, email: "updated@example.com" });
  assert.deepEqual(await a.adminRevokePlayerSessions("admin"), { success: true, revokedCount: 1 });
  assert.deepEqual(await a.adminSetPlayerAdmin("other-admin", false), { success: true, isAdmin: false, changed: true });
  assert.deepEqual(await a.adminSetPlayerAdmin("member", true), { success: true, isAdmin: true, changed: true });
  assert.deepEqual(await a.adminDeletePlayerAccount("admin"), { success: true });
  const owner = f.db.players.find(p => p.id === "primary-owner");
  assert(owner.isOwner && owner.isAdmin); assert(f.db.sessions.some(s => s.userId === owner.id));
  for (const run of [
    a => a.adminResetPlayerPassword(owner.id, "new password"),
    a => a.adminUpdatePlayerEmail(owner.id, "new@example.com"),
    a => a.adminRevokePlayerSessions(owner.id),
    a => a.adminSetPlayerAdmin(owner.id, false),
    a => a.adminSetPlayerAdmin(owner.id, true),
    a => a.adminDeletePlayerAccount(owner.id),
  ]) {
    const before = structuredClone(f.db); assert.equal(typeof (await run(a)).error, "string"); assert.deepEqual(f.db, before);
  }
});


test("admin layout changes preserve sessions and other account data, and Owner can change an Admin's layout", async () => {
  for (const owner of [false, true]) {
    const f = fixture({ owner });
    const id = owner ? "other-admin" : "member";
    for (const mode of ["fantasy", "cyberpunk"]) {
      assert.deepEqual(await f.actions.adminSetPlayerLayoutMode(id, mode), { preferredLayoutMode: mode });
      assert.deepEqual(f.db, { ...f.initial, players: f.initial.players.map(p => p.id === id ? { ...p, preferredLayoutMode: mode } : p) });
    }
    assert.deepEqual(f.calls.paths, [["/", "layout"], ["/", "layout"]]);
  }
});

test("admin layout changes enforce hierarchy, registered targets, input validation, and fresh authorization", async () => {
  for (const owner of [false, true]) {
    const f = fixture({ owner });
    for (const id of ["primary-owner", "default-player", "missing", "", null, {}, "x".repeat(129), ...(!owner ? ["admin", "other-admin"] : [])]) {
      assert.equal(typeof (await f.actions.adminSetPlayerLayoutMode(id, "fantasy")).error, "string");
      assert.deepEqual(f.db, f.initial);
    }
    for (const mode of [null, undefined, "halloween", "FANTASY", "", {}, 1]) {
      assert.match((await f.actions.adminSetPlayerLayoutMode("member", mode)).error, /Choose Cyberpunk/);
    }
    assert.equal(f.calls.writes, 0);
  }
  for (const state of [{ active: false }, { admin: false }]) {
    const f = fixture(); Object.assign(f.state, state);
    assert.equal(typeof (await f.actions.adminSetPlayerLayoutMode("member", "fantasy")).error, "string");
    assert.equal(f.calls.transactions, 0);
    const waiting = fixture(); waiting.state.onLock = () => Object.assign(waiting.state, state);
    assert.equal(typeof (await waiting.actions.adminSetPlayerLayoutMode("member", "fantasy")).error, "string");
    assert.deepEqual(waiting.db, waiting.initial);
  }
  const failed = fixture(); failed.state.failUpdateCode = "P2025";
  assert.match((await failed.actions.adminSetPlayerLayoutMode("member", "fantasy")).error, /unavailable or changed/);
  assert.deepEqual(failed.db, failed.initial);
});
