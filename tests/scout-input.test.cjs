/* eslint-disable @typescript-eslint/no-require-imports -- Load server-only TypeScript without a Next server. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
function load(file, mocks = {}) {
  const filename = path.resolve(__dirname, "..", file);
  const instance = new Module(filename, module);
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = instance.require.bind(instance);
  instance.require = (name) => name === "server-only" ? {} : Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`, mocks) : original(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, filename);
  return instance.exports;
}
const { buildScoutInput, SCOUT_INPUT_ESTIMATED_TOKEN_LIMIT } = load("src/lib/scout-ai.ts");
const { normalizeGameTitle } = load("src/lib/game-title.ts");
const game = (title, overrides = {}) => ({ title, genre: "RPG", platform: "PC", status: "Completed", rating: 5, earnedXp: 100, ...overrides });

test("seeds preserve favorite ranking and only fall back to unrated completions", () => {
  const games = [game("Four", { rating: 4, earnedXp: 999 }), game("Zed"), game("Alpha"),
    game("First", { earnedXp: 200 }), game("Unrated", { rating: null, earnedXp: 9999 }),
    game("Low", { rating: 3 }), game("Playing", { status: "Playing" })];
  const before = JSON.stringify(games);
  assert.deepEqual(buildScoutInput(games).payload.seeds.map((seed) => seed.title), ["First", "Alpha", "Zed", "Four"]);
  assert.equal(JSON.stringify(games), before);
  const fallback = buildScoutInput([game("Low", { rating: 2 }), game("B", { rating: null }), game("A", { rating: null }), game("Top", { rating: null, earnedXp: 200 })]);
  assert.deepEqual(fallback.payload.seeds.map((seed) => seed.title), ["Top", "A", "B"]);
  assert.deepEqual(buildScoutInput([game("Low", { rating: 1 })]).payload.seeds, []);
});

function mockScout(t, resilientFetch) {
  const before = { key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL };
  process.env.GEMINI_API_KEY = " scout-test-key ";
  delete process.env.GEMINI_MODEL;
  t.after(() => {
    if (before.key === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = before.key;
    if (before.model === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = before.model;
  });
  return load("src/lib/scout-ai.ts", {
    "@/lib/api-resilience": { resilientFetch, retryAfterSeconds: (value) => Number(value) || 10 },
  });
}
const pick = (title) => ({ title, reason: "Matches your taste for tactical combat.", preferredPlatform: "PC" });
const envelope = (text, extra = {}) => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] }, ...extra }] });

test("Gemini caller reuses configuration, JSON mode and sanitized payload", async (t) => {
  let calls = 0;
  const scout = mockScout(t, async (url, options) => {
    calls++;
    assert.match(url, /gemini-3\.5-flash-lite:generateContent$/);
    assert.equal(options.headers["x-goog-api-key"], "scout-test-key");
    assert.equal(options.method, "POST");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    assert.equal(body.systemInstruction.parts[0].text, scout.SCOUT_SYSTEM_PROMPT);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal(JSON.parse(body.contents[0].parts[0].text).seeds[0].title, "Seed");
    return Response.json(envelope(JSON.stringify(["Tunic", "SOMA", "Prey"].map(pick))));
  });
  assert.deepEqual((await scout.getAIScoutCandidates([game("**Seed**")])).map((item) => item.title), ["Tunic", "SOMA", "Prey"]);
  assert.equal(calls, 1);
});

test("Gemini caller filters FULL ownership/session lists including omitted titles", async (t) => {
  const owned = [game("Seed"), ...Array.from({ length: 100 }, (_, i) => game(`Owned ${i}`, { status: "Backlog" })), game("Dark Souls III", { status: "Backlog" })];
  const excluded = [...Array.from({ length: 40 }, (_, i) => `Excluded ${i}`), "SOMA"];
  const scout = mockScout(t, async (url) => {
    assert.match(url, /custom%2Fmodel:generateContent$/);
    return Response.json(envelope(JSON.stringify(["Dark Souls 3", "Owned 99", "SOMA", "Tunic"].map(pick))));
  });
  process.env.GEMINI_MODEL = " custom/model ";
  assert.deepEqual((await scout.getAIScoutCandidates(owned, excluded)).map((item) => item.title), ["Tunic"]);
});

test("Gemini caller rejects invalid, blocked, incomplete and malformed output cleanly", async (t) => {
  let response;
  const scout = mockScout(t, async () => response);
  const invalid = [
    envelope("```json\n[]\n```"), envelope("{}"), envelope(JSON.stringify([pick("Tunic")])),
    envelope(JSON.stringify([pick("A"), pick("B"), { title: "C" }])),
    envelope(JSON.stringify(["Dark Souls III", "Dark Souls 3", "Tunic"].map(pick))),
    envelope(JSON.stringify(["A", "B", "C"].map(pick)), { finishReason: "MAX_TOKENS" }),
    { promptFeedback: { blockReason: "SAFETY" } },
    envelope("", { content: { parts: [{ thought: true, text: "private reasoning" }] } }),
  ];
  for (const value of invalid) {
    response = Response.json(value);
    await assert.rejects(scout.getAIScoutCandidates([game("Seed")]), { name: "ScoutAIError" });
  }
  response = new Response("provider secret detail", { status: 200 });
  await assert.rejects(scout.getAIScoutCandidates([game("Seed")]), /Could not reach/);
});

test("Gemini caller handles missing config, empty seeds, rate limits and transport failures", async (t) => {
  let calls = 0;
  let failure = null;
  const scout = mockScout(t, async () => {
    calls++;
    if (failure) throw failure;
    return new Response("secret provider error", { status: 429, headers: { "Retry-After": "23" } });
  });
  assert.deepEqual(await scout.getAIScoutCandidates([]), []);
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(scout.getAIScoutCandidates([game("Seed")]), /not configured/);
  assert.equal(calls, 0);
  process.env.GEMINI_API_KEY = "test";
  await assert.rejects(scout.getAIScoutCandidates([game("Seed")]), (error) => error.retryAfterSeconds === 23);
  failure = new DOMException("private detail", "TimeoutError");
  await assert.rejects(scout.getAIScoutCandidates([game("Seed")]), /timed out/);
  failure = new Error("secret network detail");
  await assert.rejects(scout.getAIScoutCandidates([game("Seed")]), (error) => error.name === "ScoutAIError" && !error.message.includes("secret"));
});

test("sanitizes and bounds strings, deduplicates title variants across sources", () => {
  const { payload, prompt } = buildScoutInput([
    game("**Dark Souls III**\u0000\u202e", { genre: "#RPG", platform: "`PC`" }),
    game("Dark Souls 3"), game("[]<>\u0000"),
  ], ["Dark Souls 3", "__Tunic__", "Tunic", " "]);
  assert.equal(payload.seeds.length, 1);
  assert.deepEqual(payload.seeds[0], { title: "Dark Souls III", genre: "RPG", platform: "PC", rating: 5 });
  assert.deepEqual(payload.excludedTitles, ["Tunic", "Dark Souls III"]);
  assert.deepEqual(JSON.parse(prompt), payload);
  assert.doesNotMatch(prompt, /[`*_~#<>\u0000\u202e]/u);
});

test("caps seeds, ownership and session titles, and budgets serialized Unicode data", () => {
  const compact = buildScoutInput(Array.from({ length: 20 }, (_, index) => game(`G${index}`)));
  assert.ok(compact.payload.seeds.length <= 8);
  const owned = Array.from({ length: 100 }, (_, index) => game(`O${index}`, { status: "Backlog" }));
  const session = Array.from({ length: 50 }, (_, index) => `S${index}`);
  const limited = buildScoutInput(owned, session).payload.excludedTitles;
  assert.ok(limited.filter((title) => title.startsWith("O")).length <= 75);
  assert.ok(limited.filter((title) => title.startsWith("S")).length <= 30);
  assert.ok(limited.some((title) => title.startsWith("O")));
  assert.ok(limited.some((title) => title.startsWith("S")));
  const large = buildScoutInput(Array.from({ length: 100 }, (_, index) => game(`遊戲${index}${"界".repeat(200)}`, { genre: "類".repeat(100), platform: "台".repeat(100) })), session);
  assert.ok(large.estimatedTokens <= SCOUT_INPUT_ESTIMATED_TOKEN_LIMIT);
  assert.ok(Buffer.byteLength(large.prompt, "utf8") <= SCOUT_INPUT_ESTIMATED_TOKEN_LIMIT * 3);
  for (const seed of large.payload.seeds) {
    assert.ok(seed.title.length <= 120 && seed.genre.length <= 40 && seed.platform.length <= 40);
    assert.deepEqual(Object.keys(seed).sort(), ["genre", "platform", "rating", "title"]);
  }
  assert.equal(new Set(large.payload.excludedTitles.map(normalizeGameTitle)).size, large.payload.excludedTitles.length);
  assert.deepEqual(buildScoutInput([]).payload.seeds, []);
});
