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
const imports=loader()('src/lib/library-import.ts');

test('import sanitization allowlists fields, defaults malformed values and enforces bounded JSON/CSV payloads',()=>{
  const clean=imports.sanitizeImportedGame({id:999,userId:'victim',playerId:'victim',email:'secret',title:'  Hades  ',platform:'  ',status:' completed ',lengthHours:'999999',hoursPlayed:-9,difficulty:'NaN',rating:'5',releaseYear:'2020',chronologicalOrder:'Infinity',earnedXp:999999999,notes:'  checkpoint  ',genre:'  ',franchise:'  ',coverUrl:'  '});
  assert.equal(clean.title,'Hades');assert.equal(clean.platform,'PC');assert.equal(clean.status,'Completed');assert.equal(clean.lengthHours,10000);assert.equal(clean.hoursPlayed,0);assert.equal(clean.difficulty,2);assert.equal(clean.rating,5);assert.equal(clean.chronologicalOrder,null);assert.equal(clean.earnedXp,200000);assert.equal(clean.notes,'checkpoint');assert.equal(clean.genre,null);assert.equal(clean.coverUrl,null);
  for(const key of ['id','userId','playerId','email'])assert(!(key in clean));
  for(const bad of [null,[],1,{title:' \u00a0 '},{title:'x'.repeat(121)},{title:'Game',notes:'x'.repeat(1001)},{title:'Game',coverUrl:'javascript:alert(1)'},{title:'Game',coverUrl:'https://user:pass@example.com/x'}])assert.throws(()=>imports.sanitizeImportedGame(bad));
  const fallback=imports.sanitizeImportedGame({title:'Game',status:'invalid',rating:true,lengthHours:'no',hoursPlayed:'Infinity',difficulty:999});assert.equal(fallback.status,'Backlog');assert.equal(fallback.rating,null);assert.equal(fallback.lengthHours,10);assert.equal(fallback.hoursPlayed,0);assert.equal(fallback.difficulty,3);
  assert.throws(()=>imports.validateImportPayload({mode:'json',content:'💀'.repeat(125001)}),/500 KB/);
  assert.throws(()=>imports.parseBackupRecords('not json','json'),/Invalid JSON/);
  assert.throws(()=>imports.parseBackupRecords(JSON.stringify(Array(201).fill({title:'Game'})),'json'),/200/);
  assert.throws(()=>imports.parseBackupRecords('title\n'+Array(201).fill('Game').join('\n'),'csv'),/200/);
  assert.throws(()=>imports.parseBackupRecords('title,title\nA,B','csv'),/duplicate/);
  assert.throws(()=>imports.parseBackupRecords('title,notes\n"Game","unterminated','csv'),/unterminated/);
  const [record]=imports.parseBackupRecords('\uFEFFtitle,notes,rating\r\n"A, B","said ""hello""\nnext line",5\r\n','csv');assert.deepEqual(record,{title:'A, B',notes:'said "hello"\nnext line',rating:'5'});
});

function vaultFixture(){
  let token='owner-token',expired=false,revoked=false,fail=false,lookups=0,queries=0;
  const player={id:'owner',handle:'netrunner',operatorName:'Neo'};
  let games=[{id:1,userId:'owner',title:'Existing',platform:'PC',pinnedOrder:1},{id:2,userId:'other',title:'Foreign Game',platform:'PC',pinnedOrder:2}];
  const writes=[];
  const selectGame=(game,select)=>Object.fromEntries(Object.keys(select).map(key=>[key,game[key]??null]));
  const gameQuery=async({where,select})=>{queries++;assert.deepEqual(where,{userId:'owner'});assert(!select.id&&!select.userId&&!select.email&&!select.passwordHash);return games.filter(game=>game.userId===where.userId).map(game=>selectGame(game,select));};
  const tx={$executeRaw:async(_sql,key)=>assert.equal(key,'backlogbuster-deck:owner'),playerSession:{findUnique:async({where})=>{assert.equal(where.userId,'owner');assert.equal(where.tokenHash,'owner-token');return revoked?null:{tokenHash:'owner-token'};}},game:{findMany:gameQuery,createMany:async({data})=>{writes.push(data);for(const record of data){assert.equal(record.userId,'owner');assert(!('id'in record));games.push({...record,id:games.length+1});}if(fail)throw Error('DB failure');return{count:data.length};}}};
  const prisma={playerSession:{findUnique:async({where,select})=>{assert.equal(where.tokenHash,'owner-token');assert(where.expiresAt.gt instanceof Date);assert.deepEqual(select.player.select,{id:true,handle:true,operatorName:true});assert.deepEqual(where.player,{email:{not:null},passwordHash:{not:null}});return expired?null:{player};}},game:{findMany:gameQuery},$transaction:async work=>{const before=structuredClone(games);try{return await work(tx);}catch(error){games=before;throw error;}}};
  const load=loader({'@/lib/prisma':{prisma},'@/lib/auth-session':{readSessionHash:async()=>token},'@/lib/rawg':{lookupRawgGame:async()=>{lookups++;throw Error('429');}}});
  return{vault:load('src/lib/library-vault.ts'),setToken:value=>token=value,setExpired:value=>expired=value,setRevoked:value=>revoked=value,setFail:value=>fail=value,get games(){return games;},get lookups(){return lookups;},get queries(){return queries;},writes};
}

