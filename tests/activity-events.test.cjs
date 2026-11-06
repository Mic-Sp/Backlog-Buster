/* eslint-disable @typescript-eslint/no-require-imports -- Run actual mutation and event writers with offline transactions. */
const test = require("node:test"), assert = require("node:assert/strict");
const { fixture, form, game } = require("./helpers/activity-fixture.cjs");
const edit = (extra = {}) => form({ id: 1, status: "Playing", lengthHours: 10, difficulty: 1, ...extra });

test("event insertion is append-only, deduplicates delivery, and projects safe metadata", async () => {
  const f = fixture(), data = { type: "game_started", gameId: 1, deduplicationKey: "game:1:1:game_started",
    metadata: { title: "Portal 2", platform: "PC", notes: "PRIVATE_NOTES", email: "PRIVATE_EMAIL", userId: "forged" } };
  assert.equal(await f.writer.appendActivityEvents(f.tx, "owner", [data]), 1);
  const original = structuredClone(f.events[0]);
  assert.equal(await f.writer.appendActivityEvents(f.tx, "owner", [{ ...data, metadata: { title: "Changed", platform: "PC" } }]), 0);
  assert.deepEqual(f.events[0], original);
  assert.deepEqual(f.events[0].metadata, { title: "Portal 2", platform: "PC" });
  assert(!JSON.stringify(f.events).includes("PRIVATE_"));
});

test("repeated and concurrent status/rating submissions emit only real transitions, while later replays get new revisions", async () => {
  const f = fixture();
  await Promise.all([f.actions.startGame(edit()), f.actions.startGame(edit())]);
  assert.deepEqual(f.events.map(row => row.type), ["game_started"]);
  assert.equal(f.games[0].activityRevision, 1);
  await f.actions.completeGame(edit({ rating: 5 }));
  await f.actions.completeGame(edit({ rating: 5 }));
  assert.deepEqual(f.events.map(row => row.type), ["game_started", "game_completed", "rating_logged"]);
  await f.actions.updateGame(edit({ status: "Completed", rating: 4 }));
  await f.actions.updateGame(edit({ status: "Completed", rating: 4, notes: "Changed private note", title: "Edited title" }));
  assert.equal(f.events.filter(row => row.type === "rating_logged").length, 2);
  await f.actions.updateGame(edit({ status: "Backlog" }));
  assert.equal(f.events.length, 4, "Backlog/rating removal are quiet");
  await f.actions.acceptQuest(1);
  assert.equal(f.events.filter(row => row.type === "game_started").length, 2);
  assert.equal(new Set(f.events.map(row => row.deduplicationKey)).size, f.events.length);
  assert(!JSON.stringify(f.events).includes("PRIVATE_NOTES"));
});

test("all status entry points record changes, and no-op flatlining, metadata or rating clearing stays quiet", async () => {
  const f = fixture();
  assert.deepEqual(await f.actions.acceptQuest(1), { success: true });
  assert((await f.actions.acceptQuest(1)).error);
  await f.actions.flatlineGame(edit()); await f.actions.flatlineGame(edit());
  assert.deepEqual(f.events.map(row => row.type), ["game_started", "game_flatlined"]);
  await f.actions.updateGame(edit({ status: "Flatlined", notes: "New note", lengthHours: 20, genre: "Action" }));
  assert.equal(f.events.length, 2);
  await f.actions.updateGame(edit({ status: "Completed", rating: 3 }));
  assert.deepEqual(f.events.slice(-2).map(row => row.type), ["game_completed", "rating_logged"]);
  await f.actions.updateGame(edit({ status: "Completed", rating: "" }));
  assert.equal(f.events.length, 4);
});

test("event failures roll game state and revision back, and foreign/revoked actions never emit", async () => {
  const f = fixture(); f.failEvents();
  const before = structuredClone(f.games);
  const result = await f.actions.startGame(edit());
  assert(result.error); assert(!result.error.includes("PRIVATE_"));
  assert.deepEqual(f.games, before); assert.deepEqual(f.events, []);
  const other = fixture({ games: [game(1, { userId: "someone-else" })] });
  assert((await other.actions.startGame(edit())).error); assert.equal(other.events.length, 0);
  other.revoke(); assert((await other.actions.startGame(edit())).error); assert.equal(other.events.length, 0);
});

