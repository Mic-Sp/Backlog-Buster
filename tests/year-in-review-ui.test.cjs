/* eslint-disable @typescript-eslint/no-require-imports -- Render the actual recap controls and standalone SVG in both personas. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { loadCatalogModule } = require('../scripts/catalog-seed.cjs');
const { buildAnnualReview } = loadCatalogModule('src/lib/year-in-review.ts');
function loader(mode) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.resolve(__dirname, '..', file), instance = new Module(filename, module);
    instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = name => {
      if (name.endsWith('.css')) return {};
      if (name === '@/components/ThemeProvider') return { useUIEffects: () => ({ layoutMode: mode }) };
      if (!name.startsWith('@/')) return original(name);
      const base = `src/${name.slice(2)}`;
      return load(fs.existsSync(path.resolve(__dirname, '..', `${base}.tsx`)) ? `${base}.tsx` : `${base}.ts`);
    };
    instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, filename);
    cache.set(file, instance.exports); return instance.exports;
  }
  return load;
}
const data = buildAnnualReview([{ id: 1, title: 'A <script>quest</script>', status: 'Completed', platform: 'PC', genre: 'Puzzle', rating: 5,
  playthroughCount: 3, hoursPlayed: 20, completedAt: '2025-07-01', startedAt: '2024-01-01' }], [1], 2026);

test('both personas render a year selector, accessible cadence table, highlights, honest accounting and share controls', () => {
  for (const mode of ['cyberpunk', 'fantasy']) {
    const Component = loader(mode)('src/components/YearInReview.tsx').default;
    const html = renderToStaticMarkup(React.createElement(Component, { data, callsign: 'Ghost' }));
    for (const text of ['Review year', 'value="2025" selected', 'Include games started this year', 'Monthly completion cadence', 'scope="row"',
      'Game of the Year', 'Longest Odyssey', 'First Clear', 'Final Clear', 'Earlier run dates are not stored', 'cumulative logged totals',
      'Copy annual summary', 'Share text', 'Annual summary share text', '3 lifetime runs', '2 lifetime replays']) assert(html.includes(text), `${mode}: ${text}`);
    assert(html.includes(mode === 'fantasy' ? 'THE YEARLY CHRONICLE' : 'ANNUAL TELEMETRY'));
    assert(html.includes(mode === 'fantasy' ? 'Primary Realm' : 'Primary Rig'));
    assert(html.includes('A &lt;script&gt;quest&lt;/script&gt;')); assert(!html.includes('<script>'));
  }
});

test('standalone annual SVG contains intrinsic theme styling and no external images for portable PNG capture', () => {
  for (const fantasy of [true, false]) {
    const Card = loader(fantasy ? 'fantasy' : 'cyberpunk')('src/components/AnnualSummaryCard.tsx').default;
    const html = renderToStaticMarkup(React.createElement(Card, { summary: data.summaries.find(summary => summary.year === 2025), callsign: 'Ghost', fantasy, includeStarted: false, cardRef: null }));
    assert(html.includes('viewBox="0 0 1000 680"')); assert(html.includes('role="img"'));
    assert(html.includes(fantasy ? '#f5e8c6' : '#080f1a')); assert(html.includes(fantasy ? 'Georgia' : 'Courier New'));
    assert(!/<image|foreignObject|NaN/.test(html)); assert(html.includes('lifetime run context'));
  }
});

test('empty recaps remain selectable and display clear fallback labels without invented ratings or winners', () => {
  const Component = loader('cyberpunk')('src/components/YearInReview.tsx').default;
  const html = renderToStaticMarkup(React.createElement(Component, { data: buildAnnualReview([], [], 2026), callsign: 'Ghost' }));
  for (const text of ['No dated clears in 2026', 'Unrated', 'No hours logged', 'No dated clear', 'value="2026"']) assert(html.includes(text), text);
  assert(!html.includes('NaN'));
});
