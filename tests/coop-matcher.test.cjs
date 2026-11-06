/* eslint-disable @typescript-eslint/no-require-imports -- Pure matching and server privacy queries with offline fixtures. */
const test = require("node:test"), assert = require("node:assert/strict");
const { loader, fixture } = require("./helpers/social-fixture.cjs");
const { matchCoopBacklogs: match } = loader()("src/lib/coop-matcher.ts");
const game = (title, extra = {}) => ({ id: 1, title, releaseYear: 2011, steamAppId: null, platform: "PC", status: "Backlog", hoursPlayed: 0, coverUrl: null, ...extra });
const library = (id, games) => ({ player: { id, operatorName: id, handle: `${id}-handle` }, games });
const catalog = (title, extra = {}) => ({ title, releaseYear: 2011, tags: [], multiplayer: true, coop: true, onlineCoop: true, localCoop: null, coverUrl: null, ...extra });
const shared = (one, two, rows = [], options = {}) => match([library("alice", one), library("bob", two)], rows, options);

test("Steam IDs match renamed titles and take priority over inconsistent release metadata", () => {
  const result = shared([game("Original Title", { steamAppId: "620" })], [game("Localized Title", { steamAppId: "620", releaseYear: 2012, status: "Playing", hoursPlayed: 3 })], [catalog("Original Title")]);
  assert.equal(result.length, 1); assert.equal(result[0].key, "steam:620");
  assert.deepEqual(result[0].participants.map(p => [p.playerId, p.status, p.hoursPlayed]), [["alice", "Backlog", 0], ["bob", "Playing", 3]]);
  assert.equal(shared([game("Same", { steamAppId: "10" })], [game("Same", { steamAppId: "11" })], [catalog("Same")]).length, 0);
});

test("normalized title/year handles accents, punctuation and Roman/Arabic sequels without merging remakes", () => {
  assert.equal(shared([game("Héro’s Journey II™")], [game("Heros Journey 2")], [catalog("Heros Journey II")]).length, 1);
  assert.equal(shared([game("Doom", { releaseYear: 1993 })], [game("DOOM", { releaseYear: 2016 })], [catalog("Doom", { releaseYear: 2016 })]).length, 0);
  assert.equal(shared([game("Story 2")], [game("Story 3")], [catalog("Story 2")]).length, 0);
});

test("title-only fallback works for unambiguous missing years but cannot bridge separate releases", () => {
  assert.equal(shared([game("Portal", { releaseYear: null })], [game("Portal")], [catalog("Portal")]).length, 1);
  const ambiguous = shared([game("Doom", { releaseYear: null })], [game("Doom", { releaseYear: 1993 }), game("Doom", { id: 2, releaseYear: 2016 })], [], { includeUnknown: true });
  assert.deepEqual(ambiguous, []);
  const unknown = shared([game("Mystery", { releaseYear: null })], [game("Mystery", { releaseYear: null })], [], { includeUnknown: true });
  assert.equal(unknown.length, 1); assert.equal(unknown[0].releaseYear, null);
});

test("duplicate platform copies collapse to one game and prefer a shared platform before an active copy", () => {
  const result = shared([game("Portal", { steamAppId: "620" }), game("Portal", { id: 2, platform: "PS3", status: "Playing", hoursPlayed: 4 })],
    [game("Portal", { steamAppId: "620", platform: "Steam" })], [catalog("Portal")]);
  assert.equal(result.length, 1); assert.equal(result[0].participants[0].status, "Backlog");
  assert.equal(result[0].samePlatform, true);
  const active = shared([game("Portal"), game("Portal", { id: 2, status: "Playing", hoursPlayed: 4 })], [game("Portal")], [catalog("Portal")]);
  assert.equal(active[0].participants[0].status, "Playing");
  assert.equal(shared([game("Portal", { platform: "PC (Microsoft Windows)" })], [game("Portal", { platform: "Steam" })], [catalog("Portal")])[0].samePlatform, true);
});

