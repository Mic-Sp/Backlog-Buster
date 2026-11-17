/* eslint-disable @typescript-eslint/no-require-imports -- Check startup and preference semantics without browser or database access. */
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { loader } = require('./helpers/social-fixture.cjs');
const { normalizeColorMode, applyColorMode, persistColorMode, colorModeStorageKey, colorModeStartupScript } = loader()('src/lib/color-mode.ts');

test('before-paint resolution agrees with runtime for both OS schemes and every preference, including invalid and blocked storage', () => {
  for (const dark of [false, true]) for (const saved of [null, 'system', 'light', 'dark', 'invalid', 'blocked']) {
    const root = {}, runtime = {}, storage = { getItem() { if (saved === 'blocked') throw Error('blocked'); return saved; } };
    vm.runInNewContext(colorModeStartupScript, { document: { documentElement: { dataset: root } }, localStorage: storage, window: { matchMedia: () => ({ matches: dark }) } });
    applyColorMode(runtime, normalizeColorMode(saved), dark);
    assert.deepEqual(root, runtime);
  }
  const root = {};
  assert.doesNotThrow(() => vm.runInNewContext(colorModeStartupScript, { document: { documentElement: { dataset: root } } }));
  assert.deepEqual(root, { colorPreference: 'system', colorMode: 'light' });
});

test('only explicit overrides are stored and choosing System clears a previous override without redundant writes', () => {
  const values = new Map(), writes = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { writes.push([key, value]); values.set(key, value); }, removeItem: key => { writes.push([key, null]); values.delete(key); } };
  persistColorMode(storage, 'system'); assert.equal(writes.length, 0);
  persistColorMode(storage, 'dark'); persistColorMode(storage, 'dark'); persistColorMode(storage, 'light'); persistColorMode(storage, 'system');
  assert.deepEqual(writes, [[colorModeStorageKey, 'dark'], [colorModeStorageKey, 'light'], [colorModeStorageKey, null]]);
  assert.equal(values.size, 0);
});

test('account color writes accept only the three known preferences and target the authenticated player', async () => {
  const writes = []; let signedIn = true;
  const load = loader({ 'next/cache': {}, '@/lib/player': { getAuthenticatedPlayerId: async () => { if (!signedIn) throw Error('Sign in'); return 'viewer'; } },
    '@/lib/prisma': { prisma: { player: { update: async args => { writes.push(args); return { id: 'viewer' }; } } } } });
  const { savePreferredColorMode } = load('src/app/profile-actions.ts');
  for (const mode of ['system', 'light', 'dark']) {
    assert.deepEqual(await savePreferredColorMode(mode), { preferredColorMode: mode });
    assert.deepEqual(writes.at(-1), { where: { id: 'viewer' }, data: { preferredColorMode: mode }, select: { id: true } });
  }
  for (const invalid of [null, 'LIGHT', 'cyberpunk', { id: 'another-player', preferredColorMode: 'dark' }]) assert.match((await savePreferredColorMode(invalid)).error, /Choose System/);
  assert.equal(writes.length, 3); signedIn = false; assert((await savePreferredColorMode('dark')).error); assert.equal(writes.length, 3);
});
