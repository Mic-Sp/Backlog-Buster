/* eslint-disable @typescript-eslint/no-require-imports -- Run real optimistic state and component output with isolated network boundaries. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { loader } = require('./helpers/social-fixture.cjs');

function stateFixture() {
  let cursor = 0;
  const slots = [];
  const hooks = { ...React, useMemo: work => work(),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
  };
  const { useHypeMeters } = loader({ react: hooks })('src/components/games/useHypeMeters.ts');
  let games = [{ id: 1, hypeLevel: 2 }, { id: 2, hypeLevel: 3 }];
  return { render: () => { cursor = 0; return useHypeMeters(games); }, setGames: next => { games = next; } };
}

test('optimistic hype cycles 2 → 3 → 1 → 2, shares pending state and coalesces repeated clicks', async t => {
  const requests = [];
  let finish;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body); requests.push({ url, ...options, body });
    await new Promise(resolve => { finish = resolve; });
    return { ok: true, json: async () => ({ game: { id: 1, hypeLevel: body.hypeLevel } }) };
  });
  const f = stateFixture();
  for (const next of [3, 1, 2]) {
    const pending = f.render().cycleHype(1, 2);
    let current = f.render();
    assert.equal(current.levels[1], next); assert.equal(current.changes[1].pending, true);
    assert.equal(current.levels[2], 3, 'other games remain unchanged');
    const count = requests.length; await current.cycleHype(1, next); assert.equal(requests.length, count);
    finish(); await pending; current = f.render();
    assert.equal(current.levels[1], next); assert.equal(current.changes[1].pending, false); assert.equal(current.changes[1].error, '');
    assert.equal(requests.at(-1).url, '/api/games/1'); assert.equal(requests.at(-1).method, 'PATCH');
    assert.deepEqual(requests.at(-1).body, { hypeLevel: next });
  }
  f.setGames([{ id: 1, hypeLevel: 2 }, { id: 2, hypeLevel: 3 }]); assert.equal(f.render().levels[1], 2);
  f.setGames([{ id: 1, hypeLevel: 1 }, { id: 2, hypeLevel: 3 }]); assert.equal(f.render().levels[1], 1, 'subsequent server changes are respected');
});

test('HTTP, network and malformed-success failures restore the previous tier and allow retry', async t => {
  for (const response of [
    async () => ({ ok: false, json: async () => ({ error: 'PRIVATE_SERVER_ERROR' }) }),
    async () => { throw Error('PRIVATE_NETWORK_ERROR'); },
    async () => ({ ok: true, json: async () => ({}) }),
  ]) {
    t.mock.method(globalThis, 'fetch', response);
    const f = stateFixture(); await f.render().cycleHype(1, 2);
    assert.equal(f.render().levels[1], 2); assert.equal(f.render().changes[1].pending, false);
    assert.match(f.render().changes[1].error, /previous tier was restored/); assert.doesNotMatch(f.render().changes[1].error, /PRIVATE/);
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ game: { id: 1, hypeLevel: 3 } }) }));
    await f.render().cycleHype(1, 2); assert.equal(f.render().levels[1], 3); assert.equal(f.render().changes[1].error, '');
  }
});

function components() {
  const filename = path.resolve(__dirname, '../src/components/games/HypeMeter.tsx'), instance = new Module(filename, module);
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = instance.require.bind(instance);
  const hook = loader()('src/components/games/useHypeMeters.ts');
  instance.require = name => name.endsWith('.css') ? {} : name === './useHypeMeters' ? hook : original(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, filename);
  return { ...instance.exports, ...hook };
}

test('meters render three segments, accessible tier/next-step labels, shared modal state and visible save errors', () => {
  const { default: HypeMeter, HypeMetersContext, HypedOnlyFilter } = components();
  for (const [level, label] of [[1, 'Backburner'], [2, 'Interested'], [3, 'Hyped / Must Play']]) {
    const html = renderToStaticMarkup(React.createElement(HypeMeter, { gameId: 1, hypeLevel: level, title: 'Quest' }));
    assert.equal((html.match(/data-lit=/g) ?? []).length, 3);
    assert.equal((html.match(/data-lit="true"/g) ?? []).length, level);
    assert(html.includes(`Hype for Quest: ${label} (${level} of 3)`)); assert(html.includes('type="button"'));
  }
  const controller = { levels: { 1: 3 }, changes: { 1: { pending: true, error: 'Please retry.' } }, cycleHype() {} };
  const html = renderToStaticMarkup(React.createElement(HypeMetersContext.Provider, { value: controller },
    React.createElement(HypeMeter, { gameId: 1, hypeLevel: 1, title: 'Modal Quest' })));
  assert(html.includes('data-hype-level="3"')); assert(html.includes('disabled=""')); assert(html.includes('aria-busy="true"'));
  assert(html.includes('role="alert"')); assert(html.includes('aria-describedby='));
  const pill = renderToStaticMarkup(React.createElement(HypedOnlyFilter, { active: true, onChange() {} }));
  assert(pill.includes('aria-pressed="true"')); assert(pill.includes('Hyped Only'));
});

test('the library filter composes Tier 3 with status, search, ownership, platform, genre and custom lists', () => {
  const filename = path.resolve(__dirname, '../src/components/GameLibrary.tsx');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'visibleGames') callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source); assert(callback);
  const code = ts.transpileModule(`return (${callback.getText(source)})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const games = [
    { id: 1, title: 'Alpha', hypeLevel: 3, status: 'Backlog', platform: 'PC', genre: 'RPG', ownershipType: 'Digital' },
    { id: 2, title: 'Beta', hypeLevel: 2, status: 'Backlog', platform: 'PC', genre: 'RPG', ownershipType: 'Digital' },
    { id: 3, title: 'Gamma', hypeLevel: 3, status: 'Completed', platform: 'PS5', genre: 'Action', ownershipType: 'Physical' },
    { id: 4, title: 'Delta', hypeLevel: 1, status: 'Playing', platform: 'PC', genre: 'Puzzle', ownershipType: 'Borrowed' },
  ];
  const options = { games, hypedOnly: true, activeView: 'All', searchQuery: '', platformFilter: '', genreFilter: '', ownershipFilter: '',
    selectedCustomList: null, customListPositions: new Map(), selectedSaga: null, byGameId: new Map(), sortBy: 'title-asc',
    inBacklogPriorityView: false, compareChronologyTitles: (a, b) => a.localeCompare(b),
    matchesOwnership: loader()('src/lib/ownership-type.ts').matchesOwnership };
  const filter = extra => { const context = { ...options, ...extra }; return new Function(...Object.keys(context), code)(...Object.values(context)).map(game => game.id); };
  assert.deepEqual(filter({}), [1, 3]); assert.deepEqual(filter({ activeView: 'Backlog' }), [1]);
  assert.deepEqual(filter({ searchQuery: 'gamma' }), [3]); assert.deepEqual(filter({ platformFilter: 'PC' }), [1]);
  assert.deepEqual(filter({ genreFilter: 'RPG' }), [1]); assert.deepEqual(filter({ ownershipFilter: 'Physical' }), [3]);
  assert.deepEqual(filter({ selectedCustomList: {}, customListPositions: new Map([[3, 0], [4, 1]]) }), [3]);
  assert.deepEqual(filter({ hypedOnly: false }), [1, 2, 4, 3]);
  assert.deepEqual(filter({ games: games.map(game => game.id === 1 ? { ...game, hypeLevel: 1 } : game) }), [3], 'optimistic changes immediately affect the filter');
});
