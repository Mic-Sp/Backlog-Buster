/* eslint-disable @typescript-eslint/no-require-imports -- Exercise real server modules with offline database/session boundaries. */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fixture, loader, player } = require("./helpers/social-fixture.cjs");
const outcome = (playerId, relationship) => ({ playerId, relationship });
const calls = ["sendFriendRequest", "acceptFriendRequest", "declineFriendRequest", "cancelFriendRequest", "removeFriend", "blockPlayer", "unblockPlayer"];

test("signup, profile editing and browser validation share the same 3–32-character handle rule", () => {
  const load = loader({ "@/lib/prisma": {}, "@/lib/player": {} });
  const { readCredentials } = load("src/lib/auth-accounts.ts");
  const { validatePlayerProfile } = load("src/lib/player-profile.ts");
  const { HANDLE_INPUT_PATTERN, isValidHandle, normalizeHandle } = load("src/lib/handle-validation.ts");
  const browser = new RegExp(`^(?:${HANDLE_INPUT_PATTERN})$`, "v");
  const base = { operatorName: "Ghost", tagline: "Hello", neonAccent: "CYAN", featuredTrophyIds: [] };
  const signup = handle => { const form = new FormData(); form.set("email", "ghost@example.test"); form.set("password", "valid password"); form.set("handle", handle); return readCredentials(form, true).handle; };
  for (const value of ["abc", "Night_Runner", "night-runner", "_legacy", "-legacy", "x".repeat(25), "x".repeat(32)]) {
    const expected = normalizeHandle(value);
    assert(isValidHandle(expected)); assert(browser.test(value));
    assert.equal(signup(` ${value} `), expected);
    assert.equal(validatePlayerProfile({ ...base, handle: ` ${value} ` }).handle, expected);
  }
  for (const value of ["ab", "x".repeat(33), "bad handle", "bad/name", "bad.name", "ghöst", "bad\u0000name"]) {
    assert(!isValidHandle(value)); assert(!browser.test(value));
    assert.throws(() => signup(value), /handle/i);
    assert.throws(() => validatePlayerProfile({ ...base, handle: value }), /handle/i);
  }
});

test("all social actions reject anonymous, revoked and unclaimed local identities before querying data", async () => {
  for (const id of [null, "default-player", "alice"]) {
    const f = fixture(); if (id === "alice") f.revoke(id);
    const { actions } = f.as(id);
    for (const name of calls) assert.match((await actions[name]("bob")).error, /Sign in/);
    assert.match((await actions.searchPlayers("bob")).error, /Sign in/);
    assert.match((await actions.updateProfileVisibility("private")).error, /Sign in/);
    assert.equal(f.queries.length, 0); assert.equal(f.writes.length, 0); assert.equal(f.locks.length, 0);
  }
});

test("social actions recheck the live session after locking, and never write with a revoked session", async () => {
  const f = fixture(), a = f.as("alice").actions;
  f.onLock(() => f.revoke("alice"));
  assert.match((await a.sendFriendRequest("bob")).error, /Sign in/);
  assert.equal(f.rows.length, 0); assert.equal(f.writes.length, 0);
});

test("a claimed default-player archive participates through its registered session", async () => {
  const f = fixture(), archive = f.players.find(p => p.id === "default-player");
  archive.email = "claimed@example.test"; archive.passwordHash = "registered-hash";
  assert.deepEqual(await f.as("default-player").actions.sendFriendRequest("bob"), outcome("bob", "outgoing"));
  assert.equal(f.rows.length, 1);
});

test("pending requests are idempotent; only their recipient can accept, and either friend can remove", async () => {
  const f = fixture(), alice = f.as("alice").actions, bob = f.as("bob").actions;
  assert.deepEqual(await alice.sendFriendRequest("bob"), outcome("bob", "outgoing"));
  assert.deepEqual(await alice.sendFriendRequest("bob"), outcome("bob", "outgoing"));
  assert.equal(f.writes.length, 1);
  assert.match((await alice.acceptFriendRequest("bob")).error, /recipient/);
  assert.deepEqual(await bob.acceptFriendRequest("alice"), outcome("alice", "friends"));
  assert.equal(f.rows[0].status, "accepted");
  assert.deepEqual(await alice.acceptFriendRequest("bob"), outcome("bob", "friends"));
  assert.deepEqual(await alice.sendFriendRequest("bob"), outcome("bob", "friends"));
  assert.deepEqual(await bob.removeFriend("alice"), outcome("alice", "none"));
  assert.equal(f.rows.length, 0);
  assert.deepEqual(await alice.removeFriend("bob"), outcome("bob", "none"));
  assert(f.revalidations.some(args => args[0] === "/dossier/[handle]" && args[1] === "page"));
});

