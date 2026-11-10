/* eslint-disable @typescript-eslint/no-require-imports -- Exercise actual persona handlers with isolated controller boundaries. */
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const { loader } = require('./helpers/social-fixture.cjs');
const load = loader(), appearance = load('src/lib/appearance.ts');
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
function component(file, mocks) {
  const filename = path.resolve(__dirname, '../', file), instance = new Module(filename, module);
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = instance.require.bind(instance);
  instance.require = name => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), { compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.ReactJSX } }).outputText, filename);
  return instance.exports;
}

test('Safe Room restores before paint, honors account preferences, and preserves the Cyberpunk variant', () => {
  const previous = global.localStorage;
  try {
    global.localStorage = { getItem: key => key.endsWith('layout-mode') ? 'biohazard' : 'halloween' };
    assert.equal(appearance.normalizeLayoutMode('biohazard'), 'biohazard');
    assert(appearance.isLayoutMode('biohazard')); assert(!appearance.isLayoutMode('unsafe'));
    for (const playerLayout of [undefined,'biohazard','fantasy','cyberpunk']) {
      const root = { playerLayout }, expected = playerLayout ?? 'biohazard';
      const value = appearance.readAppearance(root); assert.equal(value.layoutMode,expected);
      appearance.applyAppearance(root,value);
      const startup = { playerLayout };
      vm.runInNewContext(appearance.appearanceStartupScript, { document:{documentElement:{dataset:startup}}, localStorage:global.localStorage });
      assert.equal(startup.layoutMode,root.layoutMode); assert.equal(startup.theme,root.theme);
      assert.equal(root.theme, expected === 'cyberpunk' ? 'halloween' : expected);
    }
    global.localStorage = { getItem() { throw Error('blocked'); } };
    assert.equal(appearance.readAppearance({layoutMode:'biohazard'}).layoutMode,'biohazard');
  } finally { if (previous === undefined) delete global.localStorage; else global.localStorage=previous; }
});

test('custom Safe Room themes validate, round trip and restore the third layout before paint', () => {
  const themes = load('src/lib/custom-theme.ts'), runtime = load('src/lib/custom-theme-runtime.ts');
  const theme = themes.newCustomTheme('biohazard');
  assert.deepEqual(themes.parseCustomThemeJSON(JSON.stringify(theme)),theme);
  const root = { dataset:{}, style:{setProperty(){}, removeProperty(){}},setAttribute(){},removeAttribute(){} };
  const storage = {getItem:key => key === themes.CUSTOM_THEME_SELECTION_KEY ? theme.id : JSON.stringify([theme])};
  vm.runInNewContext(runtime.customThemeStartupScript,{ document:{documentElement:root},localStorage:storage });
  assert.equal(root.dataset.layoutMode,'biohazard'); assert.equal(root.dataset.theme,'biohazard');
  assert.equal(root.dataset.customTheme,theme.id); assert.equal(theme.effects.particles,false);
});

test('condition thresholds and shared surface copy use survival-horror terminology', () => {
  const { operativeCondition, safeRoomModes } = load('src/lib/biohazard.ts');
  assert.deepEqual([0,2,3,5,6,20].map(operativeCondition),['FINE','FINE','CAUTION','CAUTION','DANGER','DANGER']);
  assert.equal(new Set(safeRoomModes.map(mode => mode.key)).size,5);
  const { biohazardCopy } = load('src/lib/biohazard-copy.ts');
  assert.equal(biohazardCopy('DATA SHARDS // CUSTOM QUEUES'),'CLASSIFIED / CUSTOM RESEARCH FOLDERS');
  assert.equal(biohazardCopy('New & Upcoming','releaseRadarTitle'),'Outbreak Radar');
  assert.equal(biohazardCopy('📌 PIN TO DECK'),'EQUIP');
});

function inventoryFixture() {
  const React = require('react'), sounds=[], calls=[]; let mode='box';
  const games=[1,2].map(id=>({id,title:`Record ${id}`,platform:'PC',status:'Backlog',coverUrl:null,pinnedOrder:null,genre:null,rating:null,hoursPlayed:id,lengthHours:10,difficulty:1,earnedXp:0,steamAchievementsTotal:12,steamAchievementsUnlocked:3}));
  const noop=()=>{};
  const c={games,visibleGames:games,selectedGameId:null,setSelectedGameId:id=>{c.selectedGameId=id;},viewCounts:{},activeView:'Backlog',platforms:[],genres:[],customLists:[],chains:[],selectedSaga:null,pinnedCount:0,
    deck:{pinned:[],sectionRef:{current:null}},advisor:{selectScoutTab:tab=>calls.push(tab),openAdvisor:()=>calls.push('radar-open')},roulette:{},vault:{},social:{},
    canReorderBacklog:false,visibleBacklogPositions:new Map(),visibleTimelinePositions:new Map(),visibleBacklogIds:[],canDragToDeck:()=>true,isReorderableRow:()=>false,
    changeView:view=>calls.push(view),setSearchQuery:value=>calls.push(value),clearFilters:noop};
  const mocks={'@/components/LayoutText':{useLayoutCopy:()=>(value)=>value},react:{...React,useRef:()=>({current:null})},'@/components/WorkspaceShell':{useSafeRoom:()=>({mode,showMode:value=>{mode=value;}})},'@/components/ThemeProvider':{useUIEffects:()=>({playSfx:sound=>sounds.push(sound)})},'@/lib/game-record':{gameRecordKey:game=>String(game.id)},'@/lib/deck':{DECK_CAPACITY:3},'@/lib/trailers':{buildTrailerUrl:()=> '#'}};
  for (const name of ['CustomLists','SafeForm','Ownership','PlayJournal','MicroReview','ReplayTracking','CommunityGameStats','SteamProgress','AgentBriefing','StarRatingInput','DeckPinButton','SocialHub','SagaChains','SagaChronologyDebugger','LibraryTelemetry','RadarNotification']) mocks[`@/components/${name}`]=new Proxy({}, {get:(_,key)=>key==='__esModule'?true:()=>null});
  const View=component('src/components/BiohazardSubscreenView.tsx',mocks).default;
  return {c,games,sounds,calls,render:()=>View({controller:c}),setMode:value=>{mode=value;},getMode:()=>mode};
}

