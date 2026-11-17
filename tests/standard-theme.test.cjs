/* eslint-disable @typescript-eslint/no-require-imports -- Check real schema, terminology, and startup without a database. */
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { loader } = require('./helpers/social-fixture.cjs');
const load = loader(), appearance = load('src/lib/appearance.ts');
const { newCustomTheme, customThemeSchema, themeTermFields } = load('src/lib/custom-theme.ts');
const { standardCopy, standardTerms } = load('src/lib/standard-copy.ts');
const { customThemeStartupScript } = load('src/lib/custom-theme-runtime.ts');

test('Standard is validated as a base with a neutral palette, sans effects, 8px corners, and complete literal terms', () => {
  const theme = newCustomTheme('standard');
  assert(customThemeSchema.safeParse(theme).success);
  assert.equal(theme.borderRadius, 8);
  assert(Object.values(theme.effects).every(value => value === false));
  assert.deepEqual(Object.keys(standardTerms).sort(), Object.keys(themeTermFields).sort());
  for (const key of Object.keys(themeTermFields)) assert.equal(standardCopy('stylized fallback', key), standardTerms[key]);
  for (const [source, expected] of Object.entries({ 'System Playqueue': 'Game Library', 'Initialize Game Entry': 'Add Game', 'Edit Game Metadata': 'Edit Game', 'Backlog Roulette': 'Random Game Picker', 'CORTEX // TACTICAL GIG ADVISOR': 'Recommendations', 'Data Vault': 'Import & Export', 'Backlog': 'Backlog', 'Playing': 'Playing', 'Completed': 'Completed', 'HYPE LEVEL': 'Hype Level' })) assert.equal(standardCopy(source), expected);
  assert.equal(standardCopy('3 gigs match your filters.'), '3 games match your filters.');
});

test('startup and restoration agree for first visits, invalid preferences, every saved layout, and legacy variants', () => {
  const previous = global.localStorage;
  try {
    for (const [saved, variant, expected] of [[null, null, 'standard'], ['invalid', null, 'standard'], ['invalid', 'halloween', 'standard'], [null, 'cyberpunk', 'cyberpunk'], [null, 'halloween', 'cyberpunk'], ...['standard', 'cyberpunk', 'fantasy', 'biohazard'].map(mode => [mode, 'halloween', mode])]) {
      const storage = { getItem: key => key === 'backlogbuster:layout-mode' ? saved : variant };
      global.localStorage = storage;
      const root = {};
      vm.runInNewContext(appearance.appearanceStartupScript, { document: { documentElement: { dataset: root } }, localStorage: storage });
      const restored = appearance.readAppearance({});
      assert.equal(root.layoutMode, expected); assert.equal(restored.layoutMode, expected);
      const applied = {}; appearance.applyAppearance(applied, restored); assert.deepEqual(root, applied);
    }
  } finally { if (previous === undefined) delete global.localStorage; else global.localStorage = previous; }
});

test('a custom Standard template is restored before paint with the same layout, radius, colors, and no effects', () => {
  const theme = newCustomTheme('standard'), values = new Map();
  const root = { dataset: {}, style: { setProperty: (key, value) => values.set(key, value) }, setAttribute: (key, value) => values.set(key, value) };
  vm.runInNewContext(customThemeStartupScript, { document: { documentElement: root }, localStorage: { getItem: key => key === 'backlogbuster:custom-theme:v1' ? theme.id : JSON.stringify([theme]) } });
  assert.equal(root.dataset.theme, 'standard'); assert.equal(root.dataset.layoutMode, 'standard');
  assert.equal(values.get('--custom-radius'), '8px'); assert.equal(values.get('--custom-accent'), theme.colors.accent);
  assert.equal(values.get('data-custom-scanlines'), 'false'); assert.equal(values.get('data-custom-parchment'), 'false');
});
