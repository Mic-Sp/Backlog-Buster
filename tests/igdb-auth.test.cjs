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

async function configured(work){
 const before={id:process.env.TWITCH_CLIENT_ID,secret:process.env.TWITCH_CLIENT_SECRET};
 process.env.TWITCH_CLIENT_ID=' fixture-client ';process.env.TWITCH_CLIENT_SECRET=' fixture-secret ';
 try{return await work();}finally{for(const[key,value]of [['TWITCH_CLIENT_ID',before.id],['TWITCH_CLIENT_SECRET',before.secret]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
function fixture(initial=null,options={}){
 let row=structuredClone(initial),reads=0,posts=0,writes=0,deletes=0,transactions=0,failDb=false,sequence=Promise.resolve();
 const requests=[];
 const table={findUnique:async({where,select})=>{reads++;assert.deepEqual(where,{provider:'igdb'});assert.deepEqual(select,{accessToken:true,expiresAt:true});if(failDb)throw Error('database secret error');return structuredClone(row);},upsert:async({where,create,update,select})=>{assert.deepEqual(where,{provider:'igdb'});assert.deepEqual(select,{provider:true});assert.deepEqual(Object.keys(create).sort(),['provider','accessToken','expiresAt'].sort());assert.deepEqual(update,{accessToken:create.accessToken,expiresAt:create.expiresAt});writes++;row=structuredClone(create);return{provider:'igdb'};},deleteMany:async({where})=>{assert.deepEqual(Object.keys(where).sort(),['accessToken','provider']);assert.equal(where.provider,'igdb');deletes++;if(row?.accessToken===where.accessToken)row=null;return{count:1};}};
 const tx={$executeRaw:async(strings)=>assert.match(strings.join(''),/backlogbuster-oauth:igdb/),externalOAuthToken:table};
 const prisma={externalOAuthToken:table,$transaction:(work,settings)=>{assert.equal(settings.timeout,15000);assert.equal(settings.maxWait,5000);const run=sequence.then(async()=>{transactions++;const before=structuredClone(row);try{return await work(tx);}catch(error){row=before;throw error;}});sequence=run.catch(()=>{});return run;}};
 const mocks={'@/lib/prisma':{prisma}};
 if(!options.realFetch)mocks['@/lib/api-resilience']={resilientFetch:async(url,request)=>{posts++;requests.push({url,request});assert.equal(url,'https://id.twitch.tv/oauth2/token');assert(!url.includes('fixture-secret'));assert.equal(request.method,'POST');assert.equal(request.cache,'no-store');assert.equal(request.redirect,'error');assert.equal(request.headers['Content-Type'],'application/x-www-form-urlencoded');assert(request.signal instanceof AbortSignal);assert.deepEqual(Object.fromEntries(new URLSearchParams(request.body)),{client_id:'fixture-client',client_secret:'fixture-secret',grant_type:'client_credentials'});return options.exchange?options.exchange(posts,request):Response.json({access_token:`valid-token-${posts}`,expires_in:60*86400,token_type:'bearer'});}};
 const load=loader(mocks);
 return{auth:load('src/lib/igdb-auth.ts'),prisma,load,requests,setFailDb:value=>failDb=value,get row(){return row;},get reads(){return reads;},get posts(){return posts;},get writes(){return writes;},get deletes(){return deletes;},get transactions(){return transactions;}};
}

test('missing/blank credentials return unavailable without database, network, or request callback access',async()=>configured(async()=>{
 for(const[id,secret]of [['','fixture-secret'],['fixture-client',' '],['bad\nclient','fixture-secret']]){
  process.env.TWITCH_CLIENT_ID=id;process.env.TWITCH_CLIENT_SECRET=secret;const f=fixture();assert.equal(await f.auth.getIgdbAuth(),null);assert.equal(await f.auth.getIgdbHeaders(),null);assert.equal(await f.auth.withIgdbAuth(()=>assert.fail('No credentials')),null);assert.equal(f.reads,0);assert.equal(f.posts,0);
 }
}));

test('valid persisted tokens are reused, bursts share one read, and memory copies cannot corrupt expiry',async()=>configured(async()=>{
 const f=fixture({accessToken:'persisted-token',expiresAt:new Date(Date.now()+60*86400000)});
 const values=await Promise.all(Array.from({length:20},()=>f.auth.getIgdbAuth()));assert(values.every(value=>value.accessToken==='persisted-token'));assert.equal(f.reads,1);assert.equal(f.posts,0);assert.equal(f.transactions,0);
 values[0].expiresAt.setTime(0);values[0].accessToken='changed';assert.deepEqual(await f.auth.getIgdbHeaders(),{'Client-ID':'fixture-client',Authorization:'Bearer persisted-token'});assert.equal(f.reads,1);
}));

test('absent or expiring tokens renew once and persist the provider expiry exactly',async()=>configured(async()=>{
 const realNow=Date.now;const now=1800000000000;Date.now=()=>now;
 try{
  for(const initial of [null,{accessToken:'old-token',expiresAt:new Date(now+600000)},{accessToken:'expired-token',expiresAt:new Date(now-1)}]){
   const f=fixture(initial);const results=await Promise.all(Array.from({length:20},()=>f.auth.getIgdbAuth()));assert.equal(f.posts,1);assert.equal(f.writes,1);assert.equal(f.transactions,1);assert(results.every(value=>value.accessToken==='valid-token-1'));assert.equal(f.row.expiresAt.getTime(),now+60*86400000);assert.equal(f.row.provider,'igdb');
  }
 }finally{Date.now=realNow;}
}));

test('the shared database lock prevents token stampedes across independent server instances',async()=>configured(async()=>{
 const f=fixture();let posts=0;
 const mocks={'@/lib/prisma':{prisma:f.prisma},'@/lib/api-resilience':{resilientFetch:async()=>{posts++;await new Promise(resolve=>setTimeout(resolve,5));return Response.json({access_token:'shared-token',expires_in:5000000,token_type:'bearer'});}}};
 const a=loader(mocks)('src/lib/igdb-auth.ts'),b=loader(mocks)('src/lib/igdb-auth.ts');const values=await Promise.all([a.getIgdbAuth(),b.getIgdbAuth()]);assert.equal(posts,1);assert(values.every(value=>value.accessToken==='shared-token'));assert.equal(f.writes,1);
 const restarted=loader(mocks)('src/lib/igdb-auth.ts');assert.equal((await restarted.getIgdbAuth()).accessToken,'shared-token');assert.equal(posts,1);
}));

test('401 recovery refreshes once, delayed failures reuse the winner and a second 401 never loops',async()=>configured(async()=>{
 const f=fixture({accessToken:'rejected-token',expiresAt:new Date(Date.now()+5000000000)});const sent=[];
 const response=await f.auth.withIgdbAuth(async headers=>{sent.push(headers);return new Response(null,{status:headers.Authorization==='Bearer rejected-token'?401:200});});assert.equal(response.status,200);assert.equal(f.posts,1);assert.deepEqual(sent.map(h=>h.Authorization),['Bearer rejected-token','Bearer valid-token-1']);assert.equal(f.deletes,1);
 const fresh=await f.auth.refreshIgdbAuth('rejected-token');assert.equal(fresh.accessToken,'valid-token-1');assert.equal(f.posts,1);assert.equal(f.deletes,1);
 const always401=fixture({accessToken:'rejected-token',expiresAt:new Date(Date.now()+5000000000)});let calls=0;const final=await always401.auth.withIgdbAuth(async()=>{calls++;return new Response(null,{status:401});});assert.equal(final.status,401);assert.equal(calls,2);assert.equal(always401.posts,1);assert.equal(always401.row,null);
 const concurrent=fixture({accessToken:'rejected-token',expiresAt:new Date(Date.now()+5000000000)});const responses=await Promise.all(Array.from({length:10},()=>concurrent.auth.withIgdbAuth(async h=>new Response(null,{status:h.Authorization==='Bearer rejected-token'?401:200}))));assert(responses.every(r=>r.status===200));assert.equal(concurrent.posts,1);
}));

test('provider errors, malformed tokens, timeouts and database failures fail closed without throwing',async()=>configured(async()=>{
 for(const exchange of [async()=>new Response(null,{status:401}),async()=>new Response(null,{status:503}),async()=>{throw Error('secret provider detail');},async()=>{throw new DOMException('Timed out','TimeoutError');},...[
  {access_token:'bad\r\ntoken',expires_in:5000000,token_type:'bearer'},
  {access_token:'token',expires_in:'5000000',token_type:'bearer'},
  {access_token:'token',expires_in:-1,token_type:'bearer'},
  {access_token:'token',expires_in:Infinity,token_type:'bearer'},
  {access_token:'token',expires_in:300,token_type:'bearer'},
  {access_token:'token',expires_in:5000000,token_type:'not-bearer'},null,
 ].map(value=>async()=>Response.json(value))]){
  const f=fixture(null,{exchange});assert.equal(await f.auth.getIgdbAuth(),null);assert.equal(f.writes,0);
 }
 const f=fixture();f.setFailDb(true);assert.equal(await f.auth.getIgdbAuth(),null);assert.equal(f.posts,0);
 const unavailable=fixture({accessToken:'rejected',expiresAt:new Date(Date.now()+5000000000)},{exchange:async()=>{throw Error('unavailable');}});assert.equal(await unavailable.auth.refreshIgdbAuth('rejected'),null);assert.equal(unavailable.row,null);
 const non401=fixture({accessToken:'valid',expiresAt:new Date(Date.now()+5000000000)});assert.equal((await non401.auth.withIgdbAuth(async()=>new Response(null,{status:403}))).status,403);assert.equal(non401.posts,0);
}));

test('Twitch exchange uses bounded 429/503 retries, honors Retry-After and recovers after failures',async()=>configured(async()=>{
 const originalFetch=global.fetch,originalRandom=Math.random;Math.random=()=>0;let calls=0;
 try{
  global.fetch=async()=>{calls++;return calls<3?new Response(null,{status:calls===1?429:503}):Response.json({access_token:'retry-token',expires_in:5000000,token_type:'bearer'});};
  const f=fixture(null,{realFetch:true});assert.equal((await f.auth.getIgdbAuth()).accessToken,'retry-token');assert.equal(calls,3);
  calls=0;global.fetch=async()=>{calls++;return new Response(null,{status:429,headers:{'Retry-After':'120'}});};const limited=fixture(null,{realFetch:true});assert.equal(await limited.auth.getIgdbAuth(),null);assert.equal(await limited.auth.getIgdbAuth(),null);assert.equal(calls,1);assert.equal(limited.writes,0);
  const recovering=fixture(null,{exchange:async n=>n===1?new Response(null,{status:401}):Response.json({access_token:'recovered-token',expires_in:5000000,token_type:'bearer'})});assert.equal(await recovering.auth.getIgdbAuth(),null);assert.equal((await recovering.auth.getIgdbAuth()).accessToken,'recovered-token');
 }finally{global.fetch=originalFetch;Math.random=originalRandom;}
}));
