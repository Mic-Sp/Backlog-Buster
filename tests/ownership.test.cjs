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
const form = (values) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };

function fixture(){
  let authenticated=true, playerId='owner', scans=0, revokeDuringScan=false;
  const base={title:'Saga One',platform:'PC',status:'Backlog',pinnedOrder:null,backlogOrder:null,releaseYear:2020,lengthHours:10,difficulty:2,hoursPlayed:0,notes:null,rating:null,earnedXp:0,franchise:'Shared Saga',chronologicalOrder:null,createdAt:new Date('2020-01-01')};
  let games=[{...base,id:1,userId:'owner',pinnedOrder:1},{...base,id:2,userId:'owner',title:'Saga Two'},{...base,id:3,userId:'owner',title:'Active',franchise:null,status:'Playing'},{...base,id:4,userId:'owner',title:'Cleared',franchise:null,status:'Completed'},{...base,id:5,userId:'owner',title:'Queue',franchise:null},
    {...base,id:91,userId:'other',pinnedOrder:1},{...base,id:92,userId:'other',title:'Saga Two'},{...base,id:93,userId:'other',title:'Active',franchise:null,status:'Playing'}];
  const initial=structuredClone(games),reads=[],writes=[],syncs=[],locks=[];
  const match=(game,where)=>Object.entries(where).every(([key,value])=>value&&typeof value==='object'?('in'in value?value.in.includes(game[key]):'not'in value?game[key]!==value.not:true):game[key]===value);
  const select=(game,fields)=>fields?Object.fromEntries(Object.keys(fields).map(key=>[key,game[key]])):{...game};
  const check=where=>{assert.equal(where.userId,playerId,'every game operation must explicitly constrain the current owner');};
  const findMany=async({where,select:fields,orderBy})=>{check(where);reads.push(where);let result=games.filter(game=>match(game,where));if(orderBy)result=result.sort((a,b)=>(a.pinnedOrder??0)-(b.pinnedOrder??0));return result.map(game=>select(game,fields));};
  const findUnique=async({where,select:fields})=>{check(where);assert.equal(typeof where.id,'number');reads.push(where);const found=games.find(game=>match(game,where));return found?select(found,fields):null;};
  const fail=()=>{throw Object.assign(Error('Missing'),{code:'P2025'});};
  const game={findMany,findUnique,findUniqueOrThrow:async args=>(await findUnique(args))??fail(),
    update:async({where,data,select:fields})=>{check(where);assert.equal(typeof where.id,'number');assert(!('userId'in data)&&!('id'in data));const record=games.find(game=>match(game,where));if(!record)fail();Object.assign(record,data);writes.push(where);return select(record,fields);},
    delete:async({where})=>{check(where);assert.equal(typeof where.id,'number');const record=games.find(game=>match(game,where));if(!record)fail();games=games.filter(game=>game!==record);writes.push(where);return record;},
    create:async({data})=>{assert.equal(data.userId,playerId);const record={...base,...data,id:1000};games.push(record);writes.push({userId:data.userId,id:record.id});return record;},
  };
  const prisma={game,$executeRaw:async(_sql,key)=>{assert(key.includes(playerId));locks.push(key);},$transaction:async work=>{const before=structuredClone(games);try{return typeof work==='function'?await work(prisma):await Promise.all(work);}catch(error){games=before;throw error;}},$queryRaw:async(strings,...values)=>{assert.match(strings.join(''),/WHERE "id" = .* AND "userId" =/s);const[hours,id,userId]=values;assert.equal(userId,playerId);const record=games.find(game=>game.id===id&&game.userId===userId);if(!record)return[];record.hoursPlayed=Math.max(0,Math.min(10000,record.hoursPlayed+hours));writes.push({id,userId});return[{id}];}};
  let load;
  load=loader({'next/cache':{revalidatePath(){}},'@/lib/prisma':{prisma},'@/lib/player':{getAuthenticatedPlayerId:async()=>{if(!authenticated)throw new(load('src/lib/action-result.ts').InputError)('Sign in to access your library.');return playerId;},getCurrentPlayerId:()=>assert.fail('Legacy local-profile fallback must never authorize an action')},'@/lib/achievements':{syncAndGetAchievements:async id=>{assert.equal(id,playerId);syncs.push(id);}},'@/lib/api-resilience':{guardedRequest:async(_id,_feature,_input,work)=>work()},'@/lib/rawg':{lookupRawgGame:async()=>null},'@/lib/recommendations':{getBacklogRecommendations:async id=>{assert.equal(id,playerId);return{};},getExternalRecommendations:async id=>{assert.equal(id,playerId);return[];}},'@/lib/saga-chronology':{resolveSagaChronology:async(_name,titles)=>{scans++;if(revokeDuringScan)authenticated=false;return Object.fromEntries(titles.map((title,index)=>[title,index+1]));}}});
  return{actions:load('src/app/actions.ts'),setAuth:value=>authenticated=value,setPlayer:value=>playerId=value,revokeDuringScan:()=>revokeDuringScan=true,get games(){return games;},initial,reads,writes,syncs,locks,get scans(){return scans;},sagaKey:load('src/lib/sagas.ts').buildSagaChains(games.filter(game=>game.userId==='owner')).chains[0].key};
}
const gameForm=id=>form({id:String(id),status:'Playing',lengthHours:'20',difficulty:'2',userId:'other',playerId:'other'});
const attempts=(a,id)=>[
 ['pin',()=>a.toggleGamePin(id,true)],['unpin',()=>a.toggleGamePin(id,false)],['assign slot',()=>a.assignDeckSlot(id,2)],['swap slots',()=>a.swapDeckSlot(id,2)],['return to queue',()=>a.returnDeckGameToBacklog(id,2)],
 ['start',()=>a.startGame(gameForm(id))],['accept roulette/advisor',()=>a.acceptQuest(id)],['update',()=>a.updateGame(gameForm(id))],['rate/meta',()=>a.updateGame(form({id:String(id),status:'Completed',lengthHours:'20',difficulty:'2',rating:'5',notes:'injected',title:'Changed',franchise:'Changed',chronologicalOrder:'2'}))],['flatline',()=>a.flatlineGame(gameForm(id))],['complete',()=>a.completeGame(form({id:String(id),lengthHours:'20',difficulty:'2',hoursPlayed:'25'}))],['log session',()=>a.logPlaySession(id,2)],['AI hours',()=>a.applyPlaytimeEstimate(id,30)],['delete',()=>a.deleteGame(form({id:String(id)}))],
 ['backlog reorder',()=>a.reorderBacklogGames(['2',String(id)])],['saga reorder',()=>a.reorderSagaTimeline(['1',String(id)])],
];

