/* eslint-disable @typescript-eslint/no-require-imports -- Exercise actual backup parsing and transactional list restore. */
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,fields}=require('./helpers/custom-list-fixture.cjs');
const {loader}=require('./helpers/social-fixture.cjs');
const refs=[{title:'Game 3',platform:'PC'},{title:'Game 1',platform:'PC'}];
const backup={version:2,games:refs,customLists:[{...fields,games:refs}]};
test('versioned JSON and legacy JSON/CSV retain compatible game parsing and validate list bounds',()=>{
 const f=fixture(),parse=f.load('src/lib/custom-list-backup.ts').parseCustomListBackup,records=f.load('src/lib/library-import.ts').parseBackupRecords;
 assert.deepEqual(parse('[{"title":"Legacy"}]'),[]);assert.equal(records('[{"title":"Legacy"}]','json').length,1);
 assert.deepEqual(records(JSON.stringify(backup),'json'),refs);assert.deepEqual(parse(JSON.stringify(backup))[0].games,refs);
 assert.deepEqual(records(JSON.stringify({...backup,games:[],customLists:[{...fields,games:[]}]}),'json'),[]);
 for(const value of [{...backup,version:99},{...backup,customLists:Array(21).fill(backup.customLists[0])},{...backup,customLists:[{...fields,games:Array(51).fill(refs[0])}]},{...backup,customLists:[{...fields,isPublic:'true',games:refs}]},{...backup,customLists:[{...fields,games:[{title:' ',platform:'PC'}]}]}])assert.throws(()=>parse(JSON.stringify(value)));
});
test('list restore resolves only owner games, preserves flags/order and skips identical repeat imports',async()=>{
 const f=fixture(),parse=f.load('src/lib/custom-list-backup.ts').parseCustomListBackup;
 const lists=parse(JSON.stringify(backup));
 await f.service.restoreCustomLists(f.tx,'owner',lists);
 let [list]=await f.service.readCustomLists('owner');assert.deepEqual(list.gameIds,[3,1]);assert.equal(list.isPublic,false);assert.equal(list.isRanked,true);
 await f.service.restoreCustomLists(f.tx,'owner',lists);assert.equal(f.lists.length,1);
 await assert.rejects(f.service.restoreCustomLists(f.tx,'owner',[{...fields,title:'Foreign',games:[{title:'FOREIGN',platform:'PC'}]}]),/missing or invalid/);
 assert.equal(f.lists.length,1);
});
test('restore caps roll back the entire transaction and portable exports contain no private identifiers',async()=>{
 const f=fixture();for(let i=0;i<19;i++)await f.service.mutateCustomList({type:'create',...fields,title:`Shelf ${i}`});
 await assert.rejects(f.prisma.$transaction(tx=>f.service.restoreCustomLists(tx,'owner',[{...fields,title:'One',games:[]},{...fields,title:'Two',games:[]}])),/20-list/);assert.equal(f.lists.length,19);
 const prisma = {
   playerSession: {findUnique:async()=>({player:{id:'owner',handle:'owner',operatorName:'Owner'}})},
   game: {findMany:async()=>refs},
   customList: {findMany:async({where,select})=>{assert.deepEqual(where,{userId:'owner'});assert(!select.id&&!select.userId);return[{...fields,entries:refs.map(game=>({game}))}];}},
 };
 const exports=loader({'@/lib/prisma':{prisma},'@/lib/auth-session':{readSessionHash:async()=>'token'}})('src/lib/library-vault.ts');
 const {content}=await exports.getLibraryExport('json'),data=JSON.parse(content);
 assert.equal(data.version,2);assert.deepEqual(data.customLists,[{...fields,games:refs}]);assert.equal(data.games.length,2);assert(!content.includes('userId')&&!content.includes('tokenHash'));
});


test('vault restores lists transactionally onto existing owner games and handles merged duplicate copies',async()=>{
 const f=fixture();
 const tx={...f.tx,$executeRaw:async(parts,key)=>{if(key==='backlogbuster-deck:owner')return 1;return f.tx.$executeRaw(parts,key);},playerSession:{findUnique:async()=>({tokenHash:'token'})}};
 const prisma={...f.prisma,playerSession:{findUnique:async()=>({player:{id:'owner',handle:'owner',operatorName:'Owner'}})},$transaction:work=>f.prisma.$transaction(()=>work(tx))};
 const vault=loader({'@/lib/prisma':{prisma},'@/lib/auth-session':{readSessionHash:async()=>'token'}})('src/lib/library-vault.ts');
 const duplicateBackup={...backup,customLists:[{...fields,isPublic:true,games:[refs[0],refs[1],refs[0]]}]};
 const result=await vault.importLibraryGames({mode:'json',content:JSON.stringify(duplicateBackup)});
 assert.equal(result.counts.restoredListCount,1);assert.equal(result.counts.importedCount,0);assert.equal(result.counts.duplicateCount,2);
 const [list]=await f.service.readCustomLists('owner');assert.deepEqual(list.gameIds,[3,1]);assert.equal(list.isPublic,true);
 await vault.importLibraryGames({mode:'json',content:JSON.stringify(duplicateBackup)});assert.equal(f.lists.length,1);
 await assert.rejects(vault.importLibraryGames({mode:'json',content:JSON.stringify({...backup,customLists:[{...fields,title:'Missing',games:[{title:'Absent',platform:'PC'}]}]})}),/missing or invalid/);assert.equal(f.lists.length,1);
});
