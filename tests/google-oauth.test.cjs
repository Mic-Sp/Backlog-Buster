/* eslint-disable @typescript-eslint/no-require-imports -- Offline OAuth, cookie and transactional database fixtures. */
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
    instance.require = name => name === 'server-only' || name.endsWith('.css') ? {} : Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : original(name);
    instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, filename);
    cache.set(file, instance.exports); return instance.exports;
  }
  return load;
}
const profile = { googleId: 'google-subject-123', email: 'member@example.test', name: 'Néon Runner' };
const context = overrides => ({ state: randomBytes(32).toString('base64url'), verifier: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'), mode: 'signin', sessionHash: null, userId: null,
  redirectUri: 'http://localhost:3000/api/auth/google/callback', layoutMode: 'fantasy', expiresAt: Date.now() + 599000, ...overrides });
const player = overrides => ({ id: 'member', email: profile.email, passwordHash: 'legacy-scrypt-hash', googleId: null, emailVerifiedAt: null, isAdmin: true, isOwner: true, games: ['PRIVATE_LIBRARY'], handle: 'old-handle', operatorName: 'Old name', ...overrides });

function fixture(initial = [], overrides = {}) {
  let rows = structuredClone(initial), sessions = [{ userId: 'member', tokenHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 600000) }];
  let writes = [], sequence = Promise.resolve(), sessionHash = null, failSession = false;
  const attempts = new Map(), jar = new Map(), cookieOptions = [];
  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(part => matches(row, part));
    if (key === 'player') return matches(rows.find(player => player.id === row.userId) || {}, value);
    if (value && typeof value === 'object') {
      if ('gt' in value) return row[key] > value.gt;
      if ('lte' in value) return row[key] <= value.lte;
      if ('not' in value) return row[key] !== value.not;
      if ('equals' in value) return row[key]?.toLowerCase() === value.equals.replace(/\\([\\%_])/g, '$1').toLowerCase();
    }
    return row[key] === value;
  });
  const tx = {
    $executeRaw: async strings => assert.match(strings.join(''), /backlogbuster-account-registration/),
    player: {
      findUnique: async ({ where }) => rows.find(row => matches(row, where)) || null,
      findFirst: async ({ where }) => rows.find(row => matches(row, where)) || null,
      update: async ({ where, data }) => { const row = rows.find(row => matches(row, where)); assert(row); Object.assign(row, data); writes.push(data); return row; },
      create: async ({ data }) => { assert(!rows.some(row => row.email.toLowerCase() === data.email.toLowerCase() || row.googleId === data.googleId)); const row = { id: `new-${rows.length}`, isAdmin: false, isOwner: false, ...data }; rows.push(row); writes.push(data); return row; },
    },
    playerSession: {
      findUnique: async ({ where }) => sessions.find(row => matches(row, where)) || null,
      deleteMany: async () => {},
      create: async ({ data }) => { if (failSession) throw Error('session write failure'); sessions.push(data); },
    },
  };
  const prisma = { ...tx,
    googleOAuthAttempt: {
      create: async ({ data }) => attempts.set(data.stateHash, data),
      deleteMany: async ({ where }) => { let count = 0; for (const [key, row] of attempts) if (matches(row, where)) { attempts.delete(key); count++; } return { count }; },
    },
    $transaction: operation => {
      const run = sequence.then(async () => { const before = structuredClone({ rows, sessions, writes });
        try { return await operation(tx); } catch (error) { ({ rows, sessions, writes } = before); throw error; } });
      sequence = run.catch(() => {}); return run;
    },
  };
  const secret = Buffer.alloc(32, 1);
  const load = loader({ '@/lib/prisma': { prisma }, '@/lib/auth-session': { readSessionHash: async () => sessionHash, getSessionSigningKey: async () => secret },
    'next/headers': { cookies: async () => ({ get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value, options) => { jar.set(name, value); cookieOptions.push(options); } }) }, ...overrides });
  const api = load('src/lib/google-oauth.ts');
  return { api, prisma, tx, load, jar, cookieOptions, attempts, secret, get rows() { return rows; }, get sessions() { return sessions; }, get writes() { return writes; },
    set sessionHash(value) { sessionHash = value; }, set failSession(value) { failSession = value; } };
}