test('all valid mutation paths reject signed-out/legacy local access before touching game rows',async()=>{
  const f=fixture();f.setAuth(false);
  for(const[name,run]of attempts(f.actions,91)){assert.match((await run()).error,/Sign in/,name);assert.deepEqual(f.games,f.initial,name);}
  for(const run of [()=>f.actions.autoDetectSagaOrder(f.sagaKey),()=>f.actions.createGame(form({title:'New',platform:'PC',lengthHours:'10',difficulty:'2'})),()=>f.actions.addExternalScoutGame(form({title:'New',platform:'PC',lengthHours:'10',difficulty:'2'}))])assert.match((await run()).error,/Sign in/);
  assert.equal(f.reads.length,0);assert.equal(f.writes.length,0);assert.equal(f.syncs.length,0);assert.equal(f.scans,0);
});

test('forged foreign IDs cannot update, rate, flatline, delete, pin, log, or reorder another operator',async()=>{
  const f=fixture();for(const[name,run]of attempts(f.actions,91)){const result=await run();assert.equal(typeof result.error,'string',name);assert.deepEqual(f.games,f.initial,name);assert.equal(f.writes.length,0,name);}
  assert.equal(f.syncs.length,0,'Rejected foreign deletes cannot even mint the caller achievements');
});

test('valid owner mutations, per-owner pinned limits, reorders and AI ranks leave other operators untouched',async()=>{
  const f=fixture(),a=f.actions,foreign=f.initial.filter(game=>game.userId==='other');
  assert.deepEqual(await a.reorderBacklogGames(['5','2']),{success:true});assert.equal(f.games.find(game=>game.id===5).backlogOrder,1);
  assert.deepEqual(await a.reorderSagaTimeline(['2','1']),{success:true});assert.equal(f.games.find(game=>game.id===2).chronologicalOrder,1);
  assert.equal((await a.toggleGamePin(2,true)).pinnedOrder,2,'Other operator slot 2 never consumes our deck');assert.equal((await a.toggleGamePin(5,true)).pinnedOrder,3);
  assert.match((await a.toggleGamePin(1,true)).pinnedOrder.toString(),/1/);
  assert.deepEqual(await a.swapDeckSlot(1,3),{success:true});assert.deepEqual(await a.assignDeckSlot(2,1),{success:true});
  assert.deepEqual(await a.startGame(gameForm(1)),{success:true});assert.equal(f.games.find(game=>game.id===1).pinnedOrder,null);
  assert.deepEqual(await a.applyPlaytimeEstimate(3,33),{success:true});assert.deepEqual(await a.logPlaySession(3,2),{success:true});
  assert.deepEqual(await a.updateGame(form({id:'3',status:'Playing',lengthHours:'33',difficulty:'2',rating:'5',notes:'private owner note',chronologicalOrder:'4'})),{success:true});
  assert.equal((await a.autoDetectSagaOrder(f.sagaKey)).updatedCount,2);assert.equal(f.scans,1);
  assert.deepEqual(await a.deleteGame(form({id:'4'})),{success:true});assert.deepEqual(f.games.filter(game=>game.userId==='other'),foreign);assert(f.syncs.length>0);
});

