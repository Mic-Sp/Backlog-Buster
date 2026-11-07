/* eslint-disable @typescript-eslint/no-require-imports -- Render standalone SVG cards without browser or database services. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const filename = path.resolve(__dirname, '..', file), instance = new Module(filename, module);
  instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = instance.require.bind(instance);
  instance.require = name => {
    if (!name.startsWith('@/')) return original(name);
    const base = `src/${name.slice(2)}`;
    return load(fs.existsSync(path.resolve(__dirname, '..', `${base}.tsx`)) ? `${base}.tsx` : `${base}.ts`);
  };
  instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  cache.set(file, instance.exports); return instance.exports;
}
const Card = load('src/components/NetrunnerIdCard.tsx').default;
const props = {
  data: { level: 7, totalXp: 8450, counts: { Backlog: 3, Playing: 2, Completed: 9, Flatlined: 1 }, activeHours: 123, completionRate: 60, avgRating: 4.5, achievements: [{ key: 'first-blood', title: 'First Blood', unlocked: true, unlockedAt: '2026-01-01', xpAwarded: 50 }], trophies: [{ id: 1, title: 'Quest & <Escape>', coverUrl: 'https://example.test/a.png', earnedXp: 400 }] },
  identity: { callsign: 'Hero', handle: 'hero', tagline: 'Keep exploring.', accent: 'cyan', avatarUrl: null, showcase: [1, null, null] },
  artwork: { 'https://example.test/a.png': 'data:image/png;base64,fixture' }, timestamp: '2026-01-01T00:00:00Z', cardRef: null,
};
const render = fields => renderToStaticMarkup(React.createElement(Card, { ...props, ...fields }));

test('Cyberpunk default and explicit modes produce the original neon card', () => {
  assert.equal(render({}), render({ layoutMode: 'cyberpunk' }));
  const html = render({});
  for (const text of ['Netrunner ID Card', 'NIGHT CITY RECREATIONAL TELEMETRY', 'INDEPENDENT OPERATOR REGISTRY', 'GIGS CLEARED', 'MILESTONE MICRO-RIBBON', 'BB-2077']) assert(html.includes(text), text);
  assert.match(html, /fill="#080d16"/); assert.match(html, /Courier New/);
  assert.doesNotMatch(html, /fantasy-codex-card/);
});

test('Fantasy SVG contains its own parchment palette, crest, serif font, and quest terminology for export/print', () => {
  const html = render({ layoutMode: 'fantasy' });
  for (const text of ['fantasy-codex-card', 'CODEX', 'HERO', 'RANK 7', 'QUESTS COMPLETED', 'SAGE MEDALLIONS', 'HALL OF FAME', 'CHRONICLED', 'Georgia', '#f5e8c6', '#233f43', '#d9bf70']) assert(html.includes(text), text);
  for (const text of ['NETRUNNER', 'NIGHT CITY', 'GIGS CLEARED', 'FLATLINED', '#00f0ff', '#ff2a6d', 'Courier New', 'BB-2077']) assert(!html.includes(text), text);
  assert.match(html, /viewBox="0 0 1000 680"/);
  assert.match(html, /href="data:image\/png;base64,fixture"/);
  assert.match(html, /Quest &amp; &lt;Escape&gt;/);
  assert.doesNotMatch(html, /<style|foreignObject|NaN/);
});

test('Fantasy empty records and missing artwork use honest fallbacks and preserve saved identity', () => {
  const identity = { ...props.identity, callsign: 'ANONYMOUS NETRUNNER', tagline: 'One more gig. One more legend.' };
  const html = render({ layoutMode: 'fantasy', identity, artwork: {}, data: { ...props.data, achievements: [] } });
  assert(html.includes('UNNAMED ADVENTURER')); assert(html.includes('One more quest. One more legend.'));
  assert(html.includes('ARTWORK UNAVAILABLE')); assert(html.includes('YOUR FIRST MEDALLION AWAITS'));
  assert.equal(identity.callsign, 'ANONYMOUS NETRUNNER');
  assert(render({ identity }).includes('ANONYMOUS NETRUNNER'));
});

test('download names follow the selected layout and preserve the Cyberpunk default', () => {
  const { downloadDossier } = load('src/lib/dossier-snapshot.ts');
  const originalDocument = global.document, originalWindow = global.window;
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  const downloads = [];
  try {
    URL.createObjectURL = () => 'blob:fixture'; URL.revokeObjectURL = () => {};
    global.document = { createElement: () => ({ click() { downloads.push(this.download); }, remove() {} }), body: { append() {} } };
    global.window = { setTimeout: work => work() };
    downloadDossier(new Blob(), 'Hero'); downloadDossier(new Blob(), 'Hero', 'fantasy');
    assert.match(downloads[0], /^netrunner-id-hero-\d{4}-\d{2}-\d{2}\.png$/);
    assert.match(downloads[1], /^adventurers-codex-hero-\d{4}-\d{2}-\d{2}\.png$/);
  } finally {
    URL.createObjectURL = create; URL.revokeObjectURL = revoke;
    if (originalDocument === undefined) delete global.document; else global.document = originalDocument;
    if (originalWindow === undefined) delete global.window; else global.window = originalWindow;
  }
});


test('both themes show curated and automatic tiles without claiming favorites have five stars', () => {
  for (const layoutMode of ['cyberpunk', 'fantasy']) {
    const favorite = { id: 2, title: 'Unrated active favorite', platform: 'PC', coverUrl: null, earnedXp: 0 };
    const html = render({ layoutMode, identity: { ...props.identity, showcase: [2, null, null] }, data: { ...props.data, showcaseGames: [favorite] } });
    for (const text of ['PINNED PROFILE FAVORITES', 'Unrated active favorite', 'FAVORITE', 'Quest &amp; &lt;Escape&gt;']) assert(html.includes(text), text);
    assert.equal((html.match(layoutMode === 'fantasy' ? /♥♥♥♥♥/g : /★★★★★/g) || []).length, 1);
    const auto = render({ layoutMode, identity: { ...props.identity, showcase: [null, null, null] } });
    assert(auto.includes(layoutMode === 'fantasy' ? 'LEGENDARY QUESTS' : 'TOP CLEARED GIGS'));
    assert(!auto.includes('PINNED PROFILE FAVORITES'));
  }
});

test('both dossier SVG themes show short safe quotes and never embed spoiler text', () => {
  for (const layoutMode of ['cyberpunk', 'fantasy']) {
    for (const reviewSpoiler of [true, false]) {
      const html = render({ layoutMode, data: { ...props.data, trophies: props.data.trophies.map(game => ({ ...game, review: 'A <script>twist</script>', reviewSpoiler })) } });
      if (reviewSpoiler) { assert(html.includes('SPOILER REVIEW')); assert(!html.includes('twist')); }
      else { assert(html.includes('A &lt;script&gt;twist&lt;/script&gt;')); assert(!html.includes('<script>')); }
    }
  }
});
