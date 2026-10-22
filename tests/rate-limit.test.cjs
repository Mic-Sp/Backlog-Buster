/* eslint-disable @typescript-eslint/no-require-imports -- Load server modules with isolated API/database mocks. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.resolve(__dirname, '..', file), instance = new Module(filename, module);
    instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = name => name === 'server-only' ? {} : Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : original(name);
    instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
    cache.set(file, instance.exports); return instance.exports;
  }
  return load;
}

test('outbound retries, deduplication, provider cooldowns, route responses and safe fallbacks', async () => {
  const originalFetch = global.fetch, originalRandom = Math.random;
  const originalKey = process.env.GEMINI_API_KEY, originalRawg = process.env.RAWG_API_KEY;
  try {
    const load = loader();
    const { resilientFetch, guardedRequest, retryAfterSeconds } = load('src/lib/api-resilience.ts');
    const { RateLimitError, safeAction } = load('src/lib/action-result.ts');
    Math.random = () => 0;
    let calls = 0;
    global.fetch = async () => { calls++; return calls < 3 ? new Response(null, { status: calls === 1 ? 429 : 503 }) : Response.json({ ok: true }); };
    const [a, b] = await Promise.all([resilientFetch('https://retry.test/games'), resilientFetch('https://retry.test/games')]);
    assert.equal(calls, 3); assert.deepEqual(await a.json(), { ok: true }); assert.deepEqual(await b.json(), { ok: true });
    calls = 0;
    global.fetch = async () => { calls++; return new Response(null, { status: 429, headers: { 'Retry-After': '120' } }); };
    await assert.rejects(resilientFetch('https://quota.test/games'), e => e instanceof RateLimitError && e.retryAfterSeconds === 120);
    await assert.rejects(resilientFetch('https://quota.test/different'), RateLimitError); assert.equal(calls, 1);
    assert.equal(retryAfterSeconds('invalid'), 10); assert.equal(retryAfterSeconds('2'), 2);
    assert(retryAfterSeconds(new Date(Date.now() + 60000).toUTCString()) >= 59);
    calls = 0;
    global.fetch = async () => { calls++; return new Response(null, { status: 503 }); };
    const failed = await safeAction(() => resilientFetch('https://unavailable.test/'));
    assert.equal(calls, 3); assert.equal(failed.status, 429); assert.equal(failed.retryAfterSeconds, 10);
    // Identical in-flight jobs share work; different jobs cannot bypass a player's cooldown.
    let jobs = 0;
    const work = async () => { jobs++; await new Promise(resolve => setTimeout(resolve, 5)); return 'shared'; };
    assert.deepEqual(await Promise.all([guardedRequest('one', 'audit', 'same', work), guardedRequest('one', 'audit', 'same', work)]), ['shared', 'shared']);
    assert.equal(jobs, 1);
    await assert.rejects(guardedRequest('one', 'audit', 'different', work), RateLimitError);
    assert.equal(await guardedRequest('two', 'audit', 'different', work), 'shared');
    // RAWG exhaustion remains optional for game creation; explicit searches can surface the cooldown.
    const rawgLoad = loader({ '@/lib/api-resilience': { resilientFetch: async () => { throw new RawgLimit(30); } } });
    const RawgLimit = rawgLoad('src/lib/action-result.ts').RateLimitError;
    process.env.RAWG_API_KEY = 'fixture-not-a-real-key';
    const { lookupRawgGame } = rawgLoad('src/lib/rawg.ts');
    assert.equal(await lookupRawgGame('Alan Wake'), null);
    await assert.rejects(lookupRawgGame('Alan Wake', true), RawgLimit);
    // The actual audit route emits HTTP 429 + Retry-After and JSON without writing game hours.
    const routeLoad = loader({ '@/lib/player': { getCurrentPlayer: async () => ({ id: 'route-fixture' }) } });
    process.env.GEMINI_API_KEY = 'fixture-not-a-real-key';
    calls = 0;
    global.fetch = async url => { calls++; return url.endsWith(':countTokens') ? Response.json({ totalTokens: 400 }) : new Response(null, { status: 429, headers: { 'Retry-After': '30' } }); };
    const route = routeLoad('src/app/api/ai-briefing/route.ts');
    const request = () => new Request('http://localhost/api/ai-briefing', { method: 'POST', body: JSON.stringify({ title: 'Alan Wake', platform: 'PC', lengthHours: 10 }) });
    const responses = await Promise.all([route.POST(request()), route.POST(request())]);
    assert.equal(calls, 2);
    for (const response of responses) { assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '30'); assert.equal((await response.json()).retryAfterSeconds, 30); }
    const blocked = await route.POST(request()); assert.equal(blocked.status, 429); assert.equal(calls, 2);
    // Without verified titles, an IGDB outage clears stale ranks instead of ranking unknown games.
    let writes = 0;
    const sagaLoad = loader({ 'next/cache': { revalidatePath() {} }, '@/lib/player': { getAuthenticatedPlayerId: async () => 'saga-fixture' },
      '@/lib/prisma': { prisma: { franchiseChronology: { findUnique: async () => null }, game: { findMany: async () => [1, 2].map(id => ({ id, title: `Game ${id}`, status: 'Backlog', franchise: 'Test Saga', releaseYear: 2000 + id, chronologicalOrder: id })), update: args => ({ args }) }, $transaction: async jobs => { for (const { args } of jobs) { assert.equal(args.where.userId, 'saga-fixture'); assert.equal(args.data.chronologicalOrder, null); writes++; } } } },
      '@/lib/achievements': {}, '@/lib/recommendations': {}, '@/lib/rawg': {},
      '@/lib/igdb-chronology': { getIgdbChronology: async () => { throw new SagaLimit(20); } },
      '@/lib/api-resilience': { guardedRequest: () => { throw new SagaLimit(20); } },
    });
    const SagaLimit = sagaLoad('src/lib/action-result.ts').RateLimitError;
    const chains = sagaLoad('src/lib/sagas.ts').buildSagaChains([1, 2].map(id => ({ id, title: `Game ${id}`, status: 'Backlog', franchise: 'Test Saga' })));
    const result = await sagaLoad('src/app/actions.ts').autoDetectSagaOrder(chains.chains[0].key);
    assert.equal(result.updatedCount, 2); assert.match(result.message, /No verified saga titles/); assert.equal(result.error, undefined); assert.equal(writes, 2);
  } finally {
    global.fetch = originalFetch; Math.random = originalRandom;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
    if (originalRawg === undefined) delete process.env.RAWG_API_KEY; else process.env.RAWG_API_KEY = originalRawg;
  }
});
