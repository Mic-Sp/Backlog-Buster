/* eslint-disable @typescript-eslint/no-require-imports -- Feed queries run against relational offline fixtures. */
const test = require("node:test"), assert = require("node:assert/strict");
const { fixture, player } = require("./helpers/social-fixture.cjs");
function feedFixture() {
  const f = fixture([player("alice"), player("bob"), player("carol"), player("guest", { email: null, passwordHash: null })]);
  let events = [], onRead;
  const calls = [], now = new Date();
  f.prisma.activityEvent = { findMany: async args => {
    calls.push(args);
    const rows = events.filter(row => f.matches(row, args.where)).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).slice(0, args.take)
      .map(row => ({ ...structuredClone(row), actor: { ...f.players.find(player => player.id === row.actorId), email: "PRIVATE_EMAIL" } }));
    if (onRead) onRead(); return rows;
  } };
  const add = (actorId, extra = {}) => { const row = { id: `event-${events.length + 1}`, actorId, type: "game_started", createdAt: now,
    metadata: { title: "Portal", platform: "PC", notes: "PRIVATE_NOTES", token: "PRIVATE_TOKEN" }, deduplicationKey: "PRIVATE_KEY", ...extra }; events.push(row); return row; };
  const client = id => f.as(id).load("src/app/activity-actions.ts").fetchFriendActivity;
  const befriend = (left, right, status = "accepted") => f.rows.push({ playerLowId: left < right ? left : right, playerHighId: left < right ? right : left,
    status, requestedById: status === "blocked" ? null : left, blockedByLow: status === "blocked", blockedByHigh: false });
  return { ...f, calls, now, add, client, befriend, get events() { return events; }, clearActor: id => { events = events.filter(row => row.actorId !== id); },
    onRead: hook => { onRead = hook; } };
}

test("only accepted friends in either pair orientation appear, with public/friends audiences and no private data", async () => {
  const f = feedFixture();
  f.befriend("alice", "bob"); f.befriend("bob", "carol");
  f.players.find(p => p.id === "carol").profileVisibility = "friends";
  for (const actor of ["alice", "bob", "carol", "guest"]) f.add(actor);
  const result = await f.client("bob")({});
  assert.deepEqual(result.items.map(row => row.actor.id), ["carol", "alice"]);
  assert(result.items.every(row => Object.keys(row.actor).sort().join() === "avatarUrl,handle,id,operatorName"));
  assert(!JSON.stringify(result).includes("PRIVATE_"));
  assert.deepEqual(f.calls[0].orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  assert.equal(f.calls[0].take, 21);
  f.players.find(p => p.id === "carol").profileVisibility = "private";
  assert.deepEqual((await f.client("bob")()).items.map(row => row.actor.id), ["alice"]);
});

test("nonfriends, pending requests, blocks from either side and removed friendships cannot yield feed rows", async () => {
  const f = feedFixture(); f.add("alice");
  assert.deepEqual((await f.client("bob")()).items, []);
  f.befriend("alice", "bob", "pending");
  assert.deepEqual((await f.client("bob")()).items, []);
  f.rows[0].status = "accepted";
  assert.equal((await f.client("bob")()).items.length, 1);
  for (const high of [false, true]) {
    Object.assign(f.rows[0], { status: "blocked", requestedById: null, blockedByLow: !high, blockedByHigh: high });
    assert.deepEqual((await f.client("bob")()).items, []);
  }
  f.rows.length = 0;
  assert.deepEqual((await f.client("bob")()).items, []);
});

test("feed rejects anonymous/guest/revoked sessions and rechecks after slow database work", async () => {
  const f = feedFixture();
  for (const id of [null, "guest"]) assert.match((await f.client(id)()).error, /Sign in/);
  assert.equal(f.calls.length, 0);
  f.befriend("alice", "bob"); f.add("alice"); f.onRead(() => f.revoke("bob"));
  assert.match((await f.client("bob")()).error, /Sign in/);
});

test("keyset pagination is stable for timestamp ties and ignores client-supplied viewer/actor identities", async () => {
  const f = feedFixture(); f.befriend("alice", "bob");
  for (const id of ["a", "b", "c", "d", "e"]) f.add("alice", { id });
  const read = f.client("bob");
  const first = await read({ limit: 2, viewerId: "carol", actorId: "carol" });
  assert.deepEqual(first.items.map(row => row.id), ["e", "d"]);
  assert.deepEqual(first.nextCursor, { id: "d", createdAt: f.now.toISOString() });
  const second = await read({ limit: 2, cursor: first.nextCursor });
  assert.deepEqual(second.items.map(row => row.id), ["c", "b"]);
  const last = await read({ limit: 2, cursor: second.nextCursor });
  assert.deepEqual(last.items.map(row => row.id), ["a"]); assert.equal(last.nextCursor, null);
});

test("recent feeds skip old/malformed events and validate bounded options without querying", async () => {
  const f = feedFixture(), read = f.client("bob"); f.befriend("alice", "bob");
  f.add("alice", { createdAt: new Date(Date.now() - 31 * 86400000) });
  f.add("alice", { type: "unrecognized", metadata: {} });
  f.add("alice", { type: "rating_logged", metadata: { title: "Portal", platform: "PC", rating: 100 } });
  assert.deepEqual((await read()).items, []);
  const calls = f.calls.length;
  for (const input of [null, [], 3, { limit: 0 }, { limit: 51 }, { limit: 1.5 }, { limit: "2" },
    { cursor: 1 }, { cursor: { id: "bad/id", createdAt: f.now.toISOString() } }, { cursor: { id: "a", createdAt: "invalid" } }]) {
    assert((await read(input)).error);
  }
  assert.equal(f.calls.length, calls);
});

test("account reset/deletion removes history and losing registered credentials also hides events", async () => {
  const f = feedFixture(); f.befriend("alice", "bob"); f.add("alice");
  assert.equal((await f.client("bob")()).items.length, 1);
  f.clearActor("alice");
  assert.deepEqual((await f.client("bob")()).items, []);
  f.add("alice"); f.players.find(p => p.id === "alice").email = null;
  assert.deepEqual((await f.client("bob")()).items, []);
  f.players.splice(f.players.findIndex(p => p.id === "alice"), 1);
  assert.deepEqual((await f.client("bob")()).items, []);
});