test('exports require a live signed-in session, query only owner games and strip sensitive/ID fields',async()=>{
  const f=vaultFixture();f.setToken(null);await assert.rejects(f.vault.getLibraryExport('json'),/Sign in/);assert.equal(f.queries,0);
  f.setToken('owner-token');f.setExpired(true);await assert.rejects(f.vault.getLibraryExport('json'),/session expired/);assert.equal(f.queries,0);f.setExpired(false);
  const backup=await f.vault.getLibraryExport('json');assert.match(backup.filename,/^backlog-buster-archive-netrunner-.*\.json$/);const records=JSON.parse(backup.content);assert.equal(records.length,1);assert.equal(records[0].title,'Existing');for(const forbidden of ['userId','playerId','"id"','email','passwordHash','session','Foreign Game'])assert(!backup.content.includes(forbidden));
  const csv=await f.vault.getLibraryExport('csv');assert(csv.content.startsWith('title,platform,status'));assert(!csv.content.includes('Foreign Game'));await assert.rejects(f.vault.getLibraryExport('xml'),/JSON or CSV/);
});

test('JSON import ignores spoofed owners/IDs, isolates duplicate checks, skips bad rows and recomputes XP',async()=>{
  const f=vaultFixture();const payload={mode:'json',content:JSON.stringify([
    {id:2,userId:'other',playerId:'other',title:' Foreign Game ',platform:'PC',status:'Completed',lengthHours:20,difficulty:2,earnedXp:99999999},
    {title:' existing ',platform:' pc '},{title:'Foreign Game',platform:'pc'},
    {title:' \u00a0 '},null,{title:'Bad URL',coverUrl:'data:image/png;base64,bad'},
    {title:'Pinned',platform:'PC',releaseYear:2020,pinnedOrder:1},
  ])};
  f.setToken(null);await assert.rejects(f.vault.importLibraryGames(payload),/Sign in/);assert.equal(f.queries,0);f.setToken('owner-token');
  const result=await f.vault.importLibraryGames(payload);assert.equal(result.userId,'owner');assert.deepEqual(result.counts,{importedCount:2,duplicateCount:2,invalidCount:3,skippedCount:5});assert.equal(f.games.filter(game=>game.userId==='other').length,1);assert.equal(f.games.find(game=>game.id===2).userId,'other');assert.equal(f.writes[0][0].earnedXp,400);assert.equal(f.writes[0][1].pinnedOrder,2);
  assert.deepEqual((await f.vault.importLibraryGames(payload)).counts,{importedCount:0,duplicateCount:4,invalidCount:3,skippedCount:7});
});

test('title/CSV imports trim blanks, survive metadata failure, reject caps/revoked sessions and roll back writes',async()=>{
  const f=vaultFixture();
  const result=await f.vault.importLibraryGames({mode:'titles',content:'  Manual | Switch\n   \n| PC\n Bad | PC | extra\n',defaultPlatform:' PC '});assert.deepEqual(result.counts,{importedCount:1,duplicateCount:0,invalidCount:3,skippedCount:3});assert.equal(f.lookups,1);const game=f.games.find(game=>game.title==='Manual');assert.equal(game.platform,'Switch');assert.equal(game.lengthHours,10);
  const csv=await f.vault.importLibraryGames({mode:'csv',content:'id,userId,title,platform,status,lengthHours,difficulty,rating\n2,other,CSV Gig,PC,Completed,15,2,4\n9,other,   ,PC,Backlog,NaN,99,0'});assert.deepEqual(csv.counts,{importedCount:1,duplicateCount:0,invalidCount:1,skippedCount:1});assert.equal(f.games.find(game=>game.title==='CSV Gig').earnedXp,300);
  await assert.rejects(f.vault.importLibraryGames({mode:'titles',content:Array(26).fill('Title').join('\n')}),/25/);
  const before=structuredClone(f.games);f.setRevoked(true);await assert.rejects(f.vault.importLibraryGames({mode:'json',content:'[{"title":"Blocked"}]'}),/session expired/);assert.deepEqual(f.games,before);f.setRevoked(false);f.setFail(true);await assert.rejects(f.vault.importLibraryGames({mode:'json',content:'[{"title":"Rollback"}]'}),/DB failure/);assert.deepEqual(f.games,before);
});

test('CSV export neutralizes formula cells while retaining quoting and safe allowlisted data',()=>{
  const {serializeLibraryBackup}=loader()('src/lib/library-backup.ts');
  const csv=serializeLibraryBackup([{title:'=HYPERLINK("evil")',notes:'@SUM(1,2)',platform:'PC',id:1,userId:'secret'}],'csv');assert(csv.includes('"\'=HYPERLINK(""evil"")"'));assert(csv.includes('"\'@SUM(1,2)"'));assert(!csv.includes('secret'));assert(!csv.split('\r\n')[0].includes('userId'));
});

test('import server action syncs only the authenticated owner and returns structured failures',async()=>{
  const calls=[];
  const actions=loader({'next/cache':{revalidatePath:path=>calls.push(['refresh',path])},'@/lib/library-vault':{importLibraryGames:async()=>({userId:'owner',counts:{importedCount:1,duplicateCount:0,invalidCount:1,skippedCount:1}}),getLibraryExport:async()=>{throw Error('private error');}},'@/lib/achievements':{syncAndGetAchievements:async id=>calls.push(['sync',id])},'@/lib/prisma':{},'@/lib/player':{},'@/lib/rawg':{},'@/lib/recommendations':{}})('src/app/actions.ts');
  assert.deepEqual(await actions.bulkImportGames({}),{importedCount:1,duplicateCount:0,invalidCount:1,skippedCount:1});assert.deepEqual(calls,[['sync','owner'],['refresh','/']]);const result=await actions.exportLibraryBackup('json');assert(result.error);assert(!result.error.includes('private'));
});
