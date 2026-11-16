/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the actual controller, toggle UI and timers with isolated actions. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { loader } = require('./helpers/social-fixture.cjs');
const games = [1, 2, 3].map(hypeLevel => ({ id: hypeLevel, hypeLevel, title: `Tier ${hypeLevel}`, status: 'Backlog', releaseYear: 2020,
  genre: hypeLevel === 1 ? 'Puzzle' : 'RPG', platform: 'PC', lengthHours: 10, pinnedOrder: null, difficulty: 1, coverUrl: null }));

function fixture() {
  const slots = []; let cursor = 0;
  const hooks = { ...React, useEffect() {}, useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial;
    return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; }, useTransition: () => [false, work => work()],
  };
  const pure = loader(), empty = () => null;
  const filename = path.resolve(__dirname, '../src/components/QuestRoulette.tsx'), instance = new Module(filename, module);
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const mocks = { react: hooks, '@/app/actions': {}, '@/components/LayoutText': { useLayoutCopy: () => cyber => cyber },
    '@/components/FantasyAccents': { FantasyCorners: empty }, '@/components/DeckPinButton': { default: empty },
    '@/components/ThemeProvider': { useUIEffects: () => ({ playSfx() {} }) } };
  const original = instance.require.bind(instance);
  instance.require = name => name.endsWith('.css') ? {} : Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith('@/') ? pure(`src/${name.slice(2)}.ts`) : original(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, filename);
  return { render: () => { cursor = 0; return instance.exports.useQuestRouletteController({ games }); }, View: instance.exports.QuestRouletteView };
}

test('controller toggles reach the draw pool and weighted rerolls preserve the full 3:1 pool', t => {
  let finish;
  t.mock.method(globalThis, 'setInterval', () => 1); t.mock.method(globalThis, 'clearInterval', () => {});
  t.mock.method(globalThis, 'setTimeout', callback => { finish = callback; return 1; });
  t.mock.method(Math, 'random', () => .4);
  const f = fixture(); let c = f.render();
  assert.equal(c.hypeWeighted, true); assert.equal(c.iceboxMode, false); assert.deepEqual(c.matches.map(g => g.id), [2, 3]);
  c.roll(); assert.equal(f.render().busy, true); finish(); c = f.render(); assert.equal(c.winner.id, 3);
  c.roll(); finish(); assert.equal(f.render().winner.id, 3, 'weighted mode permits repeats rather than forcing two games to alternate');
  c.setHypeWeighted(false); c.resetResult(); c = f.render(); assert.equal(c.hypeWeighted, false);
  c.setIceboxMode(true); c = f.render(); assert.deepEqual(c.matches.map(g => g.id), [1, 2, 3]);
  c.setIceboxMode(false); c.setGenre('Puzzle'); c = f.render();
  assert.equal(c.automaticFallback, true); assert.deepEqual(c.matches.map(g => g.id), [1]);
  c.roll(); finish(); assert.equal(f.render().winner.id, 1);
});

test('dialog exposes named checkbox toggles, fallback notice and disabled preferences during rolls', t => {
  let finish;
  t.mock.method(globalThis, 'setInterval', () => 1); t.mock.method(globalThis, 'clearInterval', () => {});
  t.mock.method(globalThis, 'setTimeout', callback => { finish = callback; return 1; });
  const f = fixture(); let c = f.render(); c.open(); c.setGenre('Puzzle'); c = f.render();
  const html = renderToStaticMarkup(React.createElement(f.View, { controller: c }));
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2); assert(html.includes('Hype Weighted')); assert(html.includes('Icebox Mode'));
  assert(html.includes('Only Backburner games match')); assert(html.includes('role="status"'));
  c.roll(); const busy = renderToStaticMarkup(React.createElement(f.View, { controller: f.render() }));
  assert.match(busy, /class="quest-hype-options" disabled=""/); finish();
});
