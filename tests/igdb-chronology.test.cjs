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
const titles=loader()('src/lib/chronology-titles.ts');
const stamp=year=>Date.UTC(year,0,1)/1000;
const row=(id,name,year,type='Main Game',extra={})=>({id,name,slug:name.toLowerCase().replaceAll(' ','-'),first_release_date:stamp(year),game_type:{type},...extra});

test('title matching handles Roman/Arabic, editions, subtitles, platforms and official aliases conservatively',()=>{
 const games=[{title:'Final Fantasy IX',releaseYear:2000,chronologicalRank:1,aliases:['FFIX']},{title:'Resident Evil 4',releaseYear:2005,chronologicalRank:2},{title:'Resident Evil 4',releaseYear:2023,chronologicalRank:3,aliases:['Resident Evil 4 Remake']},{title:'Resident Evil VIII: Village',releaseYear:2021,chronologicalRank:4,aliases:['Resident Evil 8']}];
 for(const title of ['Final Fantasy 9','FINAL FANTASY IX (PC)','Final Fantasy IX Remastered','FFIX'])assert.equal(titles.matchChronologyGame(games,{title})?.chronologicalRank,1,title);
 assert.equal(titles.matchChronologyGame(games,{title:'Resident Evil 4 Remake'})?.chronologicalRank,2);assert.equal(titles.matchChronologyGame(games,{title:'Resident Evil 4',releaseYear:2005})?.chronologicalRank,2);assert.equal(titles.matchChronologyGame(games,{title:'Resident Evil 4'}).chronologicalRank,2,'An original story anchor never needs the library remake year');assert.equal(titles.matchChronologyGame(games,{title:'Resident Evil 8'})?.chronologicalRank,4);
 assert.equal(titles.matchChronologyGame(games,{title:'Final Fantasy 9: Standard Story'}),null);assert.equal(titles.matchChronologyGame(games,{title:'Final Fantasy'}),null);assert.equal(titles.matchChronologyGame(games,{title:'Final Fantasy IX: Custom Mod'}),null);assert.equal(titles.normalizeChronologyTitle('Kingdom Hearts Final Mix'),'kingdom-hearts-final-mix');
});

test('IGDB canon uses earliest release dates, stable ties, clean categories, aliases, and collapsed remake story slots',()=>{
 const {buildIgdbCanon}=loader({'@/lib/igdb-api':{}})('src/lib/igdb-chronology.ts');
 const data=[row(8,'Game 2',2010),row(1,'Game',2000,'Main Game',{remakes:[11],ports:[21],release_dates:[{date:stamp(1999)}],alternative_names:[{name:'Official Alias'}]}),row(11,'Game',2023,'Remake'),row(9,'Game 2',2010,'Main Game',{alternative_names:[{name:'Regional Name'}]}),row(10,'Standalone Story',2005,'Standalone Expansion'),row(20,'DLC',2001,'DLC Addon'),row(21,'Game',2011,'Port',{parent_game:1}),row(22,'Bundle',2000,'Bundle'),row(23,'Soundtrack',2000),row(24,'Special Edition',2005,'Main Game',{version_parent:1}),row(25,'Announced',2099),{id:26,name:'Undated',game_type:{type:'Main Game'}},row(30,'Beta',2010),row(31,'Alpha',2010)];
 const a=buildIgdbCanon(data),b=buildIgdbCanon([...data].reverse());assert.deepEqual(a,b);assert.deepEqual(a.map(g=>g.title),['Game','Standalone Story','Alpha','Beta','Game 2']);assert.deepEqual(a.map(g=>g.chronologicalRank),[1,2,3,4,5]);assert.equal(a[0].releaseYear,1999);assert(a[0].aliases.includes('Official Alias'));assert(a[4].aliases.includes('Regional Name'));assert(!a[0].aliases.includes('Game remake'),'A remake category alone must not invent edition aliases');assert(!JSON.stringify(a).includes('version_parent'));
});

