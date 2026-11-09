/* eslint-disable @typescript-eslint/no-require-imports -- Offline protocol and transactional auth fixtures. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const { randomBytes } = require('node:crypto');
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
const steamId = '76561198000000000', otherSteam = '76561198000000001', tokenHash = 'a'.repeat(64);
const ns = 'http://specs.openid.net/auth/2.0';
const persona = { name: 'Néon Runner', avatarUrl: null };
const context = overrides => {
  const state = randomBytes(32).toString('base64url');
  return { state, mode: 'signin', sessionHash: null, userId: null, returnTo: `http://localhost:3000/api/auth/steam/callback?state=${state}`, layoutMode: 'fantasy', expiresAt: Date.now() + 599000, ...overrides };
};
const player = overrides => ({ id: 'member', email: 'old@example.test', passwordHash: 'legacy-hash', googleId: 'legacy-google',
  steamId: otherSteam, steamVerifiedId: null, steamVerifiedAt: null, handle: 'old-handle', operatorName: 'Old name', games: ['PRIVATE_GAME'], isAdmin: true, ...overrides });
function matches(row, where) {
  return !!row && Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(part => matches(row, part));
    if (key === 'AND') return value.every(part => matches(row, part));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('none' in value) return !(row[key] ?? []).some(entry => matches(entry, value.none));
      if ('not' in value) return (row[key] ?? null) !== value.not;
      if ('gt' in value) return row[key] > value.gt;
      if ('lte' in value) return row[key] <= value.lte;
      if ('equals' in value) return row[key]?.toLowerCase() === value.equals.replace(/\\([\\%_])/g, '$1').toLowerCase();
    }
    return row[key] === value;
  });
}
function fixture(initial = []) {
  let rows = structuredClone(initial), sessions = [{ tokenHash, userId: 'member', expiresAt: new Date(Date.now() + 600000), player: rows.find(row => row.id === 'member') }];
  let sessionHash = null, sequence = Promise.resolve();
  const jar = new Map(), attempts = new Map(), nonces = new Map(), cookieOptions = [];
  const table = (store, key) => ({
    create: async ({ data }) => { if (store.has(data[key])) throw Object.assign(Error('private duplicate details'), { code: 'P2002' }); store.set(data[key], data); },
    deleteMany: async ({ where }) => { let count = 0; for (const [key, row] of store) if (matches(row, where)) { store.delete(key); count++; } return { count }; },
  });
  const tx = {
    $executeRaw: async strings => assert.match(strings.join(''), /pg_advisory_xact_lock/),
    $queryRaw: async strings => { assert.match(strings.join(''), /FOR UPDATE/); return []; },
    player: {
      findUnique: async ({ where }) => rows.find(row => matches(row, where)) ?? null,
      findFirst: async ({ where }) => rows.find(row => matches(row, where)) ?? null,
      update: async ({ where, data }) => { const row = rows.find(row => matches(row, where)); assert(row); Object.assign(row, data); return row; },
      updateMany: async ({ where, data }) => { const selected = rows.filter(row => matches(row, where)); selected.forEach(row => Object.assign(row, data)); return { count: selected.length }; },
      create: async ({ data }) => { assert(!rows.some(row => row.steamVerifiedId === data.steamVerifiedId)); const row = { id: `new-${rows.length}`, googleId: null, isAdmin: false, ...data }; rows.push(row); return row; },
    },
    playerSession: { findUnique: async ({ where }) => sessions.find(row => {
      const { player: policy, ...rest } = where;
      return matches(row, rest) && (!policy || matches(rows.find(player => player.id === row.userId), policy));
    }) ?? null, deleteMany: async ({ where }) => { sessions = sessions.filter(row => !matches(row, where)); } },
    steamAuthSync: { deleteMany: async () => {} },
  };
  const prisma = { ...tx, steamOpenIDAttempt: table(attempts, 'stateHash'), steamOpenIDNonce: table(nonces, 'nonceHash'),
    $transaction: work => { const run = sequence.then(async () => { const before = structuredClone({ rows, sessions });
      try { return await work(tx); } catch (error) { ({ rows, sessions } = before); throw error; } }); sequence = run.catch(() => {}); return run; },
  };
  const secret = Buffer.alloc(32, 1);
  const load = loader({ '@/lib/prisma': { prisma }, '@/lib/auth-session': { readSessionHash: async () => sessionHash, getSessionSigningKey: async () => secret },
    'next/headers': { cookies: async () => ({ get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value, options) => { jar.set(name, value); cookieOptions.push(options); } }) } });
  const api = load('src/lib/steam-openid.ts');
  return { api, load, prisma, tx, jar, attempts, nonces, secret, cookieOptions, get rows() { return rows; }, get sessions() { return sessions; },
    set sessionHash(value) { sessionHash = value; }, revoke() { sessions = []; } };
}
function assertion(ctx, changes = {}) {
  const claimed = `https://steamcommunity.com/openid/id/${steamId}`;
  return new URLSearchParams({ state: ctx.state, 'openid.ns': ns, 'openid.mode': 'id_res', 'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': claimed, 'openid.identity': claimed, 'openid.return_to': ctx.returnTo,
    'openid.response_nonce': new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') + randomBytes(8).toString('hex'), 'openid.assoc_handle': 'opaque-association',
    'openid.signed': 'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle', 'openid.sig': 'ASSERTION_SIGNATURE_SECRET', ...changes });
}
const reason = status => error => error.status === status;
function env(t, name, value) { const before = process.env[name]; if (value === undefined) delete process.env[name]; else process.env[name] = value;
  t.after(() => { if (before === undefined) delete process.env[name]; else process.env[name] = before; }); }

test('Steam-only signup uses persona, unique normalized handle, null credentials and selected theme; never claims manual profiles or archive', async () => {
  const original = [player({ steamId }), player({ id: 'default-player', email: null, passwordHash: null, googleId: null, steamId })];
  const f = fixture(original), ctx = context();
  const id = await f.prisma.$transaction(tx => f.api.resolveSteamPlayer(tx, steamId, persona, ctx));
  assert.equal(id, 'new-2'); assert.deepEqual(f.rows.slice(0, 2), original);
  const created = f.rows[2]; assert.equal(created.email, null); assert.equal(created.passwordHash, null); assert.equal(created.googleId, null);
  assert.equal(created.steamVerifiedId, steamId); assert(created.steamVerifiedAt instanceof Date); assert.equal(created.steamId, steamId);
  assert.equal(created.preferredLayoutMode, 'fantasy'); assert.match(created.handle, /^neon-runner-[a-f0-9]{8}$/); assert.equal(created.isAdmin, false);
});

test('stable verified identity signs in without modifying credentials, roles, library, persona or sync target', async () => {
  const original = player({ steamVerifiedId: steamId }), f = fixture([original]);
  assert.equal(await f.api.resolveSteamPlayer(f.tx, steamId, { name: 'Changed', avatarUrl: null }, context()), 'member');
  assert.deepEqual(f.rows, [original]);
});

test('linking verifies the initiating live session and preserves local, Google and manual Steam data', async () => {
  for (const savedId of [null, otherSteam, steamId]) {
    const original = player({ steamId: savedId }), f = fixture([original]); f.sessionHash = tokenHash;
    const ctx = context({ mode: 'link', userId: 'member', sessionHash: tokenHash });
    assert.equal(await f.api.resolveSteamPlayer(f.tx, steamId, persona, ctx), 'member');
    assert.equal(f.rows[0].steamVerifiedId, steamId); assert.equal(f.rows[0].steamId, savedId ?? steamId);
    for (const field of ['email', 'passwordHash', 'googleId', 'handle', 'operatorName', 'games', 'isAdmin']) assert.deepEqual(f.rows[0][field], original[field]);
    f.revoke(); await assert.rejects(f.api.resolveSteamPlayer(f.tx, steamId, persona, ctx), reason('session'));
  }
});

test('conflicts cannot transfer a verified identity or replace an existing Steam login', async () => {
  for (const initial of [[player(), player({ id: 'other', steamVerifiedId: steamId })], [player({ steamVerifiedId: otherSteam })]]) {
    const f = fixture(initial); f.sessionHash = tokenHash;
    await assert.rejects(f.prisma.$transaction(tx => f.api.resolveSteamPlayer(tx, steamId, persona, context({ mode: 'link', userId: 'member', sessionHash: tokenHash }))), reason('conflict'));
    assert.deepEqual(f.rows, initial);
  }
});

const shell = changes => player({ id: 'shell', email: null, passwordHash: null, googleId: null, isAdmin: false, isOwner: false,
  steamVerifiedId: steamId, steamId, games: [], operatorName: 'Steam Persona', tagline: 'A retained profile', ...changes });

test('linking reclaims an empty Steam-only shell, revokes its sessions and retains its profile privately', async () => {
  const original = player(), f = fixture([original, shell()]); f.sessionHash = tokenHash;
  f.sessions.push({ userId: 'shell', tokenHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 60000) });
  assert.equal(await f.prisma.$transaction(tx => f.api.resolveSteamPlayer(tx, steamId, persona, context({ mode: 'link', userId: 'member', sessionHash: tokenHash }))), 'member');
  assert.equal(f.rows[0].steamVerifiedId, steamId); assert.equal(f.rows[0].passwordHash, original.passwordHash); assert.deepEqual(f.rows[0].games, original.games);
  const retired = f.rows.find(row => row.id === 'shell');
  assert.equal(retired.steamVerifiedId, null); assert.equal(retired.profileVisibility, 'private'); assert.equal(retired.tagline, 'A retained profile');
  assert.equal(f.sessions.filter(row => row.userId === 'shell').length, 0);
});

test('reclamation protects every credential, role, nonempty library, social relationship, list and preference', async () => {
  for (const changes of [{ email: 'owner@example.test' }, { passwordHash: 'local-hash' }, { googleId: 'google-owner' }, { isAdmin: true }, { isOwner: true },
    { games: ['game'] }, { userAchievements: [{}] }, { customLists: [{}] }, { friendshipsLow: [{}] }, { friendshipsHigh: [{}] },
    { activityEvents: [{}] }, { recommendationDismissals: [{}] }, { authTokens: [{}] }, { steamId: otherSteam }, { id: 'default-player' }]) {
    const initial = [player(), shell(changes)], f = fixture(initial); f.sessionHash = tokenHash;
    await assert.rejects(f.prisma.$transaction(tx => f.api.resolveSteamPlayer(tx, steamId, persona, context({ mode: 'link', userId: 'member', sessionHash: tokenHash }))), reason('conflict'));
    assert.deepEqual(f.rows, initial);
  }
});

test('session creation failure rolls back shell reclamation and Steam linking together', async () => {
  const initial = [player(), shell()], f = fixture(initial); f.sessionHash = tokenHash;
  await assert.rejects(f.prisma.$transaction(async tx => {
    await f.api.resolveSteamPlayer(tx, steamId, persona, context({ mode: 'link', userId: 'member', sessionHash: tokenHash }));
    throw Error('session insert failed');
  }));
  assert.deepEqual(f.rows, initial);
});

test('simultaneous signups resolve one identity; session-write failures roll back a link', async () => {
  const f = fixture();
  const ids = await Promise.all([1, 2].map(() => f.prisma.$transaction(tx => f.api.resolveSteamPlayer(tx, steamId, persona, context()))));
  assert.equal(ids[0], ids[1]); assert.equal(f.rows.length, 1);
  const original = player(), linked = fixture([original]); linked.sessionHash = tokenHash;
  await assert.rejects(linked.prisma.$transaction(async tx => {
    await linked.api.resolveSteamPlayer(tx, steamId, persona, context({ mode: 'link', userId: 'member', sessionHash: tokenHash }));
    throw Error('session-write failure');
  }));
  assert.deepEqual(linked.rows, [original]);
});

test('signed context rejects tampering, wrong key/state, expiry and invalid mode/session bindings', () => {
  const f = fixture(), ctx = context(), signed = f.api.signSteamContext(ctx, f.secret);
  assert.deepEqual(f.api.readSteamContext(signed, ctx.state, f.secret), ctx);
  for (const [cookie, state, key] of [[undefined, ctx.state, f.secret], [signed + '.extra', ctx.state, f.secret], [signed.slice(1), ctx.state, f.secret],
    [signed, randomBytes(32).toString('base64url'), f.secret], [signed, ctx.state, Buffer.alloc(32, 2)]]) assert.throws(() => f.api.readSteamContext(cookie, state, key), reason('state'));
  for (const change of [{ expiresAt: Date.now() - 1 }, { expiresAt: Date.now() + 700000 }, { mode: 'link' }, { layoutMode: 'invalid' }, { sessionHash: 'bad' }, { userId: 'member' }]) {
    assert.throws(() => f.api.readSteamContext(f.api.signSteamContext({ ...ctx, ...change }, f.secret), ctx.state, f.secret), reason('state'));
  }
});

test('canonical origin, Steam request, secure host-only cookie and atomic single-use state survive proxy routing', async t => {
  env(t, 'APP_URL', 'https://public.example.test'); env(t, 'NODE_ENV', 'production');
  const f = fixture(), auth = new URL(await f.api.beginSteamOpenID('http://internal/api/auth/steam', 'signin', 'fantasy'));
  assert.equal(auth.origin + auth.pathname, f.api.steamEndpoint); assert.equal(auth.searchParams.get('openid.realm'), 'https://public.example.test/');
  assert.equal(auth.searchParams.get('openid.mode'), 'checkid_setup'); assert.equal(auth.searchParams.get('openid.identity'), `${ns}/identifier_select`);
  const callback = auth.searchParams.get('openid.return_to'); assert(callback.startsWith('https://public.example.test/api/auth/steam/callback?state='));
  const options = f.cookieOptions[0]; assert.equal(f.api.steamCookieName, '__Host-bb_steam_openid_v1');
  assert(options.httpOnly && options.secure); assert.equal(options.sameSite, 'lax'); assert.equal(options.path, '/'); assert.equal(options.domain, undefined);
  const internalCallback = callback.replace('https://public.example.test', 'http://internal');
  const outcomes = await Promise.allSettled([1, 2].map(() => f.api.consumeSteamContext(internalCallback)));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1); assert.equal(f.attempts.size, 0);
  assert.equal(outcomes.find(result => result.status === 'rejected').reason.status, 'state');
});

test('state validation rejects changed origins, sessions, duplicate state and logged-out linking', async t => {
  env(t, 'APP_URL', undefined);
  const f = fixture(); await assert.rejects(f.api.beginSteamOpenID('http://localhost:3000/api/auth/steam', 'link', 'fantasy'), reason('session'));
  const auth = new URL(await f.api.beginSteamOpenID('http://localhost:3000/api/auth/steam', 'signin', 'fantasy')), callback = auth.searchParams.get('openid.return_to');
  await assert.rejects(f.api.consumeSteamContext(callback + '&state=duplicate'), reason('state'));
  env(t, 'APP_URL', 'https://changed.example.test'); await assert.rejects(f.api.consumeSteamContext(callback), reason('state'));
  delete process.env.APP_URL; f.sessionHash = tokenHash; await assert.rejects(f.api.consumeSteamContext(callback), reason('session'));
});

test('verification posts the full assertion to the fixed Steam endpoint and prevents nonce reuse across attempts', async t => {
  const f = fixture(), ctx = context(), params = assertion(ctx); let calls = 0;
  t.mock.method(global, 'fetch', async (url, options) => {
    calls++; assert.equal(url, f.api.steamEndpoint); assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert.equal(options.body.get('openid.mode'), 'check_authentication'); assert.equal(options.body.get('openid.sig'), 'ASSERTION_SIGNATURE_SECRET'); assert.equal(options.body.has('state'), false);
    return new Response(`ns:${ns}\nis_valid:true\n`);
  });
  assert.equal(await f.api.verifySteamAssertion(params, ctx), steamId); assert.equal(calls, 1); assert.equal(f.nonces.size, 1);
  assert(!JSON.stringify([...f.nonces]).includes(params.get('openid.response_nonce')));
  const next = context(), replay = assertion(next, { 'openid.response_nonce': params.get('openid.response_nonce') });
  await assert.rejects(f.api.verifySteamAssertion(replay, next), reason('state'));
});

test('rejects forged endpoints/IDs/return URLs, missing signatures, stale/future nonces and cancellation before network access', async t => {
  const f = fixture(), ctx = context(); let calls = 0;
  t.mock.method(global, 'fetch', async () => { calls++; throw Error('must not fetch'); });
  const changes = [ { 'openid.ns': 'wrong' }, { 'openid.mode': 'check_authentication' }, { 'openid.op_endpoint': 'https://evil.test' },
    { 'openid.claimed_id': `https://evil.test/openid/id/${steamId}` }, { 'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561197960265728' },
    { 'openid.identity': `https://steamcommunity.com/openid/id/${otherSteam}` }, { 'openid.return_to': ctx.returnTo + '&extra=1' },
    { 'openid.signed': 'claimed_id' }, { 'openid.sig': '' }, { 'openid.response_nonce': 'invalid' },
    { 'openid.response_nonce': '2000-01-01T00:00:00Zold' }, { 'openid.response_nonce': '2099-01-01T00:00:00Zfuture' } ];
  for (const change of changes) await assert.rejects(f.api.verifySteamAssertion(assertion(ctx, change), ctx), reason('failed'));
  const duplicate = assertion(ctx); duplicate.append('openid.sig', 'second'); await assert.rejects(f.api.verifySteamAssertion(duplicate, ctx), reason('failed'));
  await assert.rejects(f.api.verifySteamAssertion(assertion(ctx, { 'openid.mode': 'cancel' }), ctx), reason('cancelled'));
  assert.equal(calls, 0); assert.equal(f.nonces.size, 0);
});

test('provider failures, malformed replies and network errors cannot authenticate or persist a nonce', async t => {
  const f = fixture(), ctx = context(); let reply;
  t.mock.method(global, 'fetch', async () => { if (reply instanceof Error) throw reply; return reply; });
  for (reply of [new Response('provider secret', { status: 500 }), new Response(`ns:${ns}\nis_valid:false\n`), new Response('is_valid:true\n'),
    new Response(`ns:${ns}\nis_valid:true\nis_valid:false\n`), new Response(`ns:${ns}\nis_valid:trueSECRET\n`), Error('UPSTREAM_SECRET')]) {
    await assert.rejects(f.api.verifySteamAssertion(assertion(ctx), ctx), reason('failed')); assert.equal(f.nonces.size, 0);
  }
});

test('optional profile metadata uses a clean fallback without API credentials and validates Steam ID/avatar host', async t => {
  const f = fixture(); env(t, 'STEAM_API_KEY', undefined);
  assert.deepEqual(await f.api.fetchSteamPersona(steamId), { name: 'Steam Player', avatarUrl: null });
  env(t, 'STEAM_API_KEY', 'API_KEY_SECRET'); let body = { response: { players: [{ steamid: steamId, personaname: '  A\u0000 Hero  ', avatarfull: 'https://avatars.steamstatic.com/avatar.jpg' }] } };
  t.mock.method(global, 'fetch', async (url, options) => { assert.equal(url.origin, 'https://api.steampowered.com'); assert.equal(options.redirect, 'error'); return Response.json(body); });
  assert.deepEqual(await f.api.fetchSteamPersona(steamId), { name: 'A Hero', avatarUrl: 'https://avatars.steamstatic.com/avatar.jpg' });
  body.response.players[0].avatarfull = 'https://evil.test/avatar'; assert.equal((await f.api.fetchSteamPersona(steamId)).avatarUrl, null);
  body.response.players[0].steamid = otherSteam; assert.equal((await f.api.fetchSteamPersona(steamId)).name, 'Steam Player');
});

test('Steam-only sessions authorize app/security access and expose a nullable, secret-free summary', async () => {
  const steamPlayer = player({ email: null, passwordHash: null, googleId: null, steamVerifiedId: steamId, createdAt: new Date('2020-01-01Z') });
  const f = fixture([steamPlayer]); f.sessionHash = tokenHash;
  const policy = f.load('src/lib/auth-policy.ts').registeredPlayerWhere;
  assert(matches(steamPlayer, policy)); assert(!matches(player({ email: null, passwordHash: null, googleId: null }), policy));
  const security = f.load('src/lib/account-security.ts'), active = await security.getCredentialSession(); assert.equal(active.player.id, 'member');
  const summary = security.credentialSummary(steamPlayer, new Date());
  assert.equal(summary.email, null); assert.equal(summary.steamVerifiedId, steamId); assert.equal(summary.hasPassword, false);
  for (const field of ['passwordHash', 'googleId', 'tokenHash']) assert(!(field in summary));
  const form = new FormData(); form.set('newEmail', ' Add@Example.Test ');
  assert.equal(security.readCredentialChanges(form, null, false).newEmail, 'add@example.test');
  form.delete('newEmail'); form.set('newPassword', 'optional password'); assert.equal(security.readCredentialChanges(form, null, false).newPassword, 'optional password');
});

test('canonical entry redirect precedes cookie creation; callback diagnostics identify stages without logging secrets', async t => {
  env(t, 'APP_URL', 'https://public.example.test');
  const logs = []; t.mock.method(console, 'error', (...args) => logs.push(args));
  const diagnostics = loader()('src/lib/steam-openid-diagnostics.ts');
  const responses = { NextResponse: { redirect: (url, options) => new Response(null, { status: 307, headers: { ...options?.headers, location: String(url) } }) } };
  for (const failure of ['consume', 'verify', 'profile', 'account', 'session', 'revalidate', 'cleanup']) {
    const work = key => { if (key === failure) throw Error('COOKIE_STATE_SIGNATURE_API_KEY_DATABASE_SECRET'); };
    const load = loader({ 'next/server': responses, 'next/cache': { revalidatePath: () => work('revalidate') }, '@/lib/steam-openid-diagnostics': diagnostics,
      '@/lib/steam-auth-sync': { queueSteamAuthSync: async () => {} },
      '@/lib/steam-openid': { beginSteamOpenID: async () => assert.fail('must canonicalize first'), clearSteamContext: async () => work('cleanup'),
        consumeSteamContext: async () => { work('consume'); return context(); }, verifySteamAssertion: async () => { work('verify'); return steamId; },
        fetchSteamPersona: async () => { work('profile'); return persona; }, resolveSteamPlayer: async () => { work('account'); return 'member'; } },
      '@/lib/auth-session': { createPlayerSession: async resolve => { work('session'); await resolve({}); } },
    });
    const entry = await load('src/app/api/auth/steam/route.ts').GET(new Request('https://deployment.test/api/auth/steam?mode=link&theme=fantasy', { headers: { host: 'deployment.test' } }));
    assert.equal(entry.headers.get('location'), 'https://public.example.test/api/auth/steam?mode=link&theme=fantasy');
    const before = logs.length;
    const response = await load('src/app/api/auth/steam/callback/route.ts').GET(new Request('https://public.example.test/api/auth/steam/callback?state=STATE_SECRET&openid.sig=SIGNATURE_SECRET'));
    assert.equal(response.headers.get('location'), failure === 'cleanup' ? 'https://public.example.test/' : 'https://public.example.test/steam-auth?status=failed');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer'); assert.equal(logs.length, before + 1);
    assert.equal(logs.at(-1)[2].stage, { consume: 'consume_state', verify: 'verify_assertion', profile: 'profile_lookup', account: 'account_resolution', session: 'create_session', revalidate: 'revalidate', cleanup: 'clear_cookie' }[failure]);
  }
  assert(!JSON.stringify(logs).includes('SECRET'));
});
