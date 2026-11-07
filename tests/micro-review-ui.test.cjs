/* eslint-disable @typescript-eslint/no-require-imports -- Render spoiler controls without a database or browser. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const filename = path.resolve(__dirname, '..', file), instance = new Module(filename, module);
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = instance.require.bind(instance);
  instance.require = name => name.endsWith('.css') ? {} : name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : original(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  cache.set(file, instance.exports); return instance.exports;
}
const { MicroReview, MicroReviewEditor } = load('src/components/MicroReview.tsx');
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

test('spoilers are absent from initial DOM and accessible text until a reveal action, including unknown flags', () => {
  for (const reviewSpoiler of [true, undefined]) {
    const html = render(MicroReview, { review: 'SECRET_ENDING', reviewSpoiler });
    assert(!html.includes('SECRET_ENDING'));
    assert(html.includes('Reveal Spoiler')); assert(html.includes('aria-expanded="false"'));
    assert(html.includes('Spoiler review hidden')); assert(html.includes('aria-controls='));
  }
});

test('non-spoiler text is escaped, optional blank reviews vanish, and editor limits match server validation', () => {
  const html = render(MicroReview, { review: '<script>alert(1)</script>', reviewSpoiler: false });
  assert(html.includes('&lt;script&gt;')); assert(!html.includes('<script>')); assert(!html.includes('Reveal Spoiler'));
  assert.equal(render(MicroReview, { review: null }), '');
  const editor = render(MicroReviewEditor, { title: 'Quest', review: 'Saved review', reviewSpoiler: true });
  assert(editor.includes('maxLength="280"')); assert(editor.includes('Contains Spoilers')); assert(editor.includes('checked=""'));
  assert(!editor.includes('<details class="micro-review-editor" open'));
  assert(editor.includes('12/280')); assert(editor.includes('notes stay private'));
});


const { PlayJournalBadges, PlayJournalEditor } = load('src/components/PlayJournal.tsx');
test('play journal date inputs preserve blank/known values and badges use stable calendar dates', () => {
  const editor = render(PlayJournalEditor, { title: 'Quest', startedAt: '2020-02-29', completedAt: '', originalStartedAt: '2020-02-29' });
  assert(editor.includes('type="date"')); assert(editor.includes('value="2020-02-29"'));
  assert(editor.includes('name="startedAtOriginal"')); assert(editor.includes('Completion date for Quest'));
  assert(editor.includes('Changing status preserves recorded history'));
  const badges = render(PlayJournalBadges, { startedAt: '2020-02-29', completedAt: '2020-03-01' });
  assert(badges.includes('Feb 29, 2020')); assert(badges.includes('Mar 1, 2020'));
  assert.equal(render(PlayJournalBadges, {}), '');
});


const { OwnershipBadge, OwnershipField, OwnershipFilterControl } = load('src/components/Ownership.tsx');
test('ownership controls expose the four media and unspecified, with accessible badges and filter labels', () => {
  const editor = render(OwnershipField, { title: 'Quest', value: 'Borrowed' });
  for (const type of ['Digital', 'Physical', 'Subscription', 'Borrowed']) assert(editor.includes(`value="${type}"`));
  assert(editor.includes('value="Borrowed" selected=""')); assert(editor.includes('Ownership for Quest'));
  assert(render(OwnershipBadge, { value: 'Physical' }).includes('Access medium: Physical'));
  assert.equal(render(OwnershipBadge, { value: null }), '');
  const filter = render(OwnershipFilterControl, { value: 'Subscription', onChange() {} });
  assert(filter.includes('Filter by ownership')); assert(filter.includes('All ownership types')); assert(filter.includes('Unspecified'));
});
