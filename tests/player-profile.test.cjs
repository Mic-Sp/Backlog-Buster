/* eslint-disable @typescript-eslint/no-require-imports -- Isolated server tests use mocked authentication and transactions. */
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
const input = { operatorName: '  Ghost  ', handle: ' Night-Runner ', tagline: ' One more gig. ', neonAccent: 'GOLD', featuredTrophyIds: [7, null, null] };

test('profile handles normalize, blank identity fields default, and malformed/duplicate trophy inputs fail', () => {
  const load = loader({ '@/lib/prisma': {}, '@/lib/player': {} });
  const { validatePlayerProfile } = load('src/lib/player-profile.ts');
  const normalized = validatePlayerProfile(input);
  assert.equal(normalized.handle, 'night-runner'); assert.equal(normalized.operatorName, 'Ghost'); assert.equal(normalized.tagline, 'One more gig.');
  const blank = validatePlayerProfile({ ...input, handle: ' ', operatorName: ' ', tagline: '\u00a0' });
  assert.equal(blank.handle, null); assert.equal(blank.operatorName, 'ANONYMOUS NETRUNNER'); assert.equal(blank.tagline, 'One more gig. One more legend.');
  for (const handle of ['ab', 'a'.repeat(33), 'bad_handle', 'bad handle', 'bad/name', 123]) assert.throws(() => validatePlayerProfile({ ...input, handle }), /handle/i);
  assert.equal(validatePlayerProfile({ ...input, handle: 'a'.repeat(32) }).handle.length, 32);
  assert.throws(() => validatePlayerProfile({ ...input, featuredTrophyIds: [7, 7] }), /different trophy/);
  assert.throws(() => validatePlayerProfile({ ...input, featuredTrophyIds: [NaN] }));
  for (const avatarUrl of ['preset:bb', 'preset:kitsune', 'preset:skull', 'preset:samurai', 'preset:cortex', 'preset:terminal']) assert.equal(validatePlayerProfile({ ...input, avatarUrl }).avatarUrl, avatarUrl);
  assert.equal(validatePlayerProfile({ ...input, avatarUrl: '  https://example.com/avatar.png  ' }).avatarUrl, 'https://example.com/avatar.png');
  assert.equal(validatePlayerProfile({ ...input, avatarUrl: '  ' }).avatarUrl, null);
  for (const avatarUrl of ['preset:unknown', '/arbitrary.svg', 'javascript:alert(1)', 'data:image/png;base64,abc', 'https://user:pass@example.com/a', 'https://example.com/' + 'a'.repeat(2048)]) assert.throws(() => validatePlayerProfile({ ...input, avatarUrl }), /avatar/i);
});

test('profile saves use authenticated ownership, reject claimed handles and foreign trophies, and revalidate the HUD', async () => {
  let claimed = false, eligible = true, writes = 0, locks = 0, refreshes = 0, race = false;
  const row = { id: 'current-player', operatorName: 'Old Name', handle: 'old-handle', tagline: 'Old tagline', neonAccent: 'CYAN', avatarUrl: null, featuredTrophyIds: [], updatedAt: new Date() };
  const tx = {
    $executeRaw: async () => { locks++; },
    player: {
      findFirst: async ({ where }) => { assert.equal(where.id.not, 'current-player'); assert.deepEqual(where.handle, { equals: 'night-runner', mode: 'insensitive' }); return claimed ? { id: 'someone-else' } : null; },
      upsert: async ({ where, update, select }) => { assert.equal(where.id, 'current-player'); assert.equal(select.handle, true); assert(!select.passwordHash); if (race) throw { code: 'P2002' }; writes++; return { ...row, ...update }; },
    },
    game: { findMany: async ({ where }) => { assert.equal(where.userId, 'current-player'); assert.equal(where.status, 'Completed'); assert.equal(where.rating, 5); return eligible ? [{ id: 7 }] : []; } },
  };
  const load = loader({ 'next/cache': { revalidatePath: p => { assert.equal(p, '/'); refreshes++; } }, '@/lib/player': { getCurrentPlayerId: async () => 'current-player' }, '@/lib/prisma': { prisma: { $transaction: work => work(tx), player: { upsert: async ({where}) => { assert.equal(where.id, 'current-player'); return row; } } } } });
  const { savePlayerProfile } = load('src/app/profile-actions.ts');
  const saved = await savePlayerProfile({ ...input, id: 'victim', avatarUrl: 'preset:kitsune' });
  assert.equal(saved.avatarUrl, 'preset:kitsune'); assert.equal(saved.id, 'current-player'); assert.equal(saved.operatorName, 'Ghost'); assert.equal(saved.handle, 'night-runner'); assert.equal(saved.neonAccent, 'GOLD'); assert.equal(refreshes, 1); assert.equal(writes, 1); assert.equal(locks, 1);
  claimed = true; assert.match((await savePlayerProfile(input)).error, /already claimed/); assert.equal(writes, 1);
  claimed = false; eligible = false; assert.match((await savePlayerProfile(input)).error, /your completed, five-star/); assert.equal(writes, 1);
  eligible = true; race = true; assert.match((await savePlayerProfile(input)).error, /already claimed/); assert.equal(refreshes, 1);
  const loaded = await load('src/lib/player-profile.ts').getCurrentPlayerProfile(); assert.equal(loaded.handle, 'old-handle'); assert.equal(typeof loaded.updatedAt, 'string');
});
