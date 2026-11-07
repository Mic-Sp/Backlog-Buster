/* eslint-disable @typescript-eslint/no-require-imports -- Public-query privacy checks use isolated database mocks. */
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

test('public dossier only queries public fields, normalizes handles, and returns summaries without secrets', async () => {
  let lookups=0, absent=false, selections=[2,null,1];
  const profile={id:'DO_NOT_EXPOSE_PLAYER_ID',email:'DO_NOT_EXPOSE_EMAIL',passwordHash:'DO_NOT_EXPOSE_HASH',sessions:['DO_NOT_EXPOSE_SESSION'],operatorName:'Ghost',handle:'ghost-runner',profileVisibility:'public',tagline:'One more gig.',neonAccent:'GOLD',avatarUrl:'preset:kitsune',
    games:[{status:'Completed',lengthHours:20,hoursPlayed:0,rating:5,earnedXp:400},{status:'Completed',lengthHours:30,hoursPlayed:40,rating:5,earnedXp:800},{status:'Playing',lengthHours:10,hoursPlayed:3,rating:null,earnedXp:0},{status:'Backlog',lengthHours:100,hoursPlayed:99,rating:null,earnedXp:0},{status:'Flatlined',lengthHours:10,hoursPlayed:2,rating:3,earnedXp:0}],
    userAchievements:[{achievementKey:'first-blood',xpAwarded:100,unlockedAt:new Date('2026-01-01Z')}],
  };
  const inspect = select => {const text=JSON.stringify(select);for(const field of ['email','passwordHash','sessions','notes','tokenHash'])assert(!text.includes(`"${field}"`),field);};
  const prisma={player:{findFirst:async ({where,select})=>{lookups++;inspect(select);assert.deepEqual(where.handle,{equals:'ghost-runner',mode:'insensitive'});return absent?null:{...profile,featuredTrophyIds:selections};}},game:{findMany:async ({where,select,take})=>{inspect(select);assert.equal(take,3);assert.equal(where.player.handle.equals,'ghost-runner');if(where.id){assert.equal(where.status,undefined);assert.equal(where.rating,undefined);assert.deepEqual(where.id.in,selections.filter(id=>typeof id==='number'));}else{assert.equal(where.status,'Completed');assert.equal(where.rating,5);}return[{id:1,title:'Chosen Trophy',platform:'PC',coverUrl:'https://cdn.example/one.png',earnedXp:400,notes:'DO_NOT_EXPOSE_NOTES'}];}}};
  const load=loader({'@/lib/prisma':{prisma},'@/lib/player':{getOptionalAuthenticatedPlayerId:async()=>null,getCurrentPlayerId:()=>{throw Error('Public visitors cannot use the local archive identity');}},'@/lib/dossier-artwork':{fetchDossierArtwork:async()=>{throw Error('offline');}}});
  const {getPublicDossier,getPublicDossierArtwork}=load('src/lib/public-dossier.ts');
  for(const value of ['', ' ', undefined, 'not/valid', '%ZZ']) assert.equal(await getPublicDossier(value),null);assert.equal(lookups,0);
  const dossier=await getPublicDossier('%20GHOST-RUNNER%20');
  const json=JSON.stringify(dossier);assert(!json.includes('DO_NOT_EXPOSE'));assert(!json.includes('profile'));assert.equal(dossier.identity.handle,'ghost-runner');assert.deepEqual(dossier.card.counts,{Backlog:1,Playing:1,Completed:2,Flatlined:1});assert.equal(dossier.card.activeHours,65);assert.equal(dossier.card.completionRate,40);assert.equal(dossier.card.totalXp,1300);assert.equal(dossier.card.level,3);assert.equal(dossier.card.avgRating,13/3);assert.equal(dossier.card.achievements.filter(a=>a.unlocked).length,1);assert.deepEqual(dossier.identity.showcase,[null,null,1]);
  const offline=await getPublicDossierArtwork(dossier);assert.deepEqual(offline,{'https://cdn.example/one.png':null});
  selections=[null,null,null];const empty=await getPublicDossier('ghost-runner');assert.deepEqual(empty.card.trophies.map(game=>game.id),[1]);assert.deepEqual(empty.identity.showcase,[null,null,null]);
  absent=true;assert.equal(await getPublicDossier('ghost-runner'),null);
});

test('public artwork fetches only selected trophy and avatar URLs and embeds safe image bytes', async () => {
  const urls=[];
  const load=loader({'@/lib/prisma':{},'@/lib/player':{},'@/lib/dossier-artwork':{fetchDossierArtwork:async url=>{urls.push(url);return{bytes:Buffer.from('image-fixture'),contentType:'image/png'};}}});
  const {getPublicDossierArtwork}=load('src/lib/public-dossier.ts');
  const artwork=await getPublicDossierArtwork({identity:{avatarUrl:'https://cdn.example/avatar.png'},card:{trophies:[{id:1,coverUrl:'https://cdn.example/one.png'},{id:1,coverUrl:'https://cdn.example/one.png'},{id:2,coverUrl:null}]}});
  assert.deepEqual(urls,['https://cdn.example/avatar.png','https://cdn.example/one.png']);for(const value of Object.values(artwork))assert.match(value,/^data:image\/png;base64,/);
});


