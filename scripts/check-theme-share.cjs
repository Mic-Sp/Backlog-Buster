/* eslint-disable @typescript-eslint/no-require-imports -- Production browser QA; no account or database mutations. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { spawn } = require('node:child_process');
const { loader } = require('../tests/helpers/social-fixture.cjs');
const load = loader(), { newCustomTheme } = load('src/lib/custom-theme.ts');
const { encodeThemeShare, decodeThemeShare } = load('src/lib/theme-share.ts');
const arg = (key, fallback) => { const i = process.argv.indexOf(key); return i < 0 ? fallback : process.argv[i + 1]; };
const { chromium } = require(arg('--playwright-module', 'playwright'));
const port = '3016', base = `http://localhost:${port}`, artifacts = '/tmp/backlog-theme-share-browser';
const listKey = 'backlogbuster:custom-themes:v1', selectedKey = 'backlogbuster:custom-theme:v1';
fs.mkdirSync(artifacts, { recursive: true });
let server, browser, activePage;
const errors = [], results = [];
async function ready() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/access`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error('Production QA server did not start');
}
async function storage(page) {
  return page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])),
    [listKey, selectedKey, 'backlogbuster:layout-mode', 'backlogbuster:theme']);
}
async function appearance(page) {
  return page.evaluate(() => ({ theme: document.documentElement.dataset.theme, layout: document.documentElement.dataset.layoutMode,
    custom: document.documentElement.dataset.customTheme ?? null, background: getComputedStyle(document.body).background }));
}
async function shots(page, name, studio = false) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: page overflows at ${width}`);
    const panel = page.locator(studio ? '.theme-studio' : '.shared-theme-banner');
    assert(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${name}: controls overflow at ${width}`);
    if (studio) await panel.getByRole('button', { name: 'Copy Share Link', exact: true }).scrollIntoViewIfNeeded();
    else {
      const box = await panel.boundingBox(); assert(box.x >= 0 && box.x + box.width <= width + 1);
      assert(box.y >= 0 && box.y + box.height <= (width === 390 ? 844 : 1000));
    }
    await page.screenshot({ path: `${artifacts}/${name}-${width}.png`, fullPage: false });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function main() {
  try {
    const log = fs.openSync(`${artifacts}/server.log`, 'w');
    server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', port], {
      cwd: path.resolve(__dirname, '..'), detached: true, stdio: ['ignore', log, log], env: { ...process.env, APP_URL: base },
    }); fs.closeSync(log);
    await ready();
    const libraryPath = arg('--library-path', '');
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], env: { ...process.env, ...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}) } });
    for (const builtin of ['cyberpunk', 'halloween', 'fantasy']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
      const page = activePage = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      const banner = page.getByRole('region', { name: 'Shared theme preview', exact: true });
      await page.goto(`${base}/access`); await page.getByRole('combobox', { name: 'UI theme', exact: true }).selectOption(builtin);
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, builtin);
      const original = await appearance(page);
      const local = { ...newCustomTheme(builtin === 'fantasy' ? 'fantasy' : 'cyberpunk'), name: 'My existing palette' };
      const shared = { ...newCustomTheme(builtin === 'fantasy' ? 'cyberpunk' : 'fantasy'), id: local.id,
        name: `月の庭 🌙 ${builtin}`, colors: { background: '#12182b', surface: '#222b45', text: '#eef1ff', muted: '#b5bfdc', accent: '#f3b66b', border: '#74689e' },
        effects: { scanlines: true, particles: false, parchment: false, haunted: false }, terminology: { authTitle: 'Shared adventures 🐉' } };
      await page.evaluate(({ key, theme }) => localStorage.setItem(key, JSON.stringify([theme])), { key: listKey, theme: local });
      const before = await storage(page), encoded = encodeThemeShare(shared);
      const link = `${base}/access?sort=recent&theme=${encoded}&private=keep#details`;
      // Direct loading applies the shared palette without persisting any theme selection.
      await page.goto(link); await banner.waitFor();
      await page.waitForFunction(color => document.documentElement.style.getPropertyValue('--custom-background') === color, shared.colors.background);
      assert.match(await banner.textContent(), new RegExp(shared.name)); assert.deepEqual(await storage(page), before);
      assert.equal(await page.getByRole('combobox', { name: 'UI theme', exact: true }).inputValue(), 'shared-theme-preview');
      assert.equal(await page.getByRole('combobox', { name: 'UI theme', exact: true }).locator('option:checked').textContent(), `${shared.name} (preview)`);
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(18, 24, 43)');
      assert.match(await banner.evaluate(node => getComputedStyle(node).backgroundColor), /^rgba\(17, 25, 37, 0\.9/);
      await shots(page, `${builtin}-shared-preview`);
      await banner.getByRole('button', { name: 'Dismiss / Revert', exact: true }).click(); await banner.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => !document.documentElement.dataset.customTheme);
      assert.deepEqual(await appearance(page), original); assert.deepEqual(await storage(page), before);
      assert.equal(new URL(page.url()).search, '?sort=recent&private=keep'); assert.equal(new URL(page.url()).hash, '#details');
      // A prior saved custom theme also survives the preview despite an incoming ID collision.
      await page.evaluate(({ key, id }) => localStorage.setItem(key, id), { key: selectedKey, id: local.id }); await page.reload();
      await page.waitForFunction(color => document.documentElement.style.getPropertyValue('--custom-background') === color, local.colors.background);
      const savedAppearance = await appearance(page), savedStorage = await storage(page);
      await page.goto(link); await banner.waitFor(); await banner.getByRole('button', { name: 'Dismiss / Revert' }).click();
      await page.waitForFunction(color => document.documentElement.style.getPropertyValue('--custom-background') === color, local.colors.background);
      assert.deepEqual(await appearance(page), savedAppearance); assert.deepEqual(await storage(page), savedStorage);
      // URL changes through the native history API are detected by Next's query hook as well.
      await page.evaluate(url => history.pushState(null, '', url), link); await banner.waitFor();
      // Editing a shared theme uses a fresh draft ID and cancellation restores the shared preview.
      await page.getByRole('button', { name: 'Custom Theme Studio', exact: true }).click();
      let panel = page.getByRole('dialog', { name: 'Custom Theme Studio', exact: true });
      assert.equal(await banner.count(), 0); assert.equal(await panel.getByLabel('Theme name', { exact: true }).inputValue(), shared.name);
      assert.equal(await panel.getByRole('button', { name: 'Delete custom theme' }).count(), 0);
      await panel.getByRole('button', { name: 'Copy Share Link', exact: true }).click();
      await panel.getByRole('status').filter({ hasText: 'Share link copied to clipboard.' }).waitFor();
      const copied = await page.evaluate(() => navigator.clipboard.readText()), copiedUrl = new URL(copied);
      assert.equal(copiedUrl.origin, base); assert.equal(copiedUrl.pathname, '/access'); assert.equal(copiedUrl.hash, '');
      assert.deepEqual([...copiedUrl.searchParams.keys()], ['theme']);
      const copiedTheme = decodeThemeShare(copiedUrl.searchParams.get('theme'));
      assert(copiedTheme); assert.notEqual(copiedTheme.id, local.id); assert.deepEqual({ ...copiedTheme, id: shared.id }, shared);
      assert.equal(await panel.getByLabel('Share link', { exact: true }).inputValue(), copied);
      assert.deepEqual(await storage(page), savedStorage);
      await shots(page, `${builtin}-copy-share-link`, true);
      // Blocked clipboard still provides a selectable URL and clear feedback.
      await page.evaluate(() => { window.__copyText = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = () => Promise.reject(Error('Denied')); });
      await panel.getByRole('button', { name: 'Copy Share Link', exact: true }).click();
      await panel.getByRole('status').filter({ hasText: 'Clipboard unavailable.' }).waitFor();
      assert.equal(await panel.getByLabel('Share link', { exact: true }).inputValue(), copied);
      await page.evaluate(() => { navigator.clipboard.writeText = window.__copyText; });
      await panel.getByRole('button', { name: 'Close Custom Theme Studio' }).click(); await banner.waitFor();
      // A denied save preserves both the preview and URL so users can retry or revert.
      await page.evaluate(() => { window.__storageWrite = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) {
        if (key.includes('custom-theme')) throw new DOMException('Quota', 'QuotaExceededError'); return window.__storageWrite.call(this, key, value);
      }; });
      await banner.getByRole('button', { name: 'Save & Apply', exact: true }).click();
      assert.match(await banner.getByRole('alert').textContent(), /storage is unavailable or full/);
      assert.equal(new URL(page.url()).searchParams.get('theme'), encoded); assert.deepEqual(await storage(page), savedStorage);
      await page.evaluate(() => { Storage.prototype.setItem = window.__storageWrite; });
      await banner.getByRole('button', { name: 'Save & Apply', exact: true }).click(); await banner.waitFor({ state: 'hidden' });
      const after = await storage(page), saved = JSON.parse(after[listKey]), accepted = saved.find(theme => theme.id !== local.id);
      assert.equal(saved.length, 2); assert.deepEqual(saved.find(theme => theme.id === local.id), local);
      assert(accepted); assert.deepEqual({ ...accepted, id: shared.id }, shared); assert.equal(after[selectedKey], accepted.id);
      assert.equal(after['backlogbuster:layout-mode'], before['backlogbuster:layout-mode']);
      assert.equal(after['backlogbuster:theme'], before['backlogbuster:theme']);
      assert.equal(new URL(page.url()).search, '?sort=recent&private=keep'); assert.equal(new URL(page.url()).hash, '#details');
      await page.reload(); await page.waitForFunction(id => document.documentElement.dataset.customTheme === id, accepted.id);
      // Corruption/ambiguity never replaces an existing palette and never opens a banner.
      for (const query of [`theme=${encoded.slice(0, -1)}`, `theme=${encoded}&theme=${encoded}`, 'theme=broken', 'theme=']) {
        await page.goto(`${base}/access?${query}`);
        await page.getByRole('button', { name: 'Custom Theme Studio', exact: true }).click();
        panel = page.getByRole('dialog', { name: 'Custom Theme Studio', exact: true });
        await panel.getByRole('button', { name: 'Close Custom Theme Studio' }).click();
        assert.equal(await banner.count(), 0); assert.equal((await appearance(page)).custom, accepted.id); assert.deepEqual(await storage(page), after);
      }
      await context.close(); results.push({ builtin, widths: [1440, 390], unicodeRoundTrip: true, directLoadAndHistoryDetection: true,
        previewDoesNotPersist: true, dismissRestoresBuiltinAndCustom: true, collisionsPreserved: true, clipboardAndManualCopy: true,
        studioCancelRestoresShared: true, quotaErrorsRecoverable: true, savePersistsFreshId: true, invalidLinksIgnored: true, noOverflow: true });
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${artifacts}/results.json`, JSON.stringify({ productionBuild: true, results, runtimeErrors: errors }, null, 2));
    console.log('PASS: shared theme links across Cyberpunk, Haunted Net / Blackwall Glitch and Fantasy at 1440/390px.');
  } catch (error) { if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: `${artifacts}/failure.png` }).catch(() => {}); throw error; }
  finally { await browser?.close(); if (server) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} } }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
