/* eslint-disable @typescript-eslint/no-require-imports -- Mock database and signed-cookie boundaries; never alter live credentials. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.resolve(__dirname, '..', file), instance = new Module(filename, module);
    instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = name => name === 'server-only' ? {} : Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : original(name);
    instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
    cache.set(file, instance.exports); return instance.exports;
  }
  return load;
}
const form = values => { const data=new FormData();for(const [key,value] of Object.entries(values))data.set(key,value);return data; };

test('credential validation trims email, preserves exact passwords, rejects blanks/no-op/invalid changes', () => {
  const {readCredentialChanges}=loader({'@/lib/prisma':{},'@/lib/auth-session':{}})('src/lib/account-security.ts');
  const base={currentPassword:' exact old password ',newEmail:'  New@Example.COM ',newPassword:' exact new password '};
  assert.deepEqual(readCredentialChanges(form(base),'old@example.com'),{currentPassword:base.currentPassword,newEmail:'new@example.com',newPassword:base.newPassword});
  assert.equal(readCredentialChanges(form({...base,newEmail:'  '}),'old@example.com').newEmail,null);
  assert.equal(readCredentialChanges(form({...base,newPassword:''}),'old@example.com').newPassword,'');
  for(const values of [{currentPassword:' '},{currentPassword:'short'},{newEmail:'bad'},{newEmail:'a'.repeat(255)+'@test.com'},{newPassword:'short'},{newPassword:' '.repeat(8)},{newPassword:'x'.repeat(129)},{newEmail:' OLD@EXAMPLE.COM ',newPassword:''}])assert.throws(()=>readCredentialChanges(form({...base,...values}),'old@example.com'));
});

test('security actions require a live session, verify current password, enforce rate/ownership and rotate atomically', async () => {
  let token='session-hash', wrong=false, taken=false, revoked=false, stale=false, race=false, quota=0;
  let verifies=0, hashes=0, rotations=0, writes=0, refreshes=0;
  let player={id:'owner-id',email:'owner@example.com',passwordHash:'private-hash',handle:'owner',createdAt:new Date('2020-01-01Z')};
  const expiry=new Date(Date.now()+60000);
  const tx={
    $executeRaw:async()=>{},
    playerSession:{findUnique:async({where})=>{assert.equal(where.userId,'owner-id');assert.equal(where.tokenHash,'session-hash');return revoked?null:{tokenHash:token};}},
    player:{findFirst:async({where})=>{assert.equal(where.id.not,'owner-id');assert.equal(where.email.mode,'insensitive');return taken?{id:'another'}:null;},
      update:async({where,data})=>{assert.equal(where.id,'owner-id');assert.equal(where.passwordHash,player.passwordHash);if(stale)throw{code:'P2025'};if(race)throw{code:'P2002'};writes++;player={...player,...data};return{id:player.id};}},
  };
  const prisma={playerSession:{findUnique:async({where,select})=>{assert(where.expiresAt.gt instanceof Date);assert.equal(select.player.select.passwordHash,true);return token?{expiresAt:expiry,player:{...player}}:null;}},
    $queryRaw:async(_parts,...values)=>{assert.match(values[0],/^[a-f0-9]{64}$/);return[{attempts:quota||1,resetsAt:new Date(Date.now()+30000)}];}};
  const load=loader({'next/cache':{revalidatePath:()=>{refreshes++;}},'@/lib/prisma':{prisma},'@/lib/auth-session':{
    readSessionHash:async()=>token,getSessionSigningKey:async()=>Buffer.alloc(32,1),
    createPlayerSession:async(id,work)=>{assert.equal(id,'owner-id');const before={...player};try{await work(tx);}catch(error){player=before;throw error;}rotations++;return{expiresAt:new Date(Date.now()+7*86400000)};},
  },'@/lib/auth-crypto':{verifyPassword:async password=>{verifies++;assert.equal(password,' exact old password ');return !wrong;},hashPassword:async password=>{hashes++;assert.equal(password,' exact new password ');return'new-salted-hash';}}});
  const {getAccountSecuritySummary,updateAccountCredentials}=load('src/app/security-actions.ts');
  let result=await getAccountSecuritySummary();assert.equal(result.email,'owner@example.com');for(const key of ['passwordHash','tokenHash','id'])assert(!(key in result));
  token=null;assert.match((await getAccountSecuritySummary()).error,/Sign in/);assert.match((await updateAccountCredentials(form({}))).error,/Sign in/);token='session-hash';
  const input={currentPassword:' exact old password ',newEmail:'new@example.com',newPassword:' exact new password '};
  wrong=true;assert.equal((await updateAccountCredentials(form(input))).error,'Current password is incorrect.');assert.equal(writes,0);assert.equal(rotations,0);assert.equal(hashes,0);
  wrong=false;quota=6;result=await updateAccountCredentials(form(input));assert.equal(result.status,429);assert(result.retryAfterSeconds>0);assert.equal(verifies,1);quota=0;
  taken=true;assert.match((await updateAccountCredentials(form(input))).error,/email address is already in use/);assert.equal(writes,0);taken=false;
  revoked=true;assert.match((await updateAccountCredentials(form(input))).error,/session expired/);assert.equal(writes,0);revoked=false;
  stale=true;assert.match((await updateAccountCredentials(form(input))).error,/another session/);stale=false;
  race=true;assert.match((await updateAccountCredentials(form(input))).error,/email address is already in use/);race=false;
  result=await updateAccountCredentials(form({...input,userId:'victim-id'}));assert.equal(result.success,true);assert.equal(result.message,'SECURITY CREDENTIALS UPDATED // ARCHIVE LOCKED');assert.equal(player.email,'new@example.com');assert.equal(player.passwordHash,'new-salted-hash');assert.equal(rotations,1);assert.equal(refreshes,1);assert.equal(writes,1);assert(!JSON.stringify(result).includes('hash'));
  result=await updateAccountCredentials(form({...input,newEmail:'second@example.com',newPassword:''}));assert.equal(result.success,true);assert.equal(player.passwordHash,'new-salted-hash');assert.equal(rotations,2);
});

test('session helper commits credential changes with rotation and sets only a signed HTTP-only cookie', async () => {
  let jar='',cookieWrites=0,fail=false;
  const sessions=new Map();let email='old@example.com';
  const tx={playerSession:{deleteMany:async()=>{sessions.clear();},create:async({data})=>{sessions.set(data.tokenHash,data);}},player:{update:async()=>{email='new@example.com';if(fail)throw Error('conflict');}}};
  const prisma={$queryRaw:async()=>[{value:'01'.repeat(32)}],$transaction:async work=>{const before=new Map(sessions),oldEmail=email;try{return await work(tx);}catch(error){email=oldEmail;sessions.clear();for(const [key,value]of before)sessions.set(key,value);throw error;}}};
  const load=loader({'@/lib/prisma':{prisma},'next/headers':{cookies:async()=>({get:()=>jar?{value:jar}:undefined,set:(_name,value,options)=>{cookieWrites++;jar=value;assert.equal(options.httpOnly,true);assert.equal(options.sameSite,'lax');assert.equal(options.path,'/');}})}});
  const crypto=load('src/lib/auth-crypto.ts'),auth=load('src/lib/auth-session.ts');
  const token='a'.repeat(43);jar=crypto.signSessionToken(token,await auth.getSessionSigningKey());const previous=crypto.sessionTokenHash(token);sessions.set(previous,{tokenHash:previous,userId:'owner-id'});
  fail=true;await assert.rejects(auth.createPlayerSession('owner-id',async t=>{await t.player.update();}));assert.equal(cookieWrites,0);assert.equal(email,'old@example.com');assert(sessions.has(previous));
  fail=false;const refreshed=await auth.createPlayerSession('owner-id',async t=>{await t.player.update();});assert(refreshed.expiresAt instanceof Date);assert.equal(email,'new@example.com');assert.equal(cookieWrites,1);assert(!sessions.has(previous));const next=crypto.verifySessionToken(jar,await auth.getSessionSigningKey());assert(sessions.has(next));assert.equal(sessions.size,1);
});
