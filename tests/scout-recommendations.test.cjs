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
function fixture({ ai = async () => [], lookup = async () => metadata, games = [seed], dismissed = () => [], cooldown = () => 0, catalog = [], vector = async () => ({
  recommendations: [], tasteSource: "cold-start", anchorCount: 0, vectorVersion: "catalog-features-v1",
}) } = {}) {
  const lookups = [], aiCalls = [], vectorCalls = [];
  const mocks = {
    "server-only": {},
    "@/lib/player": { getCurrentPlayerId: async () => "player" },
    "@/lib/prisma": { prisma: { gameCatalog: { findMany: async () => catalog }, recommendationDismissal: { findMany: async ({ where, select }) => { assert.equal(where.userId, "player"); assert.deepEqual(select, { titleKey: true }); return dismissed().map(titleKey => ({ titleKey })); } }, game: { findMany: async ({ where }) => { assert.equal(where.userId, "player"); return games; } } } },
    "@/lib/scout-ai": { getAIScoutCandidates: async (playerId, ...args) => { assert.equal(playerId, "player"); aiCalls.push(args); const remaining = cooldown(); return { candidates: remaining ? [] : await ai(...args), cooldownRemainingSeconds: remaining }; } },
    "@/lib/vector-recommendations": { recommendCatalogGames: async (...args) => { vectorCalls.push(args); return vector(...args); } },
    "@/lib/rawg": { resizeRawgImageUrl: value => value, lookupRawgGame: async (title, reportRateLimit) => { assert.equal(reportRateLimit, true); lookups.push(title); return lookup(title); } },
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
  return { ...load("src/lib/recommendations.ts"), lookups, aiCalls, vectorCalls };
}

test("empty vector results use Gemini fallback, retain its reasons, and preserve metadata/playtime mapping", async () => {
  const input = ["AI A", "AI B", "AI C"].map(candidate);
  const context = fixture({ ai: async () => input });
  const result = await context.getExternalRecommendations("player", ["Seen"]);
  assert.deepEqual(context.aiCalls, [[[seed], ["Seen"]]]);
  assert.deepEqual(context.lookups, input.map((pick) => pick.title));
  assert.deepEqual(result, input.map((pick) => ({ title: pick.title, platform: "PC", genre: "Action", releaseYear: 2020, coverUrl: metadata.coverUrl, lengthHours: 15, difficulty: 2, reason: pick.reason })));
});

const vectorPick = (title, fields = {}) => ({ key: title, title, platforms: ["Console", "PC"], genre: "Action", releaseYear: 2020,
  estimatedHours: 4, coverUrl: "https://example.com/cover.jpg", reason: `Vector rationale for ${title}.`, distance: .1,
  cosineSimilarity: .9, score: .8, scores: { cosine: .63, series: .1, genre: .05, playtime: .02 }, ...fields });
const vectorResult = picks => ({ recommendations: picks, tasteSource: "completed-favorites", anchorCount: 1, negativeAnchorCount: 2, vectorVersion: "catalog-features-v1",
  diagnostics: { queryLatencyMs: 2.5, candidateCount: 20, filteredCount: 1,
    coverage: { total: 89, embedded: 89, current: 89, released: 85, eligible: 84 }, anchors: [{ title: "Seed", rating: 5 }] } });

test("persisted dismissals filter vector, live-AI, and static fallback picks across fresh sessions", async () => {
  const dismissed = ["cafe adventure 2", "ai rejected", "fallback 1"];
  for (let session = 0; session < 2; session++) {
    const context = fixture({ dismissed: () => dismissed,
      vector: async () => vectorResult([vectorPick("Café Adventure II™"), vectorPick("Safe Vector")]),
      ai: async () => [candidate("AI: Rejected")],
    });
    const result = await context.getExternalRecommendations("player");
    assert.deepEqual(result.map(pick => pick.title), ["Safe Vector", "Fallback 2", "Fallback 3"]);
    for (const key of dismissed) {
      assert(context.vectorCalls[0][1].includes(key));
      assert(context.aiCalls[0][1].includes(key));
    }
    assert(!context.lookups.includes("AI: Rejected")); assert(!context.lookups.includes("Fallback 1"));
  }
});

test("permanent dismissals are not capped to the client's 30-title session history", async () => {
  const dismissed = [...Array.from({ length: 50 }, (_, index) => `old dismissal ${index}`), "fallback 1", "last rejected"];
  const context = fixture({ dismissed: () => dismissed,
    vector: async () => vectorResult([vectorPick("Last: Rejected")]),
    ai: async () => [candidate("Old Dismissal 49")],
  });
  const result = await context.getExternalRecommendations("player", ["Session Seen"]);
  assert.deepEqual(result.map(pick => pick.title), ["Fallback 2", "Fallback 3", "Fallback 4"]);
  assert.equal(context.vectorCalls[0][1].length, 53);
  assert(context.aiCalls[0][1].includes("last rejected"));
});

test("a dismissal saved while a provider scan is running is removed before returning results", async () => {
  const dismissed = [];
  const context = fixture({ dismissed: () => dismissed, ai: async () => {
    dismissed.push("late dismissal");
    return ["Late Dismissal", "Safe A", "Safe B"].map(candidate);
  } });
  assert.deepEqual((await context.getExternalRecommendations("player")).map(pick => pick.title), ["Safe A", "Safe B"]);
});

test("a failed preference read stops discovery rather than recommending dismissed games", async () => {
  const context = fixture({ dismissed: () => { throw Error("database unavailable"); } });
  await assert.rejects(context.getExternalRecommendations("player"), /database unavailable/);
  assert.equal(context.aiCalls.length, 0); assert.equal(context.vectorCalls.length, 0);
});

test("three vector picks are primary, skip all providers and preserve the exact public card contract", async () => {
  const picks = ["Vector A", "Vector B", "Vector C"].map(title => vectorPick(title));
  const context = fixture({ vector: async () => vectorResult(picks) });
  const result = await context.getExternalRecommendations("player", ["Seen"]);
  assert.deepEqual(result, picks.map(pick => ({ title: pick.title, platform: "PC", genre: "Action", releaseYear: 2020,
    coverUrl: pick.coverUrl, lengthHours: 15, difficulty: 2, reason: pick.reason })));
  assert.equal(context.aiCalls.length, 0); assert.equal(context.lookups.length, 0);
  assert.deepEqual(context.vectorCalls[0][1], ["Seen"]);
  assert.deepEqual(context.vectorCalls[0][2], { collectDiagnostics: false, dismissedTitles: [] });
  for (const pick of result) assert.deepEqual(Object.keys(pick).sort(), ["title", "platform", "genre", "releaseYear", "coverUrl", "lengthHours", "difficulty", "reason"].sort());
});

test("partial vector results stay first and Gemini receives those titles as exclusions while filling only remaining slots", async () => {
  const context = fixture({ vector: async () => vectorResult([vectorPick("Vector A"), vectorPick("Vector B")]),
    ai: async () => [candidate("Vector A"), candidate("New C"), candidate("New D")] });
  const debug = telemetry();
  const result = await context.getExternalRecommendations("player", ["Seen"], debug);
  assert.deepEqual(result.map(pick => pick.title), ["Vector A", "Vector B", "New C"]);
  assert.deepEqual(context.aiCalls[0][1], ["Seen", "Vector A", "Vector B"]);
  assert(!context.lookups.includes("Vector A"));
  assert.equal(debug.engineSource, "mixed"); assert.equal(debug.vector.returnedCount, 2);
  assert.equal(debug.vector.negativeAnchorCount, 2);
  assert.equal(debug.source, "mixed"); assert.equal(debug.fallbackTriggered, true);
  assert.deepEqual(debug.picks.map(pick => pick.source), ["vector", "vector", "live-ai"]);
});

test("vector errors fall back without leaking raw database details", async () => {
  const context = fixture({ vector: async () => { throw Error("postgresql://secret-credentials/private-query"); },
    ai: async () => ["A", "B", "C"].map(candidate) });
  const debug = telemetry();
  assert.equal((await context.getExternalRecommendations("player", [], debug)).length, 3);
  assert.equal(debug.engineSource, "gemini-fallback"); assert.equal(debug.vector.status, "failed");
  assert.equal(debug.vector.coverage, null); assert(debug.vector.latencyMs >= 0);
  assert(!JSON.stringify(debug).includes("secret-credentials"));
});

test("vector results are defensively filtered for owned, seen, duplicate, and unreleased titles before provider backfill", async () => {
  const context = fixture({ vector: async () => vectorResult([
    vectorPick("Seed"), vectorPick("Seen"), vectorPick("Future", { releaseYear: new Date().getFullYear() + 1 }),
    vectorPick("Undated", { releaseYear: null }), vectorPick("New II"), vectorPick("New 2"),
  ]), ai: async () => [candidate("Fill A"), candidate("Fill B")] });
  const debug = telemetry();
  const result = await context.getExternalRecommendations("player", ["Seen"], debug);
  assert.deepEqual(result.map(pick => pick.title), ["New II", "Fill A", "Fill B"]);
  assert.equal(debug.vector.filteredCount, 6); // One engine-side rejection plus five defensive rejections.
});

test("RAWG failures in both provider and curated fallback preserve successful vector cards", async () => {
  const context = fixture({ vector: async () => vectorResult([vectorPick("Vector A")]), ai: async () => [candidate("Provider B")],
    lookup: async () => { throw Error("private provider outage"); } });
  const debug = telemetry();
  const result = await context.getExternalRecommendations("player", [], debug);
  assert.deepEqual(result.map(pick => pick.title), ["Vector A"]);
  assert.equal(debug.engineSource, "vector"); assert.equal(debug.fallbackTriggered, true);
  assert(debug.metadataRejectedCount > 0); assert(!JSON.stringify(debug).includes("private provider outage"));
});

test("admin vector telemetry records provenance, score components, latency and coverage without provider charges", async () => {
  const context = fixture({ vector: async () => vectorResult(["A", "B", "C"].map(title => vectorPick(title))) });
  const debug = telemetry();
  await context.getExternalRecommendations("player", [], debug);
  assert.deepEqual(context.vectorCalls[0][2], { collectDiagnostics: true, dismissedTitles: [] });
  assert.equal(debug.engineSource, "vector"); assert.equal(debug.source, "vector");
  assert.equal(debug.fallbackTriggered, false); assert.equal(debug.vector.status, "passed");
  assert.equal(debug.vector.queryLatencyMs, 2.5); assert(debug.vector.latencyMs >= 0);
  assert.deepEqual(debug.vector.coverage, { total: 89, embedded: 89, current: 89, released: 85, eligible: 84 });
  assert.equal(debug.vector.picks[0].cosineSimilarity, .9); assert.deepEqual(debug.vector.picks[0].scores, vectorPick("A").scores);
  assert.equal(debug.estimatedCostUsd, 0); assert.equal(context.aiCalls.length, 0);
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

function telemetry() {
  return { picks: [], anchors: [], excludedCount: 0, filteredCount: 0, metadataRejectedCount: 0,
    fallbackReason: null, fallbackTriggered: false, attemptedCallCostUsd: 0.001 };
}

test("optional telemetry preserves picks and reports mixed/fallback provenance with exact catalog anchors", async () => {
  const debug = telemetry();
  const context = fixture({ ai: async () => [candidate("Good"), candidate("Seed")] });
  const result = await context.getExternalRecommendations("player", ["Seen"], debug);
  assert.equal(result.length, 3);
  assert.equal(debug.source, "mixed"); assert.equal(debug.fallbackTriggered, true);
  assert.equal(debug.excludedCount, 2); assert.equal(debug.filteredCount, 1);
  assert.deepEqual(debug.picks.map(pick => pick.source), ["live-ai", "deterministic-fallback", "deterministic-fallback"]);
  assert.deepEqual(debug.picks[1].anchor, { title: "Seed", rating: 5 });
  assert.match(debug.playtimeStatus, /RAWG/);
  const fallback = telemetry();
  const failed = fixture({ ai: async (_games, _excluded, trace) => {
    trace.fallbackReason = "Schema validation failed: missing rationale";
    throw new Error("private error");
  } });
  await failed.getExternalRecommendations("player", [], fallback);
  assert.equal(fallback.source, "deterministic-fallback");
  assert.equal(fallback.estimatedCostUsd, 0); assert.equal(fallback.attemptedCallCostUsd, 0.001);
  assert.match(fallback.fallbackReason, /missing rationale/);
});
