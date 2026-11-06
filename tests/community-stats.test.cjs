/* eslint-disable @typescript-eslint/no-require-imports -- Load TypeScript with mocked server boundaries. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.resolve(__dirname, "..", file);
    const instance = new Module(filename, module);
    instance.filename = filename;
    instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = name => name === "server-only" ? {} : Object.hasOwn(mocks, name) ? mocks[name]
      : name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`) : original(name);
    instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, filename);
    cache.set(file, instance.exports);
    return instance.exports;
  }
  return load;
}

const { aggregateCommunityStats, getCommunityGameKey } = loader()("src/lib/community-stats.ts");
const game = (id, overrides = {}) => ({
  id, userId: `player-${id}`, title: "Dark Souls III", releaseYear: 2016,
  platform: "PC", status: "Completed", rating: 4, hoursPlayed: 20, ...overrides,
});

test("canonical identity matches accents, punctuation, whitespace and sequel numerals", () => {
  const games = [game(1, { title: "  Dárk Souls: III™  " }), game(2, { title: "dark souls 3" })];
  const [stats] = aggregateCommunityStats(games);
  assert.equal(stats.key, getCommunityGameKey("Dark Souls III", 2016));
  assert.equal(stats.normalizedTitle, "dark souls 3");
  assert.equal(stats.ratingCount, 2);
  assert.equal(stats.completionCount, 2);
});

test("known release years separate remakes and null years use their own title-only fallback", () => {
  const games = [game(1, { releaseYear: 2016 }), game(2, { releaseYear: 2026 }),
    game(3, { releaseYear: null }), game(4, { title: "Dark Souls 3", releaseYear: null })];
  const stats = aggregateCommunityStats(games);
  assert.equal(stats.length, 3);
  assert.equal(stats.find(group => group.releaseYear === null).ratingCount, 2);
  assert.equal(stats.find(group => group.releaseYear === 2016).ratingCount, 1);
  assert.equal(stats.find(group => group.releaseYear === 2026).ratingCount, 1);
  assert.equal(getCommunityGameKey("Dark Souls III", null), JSON.stringify(["dark souls 3"]));
});

test("each player contributes only once per metric across conflicting platform copies, independent of input order", () => {
  const games = [game(30, { userId: "one", platform: "PS5", rating: 5, hoursPlayed: 90 }),
    game(10, { userId: "one", rating: 2, hoursPlayed: 10 }),
    game(20, { userId: "two", rating: 4, hoursPlayed: 30 })];
  const before = structuredClone(games);
  const [stats] = aggregateCommunityStats(games);
  assert.equal(stats.ratingCount, 2);
  assert.equal(stats.ratingAvg, 3);
  assert.equal(stats.completionCount, 2);
  assert.equal(stats.completionAvgHours, 20);
  assert.deepEqual(stats.ratingDistribution.map(bucket => bucket.count), [0, 1, 0, 1, 0]);
  assert.deepEqual(aggregateCommunityStats([...games].reverse()), [stats]);
  assert.deepEqual(games, before);
});

test("unrated or unmeasured copies do not suppress another copy's valid contribution", () => {
  const games = [game(1, { userId: "one", status: "Backlog", rating: null, hoursPlayed: 0 }),
    game(2, { userId: "one", status: "Playing", rating: 3, hoursPlayed: 100 }),
    game(3, { userId: "one", rating: 5, hoursPlayed: 12 }),
    game(4, { userId: "one", rating: 1, hoursPlayed: 80 })];
  const [stats] = aggregateCommunityStats(games);
  assert.equal(stats.ratingCount, 1);
  assert.equal(stats.ratingAvg, 3);
  assert.equal(stats.completionCount, 1);
  assert.equal(stats.completionAvgHours, 12);
});

test("computes means, an odd median and all five percentage buckets over rated players", () => {
  const [stats] = aggregateCommunityStats([
    game(1, { rating: 1, hoursPlayed: 30 }), game(2, { rating: 2, hoursPlayed: 5 }),
    game(3, { rating: 3, hoursPlayed: 10 }), game(4, { rating: 4, hoursPlayed: 0 }),
    game(5, { rating: 5, hoursPlayed: 0 }), game(6, { rating: null, hoursPlayed: 0 }),
  ]);
  assert.equal(stats.ratingAvg, 3);
  assert.equal(stats.ratingCount, 5);
  assert.deepEqual(stats.ratingDistribution, [1, 2, 3, 4, 5].map(rating => ({ rating, count: 1, percentage: 20 })));
  assert.equal(stats.completionCount, 3);
  assert.equal(stats.completionAvgHours, 15);
  assert.equal(stats.completionMedianHours, 10);
});

test("even medians average the middle samples without rounding; percentages retain precision", () => {
  const [stats] = aggregateCommunityStats([game(1, { hoursPlayed: 1, rating: 1 }),
    game(2, { hoursPlayed: 2, rating: 5 }), game(3, { hoursPlayed: 7, rating: 5 }),
    game(4, { hoursPlayed: 20, rating: null })]);
  assert.equal(stats.completionMedianHours, 4.5);
  assert.equal(stats.completionAvgHours, 7.5);
  assert.equal(stats.ratingAvg, 11 / 3);
  assert.equal(stats.ratingDistribution[0].percentage, 1 / 3 * 100);
  assert.equal(stats.ratingDistribution[4].percentage, 2 / 3 * 100);
});

test("only Completed games with valid positive logged hours contribute completion samples", () => {
  const games = [game(1, { hoursPlayed: 0, lengthHours: 999 }),
    ...["Backlog", "Playing", "Flatlined"].map((status, index) => game(index + 2, { status })),
    ...[-1, NaN, Infinity, 2.5, 10001].map((hoursPlayed, index) => game(index + 5, { hoursPlayed })),
    game(10, { hoursPlayed: 7, lengthHours: 50 })];
  const [stats] = aggregateCommunityStats(games);
  assert.equal(stats.completionCount, 1);
  assert.equal(stats.completionAvgHours, 7);
  assert.equal(stats.completionMedianHours, 7);
  assert.equal(stats.ratingCount, games.length);
});

test("empty samples return null averages, zero counts and zero percentages; invalid identities are skipped", () => {
  assert.deepEqual(aggregateCommunityStats([]), []);
  const [stats] = aggregateCommunityStats([null, 0, 6, 2.5, NaN, Infinity].map((rating, index) =>
    game(index + 1, { rating, hoursPlayed: 0 })));
  assert.equal(stats.ratingAvg, null);
  assert.equal(stats.ratingCount, 0);
  assert.equal(stats.completionAvgHours, null);
  assert.equal(stats.completionMedianHours, null);
  assert.equal(stats.completionCount, 0);
  assert.deepEqual(stats.ratingDistribution, [1, 2, 3, 4, 5].map(rating => ({ rating, count: 0, percentage: 0 })));
  assert.deepEqual(aggregateCommunityStats([game(1, { title: "!!!" }), game(2, { userId: " " })]), []);
});

function completionActions() {
  let current;
  const effects = [];
  const prisma = {
    $transaction: async work => work(prisma), $executeRaw: async () => 1,
    player: { findFirst: async () => ({ id: "owner" }) },
    activityEvent: { createMany: async ({ data }) => ({ count: data.length }) },
    game: {
      findUniqueOrThrow: async ({ where }) => { assert.deepEqual(where, { id: 1, userId: "owner" }); return { ...current }; },
      update: async ({ where, data }) => {
        assert.deepEqual(where, { id: 1, userId: "owner" });
        const revision = current.activityRevision ?? 0;
        Object.assign(current, data);
        if (data.activityRevision?.increment) current.activityRevision = revision + 1;
        return current;
      },
    },
  };
  const actions = loader({
    "next/cache": { revalidatePath: value => effects.push(value) },
    "@/lib/player": { getAuthenticatedPlayerId: async () => "owner" },
    "@/lib/prisma": { prisma },
    "@/lib/achievements": { syncAndGetAchievements: async userId => effects.push(userId) },
    "@/lib/library-vault": {}, "@/lib/recommendations": {}, "@/lib/rawg": {},
    "@/lib/admin": {}, "@/lib/saga-chronology-cache": {}, "@/lib/saga-lore": {},
  })("src/app/actions.ts");
  return { actions, effects, setGame: value => { current = value; }, getGame: () => current };
}

for (const actionName of ["updateGame", "completeGame"]) {
  test(`${actionName} preserves zero and measured hours through completion instead of substituting estimates`, async () => {
    const fixture = completionActions();
    for (const [saved, submitted, expected] of [[0, undefined, 0], [0, 0, 0], [0, 5, 5], [5, undefined, 5], [5, 0, 0], [5, 3, 3], [20, undefined, 20]]) {
      fixture.setGame(game(1, { userId: "owner", status: "Playing", hoursPlayed: saved, lengthHours: 10 }));
      const form = new FormData();
      for (const [name, value] of Object.entries({ id: 1, status: "Completed", lengthHours: 10, difficulty: 2 })) form.set(name, String(value));
      if (submitted !== undefined) form.set("hoursPlayed", String(submitted));
      assert.deepEqual(await fixture.actions[actionName](form), { success: true });
      const completed = fixture.getGame();
      assert.equal(completed.status, "Completed");
      assert.equal(completed.hoursPlayed, expected);
      assert.equal(completed.earnedXp, (actionName === "completeGame" ? Math.max(10, expected) : 10) * 20);
      const [stats] = aggregateCommunityStats([completed]);
      assert.equal(stats.completionCount, expected > 0 ? 1 : 0);
      assert.equal(stats.completionAvgHours, expected || null);
    }
    assert.deepEqual(fixture.effects, Array.from({ length: 7 }, () => ["owner", "/"]).flat());
  });
}
