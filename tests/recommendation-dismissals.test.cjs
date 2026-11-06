/* eslint-disable @typescript-eslint/no-require-imports -- Offline auth/database boundaries. */
const test = require("node:test"), assert = require("node:assert/strict");
const { loader } = require("./helpers/social-fixture.cjs");

function fixture() {
  const rows = new Map(), writes = [], created = [], revalidations = [];
  let actor = "alice", fail = false;
  class AuthenticationRequiredError extends Error { constructor() { super("Sign in"); this.name = "AuthenticationRequiredError"; } }
  const prisma = {
    recommendationDismissal: {
      findMany: async ({ where, select }) => {
        assert.deepEqual(select, { titleKey: true });
        return [...rows.values()].filter(row => row.userId === where.userId).map(({ titleKey }) => ({ titleKey }));
      },
      upsert: async args => {
        if (fail) throw Error("postgresql://private-connection-details");
        const { userId, titleKey } = args.where.userId_titleKey;
        assert.equal(userId, actor); assert.deepEqual(args.create, { userId, titleKey }); assert.deepEqual(args.update, {});
        const key = JSON.stringify([userId, titleKey]);
        if (!rows.has(key)) rows.set(key, { ...args.create });
        writes.push(args); return rows.get(key);
      },
    },
    game: { create: async ({ data }) => { created.push(data); return { id: 1, ...data }; } },
  };
  const load = () => loader({
    "@/lib/prisma": { prisma },
    "@/lib/player": { AuthenticationRequiredError, getAuthenticatedPlayerId: async () => {
      if (!actor || actor === "default-player") throw new AuthenticationRequiredError();
      return actor;
    } },
    "@/lib/recommendations": {}, "@/lib/rawg": { lookupRawgGame: async () => null },
    "next/cache": { revalidatePath: path => revalidations.push(path) },
  });
  return { load, rows, writes, created, revalidations, as: id => { actor = id; }, fail: () => { fail = true; } };
}

test("dismissal action persists canonical keys idempotently, including concurrent duplicate clicks", async () => {
  const f = fixture(), actions = f.load()("src/app/actions.ts");
  const results = await Promise.all(["  Café Adventure II™  ", "CAFE: Adventure 2", "Café Adventure (2020) II"].map(actions.dismissScoutRecommendation));
  assert.deepEqual(results, Array(3).fill({ titleKey: "cafe adventure 2" }));
  assert.equal(f.rows.size, 1);
  assert.deepEqual(f.revalidations, [], "Dismissals must not trigger a page refresh");
  // A fresh server-module instance and a later session still read the preference.
  assert.deepEqual(await f.load()("src/lib/recommendation-dismissals.ts").getDismissedRecommendationTitles("alice"), ["cafe adventure 2"]);
});

test("preferences are scoped to the authenticated player and reject local/anonymous writes", async () => {
  const f = fixture(), actions = f.load()("src/app/actions.ts");
  await actions.dismissScoutRecommendation("Tunic");
  f.as("bob");
  const prefs = f.load()("src/lib/recommendation-dismissals.ts");
  assert.deepEqual(await prefs.getDismissedRecommendationTitles("bob"), []);
  await actions.dismissScoutRecommendation("Tunic"); assert.equal(f.rows.size, 2);
  for (const actor of [null, "default-player"]) {
    f.as(actor);
    assert.deepEqual(await actions.dismissScoutRecommendation("SOMA"), { error: "Sign in to access your library." });
  }
  assert.equal(f.writes.length, 2);
});

test("invalid inputs and write failures return safe structured errors", async () => {
  const f = fixture(), { dismissScoutRecommendation } = f.load()("src/app/actions.ts");
  for (const invalid of [undefined, null, {}, ["Tunic"], 10, "", "   ", "!!!", "x".repeat(121), "Bad\u0000Title", "Bad\u202eTitle"]) {
    assert.equal(typeof (await dismissScoutRecommendation(invalid)).error, "string");
  }
  assert.equal(f.writes.length, 0);
  f.fail();
  const result = await dismissScoutRecommendation("Tunic");
  assert.equal(typeof result.error, "string"); assert(!JSON.stringify(result).includes("private-connection"));
});

test("a dismissed recommendation can still be manually added to the player's library", async () => {
  const f = fixture(), actions = f.load()("src/app/actions.ts");
  await actions.dismissScoutRecommendation("Café Adventure II");
  const form = new FormData();
  for (const [key, value] of Object.entries({ title: "Cafe Adventure 2", platform: "PC", genre: "RPG", releaseYear: "2020", lengthHours: "20", difficulty: "2", coverUrl: "https://example.com/cover.jpg" })) form.set(key, value);
  assert.deepEqual(await actions.createGame(form), { success: true, gameId: 1 });
  assert.equal(f.created[0].title, "Cafe Adventure 2"); assert.equal(f.created[0].userId, "alice");
  assert.equal(f.rows.size, 1, "Library creation does not undo the discovery preference");
});