test('franchise lookup uses exact groups, complete paginated games and safely quoted queries',async()=>{
 const calls=[];const pages=Array.from({length:500},(_,i)=>row(i+1,`Game ${i+1}`,2000));
 const source=loader({'@/lib/igdb-api':{queryIgdb:async(endpoint,body,signal)=>{calls.push({endpoint,body});assert(signal instanceof AbortSignal);if(endpoint==='collections')return[{id:7,name:'Final Fantasy',games:[1,2]},{id:999,name:'Not Final Fantasy',games:[9999]}];if(endpoint==='franchises')return[{id:8,name:'Final Fantasy'}];return body.includes('offset 0;')?pages:[row(501,'Last Game',2010)];}}})('src/lib/igdb-chronology.ts');
 const result=await source.getIgdbChronology('Final Fantasy');assert.equal(result.source,'igdb');assert.equal(result.games.length,501);const query=calls.find(c=>c.endpoint==='games').body;assert(query.includes('collections = (7)'));assert(query.includes('franchises = (8)'));assert(!query.includes('9999'));assert(query.includes('game_type.type'));assert(calls.some(c=>c.body.includes('offset 500;')));
 const empty=loader({'@/lib/igdb-api':{queryIgdb:async()=>[]}})('src/lib/igdb-chronology.ts');assert.equal(await empty.getIgdbChronology('Missing'),null);
 const failing=loader({'@/lib/igdb-api':{queryIgdb:async(endpoint,body)=>{if(endpoint!=='games')return[{id:1,name:'Game "Name"; fields secret;'}];assert(body.includes('where'));return null;}}})('src/lib/igdb-chronology.ts');assert.equal(await failing.getIgdbChronology('Game "Name"; fields secret;'),null);
 const unsafe=[];await loader({'@/lib/igdb-api':{queryIgdb:async(_endpoint,body)=>{unsafe.push(body);return[];}}})('src/lib/igdb-chronology.ts').getIgdbChronology('Game "; fields *;');assert(unsafe.every(body=>body.startsWith('search "Game \\"; fields *;";')));
});

function apiFixture(){
 let next=0,token={accessToken:'cached-token',expiresAt:new Date(Date.now()+5e9)},blocked=0;const dispatches=[],queries=[],deleted=[];
 const tokenTable={findUnique:async()=>token,deleteMany:async({where})=>{deleted.push(where);if(token?.accessToken===where.accessToken)token=null;},upsert:async({create})=>{token=create;return{provider:'igdb'};}};
 const prisma={externalOAuthToken:tokenTable,authRateLimit:{findUnique:async()=>({resetsAt:new Date(next)})},$queryRaw:async(_sql,key)=>{assert.match(key,/^igdb-dispatch:[a-f0-9]{64}$/);queries.push(key);const now=Date.now();if(now<next){blocked++;return[];}next=now+300;dispatches.push(now);return[{key}];},$executeRaw:async(_sql,_key,retry)=>{next=Math.max(next,Date.now()+retry*1000);},$transaction:async work=>work({$executeRaw:async()=>{},externalOAuthToken:tokenTable})};
 const load=loader({'@/lib/prisma':{prisma}});return{load,prisma,api:load('src/lib/igdb-api.ts'),dispatches,queries,deleted,get blocked(){return blocked;}};
}
async function environment(work){const old=[process.env.TWITCH_CLIENT_ID,process.env.TWITCH_CLIENT_SECRET,global.fetch,Math.random];process.env.TWITCH_CLIENT_ID='fixture-client';process.env.TWITCH_CLIENT_SECRET='fixture-secret';Math.random=()=>0;try{await work();}finally{for(const[i,key]of ['TWITCH_CLIENT_ID','TWITCH_CLIENT_SECRET'].entries()){if(old[i]===undefined)delete process.env[key];else process.env[key]=old[i];}global.fetch=old[2];Math.random=old[3];}}