test('share metadata contains public identity, level and cleared gigs without account secrets', () => {
  const { buildDossierMetadata } = loader()('src/lib/dossier-metadata.ts');
  const metadata = buildDossierMetadata({ identity: { callsign: 'Ghost', handle: 'ghost-runner' }, card: { level: 6, totalXp: 7000, counts: { Completed: 9 } } });
  assert.equal(metadata.title, 'Ghost (@ghost-runner) // LV 6 Netrunner Dossier — Backlog Buster');
  assert.match(metadata.description, /9 cleared gigs/); assert.match(metadata.description, /7,000 lifetime XP/);
  assert.equal(metadata.openGraph.title, metadata.title); assert.equal(metadata.openGraph.description, metadata.description); assert.equal(metadata.twitter.title, metadata.title);
  assert.equal(buildDossierMetadata(null).robots.index, false);
});

test('public favorites preserve custom order, fill gaps, and disclose only displayed owned games', async () => {
  let selections = [8, null, 7];
  const queries = [];
  const game = id => ({ id, title: `Game ${id}`, platform: 'PC', coverUrl: null, earnedXp: id * 100 });
  const load = loader({
    '@/lib/player': { getOptionalAuthenticatedPlayerId: async () => null },
    '@/lib/prisma': { prisma: {
      player: { findFirst: async () => ({ operatorName: 'Ghost', handle: 'ghost', tagline: '', neonAccent: 'CYAN', avatarUrl: null, featuredTrophyIds: selections, profileVisibility: 'public', games: [], userAchievements: [] }) },
      game: { findMany: async args => {
        queries.push(args);
        assert.equal(args.where.player.handle.equals, 'ghost');
        assert.equal(args.take, 3);
        assert(!args.select.userId && !args.select.notes && !args.select.rating && !args.select.status);
        if (args.where.id) {
          assert.equal(args.where.status, undefined); assert.equal(args.where.rating, undefined);
          // IDs 999/6 simulate foreign or deleted records excluded by the owner query.
          return [7, 8].filter(id => args.where.id.in.includes(id)).map(game);
        }
        assert.equal(args.where.status, 'Completed'); assert.equal(args.where.rating, 5);
        assert.deepEqual(args.orderBy, [{ earnedXp: 'desc' }, { title: 'asc' }, { id: 'asc' }]);
        return [3, 2, 1].map(game);
      } },
    } },
  });
  const read = load('src/lib/public-dossier.ts').getPublicDossier;
  const resolve = load('src/lib/dossier.ts').resolveDossierShowcase;
  async function check(expected, pinned) {
    const dossier = await read('ghost');
    const slots = resolve(dossier.identity.showcase, dossier.card.showcaseGames, dossier.card.trophies);
    assert.deepEqual(slots.map(slot => slot?.game.id ?? null), expected);
    assert.deepEqual(slots.map(slot => slot?.pinned ?? false), pinned);
    assert.deepEqual(dossier.card.showcaseGames.map(game => game.id), expected.filter(Boolean));
  }
  await check([8, 3, 7], [true, false, true]);
  selections = [7, 8, 3]; await check([7, 8, 3], [true, true, false]);
  selections = [999, 6, null]; await check([3, 2, 1], [false, false, false]);
  selections = [null, null, null]; await check([3, 2, 1], [false, false, false]);
  assert.equal(queries.length, 7);
});

test('public DTO omits spoiler review text and all private notes, while allowing non-spoiler quotes', async () => {
  const profile = { handle: 'ghost', operatorName: 'Ghost', tagline: '', neonAccent: 'CYAN', avatarUrl: null, profileVisibility: 'public', featuredTrophyIds: [1, 2], games: [], userAchievements: [] };
  const games = [
    { id: 1, title: 'Secret', platform: 'PC', earnedXp: 10, coverUrl: null, review: 'SECRET_ENDING', reviewSpoiler: true, notes: 'PRIVATE_NOTES' },
    { id: 2, title: 'Safe', platform: 'PC', earnedXp: 10, coverUrl: null, review: 'Lovely soundtrack', reviewSpoiler: false },
  ];
  const load = loader({ '@/lib/player': { getOptionalAuthenticatedPlayerId: async () => null }, '@/lib/prisma': { prisma: {
    player: { findFirst: async () => profile }, game: { findMany: async ({ where }) => where.id ? games : [] },
  } } });
  const dossier = await load('src/lib/public-dossier.ts').getPublicDossier('ghost');
  const json = JSON.stringify(dossier);
  assert(!json.includes('SECRET_ENDING')); assert(!json.includes('PRIVATE_NOTES'));
  assert(json.includes('Lovely soundtrack'));
  assert.equal(dossier.card.showcaseGames[0].review, null);
  assert.equal(dossier.card.showcaseGames[0].reviewSpoiler, true);
});
