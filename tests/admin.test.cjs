/* eslint-disable @typescript-eslint/no-require-imports -- Mock authorization and bootstrap database boundaries. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const { bootstrapAdmin, bootstrapOwner } = require("../scripts/bootstrap-admin.cjs");

function loadGuard(mocks) {
  const filename = path.resolve(__dirname, "../src/lib/admin.ts");
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.require = name => {
    assert(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
    return mocks[name];
  };
  instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, filename);
  return instance.exports;
}

test("admin guard checks fresh authenticated database state and never uses local identity or environment", async () => {
  let tokenHash = null, active = true, isAdmin = false, queries = 0;
  class AuthenticationRequiredError extends Error {}
  const { requireAdmin, AdminRequiredError } = loadGuard({
    "server-only": {},
    "@/lib/player": { AuthenticationRequiredError },
    "@/lib/auth-session": { readSessionHash: async () => tokenHash },
    "@/lib/prisma": { prisma: { playerSession: { findUnique: async ({ where, select }) => {
      queries++;
      assert.equal(where.tokenHash, "signed-session-hash");
      assert(where.expiresAt.gt instanceof Date);
      assert.deepEqual(where.player, { email: { not: null }, passwordHash: { not: null } });
      assert.deepEqual(select, { player: { select: { id: true, isAdmin: true, isOwner: true } } });
      return active ? { player: { id: "registered-player", isAdmin } } : null;
    } } } },
  });
  await assert.rejects(requireAdmin, AuthenticationRequiredError);
  assert.equal(queries, 0, "Missing/invalid cookie cannot authorize even a local admin profile");
  tokenHash = "signed-session-hash";
  await assert.rejects(requireAdmin, AdminRequiredError);
  isAdmin = true;
  assert.deepEqual(await requireAdmin(), { id: "registered-player", isAdmin: true, isOwner: false });
  isAdmin = false;
  await assert.rejects(requireAdmin, AdminRequiredError, "Demotion applies on the next check");
  isAdmin = true; active = false;
  await assert.rejects(requireAdmin, AuthenticationRequiredError, "Expired/revoked sessions fail despite admin flag");
  assert.equal(queries, 4);
});

// Rollback-capable serialized transaction fixture. No live database mutations.
function database() {
  let state = { players: [{ id: "owner", email: "owner@example.com", passwordHash: "hash", isAdmin: false }], marker: null };
  let tail = Promise.resolve();
  const prisma = { $transaction: async work => {
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    await previous;
    const before = structuredClone(state);
    let locked = false;
    try {
      const result = await work({
        $executeRaw: async parts => { assert.equal(parts.join(""), 'LOCK TABLE "Player" IN SHARE ROW EXCLUSIVE MODE'); locked = true; },
        adminBootstrap: {
          findUnique: async () => { assert(locked); return state.marker; },
          create: async ({ data }) => { assert.equal(state.marker, null); state.marker = data; return data; },
        },
        player: {
          findFirst: async ({ where }) => { assert.deepEqual(where, { isAdmin: true }); return state.players.find(p => p.isAdmin) ?? null; },
          findUnique: async ({ where }) => state.players.find(p => p.id === where.id) ?? null,
          update: async ({ where, data }) => { const player = state.players.find(p => p.id === where.id); Object.assign(player, data); return { id: player.id }; },
        },
      });
      return result;
    } catch (error) { state = before; throw error; }
    finally { release(); }
  } };
  return { prisma, state: () => state };
}

test("bootstrap promotes an existing credentialed ID exactly once, including concurrent calls", async () => {
  const db = database();
  const results = await Promise.all([bootstrapAdmin(db.prisma, "owner"), bootstrapAdmin(db.prisma, "owner")]);
  assert.deepEqual(results.map(r => r.status), ["promoted", "already-completed"]);
  assert.equal(db.state().players[0].isAdmin, true);
  db.state().players[0].isAdmin = false;
  db.state().players[0].email = "changed@example.com";
  assert.equal((await bootstrapAdmin(db.prisma, "owner")).status, "already-completed");
  assert.equal(db.state().players[0].isAdmin, false, "Demotion cannot reactivate bootstrap");
  db.state().players = [];
  assert.equal((await bootstrapAdmin(db.prisma, "another-id")).status, "already-completed", "Marker survives account deletion");
});

test("an existing admin seals bootstrap without promoting any other player", async () => {
  const db = database();
  db.state().players.push({ id: "admin", isAdmin: true });
  assert.equal((await bootstrapAdmin(db.prisma, "owner")).status, "admin-already-exists");
  assert.equal(db.state().players[0].isAdmin, false);
  db.state().players.pop();
  assert.equal((await bootstrapAdmin(db.prisma, "owner")).status, "already-completed");
});

test("bootstrap rejects absent identifiers, emails, missing players and unclaimed profiles without consuming bootstrap", async () => {
  const db = database();
  for (const id of [undefined, "", "  ", "owner@example.com", "missing"]) {
    await assert.rejects(() => bootstrapAdmin(db.prisma, id));
    assert.equal(db.state().marker, null);
    assert.equal(db.state().players[0].isAdmin, false);
  }
  for (const field of ["email", "passwordHash"]) {
    const original = db.state().players[0][field];
    db.state().players[0][field] = null;
    await assert.rejects(() => bootstrapAdmin(db.prisma, "owner"), /existing registered account/);
    assert.equal(db.state().marker, null);
    db.state().players[0][field] = original;
  }
});

function ownerDatabase() {
  let state = { players: [
    { id: "main", email: "main@test.com", passwordHash: "hash", isAdmin: true, isOwner: false },
    { id: "other", email: "other@test.com", passwordHash: "hash", isAdmin: false, isOwner: false },
    { id: "default-player", email: null, passwordHash: null, isAdmin: false, isOwner: false },
  ], markers: ["initial-admin-v1"] };
  let tail = Promise.resolve();
  const prisma = { $transaction: async work => {
    const previous = tail; let release; tail = new Promise(resolve => { release = resolve; });
    await previous; const before = structuredClone(state);
    try { return await work({
      $executeRaw: async sql => assert.match(sql.join(""), /LOCK TABLE "Player" IN SHARE ROW EXCLUSIVE MODE/),
      adminBootstrap: {
        findUnique: async ({ where }) => state.markers.includes(where.id) ? { id: where.id } : null,
        create: async ({ data }) => { assert(!state.markers.includes(data.id)); state.markers.push(data.id); },
      },
      player: {
        findFirst: async ({ where }) => { assert.deepEqual(where, { isOwner: true }); return state.players.find(p => p.isOwner) ?? null; },
        findUnique: async ({ where }) => state.players.find(p => p.id === where.id) ?? null,
        update: async ({ where, data }) => {
          assert.deepEqual(data, { isAdmin: true, isOwner: true });
          assert(!state.players.some(p => p.isOwner)); Object.assign(state.players.find(p => p.id === where.id), data);
        },
      },
    }); } catch (error) { state = before; throw error; } finally { release(); }
  } };
  return { prisma, state: () => state };
}

test("Owner bootstrap upgrades the existing admin once, preserves the legacy latch, and serializes competing claims", async () => {
  const db = ownerDatabase();
  const results = await Promise.all([bootstrapOwner(db.prisma, "main"), bootstrapOwner(db.prisma, "other")]);
  assert.deepEqual(results.map(r => r.status), ["owner-promoted", "already-completed"]);
  assert.deepEqual(db.state().markers, ["initial-admin-v1", "initial-owner-v1"]);
  assert.equal(db.state().players.filter(p => p.isOwner).length, 1);
  assert(db.state().players[0].isOwner && db.state().players[0].isAdmin);
  db.state().players[0].email = "changed@test.com";
  assert.equal((await bootstrapOwner(db.prisma, "other")).status, "already-completed");
  assert.equal(db.state().players[1].isOwner, false);
});

test("an existing Owner seals bootstrap without a transfer; absent/unclaimed targets do not consume the latch", async () => {
  const existing = ownerDatabase(); existing.state().players[0].isOwner = true;
  assert.equal((await bootstrapOwner(existing.prisma, "other")).status, "owner-already-exists");
  assert.equal(existing.state().players[1].isOwner, false);
  for (const id of [undefined, "", "main@test.com", "missing", "default-player"]) {
    const db = ownerDatabase(); await assert.rejects(() => bootstrapOwner(db.prisma, id));
    assert.deepEqual(db.state().markers, ["initial-admin-v1"]);
    assert.equal(db.state().players.filter(p => p.isOwner).length, 0);
  }
});
