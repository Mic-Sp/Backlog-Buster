/* eslint-disable @typescript-eslint/no-require-imports -- Real activity/mutation code with transactional in-memory persistence. */
const assert = require("node:assert/strict");
const { loader } = require("./social-fixture.cjs");
const form = values => { const result = new FormData(); for (const [key, value] of Object.entries(values)) result.set(key, String(value)); return result; };
const game = (id = 1, extra = {}) => ({ id, userId: "owner", title: "Portal 2", platform: "PC", ownershipType: null, status: "Backlog", activityRevision: 0,
  rating: null, hoursPlayed: 0, lengthHours: 10, difficulty: 1, earnedXp: 0, wasFlatlined: false, pinnedOrder: null,
  startedAt: null, completedAt: null, review: null, reviewSpoiler: false, notes: "PRIVATE_NOTES", franchise: null, genre: "Puzzle", releaseYear: 2011, steamAppId: null, coverUrl: null, ...extra });
function fixture({ games: initial = [game()], realAchievements = false } = {}) {
  let games = structuredClone(initial), achievements = [], events = [], sequence = Promise.resolve(), failEvent = false, registered = true, authenticated = true;
  let nextGame = 10, nextAchievement = 1;
  const eventCalls = [], locks = [], quietSyncs = [];
  const project = (row, select) => !select ? structuredClone(row) : Object.fromEntries(Object.keys(select).map(key => [key, structuredClone(row[key])]));
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => value && typeof value === "object"
    ? "in" in value ? value.in.includes(row[key]) : "not" in value ? row[key] !== value.not : true : row[key] === value);
  const tx = {
    $executeRaw: async (sql, ...values) => {
      if (sql.join("").includes('UPDATE "Game"')) {
        const updates = JSON.parse(values[0]);
        for (const update of updates) { const row = games.find(game => game.id === update.id && game.userId === values[1]);
          row.steamAppId = update.steamAppId; row.ownershipType ??= "Digital"; row.hoursPlayed = Math.max(row.hoursPlayed, update.hoursPlayed ?? row.hoursPlayed); }
        return updates.length;
      }
      assert.match(sql.join(""), /pg_advisory_xact_lock/); locks.push(values[0]); return 1;
    },
    player: { findFirst: async ({ where }) => registered && where.id === "owner" ? { id: "owner" } : null,
      update: async () => ({ id: "owner" }) },
    playerSession: { findUnique: async ({ select }) => !authenticated ? null : select.player
      ? { player: { id: "owner", handle: "owner", operatorName: "Owner" } } : { tokenHash: "token" } },
    game: {
      create: async ({ data }) => { assert.equal(data.userId, "owner"); const row = game(nextGame++, data); games.push(row); return structuredClone(row); },
      findMany: async ({ where, select }) => games.filter(row => matches(row, where)).map(row => project(row, select)),
      findUniqueOrThrow: async ({ where, select }) => { const row = games.find(row => matches(row, where)); if (!row) throw Error("Game not found"); return project(row, select); },
      update: async ({ where, data, select }) => {
        assert.equal(where.userId, "owner"); const row = games.find(row => matches(row, where)); if (!row) throw Error("Game not found");
        for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && "increment" in value ? row[key] + value.increment : value;
        return project(row, select);
      },
      createMany: async ({ data }) => { for (const value of data) games.push(game(nextGame++, value)); return { count: data.length }; },
      delete: async ({ where }) => { const row = games.find(row => matches(row, where)); assert(row); games = games.filter(other => other !== row); events = events.filter(event => event.gameId !== row.id); return row; },
    },
    userAchievement: {
      findMany: async ({ where }) => structuredClone(achievements.filter(row => matches(row, where))),
      createManyAndReturn: async ({ data, skipDuplicates }) => {
        assert.equal(skipDuplicates, true); const inserted = [];
        for (const value of data) if (!achievements.some(row => row.userId === value.userId && row.achievementKey === value.achievementKey)) {
          const row = { ...value, id: nextAchievement++, unlockedAt: new Date() }; achievements.push(row); inserted.push(row);
        }
        return structuredClone(inserted);
      },
    },
    activityEvent: {
      createMany: async ({ data, skipDuplicates }) => {
        assert.equal(skipDuplicates, true); eventCalls.push(structuredClone(data)); let count = 0;
        for (const value of data) if (!events.some(row => row.actorId === value.actorId && row.deduplicationKey === value.deduplicationKey)) {
          events.push({ ...value, id: `event-${events.length + 1}`, createdAt: new Date() }); count++;
        }
        if (failEvent) throw Error("PRIVATE_DATABASE_ERROR"); return { count };
      },
    },
  };
  const prisma = { ...tx, gameCatalog: { findMany: async () => [{ title: "Steam Game", genre: "Puzzle", estimatedHours: 10, releaseYear: 2011, coverUrl: null }] },
    $transaction: work => {
      const run = sequence.then(async () => { const before = structuredClone({ games, achievements, events });
        try { return await work(tx); } catch (error) { ({ games, achievements, events } = before); throw error; } });
      sequence = run.catch(() => {}); return run;
    },
  };
  const load = loader({
    "@/lib/prisma": { prisma }, "next/cache": { revalidatePath() {} },
    "@/lib/player": { getCurrentPlayerId: async () => "owner", getAuthenticatedPlayerId: async () => {
      if (!authenticated) throw Object.assign(Error("Sign in"), { name: "AuthenticationRequiredError" }); return "owner";
    } },
    "@/lib/auth-session": { readSessionHash: async () => "token" },
    "@/lib/api-resilience": { guardedRequest: async (_id, _feature, _input, work) => work() },
    "@/lib/rawg": { lookupRawgGame: async () => null }, "@/lib/recommendations": {}, "@/lib/admin": {},
    "@/lib/steam": { parseSteamIdentifier: () => ({ kind: "id", value: "76561198000000000" }), fetchSteamLibrary: async () => ({
      steamId: "76561198000000000", games: [{ steamAppId: "1", title: "Steam Game", playtimeMinutes: 6000, hoursPlayed: 100, coverUrl: null }],
    }) },
    ...(!realAchievements ? { "@/lib/achievements": { syncAndGetAchievements: async () => [], syncAchievementsForPlayer: async (_tx, id, emit) => { quietSyncs.push({ id, emit }); return []; } } } : {}),
  });
  return { load, prisma, tx, actions: load("src/app/actions.ts"), writer: load("src/lib/activity-events.ts"),
    get games() { return games; }, get achievements() { return achievements; }, get events() { return events; },
    eventCalls, locks, quietSyncs, failEvents: () => { failEvent = true; }, unclaim: () => { registered = false; },
    revoke: () => { authenticated = false; },
  };
}
module.exports = { fixture, form, game };
