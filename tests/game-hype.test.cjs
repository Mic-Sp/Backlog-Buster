/* eslint-disable @typescript-eslint/no-require-imports -- Exercise real schemas, actions and route with isolated persistence. */
const test = require('node:test'), assert = require('node:assert/strict');
const { loader } = require('./helpers/social-fixture.cjs');
const { fixture, form, game } = require('./helpers/activity-fixture.cjs');
const { gameHypeSchema, gameHypePatchSchema, readHypeField } = loader()('src/lib/game-mutation-schema.ts');

test('hype creation defaults to Interested and validation accepts only integers 1–3', () => {
  assert.deepEqual(gameHypeSchema.parse({}), { hypeLevel: 2 });
  for (const hypeLevel of [1, 2, 3]) {
    assert.deepEqual(gameHypeSchema.parse({ hypeLevel }), { hypeLevel });
    assert.deepEqual(readHypeField(form({ hypeLevel })), { hypeLevel });
  }
  for (const hypeLevel of [0, 4, 1.5, '3', null, false, [], {}]) {
    assert.equal(gameHypeSchema.safeParse({ hypeLevel }).success, false);
    assert.equal(gameHypePatchSchema.safeParse({ hypeLevel }).success, false);
  }
  assert.equal(gameHypePatchSchema.safeParse({}).success, false);
  assert.deepEqual(readHypeField(form({})), {});
  for (const hypeLevel of ['', ' ', 'oops', '0', '4', '1.5']) assert.throws(() => readHypeField(form({ hypeLevel })));
  const blob = new FormData(); blob.set('hypeLevel', new Blob(['3']));
  assert.throws(() => readHypeField(blob));
});

test('actions persist hype, default new games and preserve choices on unrelated edits', async () => {
  for (const fields of [{}, { hypeLevel: 1 }, { hypeLevel: 3 }]) {
    const f = fixture({ games: [] });
    const result = await f.actions.createGame(form({ title: 'Hype test', platform: 'PC', lengthHours: 10, difficulty: 1, ...fields }));
    assert(!result.error, result.error);
    assert.equal(f.games[0].hypeLevel, fields.hypeLevel ?? 2);
  }
  const f = fixture({ games: [game(1, { status: 'Playing', hypeLevel: 1 })] });
  const edit = fields => form({ id: 1, status: 'Playing', lengthHours: 10, difficulty: 1, ...fields });
  assert.deepEqual(await f.actions.updateGame(edit({ hypeLevel: 3 })), { success: true });
  assert.equal(f.games[0].hypeLevel, 3);
  assert.deepEqual(await f.actions.updateGame(edit({ notes: 'Other edit' })), { success: true });
  assert.equal(f.games[0].hypeLevel, 3);
  assert.equal(f.events.length, 0);
  for (const hypeLevel of [0, 4, 1.5, '']) {
    assert((await f.actions.updateGame(edit({ hypeLevel }))).error);
    assert((await f.actions.createGame(form({ title: 'Invalid', hypeLevel }))).error);
  }
  assert.equal(f.games[0].hypeLevel, 3); assert.equal(f.games.length, 1);
});

function routeFixture() {
  let authenticated = true, failure = null;
  const games = [game(1, { hypeLevel: 1 }), game(2, { userId: 'other', hypeLevel: 3 })];
  const writes = [], refreshed = [];
  class AuthenticationRequiredError extends Error {}
  const PATCH = loader({
    'next/cache': { revalidatePath: path => refreshed.push(path) },
    '@/lib/player': { AuthenticationRequiredError, getAuthenticatedPlayerId: async () => {
      if (!authenticated) throw new AuthenticationRequiredError(); return 'owner';
    } },
    '@/lib/google-oauth-origin': { googleOAuthOrigin: () => 'https://backlog.test' },
    '@/lib/prisma': { prisma: { game: { update: async ({ where, data, select }) => {
      if (failure) throw failure;
      assert.equal(where.userId, 'owner');
      const row = games.find(game => game.id === where.id && game.userId === where.userId);
      if (!row) throw Object.assign(new Error('Private DB details'), { code: 'P2025' });
      writes.push({ where, data }); Object.assign(row, data);
      return Object.fromEntries(Object.keys(select).map(key => [key, row[key]]));
    } } } },
  })('src/app/api/games/[id]/route.ts').PATCH;
  const patch = (body, id = '1', headers = {}) => PATCH(new Request(`https://backlog.test/api/games/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://backlog.test', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
  return { games, writes, refreshed, patch, signOut: () => { authenticated = false; }, fail: () => { failure = Error('PRIVATE_DATABASE_ERROR'); } };
}

test('PATCH changes only the owned game hype and refreshes the library', async () => {
  const f = routeFixture();
  const response = await f.patch({ hypeLevel: 2 });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { game: { id: 1, hypeLevel: 2 } });
  assert.deepEqual(f.writes, [{ where: { id: 1, userId: 'owner' }, data: { hypeLevel: 2 } }]);
  assert.deepEqual(f.refreshed, ['/']); assert.equal(f.games[1].hypeLevel, 3);
});

test('PATCH rejects malformed input, foreign games, signed-out sessions and cross-site writes', async () => {
  const f = routeFixture();
  for (const body of [{}, { hypeLevel: 0 }, { hypeLevel: 4 }, { hypeLevel: 1.5 }, { hypeLevel: '3' },
    { hypeLevel: null }, { hypeLevel: true }, { hypeLevel: 2, userId: 'other' }, { hypeLevel: 2, earnedXp: 999 }, null, [], '{']) {
    assert.equal((await f.patch(body)).status, 400);
  }
  for (const id of ['0', '-1', '1.5', '1e0', '2147483648', 'invalid']) assert.equal((await f.patch({ hypeLevel: 3 }, id)).status, 400);
  for (const id of ['2', '999']) assert.equal((await f.patch({ hypeLevel: 1 }, id)).status, 404);
  assert.equal((await f.patch({ hypeLevel: 2 }, '1', { origin: 'https://evil.test' })).status, 403);
  assert.equal((await f.patch({ hypeLevel: 2 }, '1', { 'sec-fetch-site': 'cross-site' })).status, 403);
  f.signOut(); assert.equal((await f.patch({ hypeLevel: 2 })).status, 401);
  assert.equal(f.games[0].hypeLevel, 1); assert.equal(f.games[1].hypeLevel, 3);
  assert.equal(f.writes.length, 0); assert.equal(f.refreshed.length, 0);
  const unavailable = routeFixture(); unavailable.fail(); const response = await unavailable.patch({ hypeLevel: 3 });
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /PRIVATE_DATABASE_ERROR/);
});
