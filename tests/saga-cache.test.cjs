/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node tests load TypeScript with mocked server boundaries. */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
function loader(mocks = {}) {
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
const {normalizeFranchiseKey}=loader()('src/lib/franchise-key.ts');
const canon={games:[{title:'Final Fantasy VII',releaseYear:1997,chronologicalRank:1},{title:'Final Fantasy VIII',releaseYear:1999,chronologicalRank:2}],source:'igdb'};
const titles=canon.games.map(({title,releaseYear})=>({title,releaseYear}));
function fixture(initial=null){
 let row=structuredClone(initial),latest=null;const writes=[],reads=[];let lookups=0,transactions=0;
 const table={findUnique:async({where,select})=>{assert.equal(where.slug,'final-fantasy');assert.deepEqual(select,{games:true,source:true,updatedAt:true});reads.push(where);return row;},update:async({where,data})=>{assert.equal(where.slug,'final-fantasy');assert.deepEqual(Object.keys(data),['updatedAt']);row={...row,updatedAt:data.updatedAt};return{slug:where.slug};},upsert:async({where,create,update})=>{assert.equal(where.slug,'final-fantasy');assert.deepEqual(Object.keys(create).sort(),['slug','displayName','games','source'].sort());assert.deepEqual(Object.keys(update).sort(),['displayName','games','source'].sort());for(const game of create.games)assert.deepEqual(Object.keys(game).sort(),['title','releaseYear','chronologicalRank',...(game.aliases?['aliases']:[])].sort());row={...structuredClone(create),updatedAt:new Date()};writes.push(create);return{slug:create.slug};}};
 const prisma={franchiseChronology:table,$transaction:async work=>{transactions++;if(latest)row=latest;return work({franchiseChronology:table,$executeRaw:async(_sql,key)=>assert.equal(key,'backlogbuster-franchise:final-fantasy')});}};
 const cache=loader({'@/lib/prisma':{prisma}})('src/lib/saga-chronology-cache.ts');
 const lookup=async()=>{lookups++;return structuredClone(canon);};
 return{resolve:cache.resolveCachedSagaChronology,inspect:cache.inspectSagaChronologyCache,lookup,writes,reads,setLatest:value=>latest=value,get row(){return row;},get lookups(){return lookups;},get transactions(){return transactions;}};
}


test('normalized cache hits use persisted canon without calling upstream',async()=>{
 for(const name of ['Final Fantasy',' FINAL FANTASY ','Final: Fantasy'])assert.equal(normalizeFranchiseKey(name),'final-fantasy');
 const f=fixture(canon);const result=await f.resolve(' FINAL FANTASY ',[{title:'Final Fantasy 7',releaseYear:1997}],()=>assert.fail('No upstream lookup on cache hit'));assert.deepEqual(result.order,{'Final Fantasy 7':1});assert.equal(result.cacheHit,true);assert.equal(f.writes.length,0);
 const legacy=fixture({...canon,source:'gemini'});assert.equal((await legacy.resolve('Final Fantasy',titles,()=>assert.fail('Existing cache must not spend AI quota'))).cacheHit,true);
});

test('cache misses persist only IGDB public metadata and serve other operators after restart',async()=>{
 const f=fixture();const complete={source:'igdb+gemini',games:[...canon.games,{title:'Final Fantasy IX',releaseYear:2000,chronologicalRank:3,aliases:['FFIX']}]};
 const result=await f.resolve('Final Fantasy',titles.map(game=>({...game,userId:'private',notes:'secret',rating:5})),async()=>complete);assert.equal(result.cacheHit,false);assert.equal(f.row.source,'igdb+gemini');assert.equal(f.row.games.length,3);assert(!JSON.stringify(f.row).includes('private'));assert(!JSON.stringify(f.row).includes('secret'));
 const restarted=fixture(f.row);assert.equal((await restarted.resolve('FINAL FANTASY',[{title:'FFIX',releaseYear:2000}],()=>assert.fail('DB hit'))).order.FFIX,3);
});

test('invalid or unavailable upstream data requests local sorting without writing fake canonical ranks',async()=>{
 for(const value of [null,{}, {source:'gemini',games:canon.games},{source:'igdb',games:[]},{source:'igdb',games:[{...canon.games[0],chronologicalRank:1.5}]},{source:'igdb',games:canon.games.map(game=>({...game,chronologicalRank:1}))}]){
  const f=fixture();const result=await f.resolve('Final Fantasy',titles,async()=>value);assert.equal(result.localFallback,true);assert.deepEqual(result.order,{});assert.equal(f.writes.length,0);
 }
 const f=fixture();assert.equal((await f.resolve('Final Fantasy',titles,async()=>{throw Error('Provider cooling down');})).localFallback,true);assert.equal(f.writes.length,0);
});

test('partial cache refresh expands from IGDB and bounded refresh attempts survive cold starts',async()=>{
 const requested=[titles[0],{title:'Final Fantasy IX',releaseYear:2000}],f=fixture(canon);
 const result=await f.resolve('Final Fantasy',requested,async()=>({source:'igdb+gemini',games:[...canon.games,{title:'Final Fantasy IX',releaseYear:2000,chronologicalRank:3}]}));assert.equal(result.order['Final Fantasy IX'],3);assert.equal(f.row.games.length,3);
 const missing=fixture(canon);const first=await missing.resolve('Final Fantasy',requested,async()=>null);assert.equal(first.localFallback,undefined);assert.deepEqual(missing.row.games,canon.games);
 const restarted=fixture(missing.row);assert.equal((await restarted.resolve('Final Fantasy',requested,()=>assert.fail('Do not repeatedly refresh missing title'))).refreshDeferred,true);
 const expired=fixture({...missing.row,updatedAt:new Date(Date.now()-301000)});assert.equal((await expired.resolve('Final Fantasy',requested,async()=>({source:'igdb+gemini',games:[...canon.games,{title:'Final Fantasy IX',releaseYear:2000,chronologicalRank:3}]}))).order['Final Fantasy IX'],3);
});

test('concurrent scans reuse a winner or reject stale results that would discard newly cached games',async()=>{
 const f=fixture();f.setLatest(canon);assert.equal((await f.resolve('Final Fantasy',titles,f.lookup)).order['Final Fantasy VII'],1);assert.equal(f.writes.length,0);
 const conflict=fixture();conflict.setLatest({...canon,games:[...canon.games,{title:'Final Fantasy IX',releaseYear:2000,chronologicalRank:3}]});await assert.rejects(conflict.resolve('Final Fantasy',[titles[0],{title:'Final Fantasy X',releaseYear:2001}],async()=>({...canon,source:'igdb+gemini'})),/expanded during/);assert.equal(conflict.writes.length,0);
});

test('the refresh lease is persisted before network work and same-name remakes share their original story slot',async()=>{
 const f=fixture(canon),requested=[titles[0],{title:'Final Fantasy IX',releaseYear:2000}];let release,started;const begun=new Promise(resolve=>{started=resolve;});
 const first=f.resolve('Final Fantasy',requested,async()=>{started();return new Promise(resolve=>{release=resolve;});});await begun;assert.equal((await f.resolve('Final Fantasy',requested,()=>assert.fail('No parallel refresh'))).refreshDeferred,true);release({source:'igdb+gemini',games:[...canon.games,{title:'Final Fantasy IX',releaseYear:2000,chronologicalRank:3}]});assert.equal((await first).order['Final Fantasy IX'],3);
 const remakes=fixture();const result=await remakes.resolve('Final Fantasy',[{title:'Remake Game',releaseYear:2023}],async()=>({source:'igdb',games:[{title:'Same Game',releaseYear:2000,chronologicalRank:1},{title:'Same Game',releaseYear:2023,chronologicalRank:2,aliases:['Remake Game','Same Game Remake']}]}));assert.equal(result.order['Remake Game'],1);
});

test('force refresh bypasses full cache hits and the partial refresh lease, and replaces stale ranks',async()=>{
 const fresh={...canon,updatedAt:new Date()},f=fixture(fresh);
 const swapped={source:'igdb+gemini',games:[{...canon.games[1],chronologicalRank:1},{...canon.games[0],chronologicalRank:2}]};
 const normal=await f.resolve('Final Fantasy',titles,()=>assert.fail('A full hit must stay cached'));
 assert.equal(normal.debug.status,'hit');assert.equal(normal.debug.updatedAt,fresh.updatedAt.toISOString());
 const forced=await f.resolve('Final Fantasy',titles,async()=>swapped,{forceRefresh:true});
 assert.equal(forced.order['Final Fantasy VII'],2);assert.equal(forced.debug.status,'refreshed');assert.equal(forced.debug.source,'igdb+gemini');assert.equal(f.writes.length,1);
 const partial=fixture(fresh),unknown=[...titles,{title:'Final Fantasy IX',releaseYear:2000}];
 assert.equal((await partial.resolve('Final Fantasy',unknown,()=>assert.fail('Normal refresh obeys the lease'))).refreshDeferred,true);
 const refreshed=await partial.resolve('Final Fantasy',unknown,async()=>({source:'igdb+gemini',games:[...canon.games,{...unknown[2],chronologicalRank:3}]}),{forceRefresh:true});
 assert.equal(refreshed.order['Final Fantasy IX'],3);assert.equal(partial.writes.length,1);
 const offline=fixture(fresh);const failed=await offline.resolve('Final Fantasy',titles,async()=>null,{forceRefresh:true});assert.equal(failed.localFallback,undefined);assert.equal(offline.writes.length,0);assert.deepEqual(failed.debug.canonicalGames,canon.games);
});

test('debug inspection is read-only, strips private cache extras and explains the actual matcher',async()=>{
 const stamp=new Date('2026-01-01T00:00:00Z');
 const f=fixture({...canon,updatedAt:stamp,games:canon.games.map(game=>({...game,notes:'PRIVATE',userId:'OTHER'}))});
 const inspected=await f.inspect('Final Fantasy');assert.equal(inspected.updatedAt,stamp.toISOString());assert.equal(inspected.canonicalGames.length,2);assert.equal(f.transactions,0);assert.equal(f.writes.length,0);assert(!JSON.stringify(inspected).includes('PRIVATE'));
 const {buildSagaChronologyDebug}=loader()('src/lib/saga-debug.ts');
 const debug=buildSagaChronologyDebug(inspected,[{id:1,title:'Final Fantasy 7',releaseYear:1997,chronologicalOrder:9},{id:2,title:'Final Fantasy Custom Mod',releaseYear:null,chronologicalOrder:null}]);
 assert.equal(debug.mappings[0].matchedTitle,'Final Fantasy VII');assert.equal(debug.mappings[0].anchorYear,1997);assert.equal(debug.mappings[0].canonicalRank,1);assert.equal(debug.mappings[0].assignedRank,9);assert.match(debug.mappings[0].reason,/normalized title/);
 assert.equal(debug.mappings[1].matchedTitle,null);assert.match(debug.mappings[1].reason,/No exact normalized/);
 const {explainChronologyMatch}=loader()('src/lib/chronology-titles.ts');
 const remakes=[{title:'Same Game',releaseYear:2000,chronologicalRank:1},{title:'Same Game',releaseYear:2023,chronologicalRank:2}];
 assert.equal(explainChronologyMatch(remakes,{title:'Same Game'}).match,null,'Unlinked same-name reboots are ambiguous without an exact year');
 assert.equal(explainChronologyMatch(remakes,{title:'Same Game',releaseYear:2023}).match.releaseYear,2023);
});

function actionFixture(){
 let cached=null,provider=null,stale=false,active=true,cacheDown=false;const writes=[];let lookups=0;
 const members=[{id:4,title:'Zeta',releaseYear:2005},{id:2,title:'Alpha IX',releaseYear:2000},{id:3,title:'Alpha 9',releaseYear:2000},{id:1,title:'Unknown Year',releaseYear:null}].map(game=>({...game,status:'Backlog',franchise:'Final Fantasy',chronologicalOrder:77}));
 const table={findUnique:async()=>{if(cacheDown)throw Error('Cache offline');return cached;},upsert:async({create})=>{cached=create;return{slug:create.slug};}};
 const prisma={franchiseChronology:table,game:{findMany:async({where})=>{assert.deepEqual(where,{userId:'owner'});return members;},update:args=>({args})},$transaction:async work=>{if(typeof work==='function')return work({franchiseChronology:table,$executeRaw:async()=>{}});if(stale)throw Error('snapshot changed');for(const{args}of work){const member=members.find(game=>game.id===args.where.id);assert.equal(args.where.userId,'owner');assert.equal(args.where.title,member.title);assert.equal(args.where.releaseYear,member.releaseYear);assert.equal(args.where.chronologicalOrder,77);assert(args.data.chronologicalOrder===null||Number.isSafeInteger(args.data.chronologicalOrder));writes.push(args);}return[];}};
 const load=loader({'next/cache':{revalidatePath(){}},'@/lib/prisma':{prisma},'@/lib/player':{getAuthenticatedPlayerId:async()=>{if(!active)throw new(load('src/lib/action-result.ts').InputError)('Sign in');return'owner';}},'@/lib/rawg':{},'@/lib/achievements':{},'@/lib/recommendations':{},'@/lib/api-resilience':{guardedRequest:()=>assert.fail('Chronology must not burn AI cooldowns')},'@/lib/igdb-chronology':{getIgdbChronology:async()=>{lookups++;return provider;}}});
 const key=load('src/lib/sagas.ts').buildSagaChains(members).chains[0].key;
 return{run:force=>load('src/app/actions.ts').autoDetectSagaOrder(key,force),inspect:()=>load('src/app/actions.ts').getSagaChronologyDebug(key),writes,members,get lookups(){return lookups;},get cached(){return cached;},setStale:value=>stale=value,setActive:value=>active=value,setCacheDown:value=>cacheDown=value};
}

test('local fallback stays deterministic when both chronology providers are unavailable',async()=>{
 const f=actionFixture();const result=await f.run();assert.equal(result.updatedCount,4);assert.match(result.message,/No verified saga titles/);assert.deepEqual(Object.fromEntries(f.writes.map(write=>[write.where.id,write.data.chronologicalOrder])),{1:null,2:null,3:null,4:null});assert.equal(f.cached,null);assert.equal(f.lookups,1);
 const {buildReleaseYearOrder}=loader()('src/lib/saga-chronology.ts');assert.deepEqual(buildReleaseYearOrder(f.members),buildReleaseYearOrder([...f.members].reverse()));assert.deepEqual(f.members.map(game=>game.chronologicalOrder),[77,77,77,77]);
});

test('fallback preserves authentication and atomic snapshot guards and handles cache outages gracefully',async()=>{
 const f=actionFixture();f.setStale(true);assert.match((await f.run()).error,/saga changed/);assert.equal(f.writes.length,0);f.setStale(false);f.setActive(false);assert.match((await f.run()).error,/Sign in/);assert.equal(f.writes.length,0);f.setActive(true);f.setCacheDown(true);const result=await f.run();assert.equal(result.updatedCount,4);assert.match(result.message,/Shared chronology unavailable.*release year/);
});

test('operator debug actions require authentication, only read owned saga games, and report fallback assigned ranks',async()=>{
 const f=actionFixture();f.setActive(false);assert.match((await f.inspect()).error,/Sign in/);assert.match((await f.run(true)).error,/Sign in/);assert.equal(f.lookups,0);
 f.setActive(true);assert.match((await f.run('true')).error,/valid cache refresh/);
 const inspected=await f.inspect();assert.equal(inspected.debug.status,'miss');assert.equal(inspected.debug.mappings.length,4);assert.equal(f.lookups,0);assert.equal(f.writes.length,0);
 const forced=await f.run(true);assert.equal(forced.debug.source,'fallback');assert.deepEqual(Object.fromEntries(forced.debug.mappings.map(game=>[game.id,game.assignedRank])),{1:null,2:null,3:null,4:null});assert(forced.debug.mappings.every(game=>game.reason.includes(game.releaseYear==null?'release order tail':'Release order tail')));
});
