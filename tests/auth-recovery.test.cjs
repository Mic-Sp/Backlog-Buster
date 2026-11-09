/* eslint-disable @typescript-eslint/no-require-imports -- Isolated auth/database/HTTP boundaries; no live credentials. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.resolve(__dirname, '..', file), instance = new Module(filename, module);
    instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = name => name === 'server-only' || name.endsWith('.css') ? {} : Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : original(name);
    instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
    cache.set(file, instance.exports); return instance.exports;
  }
  return load;
}
const form = values => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };

function tokenFixture() {
  let db = { player: { id: 'member', email: 'member@example.test', passwordHash: 'old-hash', emailVerifiedAt: null },
    tokens: [], sessions: [{ userId: 'member' }, { userId: 'member' }, { userId: 'other' }] };
  let failRevocation = false, queue = Promise.resolve();
  const matches = (row, where) => Object.entries(where).every(([key, value]) =>
    key === 'OR' ? value.some(part => matches(row, part)) :
    value && typeof value === 'object' ? ('gt' in value ? row[key] > value.gt : row[key] !== value.not) : row[key] === value);
  const tx = {
    $executeRaw: async strings => assert.match(strings.join(''), /backlogbuster-account-registration/),
    player: {
      findUnique: async ({ where }) => matches(db.player, where) ? { ...db.player } : null,
      updateMany: async ({ where, data }) => { if (!matches(db.player, where)) return { count: 0 }; Object.assign(db.player, data); return { count: 1 }; },
    },
    playerAuthToken: {
      create: async ({ data }) => { assert(!db.tokens.some(row => row.userId === data.userId && row.purpose === data.purpose)); db.tokens.push(data); },
      findFirst: async ({ where }) => db.tokens.find(row => matches(row, where)) ?? null,
      deleteMany: async ({ where }) => { const count = db.tokens.length; db.tokens = db.tokens.filter(row => !matches(row, where)); return { count: count - db.tokens.length }; },
    },
    playerSession: { deleteMany: async ({ where }) => { if (failRevocation) throw Error('private database error'); db.sessions = db.sessions.filter(row => !matches(row, where)); } },
  };
  const prisma = { ...tx, $transaction: work => {
    const run = queue.then(async () => { const before = structuredClone(db); try { return await work(tx); } catch (error) { db = before; throw error; } });
    queue = run.catch(() => {}); return run;
  } };
  const load = loader({ '@/lib/prisma': { prisma } });
  return { api: load('src/lib/auth-tokens.ts'), get db() { return db; }, set failRevocation(value) { failRevocation = value; } };
}

test('tokens are random, domain-separated hashes only; purpose-bound and time-bounded', async () => {
  const f = tokenFixture(), { api } = f;
  const a = await api.issueAuthToken('member', f.db.player.email, 'verify_email');
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.match(f.db.tokens[0].tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(f.db.tokens[0].tokenHash, api.authTokenHash(a));
  assert(!JSON.stringify(f.db).includes(a));
  assert.notEqual(api.authTokenHash(a), require('node:crypto').createHash('sha256').update(a).digest('hex'));
  assert.equal(await api.isAuthLinkValid(a, 'verify_email'), true);
  assert.equal(await api.isAuthLinkValid(a, 'reset_password'), false);
  assert.equal(api.authTokenLifetime.verify_email, 86400000); assert.equal(api.authTokenLifetime.reset_password, 1800000);
  for (const token of [null, '', 'x'.repeat(42), 'x'.repeat(44), '!'.repeat(43), ['x'.repeat(43)]]) {
    assert.equal(await api.isAuthLinkValid(token, 'verify_email'), false);
    await assert.rejects(api.consumeAuthToken(token, 'verify_email'), /invalid, expired, or already used/);
  }
  await assert.rejects(api.consumeAuthToken(a, 'reset_password', 'new-hash'), /invalid/);
  f.db.tokens[0].expiresAt = new Date(Date.now() - 1);
  assert.equal(await api.isAuthLinkValid(a, 'verify_email'), false);
  await assert.rejects(api.consumeAuthToken(a, 'verify_email'), /expired/);
  assert.equal(f.db.player.emailVerifiedAt, null); assert.equal(f.db.sessions.length, 3);
});

test('verification is single-use under concurrent submissions and retains passwords and sessions', async () => {
  const f = tokenFixture(), before = structuredClone(f.db);
  const token = await f.api.issueAuthToken('member', f.db.player.email, 'verify_email');
  const outcomes = await Promise.allSettled([f.api.consumeAuthToken(token, 'verify_email'), f.api.consumeAuthToken(token, 'verify_email')]);
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
  assert(f.db.player.emailVerifiedAt instanceof Date);
  assert.equal(f.db.player.passwordHash, before.player.passwordHash); assert.deepEqual(f.db.sessions, before.sessions);
  assert.equal(f.db.tokens.length, 0);
  assert.equal(await f.api.issueAuthToken('member', f.db.player.email, 'verify_email'), null);
});

test('resends supersede old links; email binding rejects changed or reassigned addresses', async () => {
  const f = tokenFixture(), old = await f.api.issueAuthToken('member', f.db.player.email, 'verify_email');
  const fresh = await f.api.issueAuthToken('member', f.db.player.email, 'verify_email');
  assert.notEqual(old, fresh); assert.equal(f.db.tokens.length, 1);
  await assert.rejects(f.api.consumeAuthToken(old, 'verify_email'), /invalid/);
  f.db.player.email = 'changed@example.test';
  await assert.rejects(f.api.consumeAuthToken(fresh, 'verify_email'), /invalid/);
  assert.equal(f.db.player.emailVerifiedAt, null); assert.equal(f.db.tokens.length, 1, 'failed consumption rolls back');
  assert.equal(await f.api.issueAuthToken('member', 'member@example.test', 'verify_email'), null);
});

test('password reset atomically consumes all links and target sessions, rolls back on failure', async () => {
  const f = tokenFixture();
  await f.api.issueAuthToken('member', f.db.player.email, 'verify_email');
  const token = await f.api.issueAuthToken('member', f.db.player.email, 'reset_password');
  const before = structuredClone(f.db); f.failRevocation = true;
  await assert.rejects(f.api.consumeAuthToken(token, 'reset_password', 'new-hash'));
  assert.deepEqual(f.db, before); f.failRevocation = false;
  const results = await Promise.allSettled([f.api.consumeAuthToken(token, 'reset_password', 'new-hash'), f.api.consumeAuthToken(token, 'reset_password', 'racing-hash')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.db.player.passwordHash, 'new-hash'); assert.equal(f.db.player.emailVerifiedAt, null);
  assert.deepEqual(f.db.sessions, [{ userId: 'other' }]); assert.deepEqual(f.db.tokens, []);
});

test('forgot-password response is identical before any known/unknown/cooldown/provider work', async () => {
  const tasks = [], deliveries = [];
  const load = loader({ 'next/server': { after: task => tasks.push(task) }, 'next/cache': {},
    '@/lib/auth-tokens': {}, '@/lib/auth-crypto': {}, '@/lib/account-security': {},
    '@/lib/auth-email': { deliverAuthEmail: async (...args) => deliveries.push(args) } });
  const action = load('src/app/recovery-actions.ts').requestPasswordReset;
  const known = await action(form({ email: ' MEMBER@Example.test ' }));
  const missing = await action(form({ email: 'missing@example.test' }));
  const repeated = await action(form({ email: 'member@example.test' }));
  assert.deepEqual(known, missing); assert.deepEqual(known, repeated); assert.equal(known.retryAfterSeconds, 60);
  assert.equal(tasks.length, 3); assert.deepEqual(deliveries, [], 'no account-dependent work runs on the response path');
  for (const task of tasks) await task();
  assert.deepEqual(deliveries[0], ['member@example.test', 'reset_password']);
  assert(!JSON.stringify(known).includes('token')); assert(!JSON.stringify(known).includes('member'));
  assert.match((await action(form({ email: 'bad' }))).error, /valid email/); assert.equal(tasks.length, 3);
});

test('email delivery persists cooldowns for known and unknown emails without consuming login buckets', async () => {
  const counters = new Map(), sent = [], lookups = [];
  const prisma = {
    $queryRaw: async (_parts, key) => { const attempts = (counters.get(key) || 0) + 1; counters.set(key, attempts); return [{ attempts }]; },
    authRateLimit: { deleteMany: async () => {} },
    player: { findFirst: async ({ where }) => { lookups.push(where); return where.email.equals === 'known@example.test' ? { id: 'member', email: 'known@example.test', preferredLayoutMode: 'fantasy' } : null; } },
  };
  const api = loader({ '@/lib/prisma': { prisma }, '@/lib/auth-session': { getSessionSigningKey: async () => Buffer.alloc(32, 1) },
    '@/lib/auth-tokens': { issueAuthToken: async () => 'secure-token' }, '@/lib/email': { sendAuthEmail: async (...args) => sent.push(args) } })('src/lib/auth-email.ts');
  for (const email of ['known@example.test', 'missing@example.test']) for (let i = 0; i < 2; i++) await api.deliverAuthEmail(email, 'reset_password');
  assert.equal(sent.length, 1); assert.equal(lookups.length, 2); assert.deepEqual(sent[0], ['known@example.test', 'reset_password', 'secure-token', 'fantasy']);
  assert.equal(counters.get('auth-email-global:reset_password'), 2); assert(!counters.has('global'));
  for (let i = 0; i < 35; i++) await api.deliverAuthEmail(`unique-${i}@example.test`, 'reset_password');
  assert.equal(lookups.length, 30, 'global bucket caps address spraying');
  assert(![...counters.keys()].some(key => key.includes('@')), 'limiter keys do not store raw addresses');
});

test('reset action validates confirmation, hashes exact passwords, rechecks token and never auto-signs in', async () => {
  let valid = false, hashCalls = 0;
  const consumed = [], paths = [];
  const load = loader({ 'next/server': {}, 'next/cache': { revalidatePath: path => paths.push(path) },
    '@/lib/auth-email': {}, '@/lib/account-security': {},
    '@/lib/auth-tokens': { invalidLinkMessage: 'Invalid link.', isAuthLinkValid: async () => valid, consumeAuthToken: async (...args) => consumed.push(args) },
    '@/lib/auth-crypto': { hashPassword: async password => { hashCalls++; assert.equal(password, ' exact new password '); return 'new-scrypt-hash'; } },
    '@/lib/auth-session': { createPlayerSession: () => assert.fail('Reset must not auto-sign in'), clearPlayerSessionCookie: () => assert.fail('Do not clear another account cookie') } });
  const action = load('src/app/recovery-actions.ts').resetPassword;
  assert.match((await action('token', form({ password: 'short', confirmPassword: 'short' }))).error, /8–128/);
  assert.match((await action('token', form({ password: ' exact new password ', confirmPassword: 'different' }))).error, /do not match/);
  assert.equal((await action('token', form({ password: ' exact new password ', confirmPassword: ' exact new password ' }))).error, 'Invalid link.');
  assert.equal(hashCalls, 0); assert.deepEqual(consumed, []);
  valid = true;
  assert.match((await action('token', form({ password: ' exact new password ', confirmPassword: ' exact new password ' }))).message, /All devices have been signed out/);
  assert.equal(hashCalls, 1); assert.deepEqual(consumed, [['token', 'reset_password', 'new-scrypt-hash']]); assert.deepEqual(paths, ['/']);
});

test('verification resends require a session and never accept a caller-supplied address', async () => {
  let active = false; const tasks = [], sent = [];
  let load;
  load = loader({ 'next/server': { after: task => tasks.push(task) }, 'next/cache': {}, '@/lib/auth-tokens': {}, '@/lib/auth-crypto': {},
    '@/lib/account-security': { getCredentialSession: async () => { if (!active) throw new (load('src/lib/action-result.ts').InputError)('Sign in first.'); return { player: { id: 'member', email: 'current@example.test' } }; } },
    '@/lib/auth-email': { deliverAuthEmail: async (...args) => sent.push(args) } });
  const action = load('src/app/recovery-actions.ts').resendVerificationEmail;
  assert.equal((await action()).error, 'Sign in first.'); assert.equal(tasks.length, 0);
  active = true;
  assert.equal((await action('victim@example.test')).retryAfterSeconds, 60);
  assert.equal(tasks.length, 1); await tasks[0](); assert.deepEqual(sent, [['current@example.test', 'verify_email', 'member']]);
});

test('a consumed link remains a clear success when revalidation marks its token invalid', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  for (const theme of ['cyberpunk', 'fantasy']) for (const mode of ['reset', 'verify']) {
    let cursor = 0;
    const success = mode === 'reset' ? 'Password updated.' : 'Email verified.';
    const values = [false, success, '', true, false];
    const load = loader({ react: { ...React, useState: () => [values[cursor++], () => {}] },
      'next/link': { default: ({ children, href }) => React.createElement('a', { href }, children) },
      '@/components/LayoutText': { useLayoutCopy: () => (cyberpunk, fantasy) => theme === 'fantasy' ? fantasy : cyberpunk },
      '@/components/ThemeProvider': { ThemeToggle: () => null }, '@/components/FantasyAccents': { FantasyCorners: () => null },
      '@/components/useCooldown': { default: () => ({ seconds: 0 }) }, '@/app/recovery-actions': {},
    });
    const html = renderToStaticMarkup(React.createElement(load('src/components/AccountRecovery.tsx').default, { mode, valid: false }));
    assert(html.includes(success)); assert(!html.includes('invalid, expired, or already used')); assert(!html.includes('<form'));
    assert(html.includes(theme === 'fantasy' ? 'THE ROYAL SEAL' : 'ICE SECURITY GATEWAY'));
  }
});

test('both legacy verified and unverified accounts log in; no verification gate or password migration', async () => {
  for (const emailVerifiedAt of [new Date('2020-01-01'), null]) {
    let issued = 0; const tasks = [], player = { id: 'legacy', email: 'legacy@example.test', passwordHash: 'unchanged-scrypt', emailVerifiedAt };
    const load = loader({ 'next/cache': { revalidatePath() {} }, 'next/navigation': { redirect: () => { throw Error('REDIRECT_SUCCESS'); } }, 'next/server': { after: task => tasks.push(task) },
      '@/lib/prisma': { prisma: { player: { findFirst: async ({ where }) => { assert(!('emailVerifiedAt' in where)); return player; } } } },
      '@/lib/auth-accounts': { readCredentials: () => ({ email: player.email, password: 'existing password' }) }, '@/lib/auth-email': {},
      '@/lib/auth-crypto': { verifyPassword: async (password, hash) => { assert.equal(password, 'existing password'); assert.equal(hash, player.passwordHash); return true; } },
      '@/lib/auth-session': { consumeAuthAttempt: async () => true, createPlayerSession: async (id, before) => {
        assert.equal(id, player.id); await before({ $executeRaw: async () => {}, player: { findUnique: async ({ where }) => {
          assert.equal(where.passwordHash, 'unchanged-scrypt'); assert(!('emailVerifiedAt' in where)); return player;
        } } }); issued++;
      } } });
    await assert.rejects(load('src/app/auth-actions.ts').authenticate('login', {}, form({})), /REDIRECT_SUCCESS/);
    assert.equal(issued, 1); assert.equal(tasks.length, 0);
  }
});

test('email changes reset verification, invalidate old links/sessions, rotate cookie, and schedule new email', async () => {
  let player = { id: 'member', email: 'old@example.test', passwordHash: 'hash', emailVerifiedAt: new Date(), handle: null };
  let tokens = ['old-verify', 'old-reset'], sessions = ['current', 'stale'], cookieRotations = 0;
  const tasks = [], sent = [];
  const load = loader({ 'next/cache': { revalidatePath() {} }, 'next/server': { after: task => tasks.push(task) }, '@/lib/prisma': {},
    '@/lib/account-security': { getCredentialSession: async () => ({ player: { ...player }, tokenHash: 'current' }), readCredentialChanges: () => ({ currentPassword: 'old password', newEmail: 'new@example.test', newPassword: '' }), consumeCredentialAttempt: async () => 0 },
    '@/lib/auth-crypto': { verifyPassword: async () => true }, '@/lib/auth-email': { deliverAuthEmail: async (...args) => sent.push(args) },
    '@/lib/auth-session': { createPlayerSession: async (id, work) => {
      await work({ $executeRaw: async () => {}, player: { findFirst: async () => null, update: async ({ data }) => { Object.assign(player, data); } },
        playerAuthToken: { deleteMany: async ({ where }) => { assert.equal(where.userId, id); tokens = []; } },
        playerSession: { findUnique: async () => ({ tokenHash: 'current' }), deleteMany: async ({ where }) => { assert.equal(where.userId, id); sessions = []; } } });
      sessions.push('rotated'); cookieRotations++; return { expiresAt: new Date() };
    } } });
  const result = await load('src/app/security-actions.ts').updateAccountCredentials(form({}));
  assert.equal(result.email, 'new@example.test'); assert.equal(result.emailVerifiedAt, null); assert.equal(player.emailVerifiedAt, null);
  assert.equal(player.passwordHash, 'hash'); assert.deepEqual(tokens, []); assert.deepEqual(sessions, ['rotated']); assert.equal(cookieRotations, 1);
  assert.equal(tasks.length, 1); await tasks[0](); assert.deepEqual(sent, [['new@example.test', 'verify_email', 'member']]);
});

test('backfill marks legacy emails once and never verifies future signups on rerun', async () => {
  const { backfillEmailVerification } = require('../scripts/backfill-email-verification.cjs');
  const players = [{ email: 'old@example.test', createdAt: new Date('2020-01-01'), emailVerifiedAt: null, passwordHash: 'legacy' }, { email: null, emailVerifiedAt: null }];
  let completed = false;
  const tx = { $executeRaw: async parts => {
    if (!parts.join('').includes('UPDATE')) return 0;
    assert.match(parts.join(''), /COALESCE\("createdAt", NOW\(\)\)/);
    let count = 0; for (const player of players) if (player.email && !player.emailVerifiedAt) { player.emailVerifiedAt = player.createdAt; count++; } return count;
  }, authRollout: { findUnique: async () => completed ? {} : null, create: async () => { completed = true; } } };
  const prisma = { $transaction: work => work(tx) };
  assert.deepEqual(await backfillEmailVerification(prisma), { status: 'completed', backfilled: 1 });
  assert.equal(players[0].emailVerifiedAt, players[0].createdAt); assert.equal(players[0].passwordHash, 'legacy'); assert.equal(players[1].emailVerifiedAt, null);
  players.push({ email: 'new@example.test', emailVerifiedAt: null });
  assert.deepEqual(await backfillEmailVerification(prisma), { status: 'already-completed', backfilled: 0 }); assert.equal(players[2].emailVerifiedAt, null);
});

test('Resend dispatch, themed templates, trusted URLs and development/production fallback boundaries', async () => {
  const keys = ['APP_URL', 'NODE_ENV', 'RESEND_API_KEY', 'EMAIL_FROM'], before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = global.fetch, originalInfo = console.info;
  const logs = [], requests = [];
  try {
    process.env.NODE_ENV = 'development'; process.env.APP_URL = 'http://localhost:3011'; delete process.env.RESEND_API_KEY;
    console.info = line => logs.push(line);
    global.fetch = async (url, options) => { requests.push({ url, options }); return new Response(null, { status: 200 }); };
    const api = loader()('src/lib/email.ts');
    await api.sendAuthEmail('local@example.test', 'verify_email', 'private-token');
    assert.equal(logs.length, 1); assert(logs[0].includes('http://localhost:3011/verify-email?token=private-token')); assert.equal(requests.length, 0);
    for (const mode of ['cyberpunk', 'fantasy']) {
      const template = api.authEmailTemplate('reset_password', 'https://trusted.test/reset-password?token=abc&other="<bad>', mode);
      assert(template.text.includes('30 minutes')); assert(template.html.includes('&amp;other=&quot;&lt;bad&gt;'));
      assert(template.text.includes(mode === 'fantasy' ? 'THE ROYAL SEAL' : 'ICE SECURITY'));
    }
    process.env.NODE_ENV = 'production'; process.env.APP_URL = 'https://trusted.test/path';
    await assert.rejects(api.sendAuthEmail('local@example.test', 'reset_password', 'secret')); assert.equal(logs.length, 1);
    process.env.RESEND_API_KEY = 'fake-test-key'; process.env.EMAIL_FROM = 'Security <security@trusted.test>';
    await api.sendAuthEmail('member@example.test', 'reset_password', 'secret', 'fantasy');
    assert.equal(requests[0].url, 'https://api.resend.com/emails'); assert.equal(requests[0].options.headers.Authorization, 'Bearer fake-test-key');
    assert.deepEqual(JSON.parse(requests[0].options.body).to, ['member@example.test']);
    assert.equal(api.authLinkUrl('verify_email', 'abc'), 'https://trusted.test/verify-email?token=abc');
    global.fetch = async () => new Response('PRIVATE provider details', { status: 500 });
    await assert.rejects(api.sendAuthEmail('member@example.test', 'reset_password', 'secret'), error => !error.message.includes('PRIVATE'));
    for (const origin of ['', 'http://insecure.test', 'https://user:password@trusted.test', 'javascript:alert(1)']) { process.env.APP_URL = origin; assert.throws(() => api.authLinkUrl('reset_password', 'token')); }
  } finally {
    global.fetch = originalFetch; console.info = originalInfo;
    for (const key of keys) if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
  }
});