test('IGDB requests share a global 4/s gate, deduplicate identical queries, and rate-limit every retry',async()=>environment(async()=>{
 const f=apiFixture();let posts=0;global.fetch=async(url,options)=>{assert.equal(options.headers['Client-ID'],'fixture-client');assert.equal(options.headers.Authorization,'Bearer cached-token');assert(url.startsWith('https://api.igdb.com/v4/'));posts++;return posts===1?new Response(null,{status:429,headers:{'Retry-After':'0'}}):Response.json([{id:posts}]);};
 const [one,two]=await Promise.all([f.api.queryIgdb('games','fields name;'),f.api.queryIgdb('games','fields name;')]);assert.deepEqual(one,two);assert.equal(posts,2);one.push({private:'changed'});assert.equal(two.length,1);assert.equal(f.dispatches.length,2);assert(f.dispatches[1]-f.dispatches[0]>=295);
 // A second instance uses the same database gate, rather than its own unshared timer.
 const secondInstance=loader({'@/lib/prisma':{prisma:f.prisma}})('src/lib/igdb-api.ts');await secondInstance.queryIgdb('games','fields id;');assert.equal(posts,3);assert(f.dispatches[2]-f.dispatches[1]>=295);assert(f.blocked>0);
}));

test('IGDB uses the real token manager for one 401 recovery and honors long Retry-After without loops',async()=>environment(async()=>{
 const f=apiFixture(),authHeaders=[];let tokenPosts=0;global.fetch=async(url,options)=>{if(url.includes('id.twitch.tv')){tokenPosts++;return Response.json({access_token:'replacement-token',expires_in:5000000,token_type:'bearer'});}authHeaders.push(options.headers.Authorization);return options.headers.Authorization==='Bearer cached-token'?new Response(null,{status:401}):Response.json([{name:'Verified'}]);};
 assert.deepEqual(await f.api.queryIgdb('games','fields name;'),[{name:'Verified'}]);assert.equal(tokenPosts,1);assert.deepEqual(authHeaders,['Bearer cached-token','Bearer replacement-token']);assert.equal(f.deleted.length,1);assert.equal(f.dispatches.length,2);
 const limited=apiFixture();let calls=0;global.fetch=async()=>{calls++;return new Response(null,{status:429,headers:{'Retry-After':'120'}});};assert.equal(await limited.api.queryIgdb('games','fields name;'),null);assert.equal(await limited.api.queryIgdb('games','fields id;'),null);assert.equal(calls,1);
}));