test("only Backlog/Playing released titles appear by default; completed replay is explicit and Flatlined stays excluded", () => {
  for (const status of ["Completed", "Flatlined", "unknown"]) assert.equal(shared([game("Portal", { status })], [game("Portal")], [catalog("Portal")]).length, 0);
  assert.equal(shared([game("Portal", { status: "Completed" })], [game("Portal")], [catalog("Portal")], { includeFinished: true }).length, 1);
  assert.equal(shared([game("Portal", { status: "Flatlined" })], [game("Portal")], [catalog("Portal")], { includeFinished: true }).length, 0);
  assert.equal(shared([game("Future", { releaseYear: 2099 })], [game("Future", { releaseYear: 2099 })], [catalog("Future", { releaseYear: 2099 })], { currentYear: 2026 }).length, 0);
});

test("capabilities use positive flags/tags, rank online co-op first, and unknown or single-player data stays honest", () => {
  const games = [game("Online"), game("PVP"), game("Unknown"), game("Solo"), game("Local")];
  const rows = [catalog("Online"), catalog("PVP", { coop: null, onlineCoop: null, multiplayer: true }),
    catalog("Solo", { coop: false, onlineCoop: null, multiplayer: false, tags: ["co-op", "multiplayer"] }),
    catalog("Local", { coop: null, onlineCoop: null, multiplayer: null, tags: ["local-co-op"] })];
  const matches = shared(games, games, rows);
  assert.deepEqual(matches.map(game => game.title), ["Online", "Local", "PVP"]);
  assert.deepEqual(matches[1].capabilities, ["Local co-op"]);
  const all = shared(games, games, rows, { includeUnknown: true });
  assert.equal(all.at(-1).title, "Unknown"); assert.equal(all.at(-1).capability, "unknown");
  assert(!all.some(game => game.title === "Solo"));
});

test("catalog evidence respects remake years and never borrows capabilities from an ambiguous edition", () => {
  const rows = [catalog("Story", { releaseYear: 1993, multiplayer: true }), catalog("Story", { releaseYear: 2016, coop: false, multiplayer: false, onlineCoop: false })];
  assert.equal(shared([game("Story", { releaseYear: 2016 })], [game("Story", { releaseYear: 2016 })], rows).length, 0);
  const uncertain = shared([game("Story", { releaseYear: null })], [game("Story", { releaseYear: null })], rows, { includeUnknown: true });
  assert.equal(uncertain[0].capability, "unknown");
});

test("group intersection requires every selected friend and projects only safe participant fields", () => {
  const games = [game("Portal", { notes: "PRIVATE_NOTE", passwordHash: "PRIVATE_HASH", hoursPlayed: 5 })];
  const result = match([library("alice", games), library("bob", games), library("carol", [game("Other")])], [catalog("Portal")]);
  assert.deepEqual(result, []);
  const group = match([library("alice", games), library("bob", games), library("carol", games)], [catalog("Portal")]);
  assert.equal(group[0].participants.length, 3); assert(!JSON.stringify(group).includes("PRIVATE_"));
  assert.deepEqual(match([library("alice", games)], []), []);
  assert.deepEqual(match([library("alice", games), library("alice", games)], []), []);
});

function socialFixture() {
  const f = fixture(), games = [game("Portal", { userId: "alice" }), game("Portal", { id: 2, userId: "bob" }), game("Private Game", { id: 3, userId: "carol" })];
  const reads = [];
  f.prisma.game.findMany = async args => { reads.push(args); return games.filter(row => f.matches(row, args.where)); };
  f.prisma.gameCatalog = { findMany: async () => [catalog("Portal")] };
  return { ...f, reads, actions: id => f.as(id).load("src/app/social-actions.ts"),
    library: id => f.as(id).load("src/lib/social.ts") };
}