test('AI saga scans recheck the live session before saving after a slow response',async()=>{
  const f=fixture();f.revokeDuringScan();const result=await f.actions.autoDetectSagaOrder(f.sagaKey);assert.match(result.error,/Sign in/);assert.deepEqual(f.games,f.initial);assert.equal(f.writes.length,0);
});

test('personalized in-flight results are isolated by operator while public chronology cache is defensive and metadata-only',async()=>{
  const {guardedRequest}=loader()('src/lib/api-resilience.ts');let calls=0;
  const values=await Promise.all([guardedRequest('owner-a','advisor','same-input',async()=>{calls++;return{notes:'A private result'};}),guardedRequest('owner-b','advisor','same-input',async()=>{calls++;return{notes:'B private result'};})]);assert.equal(calls,2);assert.deepEqual(values,[{notes:'A private result'},{notes:'B private result'}]);
  const previous=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='isolated-fixture-key';
  try{
    const requests=[];const chronology=loader({'@/lib/api-resilience':{resilientFetch:async(_url,options)=>{requests.push(JSON.parse(options.body));return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({'Saga One':1,'Saga Two':2})}]}}]}),{status:200,headers:{'Content-Type':'application/json'}});}}})('src/lib/saga-chronology.ts');
    const first=await chronology.resolveSagaChronology('Shared Saga',['Saga Two','Saga One']);first['Saga One']=999;const second=await chronology.resolveSagaChronology('Shared Saga',['Saga One','Saga Two']);assert.deepEqual(second,{'Saga One':1,'Saga Two':2});assert.equal(requests.length,1);
    const data=requests[0].contents[0].parts[0].text;assert(data.includes('Saga One'));for(const privateField of ['userId','notes','rating','status','passwordHash'])assert(!data.includes(privateField));
  }finally{if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous;}
});