test('auto-order prefers complete IGDB canon, reuses it for another operator, and falls back safely',async()=>{
 let cached=null,operator='owner-a',primaryCalls=0,primaryWorks=true,providerFails=false;const writes=[];
 const members=[{id:1,title:'Final Fantasy 7',status:'Backlog',franchise:'Final Fantasy',releaseYear:1997,chronologicalOrder:null},{id:2,title:'Final Fantasy 9 Remastered',status:'Backlog',franchise:'Final Fantasy',releaseYear:2000,chronologicalOrder:null}];
 const publicCanon={source:'igdb',games:[{title:'Final Fantasy VII',releaseYear:1997,chronologicalRank:1},{title:'Final Fantasy VIII',releaseYear:1999,chronologicalRank:2},{title:'Final Fantasy IX',releaseYear:2000,chronologicalRank:3}]};
 const table={findUnique:async()=>cached,upsert:async({create})=>{cached={...create,updatedAt:new Date()};return{slug:create.slug};}};
 const prisma={franchiseChronology:table,game:{findMany:async({where})=>{assert.equal(where.userId,operator);return members;},update:args=>({args})},$transaction:async work=>{if(typeof work==='function')return work({$executeRaw:async()=>{},franchiseChronology:table});for(const{args}of work){assert.equal(args.where.userId,operator);assert.equal(args.where.title,members[args.where.id-1].title);assert(args.data.chronologicalOrder===null||Number.isSafeInteger(args.data.chronologicalOrder));writes.push({operator,...args});}return[];}};
 const load=loader({'next/cache':{revalidatePath(){}},'@/lib/prisma':{prisma},'@/lib/player':{getAuthenticatedPlayerId:async()=>operator},'@/lib/rawg':{},'@/lib/achievements':{},'@/lib/recommendations':{},'@/lib/api-resilience':{guardedRequest:()=>assert.fail('Saga scans must not consume AI cooldowns')},'@/lib/igdb-chronology':{getIgdbChronology:async()=>{primaryCalls++;if(providerFails)throw Error('Provider unavailable');return primaryWorks?publicCanon:null;}}});
 const key=load('src/lib/sagas.ts').buildSagaChains(members).chains[0].key;const run=load('src/app/actions.ts').autoDetectSagaOrder;
 assert.equal((await run(key)).updatedCount,2);assert.equal(primaryCalls,1);assert.equal(cached.source,'igdb');assert.equal(cached.games.length,2);assert.deepEqual(writes.map(write=>write.data.chronologicalOrder),[1,2]);
 operator='owner-b';assert.equal((await run(key)).updatedCount,2);assert.equal(primaryCalls,1);assert.deepEqual(writes.map(write=>write.operator),['owner-a','owner-a','owner-b','owner-b']);
 cached=null;primaryWorks=false;const fallback=await run(key);assert.equal(fallback.updatedCount,2);assert.match(fallback.message,/No verified saga titles/);assert.equal(cached,null);assert.deepEqual(writes.slice(-2).map(write=>write.data.chronologicalOrder),[null,null]);
 const before=writes.length;providerFails=true;const unavailable=await run(key);assert.equal(unavailable.updatedCount,2);assert.match(unavailable.message,/No verified saga titles/);assert.equal(writes.length,before+2);assert.equal(cached,null);
});

test('missing Twitch credentials, malformed IGDB responses and truncated catalogues return unavailable',async()=>environment(async()=>{
 process.env.TWITCH_CLIENT_ID=' ';let calls=0;global.fetch=async()=>{calls++;throw Error('must not call provider');};const api=apiFixture();assert.equal(await api.api.queryIgdb('games','fields name;'),null);assert.equal(calls,0);assert.equal(api.queries.length,0);
 const data=Array.from({length:500},(_,i)=>row(i+1,`Game ${i}`,2000));let pages=0;const truncated=loader({'@/lib/igdb-api':{queryIgdb:async endpoint=>endpoint==='games'?(pages++,data):[{id:1,name:'Known'}]}})('src/lib/igdb-chronology.ts');assert.equal(await truncated.getIgdbChronology('Known'),null);assert.equal(pages,10);
}));

test('all trailing Roman and Arabic sequel numbers survive base-title collapsing and edition cleanup',()=>{
 const roman=['I','II','III','IV','V','VI','VII','VIII','IX','X'];
 const games=[{title:'Kingdom Hearts',releaseYear:2002,chronologicalRank:1},...roman.map((number,index)=>({title:`Kingdom Hearts ${number}`,releaseYear:2005+index,chronologicalRank:index+2}))];
 assert.equal(titles.collapseChronologyGames(games).length,11);
 for(const [index,number] of roman.entries()){
  const title=`Kingdom Hearts ${number}`;
  for(const suffix of ['', ' Remake', ' Remastered', ' HD', " Director's Cut"]){
   assert.equal(titles.baseChronologyTitle(title+suffix),title);
   assert.equal(titles.matchChronologyGame(games,{title:title+suffix}).chronologicalRank,index+2);
  }
  assert.equal(titles.normalizeChronologyTitle(title),titles.normalizeChronologyTitle(`Kingdom Hearts ${index+1}`));
  assert.notEqual(titles.normalizeChronologyTitle(title),titles.normalizeChronologyTitle('Kingdom Hearts'));
 }
 assert.equal(titles.baseChronologyTitle('Kingdom Hearts II Final Mix'),'Kingdom Hearts II Final Mix');
 assert.equal(titles.baseChronologyTitle('Kingdom Hearts 358/2 Days'),'Kingdom Hearts 358/2 Days');
});

