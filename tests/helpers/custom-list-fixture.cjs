/* eslint-disable @typescript-eslint/no-require-imports -- Transactional fixture for actual list services. */
const assert = require('node:assert/strict');
const { loader } = require('./social-fixture.cjs');
function fixture() {
  let lists = [], entries = [], games = Array.from({ length: 52 }, (_, i) => ({ id: i + 1, userId: 'owner', title: `Game ${i + 1}`, platform: 'PC' }));
  games.push({ id: 100, userId: 'other', title: 'FOREIGN', platform: 'PC' });
  let sequence = Promise.resolve(), serial = 0, token = 'token', active = true, lockHook, failEntries = false;
  const locks = [], revalidations = [];
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => row[key] === value);
  const project = row => !row ? null : { ...structuredClone(row), entries: entries.filter(entry => entry.listId === row.id).sort((a,b) => a.position-b.position || a.gameId-b.gameId).map(({gameId})=>({gameId})) };
  const tx = {
    $executeRaw: async (_parts, key) => { assert.equal(key, 'backlogbuster-lists:owner'); locks.push(key); if (lockHook) lockHook(); },
    playerSession: { findUnique: async ({where}) => { assert.equal(where.tokenHash, 'token'); assert(where.expiresAt.gt instanceof Date); assert.deepEqual(where.player, {email:{not:null},passwordHash:{not:null}}); return active ? {userId:'owner'} : null; } },
    game: { findUnique: async ({where}) => structuredClone(games.find(game=>matches(game,where)) ?? null), findMany: async ({where})=>structuredClone(games.filter(game=>matches(game,where))) },
    customList: {
      count: async ({where})=>lists.filter(list=>matches(list,where)).length,
      findMany: async ({where})=>lists.filter(list=>matches(list,where)).map(project),
      findUnique: async ({where})=>project(lists.find(list=>matches(list,where))),
      create: async ({data})=>{ const row={revision:0, id:`list-${++serial}`, ...data}; delete row.entries; lists.push(row); if(data.entries) await tx.customListEntry.createMany({data:data.entries.create.map(entry=>({...entry,listId:row.id}))}); return project(row); },
      update: async ({where,data})=>{const row=lists.find(list=>matches(list,where)); assert(row); const {revision,...fields}=data; Object.assign(row, fields); row.revision+=revision.increment; return project(row);},
      delete: async ({where})=>{const row=lists.find(list=>matches(list,where));assert(row);lists=lists.filter(list=>list!==row);entries=entries.filter(entry=>entry.listId!==row.id);return row;},
    },
    customListEntry: {
      deleteMany: async ({where})=>{entries=entries.filter(entry=>!matches(entry,where));},
      createMany: async ({data})=>{if(failEntries)throw Error('PRIVATE_DB_ERROR');for(const entry of data){assert(games.some(game=>game.id===entry.gameId&&game.userId===entry.userId));assert(lists.some(list=>list.id===entry.listId&&list.userId===entry.userId));assert(!entries.some(item=>item.listId===entry.listId&&(item.gameId===entry.gameId||item.position===entry.position)));entries.push(structuredClone(entry));}return{count:data.length};},
    },
  };
  const prisma = {...tx, $transaction: work=>{const run=sequence.then(async()=>{const before=structuredClone({lists,entries});try{return await work(tx);}catch(error){({lists,entries}=before);throw error;}});sequence=run.catch(()=>{});return run;}};
  const load = loader({'@/lib/prisma':{prisma},'@/lib/auth-session':{readSessionHash:async()=>token},'next/cache':{revalidatePath:(...args)=>revalidations.push(args)}});
  const service = load('src/lib/custom-lists.ts'), action = load('src/app/custom-list-actions.ts').changeCustomList;
  return {load,service,action,prisma,tx,locks,revalidations,get lists(){return lists;},get entries(){return entries;},get games(){return games;},setToken:value=>{token=value;},revoke:()=>{active=false;},onLock:hook=>{lockHook=hook;},failEntries:()=>{failEntries=true;},deleteGame:id=>{games=games.filter(game=>game.id!==id);entries=entries.filter(entry=>entry.gameId!==id);}};
}
const fields = {title:'Weekend queue',description:'Short adventures',isRanked:true,isPublic:false};
module.exports = { fixture, fields };
