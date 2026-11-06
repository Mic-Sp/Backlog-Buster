/* eslint-disable @typescript-eslint/no-require-imports -- Privacy queries exercise the server DAL against offline relational fixtures. */
const test = require("node:test"), assert = require("node:assert/strict");
const { fixture, loader } = require("./helpers/social-fixture.cjs");
const pair = (status, extra = {}) => ({ playerLowId: "alice", playerHighId: "bob", status,
  requestedById: status === "blocked" ? null : "alice", blockedByLow: false, blockedByHigh: false, ...extra });

test("public/friends/private dossiers authorize owner, accepted friends and anonymous visitors consistently", async () => {
  const f = fixture();
  const read = async id => f.as(id).load("src/lib/public-dossier.ts").getPublicDossier("alice-handle");
  for (const visibility of ["public", "friends", "private"]) {
    f.players[0].profileVisibility = visibility;
    for (const relation of [null, pair("pending"), pair("accepted")]) {
      f.setRelationship(relation);
      for (const viewer of [null, "default-player", "alice", "bob", "carol"]) {
        const authorized = viewer === "alice" || visibility === "public" || (visibility === "friends" && viewer === "bob" && relation?.status === "accepted");
        const beforeTrophies = f.queries.filter(([kind]) => kind === "trophies").length;
        const dossier = await read(viewer);
        assert.equal(Boolean(dossier), authorized, `${visibility}/${relation?.status}/${viewer}`);
        if (!authorized) assert.equal(f.queries.filter(([kind]) => kind === "trophies").length, beforeTrophies);
        if (dossier) { assert.equal(dossier.visibility, visibility); assert(!JSON.stringify(dossier).includes("SECRET_HASH")); }
      }
    }
  }
});

test("either side's block denies public dossiers to the peer while the owner can still read their own", async () => {
  const f = fixture();
  for (const flags of [{ blockedByLow: true }, { blockedByHigh: true }, { blockedByLow: true, blockedByHigh: true }]) {
    f.setRelationship(pair("blocked", flags));
    assert.equal(await f.as("bob").load("src/lib/public-dossier.ts").getPublicDossier("alice-handle"), null);
    assert.equal(await f.as("alice").load("src/lib/public-dossier.ts").getPublicDossier("bob-handle"), null);
    assert(await f.as("alice").load("src/lib/public-dossier.ts").getPublicDossier("alice-handle"));
    assert(await f.as(null).load("src/lib/public-dossier.ts").getPublicDossier("alice-handle"));
  }
});

test("accepted friendship authorizes both canonical pair orientations and removal revokes friends-only access", async () => {
  const f = fixture(); f.players[0].profileVisibility = "friends"; f.players[1].profileVisibility = "friends";
  const alice = f.as("alice"), bob = f.as("bob");
  await alice.actions.sendFriendRequest("bob"); await bob.actions.acceptFriendRequest("alice");
  assert(await alice.load("src/lib/public-dossier.ts").getPublicDossier("bob-handle"));
  assert(await bob.load("src/lib/public-dossier.ts").getPublicDossier("alice-handle"));
  await alice.actions.removeFriend("bob");
  assert.equal(await bob.load("src/lib/public-dossier.ts").getPublicDossier("alice-handle"), null);
  await alice.actions.updateProfileVisibility("private");
  assert.equal(await f.as(null).load("src/lib/public-dossier.ts").getPublicDossier("alice-handle"), null);
});

test("underscore handles use exact literal lookup and privacy conditions also constrain trophy reads", async () => {
  const f = fixture(); f.players[0].handle = "night_runner";
  const client = f.as("bob");
  assert(await client.load("src/lib/public-dossier.ts").getPublicDossier("%20NIGHT_RUNNER%20"));
  const profile = f.queries.find(([kind]) => kind === "profile")[1];
  const trophies = f.queries.find(([kind]) => kind === "trophies")[1];
  assert.equal(profile.where.handle.equals, "night\\_runner");
  assert.deepEqual(trophies.where.player, profile.where);
  assert(!profile.select.email && !profile.select.passwordHash && !profile.select.sessions);
});

test("restricted or missing dossiers produce generic metadata without share previews or indexing", () => {
  const build = loader()("src/lib/dossier-metadata.ts").buildDossierMetadata;
  for (const visibility of ["friends", "private"]) {
    const metadata = build({ visibility, identity: { callsign: "PRIVATE_NAME", handle: "PRIVATE_HANDLE" }, card: { totalXp: 9999 } });
    assert.equal(metadata.robots.index, false);
    assert(!JSON.stringify(metadata).includes("PRIVATE_"));
    assert(!metadata.openGraph && !metadata.twitter);
  }
  assert.equal(build(null).robots.index, false);
});