test('explicit IGDB links cannot collapse a numbered sequel into an unnumbered predecessor',()=>{
 const {buildIgdbCanon}=loader({'@/lib/igdb-api':{}})('src/lib/igdb-chronology.ts');
 const data=[row(1,'Kingdom Hearts',2002,'Main Game',{remakes:[3],alternative_names:[{name:'Kingdom Hearts II'}]}),row(2,'Kingdom Hearts II',2005,'Main Game',{version_parent:1,remasters:[4]}),row(3,'Kingdom Hearts II HD',2014,'Remaster',{version_parent:2}),row(4,'Kingdom Hearts 2 Remastered',2015,'Remaster')];
 const canon=buildIgdbCanon(data);assert.deepEqual(canon,buildIgdbCanon([...data].reverse()));
 assert.deepEqual(canon.map(g=>[g.title,g.releaseYear]),[['Kingdom Hearts',2002],['Kingdom Hearts II',2005]]);
 assert.equal(titles.matchChronologyGame(canon,{title:'Kingdom Hearts II HD'}).releaseYear,2005);
 assert(!canon[0].aliases.includes('Kingdom Hearts II'));
 const polluted=[{title:'Kingdom Hearts',releaseYear:2002,chronologicalRank:1,aliases:['Kingdom Hearts II','Kingdom Hearts 2 HD']}];
 assert.equal(titles.matchChronologyGame(polluted,{title:'Kingdom Hearts II'}),null,'Old poisoned aliases cannot create a cache hit for a missing sequel');
 assert.equal(titles.matchChronologyGame([...polluted,canon[1]],{title:'Kingdom Hearts 2'}).title,'Kingdom Hearts II');
});

test('only real edition evidence collapses entries; generic parent links, categories, and subtitles do not',()=>{
 const {buildIgdbCanon}=loader({'@/lib/igdb-api':{}})('src/lib/igdb-chronology.ts');
 const data=[row(1,'Story',1999),row(2,'Story: New Campaign',2000,'Standalone Expansion',{parent_game:1}),row(3,'Story',2020,'Remake'),row(4,'Story HD',2004,'Remaster'),row(5,'Story II',2005),row(6,'Story II: Side Story',2005)];
 const canon=buildIgdbCanon(data);assert.deepEqual(canon.map(g=>[g.title,g.releaseYear]),[['Story',1999],['Story: New Campaign',2000],['Story II',2005],['Story II: Side Story',2005],['Story',2020]]);
 assert.equal(titles.matchChronologyGame(canon,{title:'Story',releaseYear:2020}).releaseYear,2020);
 assert.equal(titles.matchChronologyGame(canon,{title:'Story'}),null,'Same-name different-era stories require disambiguation');
 assert.equal(titles.matchChronologyGame(canon,{title:'Story II: Unknown'}),null);
 assert.equal(titles.matchChronologyGame(canon,{title:'Story: New Campaign'}).title,'Story: New Campaign');
 const linked=buildIgdbCanon([row(1,'Original Story',1999,'Main Game',{remakes:[2]}),row(2,'New Edition Name',2020,'Remake'),row(3,'Original Story: Definitive Edition',2021,'Main Game',{version_parent:1})]);
 assert.equal(linked.length,1);assert.equal(linked[0].releaseYear,1999);assert(linked[0].aliases.includes('New Edition Name'));
});

test('invalid, missing, later, or cyclic edition parents never erase separate game identities',()=>{
 const {buildIgdbCanon}=loader({'@/lib/igdb-api':{}})('src/lib/igdb-chronology.ts');
 const data=[row(1,'Alpha',2000,'Main Game',{version_parent:2}),row(2,'Beta',2000,'Main Game',{version_parent:1}),row(3,'Gamma',2001,'Port',{parent_game:1,version_parent:999}),row(4,'Delta',1990,'Main Game',{version_parent:1})];
 assert.deepEqual(buildIgdbCanon(data).map(g=>g.title),['Delta','Alpha','Beta','Gamma']);
});
