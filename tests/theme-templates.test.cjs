/* eslint-disable @typescript-eslint/no-require-imports -- Verify template identity and nested style isolation without browser storage. */
const test = require('node:test'), assert = require('node:assert/strict');
const { loader } = require('./helpers/social-fixture.cjs');
const load = loader(), { newCustomTheme, customThemeSchema } = load('src/lib/custom-theme.ts');
const { getThemeTemplates, applyThemeTemplate } = load('src/lib/theme-templates.ts');
const style = theme => Object.fromEntries(Object.entries(theme).filter(([key]) => key !== 'id' && key !== 'name'));

test('template catalog includes every existing built-in and saved custom sources', () => {
  const source = newCustomTheme('fantasy'), editing = newCustomTheme('cyberpunk');
  const templates = getThemeTemplates([source, editing], editing.id);
  assert.deepEqual(templates.filter(template => template.group === 'builtin').map(template => template.name), ['Cyberpunk', 'Fantasy', 'Haunted Net / Blackwall Glitch']);
  assert.equal(templates.length, 4);
  assert.deepEqual(templates.filter(template => template.group === 'saved').map(template => template.key), [`saved:${source.id}`]);
  assert.equal(new Set(templates.map(template => template.key)).size, templates.length);
  assert(getThemeTemplates([source, editing]).some(template => template.key === `saved:${editing.id}`), 'A new draft can copy the active saved theme');
});

test('every built-in source reuses the existing layout defaults, including radius/effect/terminology values', () => {
  const templates = getThemeTemplates([]), defaults = [newCustomTheme('cyberpunk'), newCustomTheme('fantasy'), newCustomTheme('cyberpunk', true)];
  templates.filter(template => template.group === 'builtin').forEach((template, index) => assert.deepEqual(template.style, style(defaults[index])));
  for (const template of templates) assert(customThemeSchema.safeParse(applyThemeTemplate(newCustomTheme('cyberpunk'), template)).success);
});

test('copying a saved template replaces all style fields while preserving the target ID/name and both saved objects', () => {
  const source = { ...newCustomTheme('fantasy'), terminology: { libraryTitle: 'Storybook', authTitle: 'Enter the garden' } };
  const target = { ...newCustomTheme('cyberpunk', true), name: 'My work in progress', terminology: { workspaceTitle: 'Old heading' } };
  const beforeSource = structuredClone(source), beforeTarget = structuredClone(target);
  const template = getThemeTemplates([source, target], target.id).find(row => row.key === `saved:${source.id}`);
  const result = applyThemeTemplate(target, template);
  assert.deepEqual(style(result), style(source)); assert.equal(result.id, target.id); assert.equal(result.name, target.name);
  assert.equal(result.terminology.workspaceTitle, undefined, 'Old labels are replaced, not merged');
  result.colors.accent = '#123456'; result.effects.particles = false; result.terminology.libraryTitle = 'Edited locally';
  assert.deepEqual(source, beforeSource); assert.deepEqual(target, beforeTarget);
  assert.deepEqual(applyThemeTemplate(result, template), { ...beforeSource, id: target.id, name: target.name }, 'The same template can explicitly reset later edits');
});

test('new drafts keep fresh identities and edits survive catalog refreshes until another template is explicitly picked', () => {
  const source = newCustomTheme('fantasy'), draft = newCustomTheme('cyberpunk');
  const template = getThemeTemplates([source]).find(row => row.key === `saved:${source.id}`);
  const result = applyThemeTemplate(draft, template); assert.notEqual(result.id, source.id);
  result.colors.accent = '#123456'; result.borderRadius = 31; result.terminology.libraryTitle = 'My edit';
  getThemeTemplates([{ ...source, name: 'Renamed in another tab' }]);
  assert.equal(result.colors.accent, '#123456'); assert.equal(result.borderRadius, 31); assert.equal(result.terminology.libraryTitle, 'My edit');
  assert.equal(applyThemeTemplate({ ...draft, name: '   ' }, template).name, 'My custom theme', 'An empty name cannot prevent a template preview');
});
