/* eslint-disable @typescript-eslint/no-require-imports -- Exercise actual services with isolated sessions and transactional persistence. */
const test = require('node:test'), assert = require('node:assert/strict');
const {fixture,fields}=require('./helpers/custom-list-fixture.cjs');
const create=f=>f.service.mutateCustomList({type:'create',...fields});
const command=(type,list,extra={})=>({type,id:list.id,revision:list.revision,...extra});

test('list CRUD allowlists fields, scopes ownership, and cascades entries without deleting games',async()=>{
 const f=fixture();let {list}=await f.action({type:'create',...fields,title:'  Weekend queue  ',userId:'other',revision:999});
 assert.equal(list.title,'Weekend queue');assert.equal(list.revision,0);assert.equal(f.lists[0].userId,'owner');assert(!('userId'in list));
 ({list}=await f.action(command('update',list,{...fields,title:'Best of all time',isPublic:true,isRanked:false})));
 assert.equal(list.title,'Best of all time');assert.equal(list.isPublic,true);assert.equal(list.isRanked,false);
 ({list}=await f.action(command('add',list,{gameId:1})));
 const games=structuredClone(f.games);assert.equal(f.entries.length,1);
 assert.deepEqual(await f.action(command('delete',list)),{list:null});assert.equal(f.lists.length,0);assert.equal(f.entries.length,0);assert.deepEqual(f.games,games);
 assert(f.revalidations.some(args=>args[0]==='/dossier/[handle]'&&args[1]==='page'));
});
test('add/remove/reorder preserve exact deterministic membership and compact ordering',async()=>{
 const f=fixture();let {list}=await create(f);
 for(const gameId of [3,1,2])({list}=await f.service.mutateCustomList(command('add',list,{gameId})));
 assert.deepEqual(list.gameIds,[3,1,2]);
 ({list}=await f.service.mutateCustomList(command('reorder',list,{gameIds:[2,3,1]})));
 assert.deepEqual(list.gameIds,[2,3,1]);assert.deepEqual(f.entries.map(entry=>entry.position),[1,2,3]);
 await assert.rejects(f.service.mutateCustomList(command('reorder',list,{gameIds:[1,2]})),/contents changed/);
 await assert.rejects(f.service.mutateCustomList(command('reorder',list,{gameIds:[2,3,100]})),/contents changed/);
 await assert.rejects(f.service.mutateCustomList(command('add',list,{gameId:2})),/already/);
 ({list}=await f.service.mutateCustomList(command('remove',list,{gameId:3})));
 assert.deepEqual(list.gameIds,[2,1]);assert.deepEqual(f.entries.map(entry=>entry.position),[1,2]);
 await assert.rejects(f.service.mutateCustomList(command('remove',list,{gameId:3})),/no longer/);
});
test('session, registered-player checks and foreign IDs prevent unauthorized writes',async()=>{
 const f=fixture();f.setToken(null);await assert.rejects(create(f),/Sign in/);assert.equal(f.lists.length,0);f.setToken('token');
 let {list}=await create(f);
 await assert.rejects(f.service.mutateCustomList(command('add',list,{gameId:100})),/own library/);
 for(const type of ['update','delete','add','remove','reorder'])await assert.rejects(f.service.mutateCustomList({type,id:'someone-elses-list',revision:0,...(type==='update'?fields:{}),gameId:1,gameIds:[]}),/no longer available/);
 f.onLock(()=>f.revoke());await assert.rejects(f.service.mutateCustomList(command('update',list,fields)),/Sign in/);assert.equal(f.lists[0].revision,0);
});
test('20-list and 50-game caps include concurrent creates and stale revisions',async()=>{
 const f=fixture();for(let i=0;i<19;i++)await create(f);
 const results=await Promise.allSettled([create(f),create(f)]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(f.lists.length,20);
 let list=(await f.service.readCustomLists('owner'))[0];
 for(let gameId=1;gameId<=50;gameId++)({list}=await f.service.mutateCustomList(command('add',list,{gameId})));
 await assert.rejects(f.service.mutateCustomList(command('add',list,{gameId:51})),/50 games/);assert.equal(list.gameIds.length,50);
 const writes=await Promise.allSettled([f.service.mutateCustomList(command('remove',list,{gameId:1})),f.service.mutateCustomList(command('remove',list,{gameId:2}))]);
 assert.equal(writes.filter(result=>result.status==='fulfilled').length,1);assert.match(writes.find(result=>result.status==='rejected').reason.message,/another tab/);
});
test('strict validation rejects malformed values before writing or reading sessions',async()=>{
 const f=fixture();const parse=f.load('src/lib/custom-list-validation.ts').parseCustomListCommand;
 for(const value of [null,[],{}, {...fields,type:'create',title:' '},{...fields,type:'create',title:'a'.repeat(81)},{...fields,type:'create',description:'a'.repeat(281)},{...fields,type:'create',isPublic:'true'},{type:'delete',id:'../x',revision:0},{type:'delete',id:'x',revision:-1},{type:'add',id:'x',revision:0,gameId:2147483648},{type:'add',id:'x',revision:0,gameId:'1'},{type:'reorder',id:'x',revision:0,gameIds:[1,1]},{type:'reorder',id:'x',revision:0,gameIds:Array.from({length:51},(_,i)=>i+1)}])assert.throws(()=>parse(value));
 assert.equal(parse({type:'create',...fields,description:' '}).description,null);assert.equal(f.locks.length,0);
});
test('failed ordering writes roll back, and game deletion retains remaining relative order',async()=>{
 const f=fixture();let {list}=await create(f);for(const gameId of [1,2,3])({list}=await f.service.mutateCustomList(command('add',list,{gameId})));
 const before=structuredClone(f.entries);f.failEntries();await assert.rejects(f.service.mutateCustomList(command('reorder',list,{gameIds:[3,2,1]})),/PRIVATE_DB_ERROR/);assert.deepEqual(f.entries,before);
 f.deleteGame(2);const [read]=await f.service.readCustomLists('owner');assert.deepEqual(read.gameIds,[1,3]);assert.equal(read.revision,list.revision);
 const failed=await f.action(command('add',read,{gameId:4}));assert(failed.error);assert(!failed.error.includes('PRIVATE_DB_ERROR'));
});
