/* eslint-disable @typescript-eslint/no-require-imports -- Exercise actual section headers and view composition with isolated hooks. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : '';
const stub = () => null;

function fixture(mode = 'cyberpunk') {
  let cursor = 0;
  const slots = [], cache = new Map();
  const hooks = {
    useState(initial) { const slot = cursor++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], next => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next; }]; },
    useRef(initial) { const slot = cursor++; return slots[slot] ??= { current: initial }; },
    useId: () => 'section-fixture', useEffect: work => work(), useMemo: work => work(), useTransition: () => [false, work => work()],
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.resolve(__dirname, '..', file), instance = new Module(filename, module);
    instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = name => {
      if (name.endsWith('.css')) return {};
      if (name === 'react') return hooks;
      if (name === '@/components/LayoutText') return { useLayoutCopy: () => (cyber, fantasy) => mode === 'fantasy' ? fantasy : cyber };
      if (name === '@/components/ThemeProvider') return { useUIEffects: () => ({ layoutMode: mode, playSfx() {} }) };
      if (name === '@/components/WorkspaceShell') return { useSubscreen: () => ({ showPane() {} }) };
      if (name === '@/components/WorkspaceSection') return load('src/components/WorkspaceSection.tsx');
      if (name.startsWith('@/components/') || name.startsWith('@/app/')) return new Proxy({}, { get: () => stub });
      if (name.startsWith('@/lib/')) return load(`src/${name.slice(2)}.ts`);
      return original(name);
    };
    instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, filename);
    cache.set(file, instance.exports); return instance.exports;
  }
  return { load, render(Component, props) { cursor = 0; return Component(props); } };
}

function assertToggle(props, expectedOpen = true) {
  const f = fixture(), Section = f.load('src/components/WorkspaceSection.tsx').default;
  const render = extra => f.render(Section, { ...props, ...extra });
  let tree = render();
  const button = () => nodes(tree).find(node => node.props?.className === 'workspace-section-toggle');
  const body = () => nodes(tree).find(node => Object.hasOwn(node.props ?? {}, 'data-workspace-section-body'));
  const originalChildren = body().props.children;
  assert.equal(button().type, 'button'); assert.equal(button().props.type, 'button');
  assert.equal(button().props['aria-expanded'], expectedOpen);
  assert.equal(body().props.hidden, !expectedOpen);
  assert.equal(button().props['aria-controls'], body().props.id);
  assert(nodes(tree).some(node => node.props?.id === tree.props['aria-labelledby']));
  button().props.onClick(); tree = render();
  assert.equal(button().props['aria-expanded'], !expectedOpen); assert.equal(body().props.hidden, expectedOpen);
  assert.equal(body().props.children, originalChildren, 'collapsing preserves the mounted draft/selection tree');
  assert.equal(text(nodes(tree).find(node=>node.props?.className==='workspace-section-summary')), text(props.summary));
  button().props.onClick(); tree = render();
  assert.equal(button().props['aria-expanded'], expectedOpen); assert.equal(body().props.hidden, !expectedOpen);
  return { render, button, body, collapse() { button().props.onClick(); tree=render(); }, refresh(extra) { tree=render(extra); } };
}

test('new sections start open, expose linked accessible controls, and retain their mounted content', () => {
  assertToggle({sectionKey:'inventory',title:'Library inventory',label:'library inventory',summary:'3 / 8 games',children:{draft:'unsaved'}});
});

test('explicitly closed legacy sections retain that initial state and support expansion', () => {
  assertToggle({sectionKey:'telemetry',title:'Telemetry',label:'telemetry',defaultOpen:false,summary:'8 games',children:'Stats'},false);
});

test('ordinary updates preserve collapse choice; explicit navigation reveals a closed destination', () => {
  const state=assertToggle({sectionKey:'inventory',title:'Inventory',label:'inventory',summary:'3 games',children:'Rows',revealKey:0});
  state.collapse(); assert.equal(state.body().props.hidden,true);
  state.refresh({summary:'4 games'}); assert.equal(state.body().props.hidden,true);
  state.refresh({revealKey:1}); state.refresh({revealKey:1}); assert.equal(state.body().props.hidden,false);
});

const controller = () => ({ games:[],visibleGames:[],achievements:[],customLists:[],chains:[],platforms:[],genres:[],
  selectedGameId:null,activeView:'Backlog',viewCounts:{Backlog:0,Playing:0,Completed:0,Flatlined:0,All:0},
  searchQuery:'',platformFilter:'',genreFilter:'',ownershipFilter:'',sortBy:'default',selectedSaga:null,
  advisor:{triggerRef:{current:null}},roulette:{triggerRef:{current:null}},vault:{triggerRef:{current:null}},social:{},deck:{},
  sagaOrderControls:{},actions:{},libraryRevealKey:0,sagaRevealKey:0,socialEnabled:true,
});

for(const mode of ['cyberpunk','fantasy']) {
  test(`${mode}: inventory and theme-specific panels render with working default-open headers`, () => {
    const f=fixture(mode), Section=f.load('src/components/WorkspaceSection.tsx').default;
    const View=f.load(`src/components/${mode==='fantasy'?'FantasySubscreenView':'CyberpunkLibraryView'}.tsx`).default;
    const panels=nodes(f.render(View,{controller:controller()})).filter(node=>node.type===Section);
    const expected=mode==='fantasy'?['inventory','quest-status','medallions','chronicle','quest-inspection','library-filters']:['inventory','library-filters'];
    for(const key of expected) { const panel=panels.find(node=>node.props.sectionKey===key);assert(panel,key);assertToggle(panel.props); }
  });

  test(`${mode}: collapsed shelves retain active-list and capacity badges independently of their editor`, () => {
    const f=fixture(mode), CustomLists=f.load('src/components/CustomLists.tsx').default;
    const list={id:'shelf',title:'Weekend picks',description:null,isRanked:true,isPublic:false,gameIds:[]};
    const panel=f.render(CustomLists,{controller:{...controller(),customLists:[list],selectedCustomList:list}});
    assert.match(text(panel.props.title),mode==='fantasy'?/curator’s shelves/:/curated collections/);
    assert.match(text(panel.props.summary),/1 \/ 20 shelves/);assert.match(text(panel.props.summary),/Active: Weekend picks/);
    const state=assertToggle(panel.props);state.collapse();assert.equal(state.body().props.hidden,true);
    const manager=nodes(panel).find(node=>node.type==='details');assert(manager);assert.equal(manager.props.open,undefined,'manager stays intentionally closed');
  });
}

test('both deck presentations start open with equipped/slot summary badges', () => {
  for(const mode of ['cyberpunk','fantasy']) {
    const f=fixture(mode), deck={sectionRef:{current:null},pinned:[],busy:false};
    const mod=f.load(`src/components/${mode==='fantasy'?'FantasyEquipmentDeck':'UpNextDeck'}.tsx`);
    const panel=mode==='fantasy'?f.render(mod.default,{deck}):f.render(mod.UpNextDeckView,{controller:deck});
    assert.match(text(panel.props.summary),/0 \/ 3/);assertToggle(panel.props);
  }
});

test('telemetry and saga drawers preserve closed defaults while new stats subsections start open', () => {
  const f=fixture(), Section=f.load('src/components/WorkspaceSection.tsx').default;
  const Telemetry=f.load('src/components/LibraryTelemetry.tsx').default;
  const telemetry=f.render(Telemetry,{games:[]});assertToggle(telemetry.props,false);
  for(const panel of nodes(telemetry.props.children).filter(node=>node.type===Section)) assertToggle(panel.props);
  const g=fixture(), Sagas=g.load('src/components/SagaChains.tsx').default;
  assertToggle(g.render(Sagas,{chains:[],selectedKey:'',onSelect(){}}).props,false);
});
