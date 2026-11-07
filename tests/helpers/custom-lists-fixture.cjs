/* eslint-disable @typescript-eslint/no-require-imports -- Transactional offline database fixture. */
const assert = require('node:assert/strict');
const { loader } = require('./social-fixture.cjs');

function fixture() {
  let lists = [], entries = [], games = [{ id: 1, userId: 'owner', title: 'Alpha', platform: 'PC' }, { id: 2, userId: 'owner', title: 'Beta', platform: 'PC' }, { id: 3, userId: 'other', title: 'Foreign', platform: 'PC' }];
  let authenticated = true, failEntries = false, sequence = Promise.resolve(), nextId = 1, onLock;
  const locks = [], refreshes = [];
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => row[key] === value);
  const project = (row, select) => row && Object.fromEntries(Object.keys(select).map(key => [key,
    key === 'entries' ? entries.filter(entry => entry.listId === row.id).sort((a, b) => a.position - b.position).map(entry => ({ gameId: entry.gameId })) : row[key]]));
  const tx = {
    $executeRaw: async (_sql, key) => { locks.push(key); if (onLock) onLock(); },
    playerSession: { findUnique: async () => authenticated ? { tokenHash: 'token' } : null },
    customList: {
      count: async ({ where }) => lists.filter(row => matches(row, where)).length,
      findUnique: async ({ where, select }) => project(lists.find(row => matches(row, where)), select) ?? null,
      findMany: async ({ where, select }) => lists.filter(row => matches(row, where)).map(row => project(row, select)),
      create: async ({ data, select }) => { const row = { id: `list-${nextId++}`, createdAt: new Date(), ...data }; lists.push(row); return select ? project(row, select) : row; },
      update: async ({ where, data }) => { const row = lists.find(row => matches(row, where)); assert(row); Object.assign(row, data); return row; },
      delete: async ({ where }) => { const row = lists.find(row => matches(row, where)); assert(row); lists = lists.filter(other => other !== row); entries = entries.filter(entry => entry.listId !== row.id); return row; },
    },
    customListEntry: {
      deleteMany: async ({ where }) => { entries = entries.filter(row => !matches(row, where)); },
      createMany: async ({ data }) => { if (failEntries) throw Error('PRIVATE_DATABASE_ERROR'); for (const row of data) {
        assert(lists.some(list => list.id === row.listId && list.userId === row.userId));
        assert(games.some(game => game.id === row.gameId && game.userId === row.userId)); entries.push({ ...row });
      } return { count: data.length }; },
    },
    game: {
      findUnique: async ({ where }) => games.find(row => matches(row, where)) ?? null,
      findMany: async ({ where }) => structuredClone(games.filter(row => matches(row, where)).sort((a,b) => a.id-b.id)),
      createMany: async ({ data }) => { for (const row of data) games.push({ ...row, id: Math.max(0,...games.map(game=>game.id)) + 1 }); return { count: data.length }; },
    },
  };
  const prisma = { ...tx, playerSession: { findUnique: async () => authenticated ? { player: { id: 'owner', handle: 'owner' } } : null },
    $transaction: work => {
      const run = sequence.then(async () => { const before = structuredClone({ lists, entries, games });
        try { return await work(tx); } catch (error) { ({ lists, entries, games } = before); throw error; } });
      sequence = run.catch(() => {}); return run;
    },
  };
  const load = loader({ '@/lib/prisma': { prisma }, '@/lib/player': { getAuthenticatedPlayerId: async () => {
    if (!authenticated) throw Object.assign(Error('Sign in'), { name: 'AuthenticationRequiredError' }); return 'owner';
  } }, '@/lib/auth-session': { readSessionHash: async () => 'token' },
  '@/lib/achievements': { syncAchievementsForPlayer: async () => {} }, '@/lib/activity-events': { appendActivityEvents: async () => {} },
  'next/cache': { revalidatePath: (...args) => refreshes.push(args) } });
  return { load, service: load('src/lib/custom-lists.ts'), actions: load('src/app/custom-list-actions.ts'), prisma,
    get lists() { return lists; }, get entries() { return entries; }, get games() { return games; },
    locks, refreshes, revoke: () => { authenticated = false; }, failEntries: () => { failEntries = true; }, onLock: hook => { onLock = hook; } };
}
module.exports = { fixture };
