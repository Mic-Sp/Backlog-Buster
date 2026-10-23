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
    instance.require = (name) => name === "server-only" ? {} : Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`) : original(name);
    instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
    cache.set(file, instance.exports); return instance.exports;
  }
  return load;
}
const form = (values) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };
const load = loader({ "server-only": {}, "@/lib/prisma": {}, "@/lib/player": {} });
const { validateGameForm } = load("src/lib/form-validation.ts");

test("external scout validates and bounds client exclusions inside authenticated request protection", async () => {
  const calls = [], inputs = [];
  class AdminRequiredError extends Error {}
  const scoped = loader({
    "@/lib/admin": { AdminRequiredError, requireAdmin: async () => { throw new AdminRequiredError(); } },
    "next/cache": { revalidatePath() {} },
    "@/lib/prisma": {},
    "@/lib/player": { getAuthenticatedPlayerId: async () => "scout-player" },
    "@/lib/api-resilience": { guardedRequest: async (id, feature, input, work) => {
      assert.equal(id, "scout-player"); assert.equal(feature, "scout"); inputs.push(input); return work();
    } },
    "@/lib/recommendations": { getExternalRecommendations: async (...args) => { calls.push(args); return []; } },
  });
  const { fetchExternalScout } = scoped("src/app/actions.ts");
  assert.deepEqual(await fetchExternalScout(), { recommendations: [] });
  assert.deepEqual(calls[0], ["scout-player", []]);
  const titles = [" Tunic ", "TUNIC", " ", "Dark Souls III", "dark souls 3", "x".repeat(200)];
  assert.deepEqual(await fetchExternalScout(titles), { recommendations: [] });
  assert.deepEqual(calls[1], ["scout-player", ["Tunic", "Dark Souls III", "x".repeat(120)]]);
  assert.equal(titles[0], " Tunic ");
  assert.notEqual(inputs[0], inputs[1]);
  assert.deepEqual(JSON.parse(inputs[1]), calls[1][1]);
  await fetchExternalScout(Array.from({ length: 30 }, (_, index) => `Title ${index}`));
  assert.equal(calls[2][1].length, 30);
  for (const invalid of [null, "Tunic", {}, [42], Array(31).fill("Tunic")]) {
    assert.match((await fetchExternalScout(invalid)).error, /up to 30/);
  }
  assert.equal(calls.length, 3);
  assert.equal(inputs.length, 3);
});

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
      create: async ({ data }) => { created.push(data); return { ...data, id: created.length }; },
      findUniqueOrThrow: async () => ({ status: "Playing", hoursPlayed: 3 }),
      update: async ({ data }) => updated.push(data),
      delete: async () => { throw new Error("private database connection detail"); },
    },
    $transaction: async () => { throw new Error("private database connection detail"); },
  };
  const scoped = loader({ "server-only": {}, "next/cache": { revalidatePath() {} }, "@/lib/prisma": { prisma },
    "@/lib/player": { getAuthenticatedPlayerId: async () => "fixture-player", ensurePlayerExists: async () => {} },
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
  assert.deepEqual(await actions.createGame(form(base)), { success: true, gameId: 1 });
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

test("starting a pinned gig atomically advances only its owner's remaining deck and rolls back on failure", async () => {
  const initial = [1,2,3].map(id=>({id,userId:'owner',status:'Backlog',pinnedOrder:id,lengthHours:10,difficulty:1}));
  initial.push({id:4,userId:'owner',status:'Backlog',pinnedOrder:null},{id:5,userId:'other',status:'Backlog',pinnedOrder:1});
  let games=structuredClone(initial), fail=false, synced=0, refreshed=0, locked=0;
  const tx={$executeRaw:async(_sql,key)=>{assert.equal(key,'backlogbuster-deck:owner');locked++;},game:{
    findUniqueOrThrow:async({where})=>{assert.equal(where.userId,'owner');const game=games.find(g=>g.id===where.id&&g.userId===where.userId);if(!game)throw Error('Missing game');return{pinnedOrder:game.pinnedOrder};},
    findMany:async({where,orderBy})=>{assert.deepEqual(where,{userId:'owner',status:'Backlog',pinnedOrder:{not:null}});assert.deepEqual(orderBy,[{pinnedOrder:'asc'},{id:'asc'}]);return games.filter(g=>g.userId==='owner'&&g.status==='Backlog'&&g.pinnedOrder!==null).sort((a,b)=>a.pinnedOrder-b.pinnedOrder).map(g=>({id:g.id}));},
    update:async({where,data})=>{assert.equal(where.userId,'owner');const game=games.find(g=>g.id===where.id&&g.userId===where.userId);assert(game);Object.assign(game,data);if(fail&&data.pinnedOrder===1)throw Error('Database failed');return game;},
  }};
  const actions=loader({'next/cache':{revalidatePath:()=>refreshed++},'@/lib/prisma':{prisma:{$transaction:async work=>{const before=structuredClone(games);try{return await work(tx);}catch(error){games=before;throw error;}}}},'@/lib/player':{getAuthenticatedPlayerId:async()=> 'owner'},'@/lib/achievements':{syncAndGetAchievements:async()=>synced++},'@/lib/rawg':{},'@/lib/recommendations':{}})('src/app/actions.ts');
  for(const id of [1,2,3]){
    games=structuredClone(initial);
    assert.deepEqual(await actions.startGame(form({id:String(id),lengthHours:'22',difficulty:'2',userId:'other'})),{success:true});
    const started=games.find(g=>g.id===id);assert.equal(started.status,'Playing');assert.equal(started.pinnedOrder,null);assert.equal(started.lengthHours,22);
    const remaining=games.filter(g=>g.userId==='owner'&&g.pinnedOrder!==null).sort((a,b)=>a.pinnedOrder-b.pinnedOrder);
    assert.deepEqual(remaining.map(g=>g.id),[1,2,3].filter(other=>other!==id));assert.deepEqual(remaining.map(g=>g.pinnedOrder),[1,2]);assert.deepEqual(games.find(g=>g.id===5),initial[4]);
  }
  games=structuredClone(initial);fail=true;
  assert.equal(typeof(await actions.startGame(form({id:'1',lengthHours:'22',difficulty:'2'}))).error,'string');assert.deepEqual(games,initial);assert.equal(synced,3);assert.equal(refreshed,3);fail=false;
  assert.equal(typeof(await actions.startGame(form({id:'5',lengthHours:'10',difficulty:'1'}))).error,'string');assert.deepEqual(games,initial);
  assert.deepEqual(await actions.startGame(form({id:'4',lengthHours:'10',difficulty:'1'})),{success:true});assert.deepEqual(games.slice(0,3),initial.slice(0,3));assert.equal(locked,6);
});