test('Item Box selection, filtering and recon use shared controller actions with dedicated spatial structure', () => {
  const f=inventoryFixture();let tree=f.render();
  const byClass=value=>nodes(tree).find(node=>node.props?.className===value);
  assert(byClass('bio-box-split'));assert(byClass('bio-inventory-grid'));assert(byClass('bio-examination'));
  assert(!nodes(tree).some(node=>String(node.props?.className).includes('cyberpunk')));
  const slots=nodes(tree).filter(node=>node.props?.className==='bio-inventory-slot');
  slots[1].props.onClick();tree=f.render();assert.equal(f.c.selectedGameId,2);assert.deepEqual(f.sounds,['cursor']);
  assert.equal(nodes(tree).find(node=>node.props?.['aria-pressed']===true&&node.props?.className==='bio-inventory-slot').props['aria-label'],'Examine Record 2');
  nodes(tree).find(node=>node.type==='input'&&node.props.type==='search').props.onChange({target:{value:'Record'}});assert(f.calls.includes('Record'));
  const edit=nodes(tree).find(node=>node.type==='button'&&node.props.children==='EXAMINE / EDIT');edit.props.onClick();assert.equal(f.getMode(),'save');
  f.setMode('radar');tree=f.render();const radar=nodes(tree).find(node=>node.type==='button'&&Array.isArray(node.props.children)&&node.props.children[0]==='OPEN OUTBREAK RADAR ');radar.props.onClick();assert.deepEqual(f.calls.slice(-2),['radar','radar-open']);
});

test('mode pages expose only their own composition and survive an empty filtered inventory', () => {
  const f=inventoryFixture();
  for (const [mode,expected] of [['box',['bio-loadout','bio-item-box']],['equipped',['bio-loadout']],['files',['bio-files']],['radar',['bio-recon']],['save',['bio-typewriter']]]) {
    f.setMode(mode);const tree=f.render();
    const sections=nodes(tree).filter(node=>node.type==='section'&&Object.hasOwn(node.props,'hidden'));
    assert.deepEqual(sections.filter(node=>!node.props.hidden).map(node=>node.props.className),expected);
  }
  f.c.visibleGames=[]; f.setMode('box');const tree=f.render();
  assert.equal(nodes(tree).filter(node=>node.props?.className==='bio-unused-slot').length,8);
  assert(nodes(tree).some(node=>node.type==='h3'&&node.props.children==='No item selected'));
});

test('medical deck branches structurally, and subscreen keyboard navigation wraps', () => {
  const React=require('react');let layoutMode='cyberpunk',mode='box';const sounds=[];
  const {default:Deck}=component('src/components/BiohazardStatusDeck.tsx',{
    react:React,'@/components/ThemeProvider':{useUIEffects:()=>({layoutMode,playSfx:sound=>sounds.push(sound)})},
    '@/components/WorkspaceShell':{useSafeRoom:()=>({mode,showMode:value=>{mode=value;}})},
    '@/components/OperatorAvatar':{default:()=>null},'@/lib/biohazard':load('src/lib/biohazard.ts')});
  const props={legacy:'legacy summary',children:'account tools',name:'Operative',avatarUrl:null,rank:1,xp:0,activeGames:6,completed:0,total:2};
  for(const layout of ['cyberpunk','fantasy']){layoutMode=layout;assert.equal(Deck(props),props.legacy);}
  layoutMode='biohazard';const tree=Deck(props);assert.equal(tree.props.className,'bio-status-deck');
  const ecg=nodes(tree).find(node=>node.props?.className==='bio-ecg');assert.equal(ecg.props['data-condition'],'DANGER');ecg.props.onClick();assert.deepEqual(sounds,['pulse']);
  let focused=-1;nodes(tree).find(node=>node.type==='nav').props.onKeyDown({key:'ArrowLeft',preventDefault(){},currentTarget:{querySelectorAll:()=>Array.from({length:5},(_,index)=>({focus(){focused=index;}}))}});
  assert.equal(mode,'save');assert.equal(focused,4);
});
