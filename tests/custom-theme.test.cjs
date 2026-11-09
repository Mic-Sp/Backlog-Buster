/* eslint-disable @typescript-eslint/no-require-imports -- Exercise schema and pre-paint runtime without a browser/database. */
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { loader } = require('./helpers/social-fixture.cjs');
const load = loader(), theme = load('src/lib/custom-theme.ts'), runtime = load('src/lib/custom-theme-runtime.ts');
function root() {
  const values = new Map([['--unrelated-token', 'retained']]);
  return { dataset: { layoutMode: 'cyberpunk', theme: 'cyberpunk', cyberpunkTheme: 'default' }, values,
    style: { setProperty: (key, value) => values.set(key, value), removeProperty: key => values.delete(key) },
    setAttribute(key, value) { this.dataset[key.replace(/^data-/, '').replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value; },
    removeAttribute(key) { delete this.dataset[key.replace(/^data-/, '').replace(/-([a-z])/g, (_, char) => char.toUpperCase())]; },
  };
}
test('custom theme schema supplies safe optional defaults and preserves round-trip JSON', () => {
  const original = theme.newCustomTheme('fantasy'); assert(theme.customThemeSchema.safeParse(original).success);
  assert.deepEqual(theme.parseCustomThemeJSON(JSON.stringify(original)), original);
  const minimal = { id: original.id, name: original.name, colors: original.colors };
  const parsed = theme.customThemeSchema.parse(minimal);
  assert.equal(parsed.baseLayout, 'cyberpunk'); assert.equal(parsed.borderRadius, 3); assert.deepEqual(parsed.terminology, {});
  assert(Object.values(parsed.effects).every(value => value === false));
});
test('imports reject CSS injection, reserved IDs, unknown settings, invalid effects/radii and oversized JSON', () => {
  const original = theme.newCustomTheme('cyberpunk');
  for (const changed of [{ id: 'fantasy' }, { id: 'custom-bad;body{}' }, { name: '   ' }, { colors: { ...original.colors, accent: 'url(https://evil.test)' } },
    { colors: { ...original.colors, text: '#fff;display:none' } }, { effects: { scanlines: 'true' } }, { borderRadius: -1 }, { borderRadius: 33 }, { borderRadius: 2.5 },
    { css: '* { display: none; }' }, { terminology: { libraryTitle: 'x'.repeat(81) } }, { terminology: { arbitraryHTML: '<script>' } }]) {
    assert.throws(() => theme.parseCustomThemeJSON(JSON.stringify({ ...original, ...changed })));
  }
  assert.throws(() => theme.parseCustomThemeJSON('{'), /valid JSON/);
  assert.throws(() => theme.parseCustomThemeJSON(' '.repeat(12001)), /12 KB/);
});
test('storage restoration ignores malformed records, deduplicates IDs, and never writes to storage', () => {
  const valid = theme.newCustomTheme('cyberpunk');
  assert.deepEqual(theme.readCustomThemes({ getItem: () => '{broken' }), []);
  assert.deepEqual(theme.readCustomThemes({ getItem() { throw Error('blocked'); } }), []);
  const result = theme.readCustomThemes({ getItem: () => JSON.stringify([null, { id: 'evil' }, valid, { ...valid, name: 'Updated' }]) });
  assert.equal(result.length, 1); assert.equal(result[0].name, 'Updated');
});
test('runtime injects only owned root tokens and completely removes custom paint on exit', () => {
  const target = root(), value = theme.newCustomTheme('cyberpunk'); value.effects.scanlines = true; value.borderRadius = 14;
  runtime.applyCustomTheme(target, value);
  assert.equal(target.values.get('--custom-background'), value.colors.background); assert.equal(target.values.get('--canvas'), value.colors.background);
  assert.equal(target.values.get('--ink'), value.colors.text); assert.equal(target.values.get('--custom-radius'), '14px'); assert.equal(target.dataset.customScanlines, 'true');
  runtime.applyCustomTheme(target, null);
  assert.equal(target.dataset.customTheme, undefined); assert.equal(target.dataset.customScanlines, undefined);
  assert.deepEqual([...target.values], [['--unrelated-token', 'retained']]);
  assert.equal(target.dataset.theme, 'cyberpunk');
});
test('pre-paint restoration matches runtime and ignores unsafe storage without changing built-ins', () => {
  const custom = theme.newCustomTheme('fantasy'); custom.effects.particles = true;
  const storage = { getItem: key => key === theme.CUSTOM_THEME_SELECTION_KEY ? custom.id : key === theme.CUSTOM_THEMES_KEY ? JSON.stringify([custom]) : null };
  const target = root();
  vm.runInNewContext(runtime.customThemeStartupScript, { document: { documentElement: target }, localStorage: storage });
  assert.equal(target.dataset.layoutMode, 'fantasy'); assert.equal(target.dataset.customTheme, custom.id); assert.equal(target.values.get('--custom-accent'), custom.colors.accent);
  for (const invalid of [{ ...custom, colors: { ...custom.colors, surface: 'javascript:alert(1)' } }, { ...custom, borderRadius: 100 }, { ...custom, effects: { scanlines: 'false' } }]) {
    const clean = root();
    vm.runInNewContext(runtime.customThemeStartupScript, { document: { documentElement: clean }, localStorage: { getItem: key => key === theme.CUSTOM_THEME_SELECTION_KEY ? custom.id : JSON.stringify([invalid]) } });
    assert.equal(clean.dataset.customTheme, undefined); assert.equal(clean.dataset.theme, 'cyberpunk');
  }
  assert.doesNotThrow(() => vm.runInNewContext(runtime.customThemeStartupScript, { document: { documentElement: root() }, localStorage: { getItem() { throw Error('blocked'); } } }));
});