test("declining and cancelling authorize opposite request roles without accepting or removing the wrong state", async () => {
  const f = fixture(), alice = f.as("alice").actions, bob = f.as("bob").actions;
  await alice.sendFriendRequest("bob");
  for (const name of ["cancelFriendRequest", "removeFriend"]) assert.match((await bob[name]("alice")).error, /sender|incoming/);
  assert.match((await alice.declineFriendRequest("bob")).error, /recipient/);
  assert.equal(f.rows[0].status, "pending");
  assert.deepEqual(await bob.declineFriendRequest("alice"), outcome("alice", "none"));
  await alice.sendFriendRequest("bob");
  assert.deepEqual(await alice.cancelFriendRequest("bob"), outcome("bob", "none"));
  await alice.sendFriendRequest("bob");
  assert.deepEqual(await alice.removeFriend("bob"), outcome("bob", "none"));
  await alice.sendFriendRequest("bob"); await bob.acceptFriendRequest("alice");
  assert.match((await alice.cancelFriendRequest("bob")).error, /pending/);
  assert.match((await bob.declineFriendRequest("alice")).error, /pending/);
  assert.equal(f.rows[0].status, "accepted");
});

test("opposite simultaneous sends use the same canonical pair and lock, leaving one explicit pending request", async () => {
  const f = fixture(), alice = f.as("alice"), bob = f.as("bob");
  assert.deepEqual(alice.library.friendshipPair("alice", "bob"), bob.library.friendshipPair("bob", "alice"));
  await Promise.all([alice.actions.sendFriendRequest("bob"), bob.actions.sendFriendRequest("alice")]);
  assert.equal(f.rows.length, 1); assert.equal(f.rows[0].status, "pending");
  assert.equal(f.rows[0].requestedById, "alice");
  assert.deepEqual(f.locks, [f.locks[0], f.locks[0]]);
  assert.equal(f.writes.filter(([kind]) => kind === "create").length, 1);
  assert.deepEqual(await bob.actions.sendFriendRequest("alice"), outcome("alice", "incoming"));
  assert.equal(f.rows[0].status, "pending");
});

