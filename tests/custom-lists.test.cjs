/* eslint-disable @typescript-eslint/no-require-imports -- Exercise production DAL through transactional fixtures. */
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture } = require('./helpers/custom-lists-fixture.cjs');
const { fixture: socialFixture, loader } = require('./helpers/social-fixture.cjs');
const details = extra => ({ title: 'Weekend picks', description: null, isRanked: false, isPublic: false, ...extra });

test('list CRUD requires live sessions, scopes every write to the owner, and refreshes dossier/workspace', async () => {
  const f = fixture(), { id } = await f.actions.createCustomList(details({ title: '  RPGs  ', userId: 'other', id: 'spoof' }));
  assert.equal(f.lists[0].userId, 'owner'); assert.equal(f.lists[0].title, 'RPGs'); assert.notEqual(id, 'spoof');
  await f.actions.updateCustomList(id, details({ description: 'Curated', isRanked: true, isPublic: true }));
  assert.equal(f.lists[0].isRanked, true); assert.equal(f.lists[0].isPublic, true);
  f.lists.push({ id: 'foreign', userId: 'other', ...details() });
  assert((await f.actions.updateCustomList('foreign', details())).error);
  assert((await f.actions.deleteCustomList('foreign')).error);
  await f.actions.updateCustomListItems(id, { type: 'add', gameId: 1 });
  const read = await f.service.readCustomLists('owner'); assert.deepEqual(read[0].gameIds, [1]); assert(!('userId' in read[0]));
  await f.actions.deleteCustomList(id); assert.equal(f.entries.length, 0); assert.equal(f.games.length, 3);
  assert(f.refreshes.some(args => args[0] === '/dossier/[handle]' && args[1] === 'page'));
  f.revoke(); assert((await f.actions.createCustomList(details())).error); assert.equal(f.lists.length, 1);
});

test('membership is owner-only, unique, ordered deterministically, and atomically replaceable', async () => {
  const f = fixture(), { id } = await f.service.createList(details({ isRanked: true }));
  const change = input => f.service.changeListItems(id, input);
  await assert.rejects(change({ type: 'add', gameId: 3 }), /own library/);
  await change({ type: 'add', gameId: 1 }); await change({ type: 'add', gameId: 1 }); await change({ type: 'add', gameId: 2 });
  assert.deepEqual(f.entries.map(row=>[row.gameId,row.position]), [[1,1],[2,2]]);
  await change({ type: 'move', gameId: 2, direction: -1 }); assert.deepEqual(f.entries.map(row=>row.gameId), [2,1]);
  await change({ type: 'move', gameId: 2, direction: -1 }); assert.deepEqual(f.entries.map(row=>row.gameId), [2,1]);
  await assert.rejects(change({ type: 'reorder', gameIds: [1] }), /every current/);
  await assert.rejects(change({ type: 'reorder', gameIds: [1,3] }), /every current/);
  await change({ type: 'reorder', gameIds: [1,2] }); assert.deepEqual(f.entries.map(row=>row.gameId), [1,2]);
  await change({ type: 'remove', gameId: 1 }); assert.deepEqual(f.entries.map(row=>[row.gameId,row.position]), [[2,1]]);
  await change({ type: 'add', gameId: 1 }); const before = structuredClone(f.entries);
  f.failEntries(); const result = await f.actions.updateCustomListItems(id, { type: 'move', gameId: 1, direction: -1 });
  assert(result.error && !result.error.includes('PRIVATE_DATABASE')); assert.deepEqual(f.entries, before);
});

test('bounds, malformed values, and concurrent writes cannot exceed list/game caps', async () => {
  const f = fixture();
  for (const bad of [null, [], details({ title: '' }), details({ title: 'x'.repeat(81) }), details({ title: 'bad\u0000' }), details({ description: 'x'.repeat(281) }), details({ isPublic: 'true' }), details({ isRanked: 1 })]) assert((await f.actions.createCustomList(bad)).error);
  await Promise.all(Array.from({length:19},()=>f.service.createList(details())));
  const results = await Promise.all([f.actions.createCustomList(details()), f.actions.createCustomList(details())]);
  assert.equal(results.filter(row=>row.error).length, 1); assert.equal(f.lists.length, 20);
  const id = f.lists[0].id;
  for(let gameId=4;gameId<=52;gameId++) f.games.push({id:gameId,userId:'owner',title:`Game ${gameId}`,platform:'PC'});
  for(const gameId of [1,2,...Array.from({length:47},(_,i)=>i+4)]) await f.service.changeListItems(id,{type:'add',gameId});
  const adds=await Promise.all([f.actions.updateCustomListItems(id,{type:'add',gameId:51}),f.actions.updateCustomListItems(id,{type:'add',gameId:52})]);
  assert.equal(adds.filter(row=>row.error).length,1); assert.equal(f.entries.length,50);
  for(const input of [null, {type:'wat',gameId:1}, {type:'add',gameId:'1'}, {type:'move',gameId:1,direction:0}, {type:'add',gameId:2147483648}, {type:'reorder',gameIds:[1,1]}, {type:'reorder',gameIds:Array(51).fill(1)}]) assert((await f.actions.updateCustomListItems(id,input)).error);
  f.onLock(()=>f.revoke()); assert((await f.actions.updateCustomList(id,details())).error);
  assert(f.locks.every(key=>key==='backlogbuster-deck:owner'));
});

