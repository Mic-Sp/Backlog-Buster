/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node tests load TypeScript with mocked server boundaries. */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.resolve(__dirname, "..", file), instance = new Module(filename, module);
    instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`) : original(name);
    instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
    cache.set(file, instance.exports); return instance.exports;
  }
  return load;
}
const form = (values) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };
const load = loader({ "server-only": {}, "@/lib/prisma": {}, "@/lib/player": {} });
const { validateGameForm } = load("src/lib/form-validation.ts");

test("blank titles, invalid numbers and unsafe URLs are rejected; text and optional blanks normalize", () => {
  for (const title of ["", "   ", "\t\n", "\u00a0\u2003"]) assert.throws(() => validateGameForm(form({ title })), /Please input a valid title/);
  for (const field of [{ lengthHours: "NaN" }, { lengthHours: "0" }, { difficulty: "4" }, { hoursPlayed: "-1" }, { releaseYear: "1700" }, { releaseYear: "2020.5" }, { coverUrl: "javascript:alert(1)" }]) assert.throws(() => validateGameForm(form({ title: "Game", ...field })));
  const data = form({ title: "  Alan Wake  ", platform: " PC ", genre: "  ", franchise: "  ", coverUrl: "  ", releaseYear: "  ", notes: "  checkpoint  " });
  validateGameForm(data); assert.equal(data.get("title"), "Alan Wake"); assert.equal(data.get("platform"), "PC"); assert.equal(data.get("notes"), "checkpoint"); assert.equal(data.get("releaseYear"), "");
  assert.doesNotThrow(() => validateGameForm(form({ id: "1", lengthHours: "bad" }), true));
});

test("all game actions return structured errors for invalid inputs and infrastructure failures", async () => {
  let lookups = 0; const created = [], updated = [];
  const prisma = {
    game: {
      create: async ({ data }) => created.push(data),
      findUniqueOrThrow: async () => ({ status: "Playing", hoursPlayed: 3 }),
      update: async ({ data }) => updated.push(data),
      delete: async () => { throw new Error("private database connection detail"); },
    },
    $transaction: async () => { throw new Error("private database connection detail"); },
  };
  const scoped = loader({ "server-only": {}, "next/cache": { revalidatePath() {} }, "@/lib/prisma": { prisma },
    "@/lib/player": { getCurrentPlayerId: async () => "fixture-player", ensurePlayerExists: async () => {} },
    "@/lib/achievements": { syncAndGetAchievements: async () => [] }, "@/lib/rawg": { lookupRawgGame: async (title) => { assert(title.trim()); lookups++; return null; } },
    "@/lib/recommendations": { getBacklogRecommendations: async () => { throw new Error("private database connection detail"); }, getExternalRecommendations: async () => { throw new Error("private database connection detail"); } },
  });
  const actions = scoped("src/app/actions.ts");
  for (const action of Object.values(actions)) {
    const result = await action(undefined, undefined);
    assert.equal(typeof result.error, "string"); assert(!result.error.includes("private database"));
  }
  const base = { title: "  Alan Wake  ", platform: "  ", lengthHours: "  ", difficulty: "  ", genre: "  ", franchise: "  ", coverUrl: "  ", releaseYear: "  " };
  assert.deepEqual(await actions.createGame(form({ ...base, title: "   " })), { error: "Please input a valid title." });
  assert.equal(lookups, 0); assert.equal(created.length, 0);
  assert.deepEqual(await actions.createGame(form(base)), { success: true });
  assert.equal(created[0].title, "Alan Wake"); assert.equal(created[0].platform, "PC"); assert.equal(created[0].lengthHours, 10); assert.equal(created[0].difficulty, 1);
  for (const key of ["genre", "franchise", "coverUrl", "releaseYear"]) assert.equal(created[0][key], null);
  const metadata = { ...base, id: " 42 ", status: " Playing ", lengthHours: "20", difficulty: "2", hoursPlayed: " ", rating: " ", notes: " " };
  assert.deepEqual(await actions.updateGame(form({ ...metadata, title: " " })), { error: "Please input a valid title." }); assert.equal(updated.length, 0);
  assert.deepEqual(await actions.updateGame(form(metadata)), { success: true });
  assert.equal(updated[0].title, "Alan Wake"); assert.equal(updated[0].hoursPlayed, 0); assert.equal(updated[0].rating, null); assert.equal(updated[0].notes, null);
  const failure = await actions.deleteGame(form({ id: "42" })); assert.equal(typeof failure.error, "string"); assert(!failure.error.includes("private database"));
});

test("auth rejects all-space values without altering meaningful passwords; dossier blanks default safely", () => {
  const read = load("src/lib/auth-accounts.ts").readCredentials;
  const credentials = { email: "  choom@example.com ", password: " exact password ", handle: " Choom ", operatorName: "  Ghost " };
  const result = read(form(credentials), true); assert.equal(result.password, credentials.password); assert.equal(result.email, "choom@example.com"); assert.equal(result.operatorName, "Ghost");
  for (const fields of [{ email: " " }, { password: "        " }, { handle: "   " }, { operatorName: "   " }]) assert.throws(() => read(form({ ...credentials, ...fields }), true));
  const validate = loader({ "server-only": {}, "@/lib/prisma": {}, "@/lib/player": {} })("src/lib/player-profile.ts").validatePlayerProfile;
  const profile = validate({ operatorName: "  ", tagline: "  ", neonAccent: "CYAN", featuredTrophyIds: [] });
  assert.equal(profile.operatorName, "ANONYMOUS NETRUNNER"); assert.equal(profile.tagline, "One more gig. One more legend.");
});

test("AI route returns inline JSON errors for blank titles and failed authentication lookups", async () => {
  const makeRequest = () => new Request("http://localhost/api/ai-briefing", { method: "POST", body: JSON.stringify({ title: "   ", platform: "PC", lengthHours: 10 }) });
  const route = loader({ "@/lib/player": { getCurrentPlayer: async () => ({ id: "fixture" }) } })("src/app/api/ai-briefing/route.ts");
  const response = await route.POST(makeRequest()); assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: "Please input a valid title." });
  const unavailable = loader({ "@/lib/player": { getCurrentPlayer: async () => { throw new Error("private database connection detail"); } } })("src/app/api/ai-briefing/route.ts");
  const failure = await unavailable.POST(makeRequest()); assert.equal(failure.status, 503); assert(!(await failure.text()).includes("private database"));
});
