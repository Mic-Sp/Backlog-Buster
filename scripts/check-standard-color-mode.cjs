/* eslint-disable @typescript-eslint/no-require-imports -- Browser/OS appearance and real account persistence with disposable data. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomBytes, scryptSync } = require('node:crypto'), { spawn } = require('node:child_process');
require('dotenv/config');
const arg = (key, fallback) => { const i = process.argv.indexOf(key); return i < 0 ? fallback : process.argv[i + 1]; };
const { chromium } = require(arg('--playwright-module', 'playwright'));
const { neonConfig } = require('@neondatabase/serverless'); neonConfig.webSocketConstructor = require('ws');
const { PrismaNeon } = require('@prisma/adapter-neon'), { PrismaClient } = require('../src/generated/prisma/client.ts');
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
const base = `http://localhost:${arg('--port', '3029')}`, artifacts = '/tmp/backlog-standard-color-mode'; fs.mkdirSync(artifacts, { recursive: true });
let server, browser, page, playerId; const errors = [], results = [];
async function until(check, label) { for (let i = 0; i < 80; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 500)); } throw Error(`Timed out: ${label}`); }
function contrast(a, b) {
  const luminance = value => { const rgb = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }); return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722; };
  const l = [luminance(a), luminance(b)].sort((x, y) => y - x); return (l[0] + .05) / (l[1] + .05);
}
async function main() {
  try {
    const log = fs.openSync(`${artifacts}/server.log`, 'w');
    server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', new URL(base).port], {
      cwd: path.resolve(__dirname, '..'), detached: true, stdio: ['ignore', log, log], env: { ...process.env, APP_URL: base, STEAM_API_KEY: '', GEMINI_API_KEY: '', WS_NO_BUFFER_UTIL: '1', WS_NO_UTF_8_VALIDATE: '1' },
    }); fs.closeSync(log);
    await until(async () => { try { return (await fetch(`${base}/access`)).ok; } catch { return false; } }, 'production server');
    const libraryPath = arg('--library-path', '');
    browser = await chromium.launch({ headless: true, executablePath: arg('--browser-path', undefined), args: ['--no-sandbox'], env: { ...process.env, ...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}) } });
    // App chunks are blocked: only the synchronous root scripts can restore paint.
    for (const os of ['light', 'dark']) for (const choice of ['system', 'light', 'dark', 'blocked']) {
      const context = await browser.newContext({ colorScheme: os });
      await context.addInitScript(choice => {
        if (choice === 'blocked') Object.defineProperty(window, 'localStorage', { get() { throw Error('Storage blocked for QA'); } });
        else if (choice !== 'system') localStorage.setItem('backlogbuster:color-mode', choice);
      }, choice);
      const beforeHydration = await context.newPage(); await beforeHydration.route('**/_next/static/**/*.js', route => route.abort());
      await beforeHydration.goto(`${base}/access`, { waitUntil: 'domcontentloaded' });
      const mode = choice === 'system' || choice === 'blocked' ? os : choice;
      assert.equal(await beforeHydration.locator('html').getAttribute('data-color-mode'), mode);
      assert.equal(await beforeHydration.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), mode === 'light' ? 'rgb(248, 250, 252)' : 'rgb(15, 19, 26)');
      await context.close(); results.push({ preHydration: true, os, choice, mode });
    }
    console.log('Verified pre-hydration paint for both OS schemes, explicit overrides, and blocked storage.');
    const suffix = randomBytes(6).toString('hex'), salt = randomBytes(16), password = `Mode QA ${randomBytes(10).toString('hex')}`;
    const player = await prisma.player.create({ data: { email: `color-mode-${suffix}@example.invalid`, handle: `color-mode-${suffix}`, operatorName: 'Color Mode QA', preferredLayoutMode: 'standard', preferredColorMode: 'system',
      passwordHash: `scrypt$131072$8$1$${salt.toString('hex')}$${scryptSync(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString('hex')}` }, select: { id: true, email: true } }); playerId = player.id;
    const games = [];
    for (const [index, status] of ['Backlog', 'Playing', 'Completed', 'Flatlined'].entries()) games.push(await prisma.game.create({ data: { userId: playerId, title: `Color Sample ${index + 1}`, status, playthroughCount: status === 'Completed' ? 1 : 0, platform: 'PC', lengthHours: 10, difficulty: 1, releaseYear: 2020, hypeLevel: index % 3 + 1, coverUrl: `${base}/hud-logo.png` }, select: { id: true, title: true } }));
    const context = await browser.newContext({ colorScheme: 'light', viewport: { width: 1440, height: 1100 } }); page = await context.newPage();
    page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /hydration|did not match/i.test(message.text())) errors.push(message.text()); });
    async function login(target) { await target.goto(`${base}/access`); await target.locator('input[name=email]').fill(player.email); await target.locator('input[name=password]').fill(password); await target.locator('.auth-submit').click(); await target.waitForURL(`${base}/`); await target.locator('.standard-color-modes').waitFor(); }
    await login(page);
    const modeButtons = () => page.getByRole('group', { name: 'Color mode', exact: true });
    async function mode(value) { await modeButtons().getByRole('button', { name: value[0].toUpperCase() + value.slice(1), exact: true }).click(); await until(async () => (await prisma.player.findUnique({ where: { id: playerId }, select: { preferredColorMode: true } })).preferredColorMode === value, `account preference ${value}`); }
    async function resolved(value) { await page.waitForFunction(value => document.documentElement.dataset.colorMode === value, value); }
    await resolved('light'); await mode('dark'); await resolved('dark'); await page.emulateMedia({ colorScheme: 'light' }); await resolved('dark');
    assert.equal(await page.evaluate(() => localStorage.getItem('backlogbuster:color-mode')), 'dark'); await page.reload(); await resolved('dark');
    await mode('system'); assert.equal(await page.evaluate(() => localStorage.getItem('backlogbuster:color-mode')), null);
    for (const os of ['dark', 'light', 'dark', 'light']) { await page.emulateMedia({ colorScheme: os }); await resolved(os); }
    await mode('light'); await resolved('light');
    await page.getByRole('group', { name: 'Library view' }).getByRole('button', { name: /^All Games/ }).click();
    const colors = await page.evaluate(() => {
      const styles = selector => getComputedStyle(document.querySelector(selector));
      const body = styles('body'), card = styles('.standard-game-card'), button = styles('.standard-quick-start button');
      return { body: body.backgroundColor, text: body.color, card: card.backgroundColor, nav: styles('.standard-header').backgroundColor, muted: styles('.standard-card-meta').color, cta: button.backgroundColor, ctaText: button.color };
    });
    assert.equal(colors.body, 'rgb(248, 250, 252)'); assert.equal(colors.card, 'rgb(255, 255, 255)'); assert.equal(colors.nav, colors.card);
    assert(contrast(colors.text, colors.card) >= 4.5); assert(contrast(colors.muted, colors.card) >= 4.5); assert(contrast(colors.ctaText, colors.cta) >= 4.5);
    const count = await page.locator('.member-count').evaluate(node => ({ background: getComputedStyle(node).backgroundColor, text: getComputedStyle(node.querySelector('strong')).color })); assert(contrast(count.text, count.background) >= 4.5);
    const pills = await page.locator('.standard-status-badge').evaluateAll(nodes => nodes.map(node => ({ text: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor })));
    for (const pill of pills) assert(contrast(pill.text, pill.background) >= 4.5, JSON.stringify(pill));
    const hype = await page.locator('.hype-meter[data-hype-level="3"] .hype-bars > span[data-lit="true"]').first().evaluate(node => getComputedStyle(node).backgroundColor);
    assert.equal(hype, 'rgb(217, 119, 6)'); assert(contrast(hype, colors.card) >= 3);
    await page.screenshot({ path: `${artifacts}/light-desktop.png`, fullPage: true });
    await page.locator(`.standard-game-card[data-library-game-id="${games[0].id}"] .standard-card-cover`).click();
    const drawer = page.getByRole('dialog', { name: games[0].title }); await drawer.waitFor();
    assert.equal(await drawer.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)');
    assert.equal(await drawer.locator('input[type=date]').first().evaluate(node => getComputedStyle(node).colorScheme), 'light');
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: `${artifacts}/light-drawer-mobile.png` }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.keyboard.press('Escape');
    await page.screenshot({ path: `${artifacts}/light-mobile.png`, fullPage: true }); await page.setViewportSize({ width: 1440, height: 1100 });
    // A fresh browser starts without device storage, then receives the account preference.
    const fresh = await browser.newContext({ colorScheme: 'dark' }), freshPage = await fresh.newPage(); await login(freshPage);
    await freshPage.waitForFunction(() => document.documentElement.dataset.colorMode === 'light'); assert.equal(await freshPage.evaluate(() => localStorage.getItem('backlogbuster:color-mode')), 'light'); await fresh.close();
    // Fixed themes must ignore the resolved mode as the OS changes.
    await mode('system'); await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Theme', exact: true }).click();
    for (const theme of ['cyberpunk', 'fantasy', 'biohazard']) {
      await page.locator('.theme-selector:visible').first().selectOption(theme); await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      await page.emulateMedia({ colorScheme: 'light' }); await resolved('light'); const light = await page.locator('body').evaluate(node => ({ background: getComputedStyle(node).background, color: getComputedStyle(node).color }));
      await page.emulateMedia({ colorScheme: 'dark' }); await resolved('dark'); assert.deepEqual(await page.locator('body').evaluate(node => ({ background: getComputedStyle(node).background, color: getComputedStyle(node).color })), light);
    }
    await page.locator('.theme-selector:visible').first().selectOption('standard'); await page.locator('.standard-game-card').first().waitFor(); await resolved('dark');
    await page.screenshot({ path: `${artifacts}/dark-desktop.png`, fullPage: true }); await page.emulateMedia({ colorScheme: 'light' }); await resolved('light');
    const custom = { id: 'custom-color-mode-qa', name: 'Fixed QA Palette', baseLayout: 'standard', colors: { background: '#112233', surface: '#203044', text: '#f1f5f9', muted: '#cbd5e1', accent: '#a5b4fc', border: '#64748b' }, effects: { scanlines: false, particles: false, parchment: false, haunted: false }, borderRadius: 8, terminology: {} };
    await page.evaluate(custom => { localStorage.setItem('backlogbuster:custom-themes:v1', JSON.stringify([custom])); localStorage.setItem('backlogbuster:custom-theme:v1', custom.id); window.dispatchEvent(new StorageEvent('storage', { key: 'backlogbuster:custom-theme:v1' })); }, custom);
    await page.waitForFunction(() => document.documentElement.dataset.customTheme === 'custom-color-mode-qa');
    for (const os of ['dark', 'light']) { await page.emulateMedia({ colorScheme: os }); await resolved(os); assert.equal(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(17, 34, 51)'); }
    assert.equal(await modeButtons().locator('button:disabled').count(), 3);
    await page.evaluate(() => { localStorage.removeItem('backlogbuster:custom-theme:v1'); localStorage.removeItem('backlogbuster:custom-themes:v1'); window.dispatchEvent(new StorageEvent('storage', { key: 'backlogbuster:custom-theme:v1' })); });
    await page.waitForFunction(() => !document.documentElement.dataset.customTheme); assert.equal(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(248, 250, 252)');
    assert.deepEqual(errors, []); fs.writeFileSync(`${artifacts}/results.json`, JSON.stringify({ preHydration: results, liveOSSync: true, explicitOverrides: true, accountPersistence: true, newBrowserRestore: true, fixedThemeIsolation: true, customPalettePreserved: true, contrast: { text: contrast(colors.text, colors.card), muted: contrast(colors.muted, colors.card), cta: contrast(colors.ctaText, colors.cta), tier3Bars: contrast(hype, colors.card) }, runtimeErrors: errors }, null, 2));
    console.log('PASS: System/Light/Dark, live OS changes, account/reload restoration, AA text contrast, responsive light components, and fixed-theme isolation.');
  } catch (error) { if (page && !page.isClosed()) await page.screenshot({ path: `${artifacts}/failure.png` }).catch(() => {}); throw error; }
  finally { await browser?.close(); if (server) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} } if (playerId) await prisma.player.deleteMany({ where: { id: playerId } }); await prisma.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