test("server matcher requires accepted visible friends before reading libraries and rechecks after I/O", async () => {
  const f = socialFixture(), actions = f.actions("alice");
  assert((await actions.fetchCoopMatches({ friendIds: ["bob"] })).error); assert.equal(f.reads.length, 0);
  f.rows.push({ playerLowId: "alice", playerHighId: "bob", status: "pending", requestedById: "alice", blockedByLow: false, blockedByHigh: false });
  assert((await actions.fetchCoopMatches({ friendIds: ["bob"] })).error);
  f.rows[0].status = "accepted";
  assert.equal((await actions.fetchCoopMatches({ friendIds: ["bob"] })).games.length, 1);
  assert(!f.reads[0].select.notes && !f.reads[0].select.rating);
  f.players.find(p => p.id === "bob").profileVisibility = "private";
  assert((await actions.fetchCoopMatches({ friendIds: ["bob"] })).error);
  f.players.find(p => p.id === "bob").profileVisibility = "friends";
  f.prisma.gameCatalog.findMany = async () => { f.rows[0].status = "blocked"; return [catalog("Portal")]; };
  assert((await actions.fetchCoopMatches({ friendIds: ["bob"] })).error);
});

test("matcher options reject forged actors, guests, invalid IDs, duplicated friends and invalid toggles", async () => {
  const f = socialFixture();
  for (const viewer of [null, "default-player"]) assert.match((await f.actions(viewer).fetchCoopMatches({ friendIds: ["bob"] })).error, /Sign in/);
  for (const input of [null, [], { friendIds: [] }, { friendIds: ["alice"] }, { friendIds: ["bob", "bob"] }, { friendIds: ["bad/id"] }, { friendIds: ["bob"], includeUnknown: "yes" }, { friendIds: ["1", "2", "3", "4", "5"] }]) assert((await f.actions("alice").fetchCoopMatches(input)).error);
  assert.equal(f.reads.length, 0);
});

test("social overview lists participants' pending/friend/own-block identities without credentials or hidden libraries", async () => {
  const f = socialFixture(), alice = f.as("alice").actions;
  await alice.sendFriendRequest("bob");
  assert.equal((await f.actions("bob").fetchSocialOverview()).connections[0].relationship, "incoming");
  await f.as("bob").actions.acceptFriendRequest("alice");
  f.players.find(p => p.id === "bob").profileVisibility = "private";
  let overview = await f.actions("alice").fetchSocialOverview();
  assert.equal(overview.connections[0].relationship, "friends"); assert.equal(overview.connections[0].canViewProfile, false);
  assert(!JSON.stringify(overview).includes("SECRET_HASH")); assert(!JSON.stringify(overview).includes("email"));
  await alice.blockPlayer("bob");
  overview = await f.actions("alice").fetchSocialOverview(); assert.equal(overview.connections[0].relationship, "blocked");
  assert.deepEqual((await f.actions("bob").fetchSocialOverview()).connections, []);
});

test("dossier relationship context is registered-session-only and reflects pending/accepted/self states", async () => {
  const f = socialFixture();
  assert.equal(await f.library(null).getDossierSocialContext("bob-handle"), null);
  assert.equal((await f.library("bob").getDossierSocialContext("bob-handle")).relationship, "self");
  assert.equal((await f.library("alice").getDossierSocialContext("bob-handle")).relationship, "none");
  await f.as("alice").actions.sendFriendRequest("bob");
  assert.equal((await f.library("alice").getDossierSocialContext("bob-handle")).relationship, "outgoing");
  assert.equal((await f.library("bob").getDossierSocialContext("alice-handle")).relationship, "incoming");
  await f.as("bob").actions.acceptFriendRequest("alice");
  assert.equal((await f.library("alice").getDossierSocialContext("bob-handle")).relationship, "friends");
  await f.as("bob").actions.blockPlayer("alice");
  assert.equal(await f.library("alice").getDossierSocialContext("bob-handle"), null);
});
