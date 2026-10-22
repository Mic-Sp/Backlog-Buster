/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node tests load TypeScript with mocked server boundaries. */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
function loader(mocks = {}) {
  mocks = { '@/lib/admin': {
    AdminRequiredError: class extends Error {},
    requireAdmin: async () => ({ id: await mocks['@/lib/player'].getAuthenticatedPlayerId(), isAdmin: true }),
  }, ...mocks };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.resolve(__dirname, "..", file), instance = new Module(filename, module);
    instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = (name) => name === "server-only" ? {} : Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`) : original(name);
    instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
    cache.set(file, instance.exports); return instance.exports;
  }
  return load;
}
const currentYear=new Date().getFullYear();
const canon=[{title:'Undated',releaseYear:null,chronologicalRank:2},{title:'Future',releaseYear:currentYear+1,chronologicalRank:4},{title:'Other Canon Game',releaseYear:1990,chronologicalRank:15},{title:'Alpha',releaseYear:1998,chronologicalRank:22},{title:'Beta',releaseYear:2004,chronologicalRank:37},{title:'Gamma',releaseYear:2010,chronologicalRank:43}];
const owned=[{id:11,title:'Alpha',releaseYear:1998,chronologicalOrder:22},{id:12,title:'Gamma',releaseYear:2010,chronologicalOrder:43},{id:13,title:'Unknown',releaseYear:2001,chronologicalOrder:1},{id:14,title:'Alpha Remake',releaseYear:2019,chronologicalOrder:2},{id:15,title:'Beta',releaseYear:2004,chronologicalOrder:37},{id:16,title:'Future',releaseYear:currentYear+1,chronologicalOrder:1},{id:17,title:'Undated',releaseYear:null,chronologicalOrder:2}].map(game=>({...game,status:'Backlog',franchise:'Test Saga'}));

test('global ranks sort the library into unique sequential ranks, with a cleared unmatched/unreleased tail',()=>{
 const load=loader(),{buildAssignedSagaOrder}=load('src/lib/saga-chronology.ts');
 const before=structuredClone(canon),assigned=buildAssignedSagaOrder(owned,canon);
 assert.deepEqual(Object.fromEntries(assigned),{11:1,12:4,13:null,14:2,15:3,16:null,17:null});
 assert.deepEqual(assigned,buildAssignedSagaOrder([...owned].reverse(),[...canon].reverse()));assert.deepEqual(canon,before);
 const sameYear=[{id:5,title:'Alpha',releaseYear:1998},{id:3,title:'Alpha',releaseYear:1998},{id:9,title:'Alpha Remake',releaseYear:1998}];
 const ranks=buildAssignedSagaOrder(sameYear,canon);assert.deepEqual([...ranks.values()].sort(),[1,2,3]);assert.equal(ranks.get(3),1);assert.equal(ranks.get(5),2);assert.equal(ranks.get(9),3);
 const {compareSagaGames}=load('src/lib/sagas.ts');
 assert.deepEqual(owned.map(game=>({...game,chronologicalOrder:assigned.get(game.id)})).sort((a,b)=>compareSagaGames(a,b,'timeline')).map(game=>game.id),[11,14,15,12,13,16,17]);
 assert.deepEqual(Object.fromEntries(buildAssignedSagaOrder(owned,[],true)),{11:1,12:4,13:2,14:5,15:3,16:null,17:null},'Local release-order fallback is also compact and clears unreleased stale ranks');
});

function fixture({games=owned,cachedGames=canon}={}){
 let active=true,stale=false,providerCalls=0,cacheWrites=0;
 const members=structuredClone(games),initial=structuredClone(members),writes=[];
 let row={source:'igdb+gemini',games:structuredClone(cachedGames),updatedAt:new Date()};
 const initialCache=structuredClone(row);
 const table={findUnique:async()=>row,update:async({data})=>{row={...row,...data};return{slug:'test-saga'};},upsert:async({create})=>{cacheWrites++;row={...create,updatedAt:new Date()};return{updatedAt:row.updatedAt};}};
 const prisma={franchiseChronology:table,game:{findMany:async({where})=>{assert.deepEqual(where,{userId:'owner'});return members;},update:args=>({args})},$transaction:async jobs=>{
  if(typeof jobs==='function')return jobs({franchiseChronology:table,$executeRaw:async()=>{}});
  if(stale)throw Error('Concurrent metadata change');
  for(const{args}of jobs){const old=members.find(game=>game.id===args.where.id);assert.equal(args.where.userId,'owner');assert.equal(args.where.chronologicalOrder,old.chronologicalOrder);assert.equal(args.where.title,old.title);assert.equal(args.where.releaseYear,old.releaseYear);}
  for(const{args}of jobs){members.find(game=>game.id===args.where.id).chronologicalOrder=args.data.chronologicalOrder;writes.push(args);}
  return[];
 }};
 const load=loader({'next/cache':{revalidatePath(){}},'@/lib/prisma':{prisma},'@/lib/player':{getAuthenticatedPlayerId:async()=>{if(!active)throw new(load('src/lib/action-result.ts').InputError)('Sign in');return'owner';}},'@/lib/saga-lore':{getHybridSagaChronology:async()=>{providerCalls++;return{source:'igdb+gemini',games:Array.from({length:43},(_,index)=>{const known=canon.find(game=>game.chronologicalRank===index+1);return known??{title:`Other ${index+1}`,releaseYear:1990,chronologicalRank:index+1};})};}},'@/lib/achievements':{},'@/lib/recommendations':{},'@/lib/rawg':{}});
 const actions=load('src/app/actions.ts'),key=load('src/lib/sagas.ts').buildSagaChains(members).chains[0].key;
 return{run:force=>actions.autoDetectSagaOrder(key,force),inspect:()=>actions.getSagaChronologyDebug(key),members,initial,writes,initialCache,get row(){return row;},get providerCalls(){return providerCalls;},get cacheWrites(){return cacheWrites;},setActive:value=>active=value,setStale:value=>stale=value};
}

test('a partial hit compacts all owned matches and atomically clears stale unmatched ranks without changing global canon',async()=>{
 const f=fixture(),result=await f.run();assert.equal(result.updatedCount,7);assert.equal(f.writes.length,7);assert.equal(f.providerCalls,0);assert.equal(f.cacheWrites,0);assert.deepEqual(f.row,f.initialCache);
 assert.deepEqual(Object.fromEntries(f.members.map(game=>[game.id,game.chronologicalOrder])),{11:1,12:4,13:null,14:2,15:3,16:null,17:null});
 const byId=new Map(result.debug.mappings.map(game=>[game.id,game]));assert.equal(byId.get(11).canonicalRank,22);assert.equal(byId.get(11).assignedRank,1);assert.equal(byId.get(14).canonicalRank,22);assert.equal(byId.get(14).assignedRank,2);assert.equal(byId.get(15).canonicalRank,37);assert.equal(byId.get(15).assignedRank,3);assert.equal(byId.get(12).canonicalRank,43);assert.equal(byId.get(12).assignedRank,4);
 assert.equal(byId.get(13).assignedRank,null);assert.match(byId.get(13).reason,/Release order tail/);assert.equal(byId.get(16).canonicalRank,4);assert.equal(byId.get(16).assignedRank,null);assert.match(result.message,/3 unmatched or unreleased.*stale ranks cleared/);
 const inspected=await f.inspect();assert.equal(inspected.debug.mappings.find(game=>game.id===12).assignedRank,4);assert.equal(inspected.debug.mappings.find(game=>game.id===12).canonicalRank,43);
});

test('full cache hits and fresh provider scans both apply compact library ranks while leaving global positions intact',async()=>{
 const subset=owned.filter(game=>[11,12,14,15].includes(game.id));const hit=fixture({games:subset});
 const first=await hit.run();assert.equal(first.updatedCount,4);assert.equal(hit.providerCalls,0);assert.equal(first.debug.mappings.find(game=>game.id===12).canonicalRank,43);
 const refreshed=fixture({games:subset});const second=await refreshed.run(true);assert.equal(second.updatedCount,4);assert.equal(refreshed.providerCalls,1);assert.equal(refreshed.row.games.length,43);assert.equal(refreshed.row.games.find(game=>game.title==='Gamma').chronologicalRank,43);assert.equal(second.debug.mappings.find(game=>game.id===12).assignedRank,4);
});

test('all-unmatched sagas clear every stale rank instead of treating the empty match map as a release-order fallback',async()=>{
 const games=owned.filter(game=>[13,16,17].includes(game.id));const f=fixture({games,cachedGames:canon.filter(game=>!['Future','Undated'].includes(game.title))});
 const result=await f.run();assert.equal(result.updatedCount,3);assert(f.members.every(game=>game.chronologicalOrder===null));assert.equal(f.providerCalls,0);assert.equal(result.debug.source,'igdb+gemini');assert.match(result.message,/0 sequential ranks/);
});

test('compacting and clearing ranks remain authenticated, operator-scoped and protected from stale snapshots',async()=>{
 const f=fixture();f.setActive(false);assert.match((await f.run()).error,/Sign in/);assert.equal(f.writes.length,0);
 f.setActive(true);f.setStale(true);assert.match((await f.run()).error,/saga changed/);assert.equal(f.writes.length,0);assert.deepEqual(f.members,f.initial);assert.deepEqual(f.row,f.initialCache);
});