test("pair uniqueness and state validity are enforced in the schema and PostgreSQL CHECK constraints", () => {
  const schema = fs.readFileSync(path.join(__dirname, "../prisma/schema.prisma"), "utf8");
  const constraints = fs.readFileSync(path.join(__dirname, "../prisma/friendship-constraints.sql"), "utf8");
  assert.match(schema, /@@id\(\[playerLowId, playerHighId\]\)/);
  assert.equal((schema.match(/@relation\("Friendship(?:Low|High)", fields:.*onDelete: Cascade/g) ?? []).length, 2);
  assert.match(constraints, /CHECK \("playerLowId" COLLATE "C" < "playerHighId" COLLATE "C"\)/);
  assert.match(constraints, /"requestedById" IS NOT NULL/);
  assert.match(constraints, /"requestedById" IN \("playerLowId", "playerHighId"\)/);
  assert.match(constraints, /"status" = 'blocked'.*"requestedById" IS NULL/);
});

test("blocking cancels requests/friendships and prevents every request mutation from either side", async () => {
  for (const accepted of [false, true]) {
    const f = fixture(), alice = f.as("alice").actions, bob = f.as("bob").actions;
    await alice.sendFriendRequest("bob"); if (accepted) await bob.acceptFriendRequest("alice");
    assert.deepEqual(await alice.blockPlayer("bob"), outcome("bob", "blocked"));
    assert.equal(f.rows[0].status, "blocked"); assert.equal(f.rows[0].requestedById, null);
    assert.equal(f.rows[0].blockedByLow, true); assert.equal(f.rows[0].blockedByHigh, false);
    for (const actions of [alice, bob]) {
      for (const name of ["sendFriendRequest", "acceptFriendRequest", "declineFriendRequest", "cancelFriendRequest", "removeFriend"]) {
        assert.match((await actions[name](actions === alice ? "bob" : "alice")).error, /unavailable/);
      }
    }
    await bob.unblockPlayer("alice"); assert.equal(f.rows[0].blockedByLow, true);
    assert.deepEqual(await alice.unblockPlayer("bob"), outcome("bob", "none"));
    assert.equal(f.rows.length, 0, "Unblock must not resurrect the request/friendship");
  }
});

test("reciprocal blocks are independent and neither a peer nor a third player can clear another's block", async () => {
  const f = fixture(), alice = f.as("alice").actions, bob = f.as("bob").actions;
  await Promise.all([alice.blockPlayer("bob"), bob.blockPlayer("alice")]);
  assert.equal(f.rows.length, 1); assert(f.rows[0].blockedByLow && f.rows[0].blockedByHigh);
  await f.as("carol").actions.unblockPlayer("alice");
  assert(f.rows[0].blockedByLow && f.rows[0].blockedByHigh);
  assert.deepEqual(await alice.unblockPlayer("bob"), outcome("bob", "none"));
  assert.equal(f.rows[0].blockedByLow, false); assert.equal(f.rows[0].blockedByHigh, true);
  assert.match((await alice.sendFriendRequest("bob")).error, /unavailable/);
  await bob.unblockPlayer("alice"); assert.equal(f.rows.length, 0);
  assert.deepEqual(await alice.sendFriendRequest("bob"), outcome("bob", "outgoing"));
});

test("a concurrent block and accept cannot leave an accepted or duplicate relationship", async () => {
  const f = fixture(), alice = f.as("alice").actions, bob = f.as("bob").actions;
  await alice.sendFriendRequest("bob");
  await Promise.all([bob.acceptFriendRequest("alice"), alice.blockPlayer("bob")]);
  assert.equal(f.rows.length, 1); assert.equal(f.rows[0].status, "blocked");
});

test("invalid/self/guest/missing targets and forged actors cannot change other players' relationships", async () => {
  const f = fixture(), actions = f.as("alice").actions;
  for (const name of calls) {
    for (const value of [null, {}, { playerId: "bob", actorId: "carol" }, "", "bad/id", "a".repeat(129), "alice"]) {
      assert.match((await actions[name](value)).error, /valid player|another player/);
    }
    for (const target of ["default-player", "missing"]) assert.match((await actions[name](target)).error, /unavailable/);
  }
  assert.equal(f.rows.length, 0); assert.equal(f.writes.length, 0);
  const absent = await actions.acceptFriendRequest("bob"); assert.match(absent.error, /recipient/);
});

test("visibility updates validate the enum and update only the session's registered player", async () => {
  const f = fixture(), actions = f.as("alice").actions;
  for (const profileVisibility of ["friends", "private", "public"]) {
    assert.deepEqual(await actions.updateProfileVisibility(profileVisibility), { profileVisibility });
    assert.equal(f.players.find(p => p.id === "alice").profileVisibility, profileVisibility);
  }
  for (const value of [null, "PUBLIC", "", 1, { id: "bob", profileVisibility: "private" }]) {
    assert.match((await actions.updateProfileVisibility(value)).error, /public, friends or private/);
  }
  assert.equal(f.players.find(p => p.id === "bob").profileVisibility, "public");
  assert(f.writes.every(([, args]) => args.where.id === "alice" && args.where.AND[0].email.not === null));
});

test("database failures are sanitized, transactions roll back, and failed actions do not revalidate", async () => {
  const f = fixture(), actions = f.as("alice").actions;
  f.failWrites();
  const result = await actions.sendFriendRequest("bob");
  assert.match(result.error, /Could not save/); assert(!JSON.stringify(result).includes("DATABASE_SECRET"));
  assert.equal(f.rows.length, 0); assert.equal(f.revalidations.length, 0);
});

test("discovery searches literal handles/callsigns, excludes guests/self and respects visibility and blocks", async () => {
  const f = fixture([player("alice"), player("bob", { handle: "bob_runner", operatorName: "Ghost" }),
    player("carol", { profileVisibility: "friends", operatorName: "Ghost" }), player("dave", { profileVisibility: "private", operatorName: "Ghost" }),
    player("guest", { email: null, passwordHash: null, operatorName: "Ghost" }), player("eve", { handle: null, operatorName: "Ghost" })]);
  const actions = f.as("alice").actions;
  assert.deepEqual((await actions.searchPlayers("Ghost")).players.map(p => p.id), ["bob", "eve"]);
  assert.equal((await actions.searchPlayers("Ghost")).players.find(p => p.id === "eve").handle, null, "Players without handles can be discovered by callsign");
  assert.deepEqual((await actions.searchPlayers("@BOB_RUN")).players.map(p => p.id), ["bob"]);
  assert.deepEqual((await actions.searchPlayers("bob%run")).players, []);
  assert.deepEqual((await actions.searchPlayers("a")).players, []);
  assert.deepEqual((await actions.searchPlayers("alice")).players, []);
  for (const value of [null, {}, "a".repeat(65), "bad\u0000query"]) assert((await actions.searchPlayers(value)).error);
  await actions.sendFriendRequest("carol"); await f.as("carol").actions.acceptFriendRequest("alice");
  assert.deepEqual((await actions.searchPlayers("Ghost")).players.map(p => p.id), ["bob", "carol", "eve"]);
  await f.as("bob").actions.blockPlayer("alice");
  assert.deepEqual((await actions.searchPlayers("Ghost")).players.map(p => p.id), ["carol", "eve"]);
  const select = f.queries.find(([kind, args]) => kind === "players" && args.take)?.[1].select;
  assert.deepEqual(select, { id: true, handle: true, operatorName: true, avatarUrl: true });
  assert(!JSON.stringify(await actions.searchPlayers("Ghost")).includes("SECRET_HASH"));
});

test("discovery returns at most twenty minimal identities", async () => {
  const f = fixture([player("alice"), ...Array.from({ length: 30 }, (_, i) => player(`runner-${i}`))]);
  const { players } = await f.as("alice").actions.searchPlayers("runner");
  assert.equal(players.length, 20);
  assert.deepEqual(Object.keys(players[0]).sort(), ["avatarUrl", "handle", "id", "operatorName"]);
});
