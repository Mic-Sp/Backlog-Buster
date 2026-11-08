/* eslint-disable @typescript-eslint/no-require-imports -- Render the real client telemetry with action and theme boundaries isolated. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { loader } = require('./helpers/social-fixture.cjs');
const pure = loader();
function render(game, fantasy = false, compact = false) {
  const filename = path.resolve(__dirname, '../src/components/SteamProgress.tsx'), instance = new Module(filename, module);
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = instance.require.bind(instance);
  instance.require = name => name.endsWith('.css') ? {} : name === '@/components/LayoutText' ? { useLayoutCopy: () => (cyberpunk, parchment) => fantasy ? parchment : cyberpunk }
    : name === '@/app/actions' ? { syncSteamAchievements: () => { throw Error('Rendering must never dispatch an API request'); } }
    : name.startsWith('@/') ? pure(`src/${name.slice(2)}.ts`) : original(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, filename);
  return renderToStaticMarkup(React.createElement(instance.exports.default, { game: { id: 1, title: 'Steam Quest', status: 'Playing', steamAppId: '440', ...game }, compact }));
}

test('both themes render accessible achievement counts, dated recent activity, safe refresh controls and Backlog suggestions', () => {
  for (const fantasy of [false, true]) {
    const html = render({ status: 'Backlog', steamAchievementsUnlocked: 38, steamAchievementsTotal: 50, steamRecentMinutes: 252, steamLastSyncedAt: '2026-11-07T12:00:00Z' }, fantasy);
    for (const value of ['38/50', '76%', '4.2h', '2 WEEKS', 'Activity snapshot 2026-11-07', 'role="progressbar"', 'aria-valuenow="38"', 'aria-valuemax="50"', 'type="button"', 'steam-start-hint']) assert(html.includes(value), value);
    assert(html.includes(fantasy ? 'STEAM DEEDS' : 'ACHIEVEMENTS'));
    assert(html.includes(fantasy ? 'Chronicle Steam Deeds' : 'Sync Steam Achievements'));
    assert(!html.includes('MASTERED'));
  }
});

test('mastery, zero achievements, unavailable stats and non-Steam games have distinct presentations', () => {
  for (const fantasy of [false, true]) {
    assert(render({ steamAchievementsUnlocked: 50, steamAchievementsTotal: 50 }, fantasy).includes('MASTERED ON STEAM'));
    const empty = render({ steamAchievementsUnlocked: 0, steamAchievementsTotal: 0 }, fantasy);
    assert(empty.includes('NO STEAM ACHIEVEMENTS')); assert(!empty.includes('MASTERED')); assert(!empty.includes('role="progressbar"'));
    assert(!render({ steamAchievementsUnlocked: null, steamAchievementsTotal: null }, fantasy).includes('NO STEAM ACHIEVEMENTS'));
    assert.equal(render({ steamAppId: null }, fantasy), '');
    assert.equal(render({ steamAppId: 'invalid' }, fantasy), '');
  }
});

test('compact inventory overlays preserve useful progress without nesting interactive controls inside a game button', () => {
  const html = render({ steamAchievementsUnlocked: 38, steamAchievementsTotal: 50, steamRecentMinutes: 252 }, true, true);
  for (const value of ['38/50', '76%', '4.2h', 'TRAVELS', 'data-compact="true"']) assert(html.includes(value), value);
  assert(!html.includes('<button')); assert(!html.includes('steam-start-hint'));
  assert(render({ steamAchievementsUnlocked: 50, steamAchievementsTotal: 50 }, true, true).includes('100% MASTERED'));
});
