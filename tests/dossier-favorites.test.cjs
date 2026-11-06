/* eslint-disable @typescript-eslint/no-require-imports -- Exercise shared selection logic without database or browser services. */
const test = require('node:test'), assert = require('node:assert/strict');
const { loadCatalogModule } = require('../scripts/catalog-seed.cjs');
const { resolveDossierShowcase, dossierIdentityFromProfile } = loadCatalogModule('src/lib/dossier.ts');
const games = Array.from({ length: 6 }, (_, index) => ({ id: index + 1, title: `Game ${index + 1}`, platform: 'PC', coverUrl: null, earnedXp: 100 - index }));
const trophies = games.slice(0, 3);
const ids = slots => slots.map(slot => slot?.game.id ?? null);

test('three declared favorites keep exact slot order independently of library order and automatic ranking', () => {
  const selected = [6, 4, 5];
  const slots = resolveDossierShowcase(selected, [...games].reverse(), trophies);
  assert.deepEqual(ids(slots), selected);
  assert(slots.every(slot => slot.pinned));
  assert.deepEqual(selected, [6, 4, 5]);
});

test('empty and partially pinned slots fill with ranked trophies, reserving every explicit selection first', () => {
  for (const selections of [[], [null, null, null]]) {
    const slots = resolveDossierShowcase(selections, games, trophies);
    assert.deepEqual(ids(slots), [1, 2, 3]); assert(slots.every(slot => !slot.pinned));
  }
  const slots = resolveDossierShowcase([null, 1, null], games, trophies);
  assert.deepEqual(ids(slots), [2, 1, 3]);
  assert.deepEqual(slots.map(slot => slot.pinned), [false, true, false]);
  assert.deepEqual(ids(resolveDossierShowcase([6, null, 5], games, trophies)), [6, 1, 5]);
});

test('deleted, foreign, malformed and duplicate IDs fall back without duplicate games or excess slots', () => {
  for (const selections of [[999, '1', -2], [null], [NaN, {}, Infinity]]) {
    assert.deepEqual(ids(resolveDossierShowcase(selections, games, trophies)), [1, 2, 3]);
  }
  assert.deepEqual(ids(resolveDossierShowcase([2, 2, 2, 4], games, trophies)), [2, 1, 3]);
  assert.deepEqual(ids(resolveDossierShowcase([6], games.slice(0, 3), trophies)), [1, 2, 3]);
});

test('insufficient history leaves honest empty slots; any owned game remains eligible without trophies', () => {
  assert.deepEqual(ids(resolveDossierShowcase([6], games, [])), [6, null, null]);
  assert.deepEqual(ids(resolveDossierShowcase([], [], [])), [null, null, null]);
  assert.deepEqual(ids(resolveDossierShowcase([], games, [games[0]])), [1, null, null]);
});

test('profile identity preserves legacy ordered selections and never saves automatic fallback as explicit intent', () => {
  const profile = { operatorName: 'Ghost', handle: 'ghost', tagline: 'Hello', neonAccent: 'CYAN', avatarUrl: null, featuredTrophyIds: [] };
  const auto = dossierIdentityFromProfile(profile, games);
  assert.deepEqual(auto.showcase, [null, null, null]);
  assert.deepEqual(ids(resolveDossierShowcase(auto.showcase, games, trophies)), [1, 2, 3]);
  const curated = dossierIdentityFromProfile({ ...profile, featuredTrophyIds: [6, null, 4] }, games);
  assert.deepEqual(curated.showcase, [6, null, 4]);
  const stale = dossierIdentityFromProfile({ ...profile, featuredTrophyIds: [999, 1, 1] }, games);
  assert.deepEqual(stale.showcase, [null, 1, null]);
});
