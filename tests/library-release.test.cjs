/* eslint-disable @typescript-eslint/no-require-imports -- Exercise release rules and metadata boundaries offline. */
const test = require("node:test"), assert = require("node:assert/strict");
const { loader } = require("./helpers/social-fixture.cjs");
const { isReleasedYear, isUnreleasedYear } = loader()("src/lib/game-release.ts");

test("only explicit future years seal owned games; Scout still requires a known release year", () => {
  for (const year of [null, undefined, 1999, 2026]) assert.equal(isUnreleasedYear(year, 2026), false);
  assert.equal(isUnreleasedYear(2027, 2026), true);
  for (const year of [null, undefined, 0, NaN, 2027]) assert.equal(isReleasedYear(year, 2026), false);
  assert.equal(isReleasedYear(2026, 2026), true);
});

test("backup import preserves unknown-year pins and clears explicit future-year pins", () => {
  const { sanitizeImportedGame } = loader()("src/lib/library-import.ts");
  const game = { title: "Steam Quest", platform: "PC", status: "Backlog", pinnedOrder: 2 };
  assert.equal(sanitizeImportedGame({ ...game, releaseYear: null }).pinnedOrder, 2);
  assert.equal(sanitizeImportedGame({ ...game, releaseYear: new Date().getFullYear() + 1 }).pinnedOrder, null);
});

test("metadata identity normalizes Steam trademarks/numerals but rejects ambiguous remakes and sequels", () => {
  const { matchLibraryMetadata } = loader({ "@/lib/prisma": {}, "@/lib/rawg": {}, "@/lib/igdb-catalog": {}, "@/lib/catalog-store": {} })("src/lib/library-metadata.ts");
  const original = { title: "Final Fantasy IX", releaseYear: 2000 };
  assert.equal(matchLibraryMetadata("FINAL FANTASY IX™", [original]), original);
  assert.equal(matchLibraryMetadata("Final Fantasy 9", [original]), original);
  assert.equal(matchLibraryMetadata("Alan Wake", [{ title: "Alan Wake II", releaseYear: 2023 }]), null);
  assert.equal(matchLibraryMetadata("Deus Ex", [{ title: "Deus Ex", releaseYear: 2000 }, { title: "Deus Ex", releaseYear: 2026 }]), null);
});

test("release repair fills missing years/genres once and preserves user metadata under concurrent edits", async () => {
  const games = [
    { id: 1, userId: "alice", title: "Final Fantasy IX", releaseYear: null, genre: null, lengthHours: 77, status: "Playing", rating: 5 },
    { id: 2, userId: "bob", title: "FINAL FANTASY IX", releaseYear: null, genre: "My genre", hoursPlayed: 12 },
    { id: 3, userId: "alice", title: "Unknown Quest", releaseYear: null, genre: null },
    { id: 4, userId: "alice", title: "Already Dated", releaseYear: 2001, genre: null },
    { id: 5, userId: "bob", title: "Concurrent Edit", releaseYear: null, genre: null },
  ];
  const calls = [], writes = [];
  let edited = false;
  const { repairLibraryReleaseYears } = loader({
    "@/lib/prisma": { prisma: { game: {
      findMany: async ({ where }) => games.filter(game => game.releaseYear === null && game.id > where.id.gt).map(game => ({ ...game })),
      updateMany: async ({ where, data }) => {
        writes.push({ where, data });
        const game = games.find(game => game.id === where.id && game.userId === where.userId && game.releaseYear === null && game.genre === where.genre);
        if (!game) return { count: 0 };
        assert.deepEqual(Object.keys(data).sort(), game.genre ? ["releaseYear"] : ["genre", "releaseYear"]);
        Object.assign(game, data); return { count: 1 };
      },
    } } },
    "@/lib/library-metadata": { libraryMetadataKey: game => loader()("src/lib/game-title.ts").normalizeGameTitle(game.title), loadLibraryMetadata: async titles => {
      calls.push(titles.map(game => game.title));
      if (edited) games.find(game => game.id === 5).releaseYear = 1998;
      return new Map([["final fantasy 9", { releaseYear: 2000, genre: "RPG" }], ["concurrent edit", { releaseYear: 2000, genre: "Action" }]]);
    } },
  })("src/lib/library-release-repair.ts");
  const before = structuredClone(games);
  const preview = await repairLibraryReleaseYears();
  assert.equal(preview.updated, 3); assert.deepEqual(games, before); assert.equal(writes.length, 0);
  edited = true;
  const result = await repairLibraryReleaseYears(true);
  assert.equal(result.updated, 2); assert.deepEqual(result.unresolved, ["Unknown Quest"]);
  assert.deepEqual(games[0], { ...before[0], releaseYear: 2000, genre: "RPG" });
  assert.deepEqual(games[1], { ...before[1], releaseYear: 2000 });
  assert.equal(games[4].releaseYear, 1998);
  assert.equal(calls[0].filter(title => /fantasy/i.test(title)).length, 1, "one provider lookup per normalized title across players");
  const rerun = await repairLibraryReleaseYears(true);
  assert.equal(rerun.updated, 0);
});

test("IGDB Steam identity resolves same-name ports without interpolating invalid IDs", async () => {
  const queries = [];
  const { lookupIgdbSteamGame } = loader({ "@/lib/igdb-api": { queryIgdb: async (endpoint, body) => {
    queries.push([endpoint, body]);
    return [{ game: { id: 123, name: "Final Fantasy IX", first_release_date: Date.UTC(2016, 3, 14) / 1000, genres: [{ name: "RPG" }] } }];
  } } })("src/lib/igdb-catalog.ts");
  assert.equal(await lookupIgdbSteamGame('1"; fields *;', new AbortController().signal), null);
  assert.equal(queries.length, 0);
  const result = await lookupIgdbSteamGame("377840", new AbortController().signal);
  assert.equal(result.releaseYear, 2016); assert.equal(result.genre, "RPG");
  assert.equal(queries[0][0], "external_games");
  assert.match(queries[0][1], /external_game_source = 1 & uid = "377840"/);
});
