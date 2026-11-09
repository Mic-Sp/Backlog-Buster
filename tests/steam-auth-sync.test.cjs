/* eslint-disable @typescript-eslint/no-require-imports -- Isolate durable claims, provider failures and callback transactions. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const { randomUUID } = require('node:crypto');
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
class SteamAPIError extends Error { constructor(code) { super('PROVIDER_URL_API_KEY_SECRET'); this.code = code; } }
const steamId = '76561198000000000', session = { userId: 'main', tokenHash: 'session-hash' };
const makeRow = overrides => ({ userId: 'main', requestId: randomUUID(), steamId, mode: 'signin', status: 'pending', attempts: 0,
  leaseId: null, leaseUntil: null, errorCode: null, addedCount: 0, updatedCount: 0, createdAt: new Date(), updatedAt: new Date(), ...overrides });
function fixture(input = makeRow(), work = async () => ({ summary: { addedCount: 2, updatedCount: 1 } })) {
  let row = structuredClone(input), validSession = true, verifiedId = steamId;
  const calls = [];
  function matches(where) {
    if (!row) return false;
    return Object.entries(where).every(([key, value]) => {
      if (key === 'OR') return value.some(part => matches(part));
      if (key === 'player') return validSession && value.steamVerifiedId === verifiedId && value.sessions.some.tokenHash === session.tokenHash;
      if (value && typeof value === 'object') {
        if ('lt' in value) return row[key] < value.lt;
        if ('lte' in value) return row[key] <= value.lte;
      }
      return row[key] === value;
    });
  }
  const table = {
    findUnique: async () => structuredClone(row),
    upsert: async ({ create, update }) => { row = row ? { ...row, ...update, updatedAt: new Date() } : { ...makeRow(), ...create }; },
    updateMany: async ({ where, data }) => { if (!matches(where)) return { count: 0 };
      for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value;
      row.updatedAt = new Date(); return { count: 1 }; },
  };
  const load = loader({ '@/lib/prisma': { prisma: { steamAuthSync: table } }, '@/lib/steam': { SteamAPIError },
    '@/lib/library-vault': { syncSteamLibraryForSession: async (...args) => { calls.push(args); return work(...args); } } });
  return { api: load('src/lib/steam-auth-sync.ts'), table, calls, get row() { return row; }, replace(value) { row = value; }, revoke() { validSession = false; }, changeVerifiedId(value) { verifiedId = value; } };
}

test('callback queues verified-ID sync in its session transaction for both sign-in and linking, then redirects straight to workspace', async () => {
  for (const mode of ['signin', 'link']) {
    const f = fixture(null), tx = { steamAuthSync: f.table }; let queueCount = 0, sessionCreated = false;
    const load = loader({ 'next/server': { NextResponse: { redirect: (url, options) => new Response(null, { status: 307, headers: { location: String(url), ...options.headers } }) } },
      'next/cache': { revalidatePath() {} }, '@/lib/google-oauth-origin': { googleOAuthOrigin: () => 'https://app.example.test' },
      '@/lib/steam-openid': { consumeSteamContext: async () => ({ mode }), verifySteamAssertion: async () => steamId, fetchSteamPersona: async () => ({}),
        resolveSteamPlayer: async received => { assert.equal(received, tx); return 'main'; }, clearSteamContext: async () => {} },
      '@/lib/steam-auth-sync': { queueSteamAuthSync: async (received, id, verified, flow) => { queueCount++; assert.equal(received, tx); await f.api.queueSteamAuthSync(tx, id, verified, flow); } },
      '@/lib/auth-session': { createPlayerSession: async resolve => { assert.equal(await resolve(tx), 'main'); sessionCreated = true; } },
    });
    const response = await load('src/app/api/auth/steam/callback/route.ts').GET(new Request('https://app.example.test/api/auth/steam/callback'));
    assert.equal(response.headers.get('location'), 'https://app.example.test/'); assert(sessionCreated); assert.equal(queueCount, 1);
    assert.equal(f.row.steamId, steamId); assert.equal(f.row.mode, mode); assert.equal(f.row.status, 'pending'); assert.equal(f.calls.length, 0);
  }
});

test('auth import uses only verified ID, includes unplayed games, updates hours and passes a unique write fence', async () => {
  const f = fixture();
  const result = await f.api.runSteamAuthSync(session, f.row.requestId);
  assert.equal(result.status, 'completed'); assert.equal(result.addedCount, 2); assert.equal(result.updatedCount, 1);
  const [payload, identity] = f.calls[0]; assert.deepEqual(payload, { identifier: steamId, includeUnplayed: true, updateHoursPlayed: true });
  assert.equal(identity.verifiedSteamId, steamId); assert.equal(identity.authSync.requestId, f.row.requestId); assert(identity.authSync.leaseId);
  assert.equal(f.row.attempts, 1); assert.equal(f.row.leaseId, null);
});

test('parallel tabs and duplicate POSTs share one durable claim; completed jobs are idempotent', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const f = fixture(makeRow(), async () => { await wait; return { summary: { addedCount: 3, updatedCount: 0 } }; });
  const pending = f.api.runSteamAuthSync(session, f.row.requestId);
  await new Promise(resolve => setImmediate(resolve));
  const second = await f.api.runSteamAuthSync(session, f.row.requestId); assert.equal(second.status, 'running'); assert.equal(f.calls.length, 1);
  release(); await pending; await f.api.runSteamAuthSync(session, f.row.requestId); assert.equal(f.calls.length, 1);
});

test('private libraries and configuration/provider errors persist controlled codes without failing authentication or exposing secrets', async () => {
  for (const error of [new SteamAPIError('PRIVATE_LIBRARY'), new SteamAPIError('MISSING_API_KEY'), Error('DB_PASSWORD_SECRET')]) {
    const f = fixture(makeRow({ mode: 'link' }), async () => { throw error; });
    const result = await f.api.runSteamAuthSync(session, f.row.requestId);
    assert.equal(result.status, 'failed'); assert.equal(result.errorCode, error.code ?? 'SYNC_FAILED'); assert(result.linked); assert(result.canRetry);
    assert(!JSON.stringify(result).includes('SECRET')); assert.equal(result.addedCount, 0);
    await f.api.runSteamAuthSync(session, f.row.requestId); assert.equal(f.calls.length, 1, 'Failures need an explicit retry');
    await f.api.runSteamAuthSync(session, f.row.requestId, true); assert.equal(f.calls.length, 1, 'Retry cooldown is persistent');
  }
});

test('explicit retries and expired-worker recovery are bounded; old request IDs and revoked sessions never start work', async () => {
  const f = fixture(makeRow({ status: 'failed', errorCode: 'PRIVATE_LIBRARY', attempts: 1, updatedAt: new Date(Date.now() - 11000) }));
  assert.equal((await f.api.runSteamAuthSync(session, f.row.requestId, true)).status, 'completed');
  const expired = fixture(makeRow({ status: 'running', leaseId: 'old', leaseUntil: new Date(Date.now() - 1), attempts: 1 }));
  assert.equal((await expired.api.getSteamAuthSyncView('main')).status, 'pending');
  assert.equal((await expired.api.runSteamAuthSync(session, expired.row.requestId)).status, 'completed'); assert.equal(expired.row.attempts, 2);
  const exhausted = fixture(makeRow({ status: 'running', leaseUntil: new Date(Date.now() - 1), attempts: 3 }));
  const view = await exhausted.api.runSteamAuthSync(session, exhausted.row.requestId); assert.equal(view.status, 'failed'); assert.equal(view.errorCode, 'TIMEOUT'); assert.equal(view.canRetry, false); assert.equal(exhausted.calls.length, 0);
  for (const invalidate of [f => f.revoke(), f => f.changeVerifiedId('76561198000000001')]) {
    const blocked = fixture(); invalidate(blocked); await blocked.api.runSteamAuthSync(session, blocked.row.requestId); assert.equal(blocked.calls.length, 0);
  }
  const old = fixture(); await old.api.runSteamAuthSync(session, randomUUID()); assert.equal(old.calls.length, 0);
});

test('a superseded worker cannot overwrite a newer callback’s sync state', async () => {
  let f; const next = makeRow();
  f = fixture(makeRow(), async () => { f.replace(next); return { summary: { addedCount: 99, updatedCount: 0 } }; });
  const result = await f.api.runSteamAuthSync(session, f.row.requestId);
  assert.equal(result.requestId, next.requestId); assert.equal(result.status, 'pending'); assert.equal(result.addedCount, 0);
});

test('sync endpoint rejects cross-origin/invalid requests and always gets identity from the live server session', async () => {
  let calls = 0, authenticated = true;
  const load = loader({ '@/lib/library-vault': { requireVaultSession: async () => { if (!authenticated) throw Error('Sign in'); return { player: { id: 'main' }, tokenHash: 'live' }; } },
    '@/lib/google-oauth-origin': { googleOAuthOrigin: () => 'https://app.example.test' },
    '@/lib/steam-auth-sync': { getSteamAuthSyncView: async id => { assert.equal(id, 'main'); return null; }, runSteamAuthSync: async (identity, requestId) => {
      calls++; assert.deepEqual(identity, { userId: 'main', tokenHash: 'live' }); assert.equal(typeof requestId, 'string'); return { status: 'completed' };
    } } });
  const route = load('src/app/api/steam/auth-sync/route.ts');
  const post = (origin, body) => route.POST(new Request('https://app.example.test/api/steam/auth-sync', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  assert.equal((await post('https://evil.test', { requestId: randomUUID() })).status, 403);
  assert.equal((await post('https://app.example.test', { requestId: 'invalid' })).status, 400);
  assert.equal(calls, 0);
  assert.equal((await post('https://app.example.test', { requestId: randomUUID(), userId: 'victim', steamId: 'forged' })).status, 200); assert.equal(calls, 1);
  authenticated = false; assert.equal((await route.GET()).status, 401); assert.equal((await post('https://app.example.test', { requestId: randomUUID() })).status, 401);
});