test('public shelves inherit profile privacy and reciprocal blocks; projections exclude private fields', async () => {
  const f = socialFixture();
  f.players[0].customLists = [{id:'shelf',title:'Picks',description:'A collection',isRanked:true,entries:[{game:{title:'Game',platform:'PC',coverUrl:null,notes:'SECRET_NOTES',review:'SECRET_SPOILER'}}]}];
  const read = viewer => f.as(viewer).load('src/lib/public-dossier.ts').getPublicDossier('alice-handle');
  for(const visibility of ['public','friends','private']) {
    f.players[0].profileVisibility=visibility;
    for(const status of ['pending','accepted','blocked']) {
      f.setRelationship({playerLowId:'alice',playerHighId:'bob',status,requestedById:'alice',blockedByLow:status==='blocked',blockedByHigh:false});
      for(const viewer of [null,'alice','bob','carol']) {
        const expected=viewer==='alice'||(status!=='blocked'||viewer!=='bob')&&(visibility==='public'||visibility==='friends'&&status==='accepted'&&viewer==='bob');
        const dossier=await read(viewer); assert.equal(Boolean(dossier),expected,`${visibility}/${status}/${viewer}`);
        if(dossier) { assert.equal(dossier.customLists.length,1); assert(!JSON.stringify(dossier.customLists).includes('SECRET')); }
      }
    }
  }
  const query=f.queries.find(([kind])=>kind==='profile')[1].select.customLists;
  assert.deepEqual(query.where,{isPublic:true});assert.equal(query.take,20);assert.equal(query.select.entries.take,50);
  assert.deepEqual(query.select.entries.select.game.select,{title:true,platform:true,coverUrl:true});
});

test('JSON archives preserve ranking, visibility, order and empty shelves without exporting database IDs', async () => {
  const f=fixture(), backup=f.load('src/lib/library-backup.ts'), imports=f.load('src/lib/library-import.ts');
  const {id}=await f.service.createList(details({isRanked:true,isPublic:true}));
  await f.service.changeListItems(id,{type:'add',gameId:2});await f.service.changeListItems(id,{type:'add',gameId:1});
  await f.service.createList(details({title:'Empty'}));
  const archive=backup.serializeLibraryArchive(f.games.filter(game=>game.userId==='owner'),await f.service.readCustomLists('owner'));
  assert(!archive.includes('userId'));assert(!archive.includes('"id"'));assert.deepEqual(imports.parseArchiveLists(archive)[0].gameIndexes,[1,0]);
  assert.equal(imports.parseArchiveLists(archive)[1].isPublic,false);assert.equal(imports.parseBackupRecords(archive,'json').length,2);
  assert.equal(imports.parseArchiveLists('[{"title":"Legacy"}]'),null);
  const parsed=JSON.parse(archive);
  for(const indexes of [[2],[-1],[0,0],['0'],Array(51).fill(0)]) assert.throws(()=>imports.parseArchiveLists(JSON.stringify({...parsed,customLists:[{...parsed.customLists[0],gameIndexes:indexes}]})));
  assert.throws(()=>imports.parseArchiveLists(JSON.stringify({...parsed,version:999})),/version/);
  const emptyArchive=backup.serializeLibraryArchive([], [{id:'empty',...details(),gameIds:[]}]);assert.deepEqual(imports.parseBackupRecords(emptyArchive,'json'),[]);
});

test('archive restore remaps ownership, skips exact duplicates, and rolls back on list bounds', async () => {
  const f=fixture(), vault=f.load('src/lib/library-vault.ts');
  const content=JSON.stringify({format:'backlog-buster',version:2,games:[{title:'Beta',platform:'PC'},{title:'New',platform:'PC',userId:'other'}],customLists:[{...details({isRanked:true,isPublic:true}),gameIndexes:[1,0]}]});
  const result=await vault.importLibraryGames({mode:'json',content});assert.equal(result.counts.restoredListCount,1);
  const newGame=f.games.find(game=>game.title==='New');assert.equal(newGame.userId,'owner');assert.deepEqual(f.entries.map(entry=>entry.gameId),[newGame.id,2]);
  assert.equal((await vault.importLibraryGames({mode:'json',content})).counts.restoredListCount,0);
  while(f.lists.length<20) await f.service.createList(details());
  const before=structuredClone(f.games);
  const overflow=JSON.parse(content);overflow.games[1].title='Should roll back';overflow.customLists[0].title='No room';
  await assert.rejects(vault.importLibraryGames({mode:'json',content:JSON.stringify(overflow)}),/exceed 20/);assert.deepEqual(f.games,before);
});
