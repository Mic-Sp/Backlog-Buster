/* eslint-disable @typescript-eslint/no-require-imports -- Real Scout pipeline/limiter with database and network boundaries mocked. */
const test = require("node:test"), assert = require("node:assert/strict");
const { loader } = require("./helpers/social-fixture.cjs");
const seed = { title: "Seed", platform: "PC", genre: "Action", status: "Completed", rating: 5, earnedXp: 100 };
const catalogGame = title => ({ title, releaseYear: 2020, platforms: ["PC"], genre: "Action", coverUrl: null, estimatedHours: 20 });
const vectorPick = title => ({ ...catalogGame(title), reason: "A vector pick", distance: .1 });
const answer = () => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(
  ["AI A", "AI B", "AI C"].map(title => ({ title, reason: "Matches Seed", preferredPlatform: "PC" })),
) }] } }] });

function fixture(t, { fetch = async () => answer(), vector = () => ["Vector A"], games = [seed], dismissed = [], catalog = ["Fallback 1", "Fallback 2", "Reserve"].map(catalogGame) } = {}) {
  let now = 100_000, dispatches = 0;
  const rawgCalls = [], vectorCalls = [];
  const before = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  t.after(() => { if (before === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = before; });
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async (...args) => { dispatches++; return fetch(...args); });
  const load = loader({
    "@/lib/player": { getCurrentPlayerId: async () => "player" },
    "@/lib/prisma": { prisma: {
      player: { findUnique: async () => ({ featuredTrophyIds: [] }) },
      game: { findMany: async () => games }, recommendationDismissal: { findMany: async () => dismissed.map(titleKey => ({ titleKey })) },
      gameCatalog: { findMany: async () => { if (catalog instanceof Error) throw catalog; return catalog; } },
    } },
    "@/lib/vector-recommendations": { recommendCatalogGames: async (...args) => {
      vectorCalls.push(args);
      return { recommendations: vector().map(vectorPick), vectorVersion: "test", tasteSource: "completed-favorites", anchorCount: 1 };
    } },
    "@/lib/rawg": { resizeRawgImageUrl: value => value, lookupRawgGame: async title => {
      rawgCalls.push(title); return { platforms: ["PC"], genre: "Action", releaseYear: 2020, coverUrl: null, playtime: 20 };
    } },
    "@/lib/scout-catalog": { franchiseAffinities: {}, genreNeighbors: {}, generalDiscovery: ["Fallback 1", "Fallback 2"] },
  });
  return { ...load("src/lib/recommendations.ts"), ...load("src/lib/scout-ai.ts"),
    debug: load("src/lib/scout-debug.ts").createScoutDebug, vectorCalls, rawgCalls,
    advance: milliseconds => { now += milliseconds; }, get dispatches() { return dispatches; } };
}

test("full vector scans never touch Gemini cooldown; partial scans claim it only on API dispatch", async t => {
  let vector = ["Vector A", "Vector B", "Vector C"];
  const f = fixture(t, { vector: () => vector });
  for (let i = 0; i < 3; i++) {
    const debug = f.debug();
    assert.equal((await f.getExternalRecommendations("player", [], debug)).length, 3);
    assert.equal(debug.liveCallAttempted, false); assert.equal(debug.geminiCooldownSkipped, false);
  }
  assert.equal(f.dispatches, 0);
  vector = ["Vector A"];
  assert.deepEqual((await f.getExternalRecommendations("player")).map(p => p.title), ["Vector A", "AI A", "AI B"]);
  assert.equal(f.dispatches, 1);
  const rawgBefore = f.rawgCalls.length;
  const debug = f.debug();
  assert.deepEqual((await f.getExternalRecommendations("player", [], debug)).map(p => p.title), ["Vector A", "Fallback 1", "Fallback 2"]);
  assert.equal(f.dispatches, 1); assert.equal(f.rawgCalls.length, rawgBefore, "Cooldown scans must use only local metadata");
  assert.equal(debug.geminiCooldownSkipped, true); assert.equal(debug.geminiCooldownRemainingSeconds, 10);
  assert.equal(debug.liveCallAttempted, false); assert.equal(debug.attemptedCallCostUsd, 0);
  assert.match(debug.fallbackReason, /cooldown active/);
  // A full vector result still serves immediately during the Gemini window.
  vector = ["Vector A", "Vector B", "Vector C"];
  const full = f.debug(); await f.getExternalRecommendations("player", [], full);
  assert.equal(full.geminiCooldownSkipped, false); assert.equal(f.dispatches, 1);
  vector = ["Vector A"];
  f.advance(9999); await f.getExternalRecommendations("player"); assert.equal(f.dispatches, 1);
  f.advance(1); await f.getExternalRecommendations("player"); assert.equal(f.dispatches, 2);
  await f.getExternalRecommendations("other-player"); assert.equal(f.dispatches, 3, "Cooldown belongs to one player");
});

