/* eslint-disable @typescript-eslint/no-require-imports -- Production browser QA with disposable accounts. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomBytes, scryptSync } = require('node:crypto'), { spawn } = require('node:child_process');
require('dotenv/config');
const arg = (key, fallback) => { const i = process.argv.indexOf(key); return i < 0 ? fallback : process.argv[i + 1]; };
const { chromium } = require(arg('--playwright-module', 'playwright'));
const { neonConfig } = require('@neondatabase/serverless'); neonConfig.webSocketConstructor = require('ws');
const { PrismaNeon } = require('@prisma/adapter-neon'), { PrismaClient } = require('../src/generated/prisma/client.ts');
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
const base = 'http://localhost:3015', artifacts = '/tmp/backlog-theme-studio-browser'; fs.mkdirSync(artifacts, { recursive: true });
const ids = [], errors = [], results = []; let browser, server, activePage;
const customKey = 'backlogbuster:custom-themes:v1', selectionKey = 'backlogbuster:custom-theme:v1';
async function until(check) { for (let i = 0; i < 80; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 500)); } throw Error('QA server did not start'); }
async function shots(page, name) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} page overflows at ${width}`);
    const studio = page.locator('[data-theme-studio]');
    if (await studio.count()) { await studio.evaluate(node => { node.scrollTop = 0; }); assert(await studio.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${name} studio overflows`); }
    await page.screenshot({ path: `${artifacts}/${name}-${width}.png`, fullPage: false });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function main() {
  try {
    const log = fs.openSync(`${artifacts}/server.log`, 'w');
    server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3015'], {
      cwd: path.resolve(__dirname, '..'), detached: true, stdio: ['ignore', log, log], env: { ...process.env, APP_URL: base, STEAM_API_KEY: '' },
    }); fs.closeSync(log);
    await until(async () => { try { return (await fetch(`${base}/access`)).ok; } catch { return false; } });
    const libraryPath = arg('--library-path', '');
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], env: { ...process.env, ...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}) } });
    for (const builtin of ['cyberpunk', 'halloween', 'fantasy']) {
      const baseLayout = builtin === 'fantasy' ? 'fantasy' : 'cyberpunk';
      const suffix = randomBytes(5).toString('hex'), password = 'Studio QA exact password', salt = randomBytes(16);
      const player = await prisma.player.create({ data: { email: `studio-${suffix}@example.invalid`, preferredLayoutMode: baseLayout, handle: `studio-${suffix}`, operatorName: 'Studio QA',
        passwordHash: `scrypt$131072$8$1$${salt.toString('hex')}$${scryptSync(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString('hex')}` } }); ids.push(player.id);
      await prisma.game.create({ data: { userId: player.id, title: 'Theme Studio Sample', platform: 'PC' } });
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
      const page = activePage = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/access`); await page.getByRole('combobox', { name: 'UI theme', exact: true }).selectOption(builtin);
      await page.waitForFunction(value => document.documentElement.dataset.theme === value, builtin);
      const original = await page.evaluate(() => ({ background: getComputedStyle(document.body).background, theme: document.documentElement.dataset.theme,
        layout: localStorage.getItem('backlogbuster:layout-mode'), seasonal: localStorage.getItem('backlogbuster:theme') }));
      await shots(page, `${builtin}-built-in`);
      await page.getByRole('button', { name: 'Custom Theme Studio', exact: true }).click();
      let panel = page.getByRole('dialog', { name: 'Custom Theme Studio', exact: true });
      await panel.getByLabel('Theme name', { exact: true }).fill(`Observatory ${builtin}`);
      await panel.getByLabel('Primary background', { exact: true }).fill('#12182b');
      await panel.getByRole('slider', { name: 'Border radius', exact: true }).press('End');
      assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--custom-radius')), '32px');
      await panel.getByLabel('Surface / card background', { exact: true }).fill('#222b45');
      await panel.getByLabel('Primary accent', { exact: true }).fill('#f3b66b');
      await panel.getByLabel('Pick border / glow', { exact: true }).fill('#74689e');
      assert.equal(await panel.getByLabel('Border / glow', { exact: true }).inputValue(), '#74689e');
      await panel.getByLabel('Scanlines', { exact: true }).check(); await panel.getByLabel('Floating fairies / particles', { exact: true }).check();
      await panel.getByLabel('Fantasy backdrop / parchment', { exact: true }).check(); await panel.getByLabel('Haunted decorations', { exact: true }).check();
      await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--custom-background') === '#12182b');
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(18, 24, 43)');
      assert.equal(await page.locator('.auth-panel').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(34, 43, 69)');
      assert.equal(await panel.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(17, 25, 37)', 'Editor remains readable');
      assert.equal(await page.locator('.floating-fairies').count(), 1); assert(await page.locator('.halloween-decorations').isVisible());
      await panel.getByLabel('Primary background', { exact: true }).fill('invalid'); assert(await panel.getByRole('button', { name: 'Save & apply theme' }).isDisabled());
      assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--custom-background')), '#12182b');
      await panel.getByLabel('Primary background', { exact: true }).fill('#12182b');
      await panel.getByLabel('Base layout', { exact: true }).selectOption(baseLayout === 'fantasy' ? 'cyberpunk' : 'fantasy');
      await shots(page, `${builtin}-studio-preview`);
      await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => !document.documentElement.dataset.customTheme);
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).background), original.background);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), original.theme);
      assert.deepEqual(await page.evaluate(() => ({ layout: localStorage.getItem('backlogbuster:layout-mode'), seasonal: localStorage.getItem('backlogbuster:theme') })), { layout: original.layout, seasonal: original.seasonal });
      const custom = { id: `custom-browser-${suffix}`, name: `Observatory ${builtin}`, baseLayout,
        colors: { background: '#12182b', surface: '#222b45', text: '#eef1ff', muted: '#b5bfdc', accent: '#f3b66b', border: '#74689e' },
        effects: { scanlines: true, particles: true, parchment: true, haunted: false }, borderRadius: 14,
        terminology: { authTitle: 'Welcome to the Observatory', libraryTitle: 'The Observatory', statsTitle: 'Voyager record', inventoryTitle: 'The Collection', deckTitle: 'Next landings', workspaceTitle: 'Orbit Control' } };
      await page.getByRole('button', { name: 'Custom Theme Studio', exact: true }).click(); panel = page.getByRole('dialog', { name: 'Custom Theme Studio', exact: true });
      await panel.getByLabel('Theme JSON', { exact: true }).fill('{bad'); await panel.getByRole('button', { name: 'Validate & preview JSON' }).click(); assert.match(await panel.getByRole('alert').textContent(), /valid JSON/);
      await panel.getByLabel('Theme JSON', { exact: true }).fill(JSON.stringify({ ...custom, colors: { ...custom.colors, accent: 'url(evil)' } }));
      await panel.getByRole('button', { name: 'Validate & preview JSON' }).click(); assert.match(await panel.getByRole('alert').textContent(), /colors.accent/);
      await panel.getByLabel('Theme JSON', { exact: true }).fill(JSON.stringify(custom)); await panel.getByRole('button', { name: 'Validate & preview JSON' }).click();
      await page.locator('.auth-heading h2:visible').filter({ hasText: custom.terminology.authTitle }).waitFor();
      await panel.getByRole('button', { name: 'Copy theme JSON' }).click();
      assert.deepEqual(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())), custom);
      await panel.getByRole('button', { name: 'Save & apply theme' }).click(); await panel.waitFor({ state: 'hidden' });
      assert.equal(await page.getByRole('combobox', { name: 'UI theme', exact: true }).inputValue(), custom.id);
      assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), customKey), [custom]);
      // Block application chunks: root tokens must already be restored by the inline bootstrap.
      const beforeHydration = await context.newPage();
      await beforeHydration.route(/\/_next\/.*\.js(?:\?|$)/, route => route.abort());
      await beforeHydration.goto(`${base}/access`, { waitUntil: 'domcontentloaded' });
      assert.equal(await beforeHydration.evaluate(() => document.documentElement.dataset.customTheme), custom.id);
      assert.equal(await beforeHydration.evaluate(() => document.documentElement.style.getPropertyValue('--custom-accent')), custom.colors.accent);
      await beforeHydration.close();
      await page.reload(); await page.waitForFunction(id => document.documentElement.dataset.customTheme === id, custom.id);
      // Cross-tab selection changes apply without echo writes or a reload.
      const second = await context.newPage(); await second.goto(`${base}/access`);
      await second.getByRole('combobox', { name: 'UI theme', exact: true }).selectOption('fantasy');
      await page.waitForFunction(() => !document.documentElement.dataset.customTheme);
      await page.getByRole('combobox', { name: 'UI theme', exact: true }).selectOption(custom.id); await second.waitForFunction(id => document.documentElement.dataset.customTheme === id, custom.id);
      await second.close();
      await page.locator('[name=email]:visible').fill(player.email); await page.locator('[name=password]:visible').fill(password); await page.locator('.auth-submit:visible').click();
      await page.getByRole('button', { name: '⚙ ACCOUNT SECURITY', exact: true }).waitFor({ timeout: 60000 });
      await page.locator('#collection-title:visible').filter({ hasText: 'The Observatory' }).waitFor();
      await page.getByRole('heading', { name: 'Orbit Control', exact: true }).waitFor();
      assert.equal((await prisma.player.findUniqueOrThrow({ where: { id: player.id } })).preferredLayoutMode, baseLayout, 'Custom themes do not rewrite account layout');
      await shots(page, `${builtin}-custom-workspace`);
      await page.getByRole('button', { name: 'Custom Theme Studio', exact: true }).first().click(); panel = page.getByRole('dialog', { name: 'Custom Theme Studio', exact: true });
      await panel.getByLabel('Theme name', { exact: true }).fill(`${custom.name} edited`);
      await panel.getByRole('button', { name: 'Save & apply theme' }).click(); await panel.waitFor({ state: 'hidden' });
      assert.equal((await page.evaluate(key => JSON.parse(localStorage.getItem(key)), customKey)).length, 1, 'Edits update existing IDs');
      // Storage failure keeps the draft/editor available for JSON export.
      await page.getByRole('button', { name: 'Custom Theme Studio', exact: true }).first().click(); panel = page.getByRole('dialog', { name: 'Custom Theme Studio', exact: true });
      await page.evaluate(() => { window.__studioSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.includes('custom-theme')) throw new DOMException('Quota', 'QuotaExceededError'); return window.__studioSetItem.call(this, key, value); }; });
      await panel.getByRole('button', { name: 'Save & apply theme' }).click(); assert.match(await panel.getByRole('alert').textContent(), /storage.*unavailable|storage.*full/);
      await page.evaluate(() => { Storage.prototype.setItem = window.__studioSetItem; });
      await panel.getByRole('button', { name: 'Delete custom theme' }).click();
      await page.waitForFunction(() => !document.documentElement.dataset.customTheme);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), selectionKey), null);
      assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), customKey), []);
      await panel.getByRole('button', { name: 'Close Custom Theme Studio' }).click();
      await page.getByRole('combobox', { name: 'UI theme', exact: true }).first().selectOption(builtin);
      await page.waitForFunction(value => document.documentElement.dataset.theme === value, builtin);
      assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--custom-accent')), '');
      assert.equal(await page.locator('#collection-title:visible').textContent(), builtin === 'fantasy' ? 'Your Quest Journal' : 'System Playqueue');
      await shots(page, `${builtin}-restored`);
      await context.close(); results.push({ builtin, widths: [1440, 390], livePreview: true, cancelRestoresBuiltin: true, colorAndHexInputs: true, effects: true,
        jsonValidationAndClipboard: true, savedAndReloaded: true, prePaintRestoration: true, crossTabSync: true, customTerminology: true, accountLayoutPreserved: true,
        editAndDelete: true, storageFailureHandled: true, noOverflow: true });
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${artifacts}/results.json`, JSON.stringify({ productionBuild: true, results, runtimeErrors: errors }, null, 2));
    console.log('PASS: Custom Theme Studio production checks across Cyberpunk, Haunted Net / Blackwall Glitch and Fantasy at 1440/390px.');
  } catch (error) { if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: `${artifacts}/failure.png` }).catch(() => {}); throw error; }
  finally { await browser?.close(); if (server) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} } await prisma.player.deleteMany({ where: { id: { in: ids } } }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
