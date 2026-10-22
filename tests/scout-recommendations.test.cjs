/* eslint-disable @typescript-eslint/no-require-imports -- Mock server/database/provider boundaries. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const seed = { title: "Seed", platform: "PC", genre: "Action", status: "Completed", rating: 5, earnedXp: 100 };
const candidate = (title) => ({ title, preferredPlatform: "PC", reason: `AI rationale for ${title}.` });
const metadata = { platforms: ["Console", "PC"], genre: "Action", releaseYear: 2020, coverUrl: "https://example.com/cover.jpg", playtime: 4 };
function fixture({ ai = async () => [], lookup = async () => metadata, games = [seed] } = {}) {
  const lookups = [], aiCalls = [];
  const mocks = {
    "server-only": {},
    "@/lib/player": { getCurrentPlayerId: async () => "player" },
    "@/lib/prisma": { prisma: { game: { findMany: async ({ where }) => { assert.equal(where.userId, "player"); return games; } } } },
    "@/lib/scout-ai": { getAIScoutCandidates: async (...args) => { aiCalls.push(args); return ai(...args); } },
    "@/lib/rawg": { lookupRawgGame: async (title, reportRateLimit) => { assert.equal(reportRateLimit, true); lookups.push(title); return lookup(title); } },
    "@/lib/scout-catalog": { franchiseAffinities: {}, genreNeighbors: {}, generalDiscovery: ["Fallback 1", "Fallback 2", "Fallback 3", "Fallback 4", "Fallback 5", "Fallback 6"] },
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.resolve(__dirname, "..", file), instance = new Module(filename, module);
    instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`) : original(name);
    instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
    cache.set(file, instance.exports);
    return instance.exports;
  }
  return { ...load("src/lib/recommendations.ts"), lookups, aiCalls };
}

test("AI is primary, keeps its reasons, and uses existing metadata/playtime mapping", async () => {
  const input = ["AI A", "AI B", "AI C"].map(candidate);
  const context = fixture({ ai: async () => input });
  const result = await context.getExternalRecommendations("player", ["Seen"]);
  assert.deepEqual(context.aiCalls, [[[seed], ["Seen"]]]);
  assert.deepEqual(context.lookups, input.map((pick) => pick.title));
  assert.deepEqual(result, input.map((pick) => ({ title: pick.title, platform: "PC", genre: "Action", releaseYear: 2020, coverUrl: metadata.coverUrl, lengthHours: 15, difficulty: 2, reason: pick.reason })));
});

test("partial AI results fill from static catalog without owned, excluded or duplicate titles", async () => {
  const context = fixture({
    ai: async () => ["Fallback 1", "AI B", "fallback 1", "SEED", "FALLBACK 2", "Fallback 3"].map(candidate),
    games: [seed, { ...seed, title: "Fallback 3", status: "Backlog" }],
  });
  const result = await context.getExternalRecommendations("player", ["fallback 2"]);
  assert.deepEqual(result.map((pick) => pick.title), ["Fallback 1", "AI B", "Fallback 4"]);
  assert.equal(result[0].reason, candidate("Fallback 1").reason);
  assert.match(result[2].reason, /curated/);
  assert.equal(new Set(context.lookups.map((title) => title.toLowerCase())).size, context.lookups.length);
  assert.ok(!context.lookups.some((title) => ["seed", "fallback 2", "fallback 3"].includes(title.toLowerCase())));
});

test("missing, future, undated and failed AI lookups preserve successes and trigger fallback", async () => {
  const context = fixture({
    ai: async () => ["Good", "Future", "Undated", "Missing", "Throws"].map(candidate),
    lookup: async (title) => {
      if (title === "Future") return { ...metadata, releaseYear: new Date().getFullYear() + 1 };
      if (title === "Undated") return { ...metadata, releaseYear: null };
      if (title === "Missing") return null;
      if (title === "Throws") throw new Error("RAWG lookup failed");
      return metadata;
    },
  });
  assert.deepEqual((await context.getExternalRecommendations()).map((pick) => pick.title), ["Good", "Fallback 1", "Fallback 2"]);
});

test("AI timeout, validation and quota errors gracefully fall back", async () => {
  for (const failure of [new DOMException("timeout", "TimeoutError"), new Error("Invalid JSON"), new Error("Invalid recommendation data"), new Error("Quota exceeded")]) {
    const context = fixture({ ai: async () => { throw failure; } });
    assert.deepEqual((await context.getExternalRecommendations()).map((pick) => pick.title), ["Fallback 1", "Fallback 2", "Fallback 3"]);
  }
});

test("fallback skips ineligible metadata and returns fewer only when no valid pool remains", async () => {
  const context = fixture({ lookup: async (title) => title === "Fallback 1" ? null : metadata });
  assert.deepEqual((await context.getExternalRecommendations()).map((pick) => pick.title), ["Fallback 2", "Fallback 3", "Fallback 4"]);
  const empty = fixture({ lookup: async () => null });
  assert.deepEqual(await empty.getExternalRecommendations(), []);
  const noSeeds = fixture({ games: [] });
  assert.deepEqual(await noSeeds.getExternalRecommendations(), []);
  assert.deepEqual(noSeeds.lookups, []);
});