test('new Google user receives a verified email, no password, clean unique handle and chosen theme', async () => {
  const f = fixture();
  const id = await f.prisma.$transaction(tx => f.api.resolveGooglePlayer(tx, profile, context()));
  assert.equal(id, 'new-0'); assert.equal(f.rows[0].googleId, profile.googleId); assert.equal(f.rows[0].passwordHash, null);
  assert(f.rows[0].emailVerifiedAt instanceof Date); assert.match(f.rows[0].handle, /^neon-runner-[a-f0-9]{8}$/);
  assert.equal(f.rows[0].operatorName, profile.name); assert.equal(f.rows[0].preferredLayoutMode, 'fantasy');
  assert.equal(f.rows[0].isAdmin, false); assert.equal(f.rows[0].isOwner, false);
});

test('verified email auto-linking preserves immutable identity, local password, library and roles', async () => {
  for (const verifiedAt of [null, new Date('2020-01-01')]) {
    const original = player({ email: 'MEMBER@Example.test', emailVerifiedAt: verifiedAt }), f = fixture([original]);
    const id = await f.prisma.$transaction(tx => f.api.resolveGooglePlayer(tx, profile, context()));
    assert.equal(id, original.id); assert.equal(f.rows.length, 1); assert.equal(f.rows[0].googleId, profile.googleId);
    for (const field of ['passwordHash', 'id', 'email', 'isAdmin', 'isOwner', 'operatorName', 'handle']) assert.equal(f.rows[0][field], original[field]);
    assert.deepEqual(f.rows[0].games, original.games); assert(f.rows[0].emailVerifiedAt);
    if (verifiedAt) assert.deepEqual(f.rows[0].emailVerifiedAt, verifiedAt);
  }
});

test('stable Google ID takes precedence over changed Google email without changing local credentials', async () => {
  const original = player({ googleId: profile.googleId }), f = fixture([original, player({ id: 'other', email: 'changed@example.test' })]);
  const id = await f.prisma.$transaction(tx => f.api.resolveGooglePlayer(tx, { ...profile, email: 'changed@example.test' }, context()));
  assert.equal(id, original.id); assert.deepEqual(f.rows[0], original); assert.equal(f.writes.length, 0);
});

test('logged-in linking binds the initiating session and retains a different primary email', async () => {
  const original = player({ email: 'local@example.test' }), f = fixture([original]);
  const ctx = context({ mode: 'link', sessionHash: 'a'.repeat(64), userId: 'member' });
  assert.equal(await f.prisma.$transaction(tx => f.api.resolveGooglePlayer(tx, profile, ctx)), 'member');
  assert.equal(f.rows[0].email, original.email); assert.equal(f.rows[0].emailVerifiedAt, null);
  assert.equal(f.rows[0].googleId, profile.googleId); assert.equal(f.rows[0].passwordHash, original.passwordHash);
  const revoked = fixture([original]);
  await assert.rejects(revoked.prisma.$transaction(tx => revoked.api.resolveGooglePlayer(tx, profile, { ...ctx, sessionHash: 'b'.repeat(64) })), error => error.reason === 'session');
  assert.deepEqual(revoked.rows[0], original);
});

test('conflicts never reassign Google IDs, overwrite an existing connection or merge player data', async () => {
  const cases = [
    { rows: [player({ googleId: 'another-google' })], ctx: context() },
    { rows: [player({}), player({ id: 'other', email: 'other@example.test', googleId: profile.googleId })], ctx: context({ mode: 'link', userId: 'member', sessionHash: 'a'.repeat(64) }) },
    { rows: [player({ googleId: 'another-google' })], ctx: context({ mode: 'link', userId: 'member', sessionHash: 'a'.repeat(64) }) },
  ];
  for (const entry of cases) {
    const f = fixture(entry.rows);
    await assert.rejects(f.prisma.$transaction(tx => f.api.resolveGooglePlayer(tx, profile, entry.ctx)), error => error.reason === 'conflict');
    assert.deepEqual(f.rows, entry.rows);
  }
});

