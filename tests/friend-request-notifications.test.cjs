/* eslint-disable @typescript-eslint/no-require-imports -- Exercise authenticated queries and per-player notification persistence offline. */
const test = require("node:test"), assert = require("node:assert/strict");
const { fixture, loader } = require("./helpers/social-fixture.cjs");
const helpers = loader()("src/lib/friend-request-notifications.ts");
const request = (id, name = "Nova") => ({ id, requester: { id: "nova", operatorName: name, handle: "nova" } });

function notificationsFixture() {
  const f = fixture();
  f.prisma.friendship.count = async ({ where }) => f.rows.filter(row => f.matches(row, where)).length;
  return f;
}

test("only live incoming requests count, in either pair orientation, with safe requester identities", async () => {
  const f = notificationsFixture();
  await f.as("alice").actions.sendFriendRequest("bob");
  await f.as("carol").actions.sendFriendRequest("bob");
  const incoming = await f.as("bob").load("src/app/social-actions.ts").fetchIncomingFriendRequests();
  assert.equal(incoming.viewerId, "bob"); assert.equal(incoming.total, 2);
  assert.deepEqual(new Set(incoming.requests.map(row => row.requester.id)), new Set(["alice", "carol"]));
  for (const row of incoming.requests) {
    assert.deepEqual(Object.keys(row.requester).sort(), ["handle", "id", "operatorName"]);
    assert.match(row.id, /:\d{4}-\d{2}-\d{2}T/);
  }
  assert(!JSON.stringify(incoming).includes("SECRET_HASH")); assert(!JSON.stringify(incoming).includes("email"));
  assert.equal((await f.as("alice").load("src/lib/incoming-friend-requests.ts").getIncomingFriendRequests()).total, 0, "sent requests never inflate unread count");
  await f.as("bob").actions.acceptFriendRequest("alice");
  assert.equal((await f.as("bob").load("src/lib/incoming-friend-requests.ts").getIncomingFriendRequests()).total, 1);
  await f.as("bob").actions.declineFriendRequest("carol");
  assert.equal((await f.as("bob").load("src/lib/incoming-friend-requests.ts").getIncomingFriendRequests()).total, 0);
});

test("blocks, deleted/unclaimed senders and revoked viewers cannot leak notifications", async () => {
  for (const change of [
    async f => f.as("alice").actions.blockPlayer("bob"),
    async f => f.as("bob").actions.blockPlayer("alice"),
    async f => { f.players.find(row => row.id === "alice").email = null; },
    async f => { f.players.splice(f.players.findIndex(row => row.id === "alice"), 1); },
  ]) {
    const f = notificationsFixture(); await f.as("alice").actions.sendFriendRequest("bob"); await change(f);
    const result = await f.as("bob").load("src/lib/incoming-friend-requests.ts").getIncomingFriendRequests();
    assert.equal(result.total, 0); assert.deepEqual(result.requests, []);
  }
  const f = notificationsFixture();
  for (const id of [null, "default-player"]) {
    assert.equal(typeof (await f.as(id).load("src/app/social-actions.ts").fetchIncomingFriendRequests()).error, "string");
  }
  const find = f.prisma.friendship.findMany;
  f.prisma.friendship.findMany = async args => { const result = await find(args); f.revoke("bob"); return result; };
  assert.equal(typeof (await f.as("bob").load("src/app/social-actions.ts").fetchIncomingFriendRequests()).error, "string");
});

test("new requests from the same person have distinct notification identities", async () => {
  const f = notificationsFixture(); await f.as("alice").actions.sendFriendRequest("bob");
  f.rows[0].createdAt = new Date("2026-11-01T12:00:00.000Z");
  const read = () => f.as("bob").load("src/lib/incoming-friend-requests.ts").getIncomingFriendRequests();
  const first = (await read()).requests[0];
  await f.as("alice").actions.sendFriendRequest("bob"); assert.equal((await read()).requests[0].id, first.id, "duplicate sends stay quiet");
  await f.as("alice").actions.cancelFriendRequest("bob");
  await f.as("alice").actions.sendFriendRequest("bob");
  f.rows[0].createdAt = new Date("2026-11-02T12:00:00.000Z");
  const second = (await read()).requests[0]; assert.notEqual(second.id, first.id);
  assert.deepEqual(helpers.unseenFriendRequests([second], [first.id]), [second]);
});

test("seen requests survive reloads, are scoped by player, and merge cross-tab dismissals", () => {
  const data = new Map(), storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const first = helpers.markFriendRequestsSeen(storage, "alice", [], ["one"]);
  assert.deepEqual(helpers.unseenFriendRequests([request("one"), request("two")], first), [request("two")]);
  assert.deepEqual(helpers.readSeenFriendRequests(storage, "alice"), ["one"]);
  assert.deepEqual(helpers.readSeenFriendRequests(storage, "bob"), []);
  assert.deepEqual(helpers.markFriendRequestsSeen(storage, "alice", [], ["two"]), ["one", "two"]);
  assert.deepEqual(helpers.unseenFriendRequests([request("one"), request("two")], helpers.readSeenFriendRequests(storage, "alice")), []);
});

test("corrupt or blocked storage is harmless and seen history stays bounded", () => {
  for (const raw of ["{", "null", '"one"', '[null,1,{},"good"]', " ".repeat(150001)]) {
    const storage = { getItem: () => raw, setItem() {} };
    assert.deepEqual(helpers.readSeenFriendRequests(storage, "alice"), raw.includes('"good"') ? ["good"] : []);
  }
  const blocked = { getItem() { throw Error("Blocked"); }, setItem() { throw Error("Blocked"); } };
  assert.deepEqual(helpers.markFriendRequestsSeen(blocked, "alice", [], ["one"]), ["one"]);
  assert.equal(helpers.markFriendRequestsSeen(blocked, "alice", [], Array.from({ length: 700 }, (_, i) => String(i))).length, 500);
  const oldTab = Array.from({ length: 500 }, (_, i) => `old-${i}`);
  const stored = { getItem: () => '["dismissed-now"]', setItem() {} };
  assert(helpers.markFriendRequestsSeen(stored, "alice", oldTab, ["dismissed-now"]).includes("dismissed-now"));
});
