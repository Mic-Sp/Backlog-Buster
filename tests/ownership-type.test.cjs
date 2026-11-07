/* eslint-disable @typescript-eslint/no-require-imports -- Test shared validation, real server actions and backup paths offline. */
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, form, game } = require('./helpers/activity-fixture.cjs');
const { loadCatalogModule } = require('../scripts/catalog-seed.cjs');
const ownership = loadCatalogModule('src/lib/ownership-type.ts');
const edit = extra => form({ id: 1, status: 'Playing', lengthHours: 10, difficulty: 1, ...extra });

test('ownership validation canonicalizes four categories, allows unspecified, and rejects malformed values', () => {
  for (const value of ownership.OWNERSHIP_TYPES) assert.equal(ownership.parseOwnershipType(` ${value.toLowerCase()} `), value);
  for (const value of [null, undefined, '', ' ']) assert.equal(ownership.parseOwnershipType(value), null);
  for (const value of ['rented', 'all', 123, false, {}, ['Digital'], new Blob(['Digital'])]) assert.throws(() => ownership.parseOwnershipType(value));
  assert.deepEqual(ownership.readOwnershipField(form({})), {});
  assert.deepEqual(ownership.readOwnershipField(form({ ownershipType: '' })), { ownershipType: null });
  assert.equal(ownership.defaultOwnershipType(null, '730'), 'Digital');
  assert.equal(ownership.defaultOwnershipType('Physical', '730'), 'Physical');
  assert.equal(ownership.defaultOwnershipType(null, 'malformed'), null);
});

test('creation and edit actions persist ownership for the authenticated player and metadata edits stay quiet', async () => {
  for (const ownershipType of ownership.OWNERSHIP_TYPES) {
    const f = fixture({ games: [] });
    const result = await f.actions.createGame(form({ title: 'Access Game', platform: 'PC', lengthHours: 10, difficulty: 1, ownershipType, userId: 'victim' }));
    assert(!result.error, result.error); assert.equal(f.games[0].userId, 'owner'); assert.equal(f.games[0].ownershipType, ownershipType);
  }
  const f = fixture({ games: [game(1, { status: 'Playing', ownershipType: 'Digital' })] });
  assert.deepEqual(await f.actions.updateGame(edit({ ownershipType: 'Borrowed' })), { success: true });
  assert.equal(f.games[0].ownershipType, 'Borrowed'); assert.equal(f.events.length, 0);
  await f.actions.updateGame(edit({ notes: 'Unrelated edit' })); assert.equal(f.games[0].ownershipType, 'Borrowed');
  await f.actions.completeGame(edit({ ownershipType: 'Subscription' })); assert.equal(f.games[0].ownershipType, 'Subscription');
  await f.actions.updateGame(edit({ status: 'Completed', ownershipType: '' })); assert.equal(f.games[0].ownershipType, null);
});

test('invalid choices and foreign/revoked mutations cannot persist ownership', async () => {
  const f = fixture();
  assert((await f.actions.updateGame(edit({ ownershipType: 'forged' }))).error); assert.equal(f.games[0].ownershipType, null);
  assert((await f.actions.createGame(form({ title: 'Bad', ownershipType: 'forged' }))).error); assert.equal(f.games.length, 1);
  const foreign = fixture({ games: [game(1, { userId: 'other', ownershipType: 'Physical' })] });
  assert((await foreign.actions.updateGame(edit({ ownershipType: 'Digital' }))).error); assert.equal(foreign.games[0].ownershipType, 'Physical');
  f.revoke(); assert((await f.actions.updateGame(edit({ ownershipType: 'Digital' }))).error); assert.equal(f.games[0].ownershipType, null);
});

test('ownership filtering selects exact media, includes unspecified legacy rows, and composes with other filters', () => {
  const games = [...ownership.OWNERSHIP_TYPES.map((ownershipType, id) => ({ id, ownershipType, platform: 'PC', genre: id === 2 ? 'RPG' : 'Action' })), { id: 4, ownershipType: null, platform: 'PC' }, { id: 5, platform: 'Switch' }];
  assert.equal(games.filter(game => ownership.matchesOwnership(game, '')).length, 6);
  for (const type of ownership.OWNERSHIP_TYPES) assert.equal(games.filter(game => ownership.matchesOwnership(game, type)).length, 1);
  assert.deepEqual(games.filter(game => ownership.matchesOwnership(game, 'Unspecified')).map(game => game.id), [4, 5]);
  assert.deepEqual(games.filter(game => ownership.matchesOwnership(game, 'Subscription') && game.platform === 'PC' && game.genre === 'RPG').map(game => game.id), [2]);
});

test('JSON and CSV vault exports/imports preserve every category and unspecified records', async () => {
  const types = [...ownership.OWNERSHIP_TYPES, null];
  const source = fixture({ games: types.map((ownershipType, id) => game(id + 1, { title: `Game ${id}`, ownershipType })) });
  for (const format of ['json', 'csv']) {
    const exported = await source.load('src/lib/library-vault.ts').getLibraryExport(format);
    const restored = fixture({ games: [] });
    const result = await restored.actions.bulkImportGames({ mode: format, content: exported.content });
    assert(!result.error, result.error); assert.equal(result.importedCount, 5);
    assert.deepEqual(restored.games.map(game => game.ownershipType), types);
  }
  const { sanitizeImportedGame } = loadCatalogModule('src/lib/library-import.ts');
  assert.equal(sanitizeImportedGame({ title: 'Legacy' }).ownershipType, null);
  assert.equal(sanitizeImportedGame({ title: 'Steam', steamAppId: '730' }).ownershipType, 'Digital');
  assert.equal(sanitizeImportedGame({ title: 'Edited', steamAppId: '730', ownershipType: 'borrowed' }).ownershipType, 'Borrowed');
  assert.throws(() => sanitizeImportedGame({ title: 'Invalid', ownershipType: 'forged' }));
});