test('concurrent callbacks resolve one account; session insertion failure rolls back account linking', async () => {
  const f = fixture([player({})]), ctx = context();
  const ids = await Promise.all([1, 2].map(() => f.prisma.$transaction(tx => f.api.resolveGooglePlayer(tx, profile, ctx))));
  assert.deepEqual(ids, ['member', 'member']); assert.equal(f.rows.length, 1);
  const rollback = fixture([player({})]), before = structuredClone(rollback.rows); rollback.failSession = true;
  await assert.rejects(rollback.prisma.$transaction(async tx => { const id = await rollback.api.resolveGooglePlayer(tx, profile, ctx); await tx.playerSession.create({ data: { userId: id } }); }));
  assert.deepEqual(rollback.rows, before);
});

test('signed CSRF context rejects missing, forged, wrong, expired, or inconsistent state', () => {
  const { api, secret } = fixture(), ctx = context();
  const signed = api.signGoogleContext(ctx, secret);
  assert.deepEqual(api.readGoogleContext(signed, ctx.state, secret), ctx);
  for (const [cookie, state] of [[undefined, ctx.state], [signed, null], [signed, 'x'.repeat(43)], [`${signed.slice(0, -1)}!`, ctx.state], [signed + '.extra', ctx.state]]) {
    assert.throws(() => api.readGoogleContext(cookie, state, secret), error => error.reason === 'state');
  }
  for (const changed of [{ expiresAt: Date.now() - 1 }, { mode: 'other' }, { nonce: '' }, { verifier: '' }, { mode: 'link', userId: null }, { userId: 'victim' }]) {
    assert.throws(() => api.readGoogleContext(api.signGoogleContext({ ...ctx, ...changed }, secret), ctx.state, secret), error => error.reason === 'state');
  }
});