test("a concurrent scan skips an in-flight Gemini call and returns local picks without waiting", async t => {
  let release, dispatched;
  const started = new Promise(resolve => { dispatched = resolve; });
  const f = fixture(t, { fetch: () => new Promise(resolve => { release = () => resolve(answer()); dispatched(); }) });
  const first = f.getExternalRecommendations("player");
  await started;
  const result = await f.getExternalRecommendations("player", ["Vector A", "Fallback 1"]);
  assert.deepEqual(result.map(p => p.title), ["Fallback 2", "Reserve"]);
  assert.equal(f.dispatches, 1); assert.deepEqual(f.rawgCalls, []);
  release(); assert.equal((await first).length, 3);
});

test("failed Gemini attempts retain their cooldown, and failed local reserves preserve vector successes", async t => {
  const f = fixture(t, { fetch: async () => { throw Error("private network failure"); }, catalog: Error("private database failure") });
  await f.getExternalRecommendations("player"); assert.equal(f.dispatches, 1);
  const debug = f.debug(), result = await f.getExternalRecommendations("player", [], debug);
  assert.deepEqual(result.map(p => p.title), ["Vector A"]);
  assert.equal(f.dispatches, 1); assert.equal(debug.geminiCooldownSkipped, true);
  assert(!JSON.stringify(debug).includes("private"));
});

test("no seeds or missing configuration do not claim a Gemini cooldown", async t => {
  const f = fixture(t);
  assert.deepEqual(await f.getAIScoutCandidates("player", []), { candidates: [], cooldownRemainingSeconds: 0 });
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(f.getAIScoutCandidates("player", [seed]), /not configured/);
  process.env.GEMINI_API_KEY = "test-key";
  assert.equal((await f.getAIScoutCandidates("player", [seed])).candidates.length, 3);
  assert.equal(f.dispatches, 1);
  assert.deepEqual(await f.getAIScoutCandidates("player", []), { candidates: [], cooldownRemainingSeconds: 10 }, "Active windows stay local even if the library's eligible seeds change");
});

test("cooldown-only local fallback prefers curated titles and excludes owned, seen, duplicate and unreleased catalog rows", async t => {
  let vector = ["Vector A"];
  const f = fixture(t, { vector: () => vector, dismissed: ["dismissed 2"], catalog: [catalogGame("Seed"), catalogGame("Seen"), catalogGame("Dismissed II™"),
    { ...catalogGame("Future"), releaseYear: 9999 }, { ...catalogGame("Undated"), releaseYear: null },
    catalogGame("Fallback 2"), catalogGame("Cafe Adventure II"), catalogGame("Café Adventure 2™"), catalogGame("Reserve") ] });
  await f.getExternalRecommendations("player");
  vector = [];
  const debug = f.debug(), result = await f.getExternalRecommendations("player", ["Seen"], debug);
  assert.deepEqual(result.map(p => p.title), ["Fallback 2", "Cafe Adventure II", "Reserve"]);
  assert.equal(debug.engineSource, "local-fallback"); assert.equal(debug.liveCallAttempted, false);
  assert.equal(f.dispatches, 1);
});
