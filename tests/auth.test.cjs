/* eslint-disable @typescript-eslint/no-require-imports -- Node's CommonJS test loader mocks server-only boundaries. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { randomBytes } = require("node:crypto");

// Exercise the server modules with isolated database/cookie boundaries. No live
// credentials, database connection, Next server, or additional test package.
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, "..", relative);
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = instance.require.bind(instance);
  instance.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith("@/") ? load("src/" + name.slice(2) + ".ts", mocks) : original(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, filename);
  return instance.exports;
}

const crypto = load("src/lib/auth-crypto.ts", { "server-only": {} });
const accounts = (prisma = {}) => load("src/lib/auth-accounts.ts", { "server-only": {}, "@/lib/prisma": { prisma } });
function credentials(values) {
  const form = new FormData();
  for (const [name, value] of Object.entries(values)) form.set(name, value);
  return form;
}

test("scrypt uses independent salts and rejects wrong passwords and malformed hashes", async () => {
  const password = " a long exact passphrase ";
  const one = await crypto.hashPassword(password), two = await crypto.hashPassword(password);
  assert.notEqual(one, two);
  assert.match(one, /^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.equal(await crypto.verifyPassword(password, one), true);
  assert.equal(await crypto.verifyPassword(password.trim(), one), false);
  assert.equal(await crypto.verifyPassword(password, null), false);
  assert.equal(await crypto.verifyPassword(password, "broken"), false);
  assert.equal(await crypto.verifyPassword(password, one.replace("131072", "1073741824")), false);
});

test("signed session tokens reject every single-character mutation and a different signing key", () => {
  const secret = randomBytes(32), token = randomBytes(32).toString("base64url");
  const signed = crypto.signSessionToken(token, secret);
  assert.equal(crypto.verifySessionToken(signed, secret), crypto.sessionTokenHash(token));
  assert.equal(crypto.verifySessionToken(signed, randomBytes(32)), null);
  for (let index = 0; index < signed.length; index++) {
    const modified = signed.slice(0, index) + (signed[index] === "x" ? "y" : "x") + signed.slice(index + 1);
    assert.equal(crypto.verifySessionToken(modified, secret), null);
  }
  for (const value of ["", signed + ".extra", signed.slice(1), "v1.id.signature"]) {
    assert.equal(crypto.verifySessionToken(value, secret), null);
  }
});

test("credentials normalize email/handle, preserve exact passwords, and validate bounds", () => {
  const read = accounts().readCredentials;
  const base = { email: "  Choom@Example.COM ", password: " exact password ", handle: " Night_Runner ", operatorName: " Neon " };
  assert.deepEqual(read(credentials(base), true), { email: "choom@example.com", password: base.password, handle: "night_runner", operatorName: "Neon" });
  for (const change of [{ email: "invalid" }, { password: "short" }, { password: "x".repeat(129) }, { handle: "ab" }, { handle: "bad handle" }, { operatorName: "x".repeat(29) }]) {
    assert.throws(() => read(credentials({ ...base, ...change }), true));
  }
  for (const register of [false, true]) {
    for (const length of [8, 128]) {
      const password = "x".repeat(length);
      assert.equal(read(credentials({ email: "a@example.com", password }), register).password, password);
    }
    for (const length of [0, 7, 129]) {
      assert.throws(() => read(credentials({ email: "a@example.com", password: "x".repeat(length) }), register));
    }
  }
});

function accountDatabase() {
  const initial = { id: "default-player", email: null, passwordHash: null, handle: null, operatorName: "ARCHIVED GHOST", neonAccent: "GOLD", featuredTrophyIds: [47, null, null] };
  let rows = [structuredClone(initial)], next = 1, sequence = Promise.resolve();
  const tx = {
    $executeRaw: async (strings) => assert.match(strings.join(""), /pg_advisory_xact_lock/),
    player: {
      findUnique: async ({ where }) => structuredClone(rows.find((row) => row.id === where.id) ?? null),
      findFirst: async ({ where }) => rows.find((row) => {
        const field = where.email ? "email" : "handle";
        return row[field]?.toLowerCase() === where[field].equals.toLowerCase() && row.id !== where.id?.not;
      }) ?? null,
      update: async ({ where, data }) => {
        const row = rows.find((row) => row.id === where.id);
        assert.deepEqual(where.AND, [{ email: null }, { passwordHash: null }]);
        assert.equal(row.email, null); assert.equal(row.passwordHash, null);
        Object.assign(row, data);
        return { id: row.id };
      },
      create: async ({ data }) => { const row = { id: `new-player-${next++}`, ...data }; rows.push(row); return { id: row.id }; },
    },
  };
  const prisma = { $transaction: (operation) => {
    const result = sequence.then(async () => {
      const before = structuredClone(rows);
      try { return await operation(tx); } catch (error) { rows = before; throw error; }
    });
    sequence = result.catch(() => {});
    return result;
  } };
  return { prisma, initial, get rows() { return rows; } };
}

test("simultaneous registrations claim the archive once; later players get different IDs", async () => {
  const db = accountDatabase(), register = accounts(db.prisma).registerPlayer;
  const [first, second] = await Promise.all([
    register({ email: "first@example.com", handle: "first", operatorName: null }, "hashed-first"),
    register({ email: "second@example.com", handle: "second", operatorName: "Second" }, "hashed-second"),
  ]);
  assert.equal(first.id, "default-player"); assert.notEqual(second.id, first.id);
  assert.equal(db.rows.length, 2);
  assert.equal(db.rows[0].operatorName, db.initial.operatorName);
  assert.equal(db.rows[0].neonAccent, "GOLD");
  assert.deepEqual(db.rows[0].featuredTrophyIds, [47, null, null]);
  const before = structuredClone(db.rows);
  await assert.rejects(() => register({ email: "FIRST@EXAMPLE.COM", handle: null, operatorName: null }, "hashed-third"), /email is already/);
  await assert.rejects(() => register({ email: "third@example.com", handle: "SECOND", operatorName: null }, "hashed-third"), /handle is already/);
  assert.deepEqual(db.rows, before);
});

test("claimed archives require a valid session, and private sessions return only public identity", async () => {
  let local = { id: "default-player", operatorName: "Local", handle: null, email: null, passwordHash: null };
  let tokenHash = null, session = null;
  const player = load("src/lib/player.ts", {
    "server-only": {}, react: { cache: (fn) => fn }, "@/lib/auth-session": { readSessionHash: async () => tokenHash },
    "@/lib/prisma": { prisma: {
      player: { findUnique: async () => local },
      playerSession: { findUnique: async ({ where, select }) => {
        assert(where.expiresAt.gt instanceof Date);
        assert.deepEqual(where.player, { email: { not: null }, passwordHash: { not: null } });
        if (select.userId) return session ? { userId: session.player.id } : null;
        assert.deepEqual(select, { player: { select: { id: true, operatorName: true, handle: true, isAdmin: true, isOwner: true, preferredLayoutMode: true } } });
        return session;
      } },
    } },
  });
  assert.equal(await player.getCurrentPlayerId(), "default-player");
  assert.equal((await player.getCurrentPlayer()).isAdmin, false, "Local fallback never receives admin privileges");
  await assert.rejects(() => player.getAuthenticatedPlayerId(), /Sign in/, "Unclaimed local profiles cannot authorize mutations");
  local = { ...local, email: "claimed@example.com", passwordHash: "hashed" };
  assert.equal(await player.getCurrentPlayer(), null);
  await assert.rejects(() => player.getCurrentPlayerId(), /Sign in/);
  local = null;
  assert.equal(await player.getCurrentPlayer(), null, "Deleted local profiles are never recreated by a public visit");
  tokenHash = "expired-or-revoked-token";
  await assert.rejects(() => player.getCurrentPlayerId(), /Sign in/);
  await assert.rejects(() => player.getAuthenticatedPlayerId(), /Sign in/);
  session = { player: { id: "private-player", operatorName: "Private", handle: "private", isAdmin: true, isOwner: true, preferredLayoutMode: "fantasy" } };
  assert.deepEqual(await player.getCurrentPlayer(), { ...session.player, isLocal: false });
  assert.equal(await player.getCurrentPlayerId(), "private-player");
  assert.equal(await player.getAuthenticatedPlayerId(), "private-player");
  session = null;
  await assert.rejects(() => player.getAuthenticatedPlayerId(), /Sign in/, "Revoked sessions are checked afresh");
});

test("production sessions use protected cookies, rotate tokens, and revoke on logout", async () => {
  const previousMode = process.env.NODE_ENV, previousSecret = process.env.AUTH_SECRET;
  process.env.NODE_ENV = "production";
  process.env.AUTH_SECRET = "isolated-test-signing-key-32-bytes-minimum";
  try {
    let cookie = "", options;
    const rows = new Map();
    const jar = {
      get: () => cookie ? { value: cookie } : undefined,
      set: (name, value, settings) => { assert.equal(name, "__Host-bb_session_v1"); cookie = value; options = settings; },
    };
    const session = load("src/lib/auth-session.ts", {
      "server-only": {}, "next/headers": { cookies: async () => jar }, "@/lib/auth-crypto": crypto,
      "@/lib/prisma": { prisma: {
        $transaction: (operations) => Promise.all(operations),
        playerSession: {
          create: async ({ data }) => { rows.set(data.tokenHash, data); return data; },
          deleteMany: async ({ where }) => {
            for (const [key, row] of rows) if (where.tokenHash === key || where.OR?.some((condition) => condition.tokenHash === key || row.expiresAt <= condition.expiresAt?.lte)) rows.delete(key);
            return { count: 0 };
          },
        },
      } },
    });
    await session.createPlayerSession("private-player");
    assert.equal(options.httpOnly, true); assert.equal(options.secure, true);
    assert.equal(options.sameSite, "lax"); assert.equal(options.path, "/");
    assert.equal(options.maxAge, 7 * 86400); assert.equal(options.domain, undefined);
    const firstHash = await session.readSessionHash(), firstCookie = cookie;
    assert.equal(rows.size, 1);
    assert.equal(firstHash, crypto.sessionTokenHash(cookie.split(".")[1]));
    assert(!cookie.includes("private-player")); assert(!cookie.includes(firstHash));
    await session.createPlayerSession("private-player");
    assert.notEqual(cookie, firstCookie); assert.equal(rows.size, 1); assert.equal(rows.has(firstHash), false);
    await session.destroyPlayerSession();
    assert.equal(rows.size, 0); assert.equal(cookie, ""); assert.equal(options.maxAge, 0);
  } finally {
    if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode;
    if (previousSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previousSecret;
  }
});