test("newly inserted achievement rows emit once across repeated/concurrent page checks", async () => {
  const f = fixture({ realAchievements: true, games: [game(1, { status: "Completed" })] });
  const sync = f.load("src/lib/achievements.ts").syncAndGetAchievements;
  await Promise.all([sync("owner"), sync("owner")]); await sync("owner");
  assert.equal(f.achievements.length, 1);
  assert.equal(f.events.length, 1); assert.equal(f.events[0].type, "achievement_unlocked");
  assert.equal(f.events[0].achievementId, f.achievements[0].id);
  assert.equal(f.events[0].metadata.achievementKey, "first-blood");
  const original = structuredClone(f.events); await sync("owner"); assert.deepEqual(f.events, original);
});

test("a losing achievement insert cannot emit and a failed event rolls back a winning unlock", async () => {
  const loser = fixture({ realAchievements: true, games: [game(1, { status: "Completed" })] });
  loser.tx.userAchievement.createManyAndReturn = async () => [];
  await loser.load("src/lib/achievements.ts").syncAndGetAchievements("owner");
  assert.equal(loser.events.length, 0);
  const failed = fixture({ realAchievements: true, games: [game(1, { status: "Completed" })] }); failed.failEvents();
  await assert.rejects(failed.load("src/lib/achievements.ts").syncAndGetAchievements("owner"));
  assert.equal(failed.events.length, 0); assert.equal(failed.achievements.length, 0);
});

test("unclaimed local achievement checks persist unlocks but never publish activity", async () => {
  const f = fixture({ realAchievements: true, games: [game(1, { status: "Completed" })] }); f.unclaim();
  await f.load("src/lib/achievements.ts").syncAndGetAchievements("owner");
  assert.equal(f.achievements.length, 1); assert.equal(f.events.length, 0);
});

test("backup import records one compact summary, quietly unlocks achievements, and replay is silent", async () => {
  const f = fixture({ realAchievements: true, games: [] });
  const payload = { mode: "json", content: JSON.stringify(Array.from({ length: 100 }, (_, id) => ({ title: `Game ${id}`, platform: "PC", status: "Completed", notes: "IMPORT_SECRET" }))) };
  const result = await f.actions.bulkImportGames(payload);
  assert.equal(result.importedCount, 100); assert(f.achievements.length > 0);
  assert.equal(f.events.length, 1); assert.equal(f.events[0].type, "library_imported");
  assert.deepEqual(f.events[0].metadata, { source: "backup", importedCount: 100 });
  assert(!JSON.stringify(f.events).includes("IMPORT_SECRET"));
  await f.load("src/lib/achievements.ts").syncAndGetAchievements("owner");
  await f.actions.bulkImportGames(payload);
  assert.equal(f.events.length, 1);
});

test("Steam synchronization stays quiet even when playtime earns achievements", async () => {
  const f = fixture({ realAchievements: true, games: [game(1, { steamAppId: "1", title: "Steam Game", status: "Playing" })] });
  const result = await f.actions.syncSteamLibrary({ identifier: "76561198000000000", updateHoursPlayed: true });
  assert.equal(result.updatedCount, 1); assert(f.achievements.length > 0);
  assert.equal(f.events.length, 0);
  await f.load("src/lib/achievements.ts").syncAndGetAchievements("owner");
  assert.equal(f.events.length, 0);
});

test("title lists produce one count summary and failed imports roll back games, quiet unlocks and activity", async () => {
  const titles = fixture({ games: [] });
  assert.equal((await titles.actions.bulkImportGames({ mode: "titles", content: "Portal\nHades" })).importedCount, 2);
  assert.equal(titles.events.length, 1);
  assert.deepEqual(titles.events[0].metadata, { source: "titles", importedCount: 2 });
  const failed = fixture({ games: [], realAchievements: true }); failed.failEvents();
  const result = await failed.actions.bulkImportGames({ mode: "json", content: '[{"title":"Game","status":"Completed"}]' });
  assert(result.error); assert.deepEqual(failed.games, []); assert.deepEqual(failed.achievements, []); assert.deepEqual(failed.events, []);
});

test("deleting a source game removes its activity", async () => {
  const f = fixture(); await f.actions.startGame(edit()); assert.equal(f.events.length, 1);
  await f.actions.deleteGame(form({ id: 1 })); assert.equal(f.events.length, 0);
});