test('OAuth initiation sets PKCE, nonce, exact callback, secure cookie; state is consumed only once', async () => {
  const before = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET, origin: process.env.APP_URL };
  try {
    process.env.GOOGLE_CLIENT_ID = 'unit-client'; process.env.GOOGLE_CLIENT_SECRET = 'unit-secret'; process.env.APP_URL = 'http://localhost:3000';
    const f = fixture(), auth = new URL(await f.api.beginGoogleOAuth('http://localhost:3000/api/auth/google', 'signin', 'fantasy'));
    assert.equal(auth.origin, 'https://accounts.google.com'); assert.equal(auth.searchParams.get('scope'), 'openid email profile');
    assert.equal(auth.searchParams.get('code_challenge_method'), 'S256'); assert.equal(auth.searchParams.get('redirect_uri'), 'http://localhost:3000/api/auth/google/callback');
    const signed = f.jar.get(f.api.googleCookieName), state = auth.searchParams.get('state');
    const ctx = f.api.readGoogleContext(signed, state, f.secret);
    assert.equal(auth.searchParams.get('code_challenge'), f.api.pkceChallenge(ctx.verifier)); assert.equal(auth.searchParams.get('nonce'), ctx.nonce);
    assert.equal(f.cookieOptions[0].httpOnly, true); assert.equal(f.cookieOptions[0].sameSite, 'lax'); assert.equal(f.cookieOptions[0].path, '/'); assert.equal(f.cookieOptions[0].maxAge, 600);
    assert(!JSON.stringify([...f.attempts.values()]).includes(ctx.verifier)); assert(!JSON.stringify([...f.attempts.values()]).includes(ctx.state));
    const callback = `${ctx.redirectUri}?state=${state}&code=test-code`;
    assert.deepEqual(await f.api.consumeGoogleContext(callback), ctx);
    await assert.rejects(f.api.consumeGoogleContext(callback), error => error.reason === 'state');
    await f.api.clearGoogleContext(); assert.equal(f.jar.get(f.api.googleCookieName), '');
  } finally {
    for (const [key, value] of [['GOOGLE_CLIENT_ID', before.id], ['GOOGLE_CLIENT_SECRET', before.secret], ['APP_URL', before.origin]]) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('callback rejects a switched browser session before token exchange, and unavailable configuration fails cleanly', async () => {
  const before = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET, origin: process.env.APP_URL };
  try {
    process.env.GOOGLE_CLIENT_ID = 'unit-client'; process.env.GOOGLE_CLIENT_SECRET = 'unit-secret'; delete process.env.APP_URL;
    const f = fixture();
    const auth = new URL(await f.api.beginGoogleOAuth('http://localhost:3000/api/auth/google', 'signin', 'cyberpunk'));
    f.sessionHash = 'c'.repeat(64);
    await assert.rejects(f.api.consumeGoogleContext(`http://localhost:3000/api/auth/google/callback?state=${auth.searchParams.get('state')}`), error => error.reason === 'session');
    assert.equal(f.api.googleConfiguration('https://backlog-buster-chi.vercel.app/api/auth/google').redirectUri, 'https://backlog-buster-chi.vercel.app/api/auth/google/callback');
    assert.throws(() => f.api.googleConfiguration('http://untrusted.example/api/auth/google'), error => error.reason === 'unavailable');
    delete process.env.GOOGLE_CLIENT_SECRET;
    await assert.rejects(f.api.beginGoogleOAuth('http://localhost:3000/api/auth/google', 'signin', 'cyberpunk'), error => error.reason === 'unavailable');
  } finally {
    for (const [key, value] of [['GOOGLE_CLIENT_ID', before.id], ['GOOGLE_CLIENT_SECRET', before.secret], ['APP_URL', before.origin]]) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('ID tokens require a verified email and the exact nonce and authorized party', () => {
  const { api } = fixture(), good = { sub: profile.googleId, email: ' MEMBER@Example.test ', email_verified: true, nonce: 'nonce', aud: 'client', name: profile.name };
  assert.deepEqual(api.googleProfileFromClaims(good, 'nonce', 'client'), profile);
  for (const changed of [{ email_verified: false }, { email_verified: 'true' }, { email: 'bad' }, { nonce: 'other' }, { sub: '' }, { azp: 'attacker' }, { aud: ['client', 'other'] }]) {
    assert.throws(() => api.googleProfileFromClaims({ ...good, ...changed }, 'nonce', 'client'), error => error.reason === 'profile');
  }
});

test('real JWT verification rejects forged signatures, wrong issuer/audience, expiration and nonce', async () => {
  const jose = await import('jose'), { publicKey, privateKey } = await jose.generateKeyPair('RS256');
  const jwk = await jose.exportJWK(publicKey), localKeys = jose.createLocalJWKSet({ keys: [{ ...jwk, kid: 'unit' }] });
  const previous = { fetch: global.fetch, id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET, origin: process.env.APP_URL };
  try {
    process.env.GOOGLE_CLIENT_ID = 'unit-client'; process.env.GOOGLE_CLIENT_SECRET = 'unit-secret'; process.env.APP_URL = 'http://localhost:3000';
    const api = loader({ '@/lib/prisma': {}, '@/lib/auth-session': {}, 'next/headers': {}, jose: { ...jose, createRemoteJWKSet: () => localKeys } })('src/lib/google-oauth.ts');
    const ctx = context(); let idToken, requests = [];
    global.fetch = async (url, options) => { requests.push({ url, options }); return Response.json({ id_token: idToken, access_token: 'must-not-persist' }); };
    const token = async (claims = {}, issuer = 'https://accounts.google.com', audience = 'unit-client', expiration = '5m', signingKey = privateKey) => new jose.SignJWT({ email: profile.email, email_verified: true, nonce: ctx.nonce, name: profile.name, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'unit' }).setSubject(profile.googleId).setIssuedAt().setIssuer(issuer).setAudience(audience).setExpirationTime(expiration).sign(signingKey);
    idToken = await token(); assert.deepEqual(await api.exchangeGoogleCode('authorization-code', ctx), profile);
    assert.equal(requests[0].url, 'https://oauth2.googleapis.com/token'); assert.equal(requests[0].options.body.get('code_verifier'), ctx.verifier);
    assert.equal(requests[0].options.body.get('client_secret'), 'unit-secret');
    const attacker = await jose.generateKeyPair('RS256');
    for (const promise of [token({}, 'https://evil.test'), token({}, undefined, 'other-client'), token({}, undefined, undefined, -10), token({ nonce: 'wrong' }), token({}, undefined, undefined, undefined, attacker.privateKey)]) {
      idToken = await promise; await assert.rejects(api.exchangeGoogleCode('code', ctx));
    }
  } finally {
    global.fetch = previous.fetch;
    for (const [key, value] of [['GOOGLE_CLIENT_ID', previous.id], ['GOOGLE_CLIENT_SECRET', previous.secret], ['APP_URL', previous.origin]]) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('Google-only accounts can set their first local password, while credential changes retain old-password protection', async () => {
  const load = loader({ '@/lib/prisma': {}, '@/lib/auth-session': {} });
  const { readCredentialChanges } = load('src/lib/account-security.ts');
  const form = fields => { const data = new FormData(); for (const [key, value] of Object.entries(fields)) data.set(key, value); return data; };
  const input = form({ newPassword: ' exact local password ' });
  assert.deepEqual(readCredentialChanges(input, profile.email, false), { currentPassword: '', newEmail: null, newPassword: ' exact local password ' });
  assert.throws(() => readCredentialChanges(input, profile.email, true), /current password/);
  assert.throws(() => readCredentialChanges(form({ newPassword: 'new password', newEmail: 'other@example.test' }), profile.email, false), /Set a local password/);
  assert.throws(() => readCredentialChanges(form({ newPassword: 'short' }), profile.email, false), /8–128/);
});

test('OAuth notices accept only known status messages and render safely in both themes', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  for (const theme of ['cyberpunk', 'fantasy']) {
    const load = loader({
      'next/link': { default: ({ children, href }) => React.createElement('a', { href }, children) },
      '@/components/LayoutText': { useLayoutCopy: () => (cyberpunk, fantasy) => theme === 'fantasy' ? fantasy : cyberpunk },
      '@/components/ThemeProvider': { ThemeToggle: () => null }, '@/components/FantasyAccents': { FantasyCorners: () => null },
    });
    const Notice = load('src/components/GoogleAuthNotice.tsx').default;
    for (const status of ['__proto__', 'constructor', 'toString', 'unknown', '<script>unsafe</script>']) {
      const html = renderToStaticMarkup(React.createElement(Notice, { status }));
      assert(html.includes('Google sign-in could not be completed.')); assert(!html.includes('<script>'));
      assert(html.includes(theme === 'fantasy' ? 'THE ROYAL SEAL' : 'ICE SECURITY GATEWAY'));
    }
    assert(renderToStaticMarkup(React.createElement(Notice, { status: 'linked' })).includes('Your Google account is connected.'));
  }
});

async function withOAuthEnvironment(work) {
  const names = ['APP_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'NODE_ENV'];
  const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.GOOGLE_CLIENT_ID = 'unit-client'; process.env.GOOGLE_CLIENT_SECRET = 'CLIENT_SECRET_MUST_NOT_APPEAR';
  delete process.env.APP_URL;
  try { return await work(); }
  finally { for (const name of names) if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name]; }
}
const publicOrigin = 'https://backlog-buster-chi.vercel.app';
const publicHeaders = () => new Headers({ 'x-forwarded-host': 'backlog-buster-chi.vercel.app', 'x-forwarded-proto': 'https', host: 'backlog-buster-deployment.vercel.app' });
const responses = { NextResponse: { redirect: (url, options = {}) => new Response(null, { status: 307, headers: { ...options.headers, Location: String(url) } }) } };

test('canonical callback resolution prefers APP_URL, then public forwarded headers, and preserves localhost', async () => withOAuthEnvironment(async () => {
  const { api } = fixture(), internal = 'http://backlog-buster-internal-a.vercel.app/api/auth/google';
  assert.equal(api.googleConfiguration(internal, publicHeaders()).redirectUri, `${publicOrigin}/api/auth/google/callback`);
  process.env.APP_URL = `${publicOrigin}/ignored-path`;
  assert.equal(api.googleConfiguration('https://internal-b.vercel.app/api/auth/google/callback', new Headers({ 'x-forwarded-host': 'other.example', 'x-forwarded-proto': 'https' })).redirectUri, `${publicOrigin}/api/auth/google/callback`);
  delete process.env.APP_URL;
  assert.equal(api.googleConfiguration('http://localhost:3000/api/auth/google', new Headers({ host: 'localhost:3000', 'x-forwarded-proto': 'http' })).redirectUri, 'http://localhost:3000/api/auth/google/callback');
  assert.equal(api.googleConfiguration('https://deployment.vercel.app/api/auth/google', new Headers({ host: 'backlog-buster-chi.vercel.app' })).redirectUri, `${publicOrigin}/api/auth/google/callback`);
  for (const host of ['evil.example/path', 'user:secret@evil.example', 'evil.example,backlog-buster-chi.vercel.app', 'evil.example?token=SECRET', 'evil.example\\path']) {
    assert.throws(() => api.googleConfiguration(internal, new Headers({ 'x-forwarded-host': host, 'x-forwarded-proto': 'https' })), error => error.failure === 'invalid_forwarded_origin');
  }
  assert.throws(() => api.googleConfiguration(internal, new Headers({ 'x-forwarded-host': 'backlog-buster-chi.vercel.app', 'x-forwarded-proto': 'https,http' })), error => error.failure === 'invalid_forwarded_origin');
}));

test('production state cookie and database attempt survive different deployment hosts and separate replicas', async () => withOAuthEnvironment(async () => {
  process.env.NODE_ENV = 'production';
  const first = fixture(), authorization = new URL(await first.api.beginGoogleOAuth('http://internal-a.vercel.app/api/auth/google', 'signin', 'cyberpunk', publicHeaders()));
  assert.equal(authorization.searchParams.get('redirect_uri'), `${publicOrigin}/api/auth/google/callback`);
  assert.equal(first.api.googleCookieName, '__Host-bb_google_oauth_v1');
  assert.deepEqual(first.cookieOptions[0], { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600 });
  const callbackReplica = fixture([], { '@/lib/prisma': { prisma: first.prisma } });
  callbackReplica.jar.set(callbackReplica.api.googleCookieName, first.jar.get(first.api.googleCookieName));
  const callback = `http://internal-b.vercel.app/api/auth/google/callback?state=${authorization.searchParams.get('state')}&code=CODE_MUST_NOT_LOG`;
  const ctx = await callbackReplica.api.consumeGoogleContext(callback, publicHeaders());
  assert.equal(ctx.redirectUri, `${publicOrigin}/api/auth/google/callback`); assert.equal(first.attempts.size, 0);
  await assert.rejects(callbackReplica.api.consumeGoogleContext(callback, publicHeaders()), error => error.failure === 'state_attempt_missing_expired_or_used');
}));

test('a genuine public-origin mismatch is rejected and retains the one-time state attempt', async () => withOAuthEnvironment(async () => {
  const f = fixture(), authorization = new URL(await f.api.beginGoogleOAuth('https://internal-a.vercel.app/api/auth/google', 'signin', 'cyberpunk', publicHeaders()));
  const callback = `https://internal-b.vercel.app/api/auth/google/callback?state=${authorization.searchParams.get('state')}`;
  await assert.rejects(f.api.consumeGoogleContext(callback, new Headers({ 'x-forwarded-host': 'different.example', 'x-forwarded-proto': 'https' })), error => {
    assert.equal(error.reason, 'state'); assert.equal(error.failure, 'redirect_uri_mismatch');
    assert.equal(error.detail.expectedOrigin, 'https://different.example'); assert.equal(error.detail.storedOrigin, publicOrigin); return true;
  });
  assert.equal(f.attempts.size, 1);
}));

test('authorize and callback routes keep a public alias across internal hosts through session creation', async () => withOAuthEnvironment(async () => {
  const f = fixture(), diagnostics = f.load('src/lib/google-oauth-diagnostics.ts');
  const routeLoad = loader({
    'next/server': responses, 'next/cache': { revalidatePath() {} },
    '@/lib/google-oauth-diagnostics': diagnostics,
    '@/lib/google-oauth': { ...f.api, exchangeGoogleCode: async () => profile },
    '@/lib/auth-session': { createPlayerSession: async resolve => f.prisma.$transaction(async tx => { const userId = await resolve(tx); await tx.playerSession.create({ data: { userId, tokenHash: 'session', expiresAt: new Date() } }); }) },
  });
  const authorize = routeLoad('src/app/api/auth/google/route.ts').GET;
  const response = await authorize(new Request('http://internal-a.vercel.app/api/auth/google?theme=fantasy', { headers: publicHeaders() }));
  const google = new URL(response.headers.get('location'));
  assert.equal(google.origin, 'https://accounts.google.com'); assert.equal(google.searchParams.get('redirect_uri'), `${publicOrigin}/api/auth/google/callback`);
  const callback = routeLoad('src/app/api/auth/google/callback/route.ts').GET;
  const result = await callback(new Request(`http://internal-b.vercel.app/api/auth/google/callback?code=opaque-code&state=${google.searchParams.get('state')}`, { headers: publicHeaders() }));
  assert.equal(result.status, 307); assert.equal(result.headers.get('location'), `${publicOrigin}/`);
  assert.equal(result.headers.get('referrer-policy'), 'no-referrer'); assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(f.rows[0].googleId, profile.googleId); assert.equal(f.rows[0].preferredLayoutMode, 'fantasy');
  assert.equal(f.jar.get(f.api.googleCookieName), '');
}));

test('APP_URL canonicalizes a deployment-host entry before creating its host-only cookie', async () => withOAuthEnvironment(async () => {
  process.env.APP_URL = publicOrigin; let began = false;
  const diagnostics = loader()('src/lib/google-oauth-diagnostics.ts');
  const load = loader({ 'next/server': responses, '@/lib/google-oauth-diagnostics': diagnostics,
    '@/lib/google-oauth': { beginGoogleOAuth: async () => { began = true; return 'https://accounts.google.com'; } } });
  const response = await load('src/app/api/auth/google/route.ts').GET(new Request('https://internal.vercel.app/api/auth/google?mode=link&theme=fantasy', { headers: { host: 'internal.vercel.app', 'x-forwarded-proto': 'https' } }));
  assert.equal(response.headers.get('location'), `${publicOrigin}/api/auth/google?mode=link&theme=fantasy`); assert.equal(began, false);
}));

test('token exchange uses the exact saved redirect URI and logs only safe provider rejection codes', async () => withOAuthEnvironment(async () => {
  const originalFetch = global.fetch, originalError = console.error, logs = [];
  const diagnostics = loader()('src/lib/google-oauth-diagnostics.ts');
  const api = loader({ '@/lib/prisma': {}, '@/lib/auth-session': {}, 'next/headers': {}, '@/lib/google-oauth-diagnostics': diagnostics,
    jose: { createRemoteJWKSet: () => ({}), jwtVerify: async () => ({ payload: { sub: profile.googleId, email: profile.email, email_verified: true, nonce: 'nonce' } }) } })('src/lib/google-oauth.ts');
  try {
    console.error = (...args) => logs.push(args);
    // Even if APP_URL changes mid-flight, the provider receives the URI from the
    // signed initiating context, never a reconstructed deployment URL.
    process.env.APP_URL = 'https://internal-new-deployment.vercel.app';
    const ctx = context({ redirectUri: `${publicOrigin}/api/auth/google/callback`, nonce: 'nonce' });
    global.fetch = async (_url, options) => {
      assert.equal(options.body.get('redirect_uri'), ctx.redirectUri);
      return Response.json({ error: 'invalid_grant', error_description: 'AUTH_CODE_SECRET CLIENT_SECRET_MUST_NOT_APPEAR', access_token: 'ACCESS_TOKEN_SECRET' }, { status: 400 });
    };
    let rejection;
    try { await api.exchangeGoogleCode('AUTH_CODE_SECRET', ctx); } catch (error) { rejection = error; }
    assert(rejection); diagnostics.logGoogleOAuthFailure(rejection, { route: 'callback', stage: 'exchange_code', requestUrl: 'https://internal.vercel.app/api/auth/google/callback?code=AUTH_CODE_SECRET&state=STATE_SECRET', canonicalOrigin: publicOrigin });
    assert.equal(logs[0][0], '[google-oauth]'); assert.equal(logs[0][1], 'failed');
    assert.equal(logs[0][2].stage, 'token_exchange'); assert.equal(logs[0][2].httpStatus, 400); assert.equal(logs[0][2].providerError, 'invalid_grant');
    for (const secret of ['AUTH_CODE_SECRET', 'CLIENT_SECRET_MUST_NOT_APPEAR', 'ACCESS_TOKEN_SECRET', 'STATE_SECRET']) assert(!JSON.stringify(logs).includes(secret));
    assert.equal(diagnostics.safeGoogleProviderError('RAW_PROVIDER_SECRET'), 'unrecognized_provider_error');
    global.fetch = async () => Response.json({ id_token: 'ID_TOKEN_SECRET' });
    assert.equal((await api.exchangeGoogleCode('AUTH_CODE_SECRET', ctx)).googleId, profile.googleId);
  } finally { global.fetch = originalFetch; console.error = originalError; }
}));

test('all route failure paths log the failing stage without exposing cookies, codes, credentials or database messages', async () => withOAuthEnvironment(async () => {
  const diagnostics = loader()('src/lib/google-oauth-diagnostics.ts');
  const { GoogleOAuthError } = diagnostics;
  const originalError = console.error, logs = [];
  console.error = (...args) => logs.push(args);
  const secret = 'DATABASE_PASSWORD_AND_QUERY_SECRET';
  try {
    for (const entry of [
      { route: 'authorize', fail: 'begin', error: new GoogleOAuthError('unavailable', 'missing_google_client_secret', { stage: 'configuration' }), stage: 'configuration', reason: 'unavailable' },
      { route: 'authorize', fail: 'begin', error: new GoogleOAuthError('failed', 'operation_failed', { stage: 'state_persistence' }, { cause: Object.assign(new Error(secret), { code: 'P2021', meta: { modelName: 'GoogleOAuthAttempt', query: secret } }) }), stage: 'state_persistence' },
      { route: 'callback', fail: 'state', error: new GoogleOAuthError('state', 'missing_state_cookie'), stage: 'consume_state', reason: 'state' },
      { route: 'callback', query: '&error=access_denied&error_description=TOKEN_SECRET', stage: 'provider_callback', reason: 'cancelled' },
      { route: 'callback', noCode: true, stage: 'provider_callback' },
      { route: 'callback', fail: 'exchange', error: new GoogleOAuthError('failed', 'operation_failed', { stage: 'id_token_verification' }, { cause: Object.assign(new Error('ID_TOKEN_SECRET'), { code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'aud' }) }), stage: 'id_token_verification' },
      { route: 'callback', fail: 'account', error: Object.assign(new Error(secret), { code: 'P2022', meta: { modelName: 'Player', column: secret } }), stage: 'account_resolution' },
      { route: 'callback', fail: 'session', error: Object.assign(new Error(secret), { code: 'P2021', meta: { modelName: 'PlayerSession' } }), stage: 'create_session' },
      { route: 'callback', fail: 'revalidate', error: new Error(secret), stage: 'revalidate' },
      { route: 'callback', fail: 'cleanup', error: new Error(secret), stage: 'clear_cookie', success: true },
    ]) {
      const before = logs.length, errorAt = key => { if (entry.fail === key) throw entry.error; };
      const load = loader({ 'next/server': responses, 'next/cache': { revalidatePath: () => errorAt('revalidate') }, '@/lib/google-oauth-diagnostics': diagnostics,
        '@/lib/google-oauth': { GoogleOAuthError, beginGoogleOAuth: async () => { errorAt('begin'); return 'https://accounts.google.com'; },
          consumeGoogleContext: async () => { errorAt('state'); return context(); }, exchangeGoogleCode: async () => { errorAt('exchange'); return profile; },
          resolveGooglePlayer: async () => { errorAt('account'); return 'member'; }, clearGoogleContext: async () => errorAt('cleanup') },
        '@/lib/auth-session': { createPlayerSession: async resolve => { errorAt('session'); await resolve({}); } },
      });
      const relative = entry.route === 'authorize' ? 'src/app/api/auth/google/route.ts' : 'src/app/api/auth/google/callback/route.ts';
      const request = new Request(`https://internal-deployment.vercel.app/api/auth/google${entry.route === 'callback' ? '/callback' : ''}?state=STATE_SECRET${entry.noCode ? '' : '&code=AUTH_CODE_SECRET'}${entry.query || ''}`, { headers: publicHeaders() });
      const response = await load(relative).GET(request);
      assert.equal(logs.length, before + 1); assert.equal(logs[before][0], '[google-oauth]'); assert.equal(logs[before][2].stage, entry.stage);
      assert.equal(logs[before][2].canonicalOrigin, publicOrigin);
      assert.equal(response.headers.get('location'), entry.success ? `${publicOrigin}/` : `${publicOrigin}/google-auth?status=${entry.reason || 'failed'}`);
    }
    const serialized = JSON.stringify(logs);
    for (const value of [secret, 'TOKEN_SECRET', 'STATE_SECRET', 'AUTH_CODE_SECRET', 'ID_TOKEN_SECRET', 'CLIENT_SECRET_MUST_NOT_APPEAR']) assert(!serialized.includes(value));
    assert(serialized.includes('P2022')); assert(serialized.includes('GoogleOAuthAttempt')); assert(serialized.includes('ERR_JWT_CLAIM_VALIDATION_FAILED')); assert(serialized.includes('"claim":"aud"'));
  } finally { console.error = originalError; }
}));
