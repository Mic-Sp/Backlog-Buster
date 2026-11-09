/* eslint-disable @typescript-eslint/no-require-imports -- Production browser QA with device-local themes only. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const { loader } = require('../tests/helpers/social-fixture.cjs');
const load = loader(), { newCustomTheme, themeColorFields, themeTermFields } = load('src/lib/custom-theme.ts');
const { getThemeTemplates } = load('src/lib/theme-templates.ts');
const arg = (key, fallback) => { const i = process.argv.indexOf(key); return i < 0 ? fallback : process.argv[i + 1]; };
const { chromium } = require(arg('--playwright-module', 'playwright'));
const base = 'http://localhost:3017', artifacts = '/tmp/backlog-theme-templates-browser';
const listKey = 'backlogbuster:custom-themes:v1', selectedKey = 'backlogbuster:custom-theme:v1';
const errors = [], results = []; let browser, server, activePage;
fs.mkdirSync(artifacts, { recursive: true });
async function ready() {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/access`)).ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 500)); }
  throw Error('Production server did not start');
}
async function assertStyle(page, panel, expected) {
  await page.waitForFunction(style => {
    const root = document.documentElement;
    return root.dataset.layoutMode === style.baseLayout && Object.entries(style.colors).every(([key, value]) => root.style.getPropertyValue(`--custom-${key}`) === value)
      && root.style.getPropertyValue('--custom-radius') === `${style.borderRadius}px`;
  }, expected);
  for (const [key, label] of Object.entries(themeColorFields)) assert.equal(await panel.getByLabel(label, { exact: true }).inputValue(), expected.colors[key]);
  for (const [key, label] of Object.entries(themeTermFields)) assert.equal(await panel.getByLabel(label, { exact: true }).inputValue(), expected.terminology[key] ?? '');
  for (const [key, label] of Object.entries({ scanlines: 'Scanlines', particles: 'Floating fairies / particles', parchment: 'Fantasy backdrop / parchment', haunted: 'Haunted decorations' })) {
    assert.equal(await panel.getByLabel(label, { exact: true }).isChecked(), expected.effects[key]);
  }
  assert.equal(await panel.getByRole('slider', { name: 'Border radius', exact: true }).inputValue(), String(expected.borderRadius));
}
async function shots(page, name) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const panel = page.locator('.theme-studio'); await panel.evaluate(node => { node.scrollTop = 0; });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    await page.screenshot({ path: `${artifacts}/${name}-${width}.png`, fullPage: false });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function main() {
  try {
    const log = fs.openSync(`${artifacts}/server.log`, 'w');
    server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3017'], {
      cwd: path.resolve(__dirname, '..'), detached: true, stdio: ['ignore', log, log], env: { ...process.env, APP_URL: base },
    }); fs.closeSync(log); await ready();
    const libraryPath = arg('--library-path', '');
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], env: { ...process.env, ...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}) } });
    for (const layout of ['cyberpunk', 'fantasy']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const target = { ...newCustomTheme(layout), name: 'My target theme', terminology: { workspaceTitle: 'Target workspace' } };
      const source = { ...newCustomTheme(layout === 'fantasy' ? 'cyberpunk' : 'fantasy'), name: 'Saved source palette', borderRadius: 23,
        terminology: { authTitle: 'Template gateway', libraryTitle: 'Template library' }, effects: { scanlines: true, particles: true, parchment: false, haunted: true } };
      const initial = [target, source];
      await context.addInitScript(({ listKey, selectedKey, initial, layout }) => {
        if (localStorage.getItem(listKey)) return;
        localStorage.setItem(listKey, JSON.stringify(initial)); localStorage.setItem(selectedKey, initial[0].id);
        localStorage.setItem('backlogbuster:layout-mode', layout); localStorage.setItem('backlogbuster:ui-muted', 'true');
      }, { listKey, selectedKey, initial, layout });
      const page = activePage = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/access`); await page.getByRole('button', { name: 'Custom Theme Studio', exact: true }).click();
      let panel = page.getByRole('dialog', { name: 'Custom Theme Studio', exact: true });
      const picker = () => panel.getByRole('combobox', { name: 'Start from Template', exact: true });
      const expectedTemplates = getThemeTemplates(initial, target.id);
      assert.deepEqual(await picker().locator('option:not([disabled])').allTextContents(), expectedTemplates.map(template => template.name));
      assert.equal(await picker().locator(`option[value="saved:${target.id}"]`).count(), 0, 'Current edit target is excluded');
      // All three built-ins plus a saved custom source map the entire form and DOM.
      for (const template of expectedTemplates) {
        await picker().selectOption(template.key); await assertStyle(page, panel, template.style);
        assert.equal(await panel.getByLabel('Theme name', { exact: true }).inputValue(), target.name);
        assert.equal(await picker().inputValue(), '', 'The action selector remains reusable');
      }
      await shots(page, `${layout}-saved-template`);
      assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), listKey), initial, 'Preview does not save');
      // A catalog refresh while editing must not replace custom field edits.
      await panel.getByLabel('Primary accent', { exact: true }).fill('#123456'); await panel.getByLabel('Library heading', { exact: true }).fill('My custom label');
      const other = await context.newPage(); await other.goto(`${base}/access`);
      await other.evaluate(({ key, initial }) => localStorage.setItem(key, JSON.stringify(initial)), { key: listKey, initial: [target, { ...source, name: 'Renamed source palette' }] });
      await picker().locator(`option[value="saved:${source.id}"]`).filter({ hasText: 'Renamed source palette' }).waitFor({ state: 'attached' });
      assert.equal(await panel.getByLabel('Primary accent', { exact: true }).inputValue(), '#123456');
      assert.equal(await panel.getByLabel('Library heading', { exact: true }).inputValue(), 'My custom label'); await other.close();
      // Selecting the same source again deliberately resets those edits, not the target's identity.
      await picker().selectOption(`saved:${source.id}`); await assertStyle(page, panel, source);
      await panel.getByRole('button', { name: 'Save & apply theme', exact: true }).click(); await panel.waitFor({ state: 'hidden' });
      let saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), listKey);
      assert.equal(saved.length, 2); assert.deepEqual(saved.find(theme => theme.id === target.id), { ...source, id: target.id, name: target.name });
      assert.deepEqual(saved.find(theme => theme.id === source.id), { ...source, name: 'Renamed source palette' });
      // New drafts clone into a fresh ID; cancelling later changes restores the saved clone.
      await page.getByRole('button', { name: 'Custom Theme Studio', exact: true }).click(); panel = page.getByRole('dialog', { name: 'Custom Theme Studio', exact: true });
      await panel.getByRole('button', { name: 'New theme', exact: true }).click();
      assert.equal(await picker().locator(`option[value="saved:${target.id}"]`).count(), 1);
      await picker().selectOption(`saved:${source.id}`); await assertStyle(page, panel, source);
      await panel.getByLabel('Theme name', { exact: true }).fill('Independent clone');
      await panel.getByRole('button', { name: 'Save & apply theme', exact: true }).click(); await panel.waitFor({ state: 'hidden' });
      saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), listKey);
      const clone = saved.find(theme => theme.name === 'Independent clone'); assert(clone); assert.equal(saved.length, 3);
      assert.notEqual(clone.id, target.id); assert.notEqual(clone.id, source.id); assert.deepEqual({ ...clone, id: source.id, name: source.name }, source);
      await page.getByRole('button', { name: 'Custom Theme Studio', exact: true }).click(); panel = page.getByRole('dialog', { name: 'Custom Theme Studio', exact: true });
      await picker().selectOption('builtin:halloween'); await panel.getByRole('button', { name: 'Cancel preview', exact: true }).click();
      await page.waitForFunction(id => document.documentElement.dataset.customTheme === id, clone.id);
      assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), listKey), saved);
      await context.close(); results.push({ layout, widths: [1440, 390], allSourcesMapped: true, previewBeforeSave: true, editTargetExcluded: true,
        fieldsAndIdentityPreserved: true, catalogRefreshPreservesEdits: true, sameSourceReset: true, savedSourceUnchanged: true, freshCloneId: true, cancelRestores: true, noOverflow: true });
    }
    assert.deepEqual(errors, []); fs.writeFileSync(`${artifacts}/results.json`, JSON.stringify({ productionBuild: true, results, runtimeErrors: errors }, null, 2));
    console.log('PASS: template selection, cloning and identity preservation at 1440/390px across both layouts.');
  } catch (error) { if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: `${artifacts}/failure.png` }).catch(() => {}); throw error; }
  finally { await browser?.close(); if (server) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} } }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
