/* eslint-disable @typescript-eslint/no-require-imports -- Production browser QA with disposable data. */
const assert = require('node:assert/strict'), fs = require('node:fs');
const { randomBytes, createHash, createHmac } = require('node:crypto'), { spawn } = require('node:child_process');
require('dotenv/config');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const { chromium } = require(arg('--playwright-module', 'playwright'));
const { neonConfig } = require('@neondatabase/serverless'); neonConfig.webSocketConstructor = require('ws');
const { PrismaNeon } = require('@prisma/adapter-neon'), { PrismaClient } = require('../src/generated/prisma/client.ts');
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
const artifacts = '/tmp/backlog-discovery-browser', port = '3018', base = `http://localhost:${port}`;
fs.mkdirSync(artifacts, { recursive: true });
const ids = [], errors = [], results = [], originals = new Map(), catalogKeys = [];
let browser, server, activePage, seeded = false;
const today = new Date(); today.setUTCHours(0, 0, 0, 0);
const date = days => new Date(today.getTime() + days * 86400000).toISOString().slice(0, 10);
const suffix = randomBytes(5).toString('hex');
const card = (label, days) => ({ title: `Discovery QA ${label} ${suffix}`, key: `discovery-qa-${suffix}-${label}`, releaseYear: today.getUTCFullYear(),
  releaseDate: days === null ? null : date(days), platforms: ['PC', 'PlayStation 5', 'Xbox Series X/S'], genre: 'Adventure / Role-playing', estimatedHours: null,
  coverUrl: null, signal: label === 'Community' ? 'community' : 'release' });
const cards = [card('Upcoming', 20), card('Recent', -20), card('Today', 0), card('Community', -900), card('Owned', -10), card('Dismissed', 15), card('Undated', null)];
const [upcoming, recent, released, community, owned, dismissed] = cards;
async function waitServer() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/access`)).ok) return; } catch { /* still starting */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error('Browser server did not start');
}
async function main() {
  try {
    for (const kind of ['radar', 'popular']) originals.set(kind, await prisma.discoveryFeed.findUnique({ where: { kind } }));
    seeded = true;
    for (const kind of ['radar', 'popular']) {
      const data = { items: cards, source: 'local', refreshedAt: new Date(), expiresAt: new Date(Date.now() + 18 * 3600000), leaseId: null, leaseUntil: null };
      await prisma.discoveryFeed.upsert({ where: { kind }, create: { kind, ...data }, update: data });
    }
    const cacheBefore = await prisma.discoveryFeed.findMany({ orderBy: { kind: 'asc' } });
    const log = fs.openSync(`${artifacts}/server.log`, 'w');
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', port], {
      cwd: process.cwd(), stdio: ['ignore', log, log], env: { ...process.env, APP_URL: base,
        GEMINI_API_KEY: '', RAWG_API_KEY: '', TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '', STEAM_API_KEY: '' },
    }); fs.closeSync(log);
    await waitServer();
    const libraryPath = arg('--library-path', '');
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], env: { ...process.env, ...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}) } });
    for (const mode of ['cyberpunk', 'fantasy', 'custom-cyberpunk', 'custom-fantasy']) {
      const fantasy = mode.endsWith('fantasy'), custom = mode.startsWith('custom-'), layout = fantasy ? 'fantasy' : 'cyberpunk';
      const idSuffix = randomBytes(4).toString('hex');
      const player = await prisma.player.create({ data: { email: `discovery-${idSuffix}@example.invalid`, passwordHash: 'disposable-browser-fixture',
        handle: `discovery-${idSuffix}`, operatorName: 'Discovery Browser QA', preferredLayoutMode: layout, profileVisibility: 'private' } }); ids.push(player.id);
      await prisma.game.create({ data: { userId: player.id, title: owned.title, platform: 'PC' } });
      await prisma.recommendationDismissal.create({ data: { userId: player.id, titleKey: dismissed.title.toLowerCase() } });
      const secret = process.env.AUTH_SECRET ? Buffer.from(process.env.AUTH_SECRET)
        : Buffer.from((await prisma.authSecret.findUniqueOrThrow({ where: { id: 'session-signing-v1' } })).value, 'hex');
      const token = randomBytes(32).toString('base64url'), payload = `v1.${token}`;
      await prisma.playerSession.create({ data: { userId: player.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000) } });
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await context.addCookies([{ name: '__Host-bb_session_v1', value: `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`,
        url: `https://localhost:${port}`, secure: true, httpOnly: true, sameSite: 'Lax' }]);
      await context.addInitScript(({ custom, layout }) => {
        localStorage.setItem('backlogbuster:layout-mode', layout); localStorage.setItem('backlogbuster:theme', 'default');
        if (custom) {
          const theme = { id: 'custom-discovery-qa', name: 'Discovery QA', baseLayout: layout, colors: {
            background: '#101827', surface: '#1e293b', text: '#f1f5f9', muted: '#cbd5e1', accent: '#fbbf24', border: '#64748b' },
          effects: { scanlines: false, particles: false, parchment: false, haunted: false }, borderRadius: 12,
          terminology: layout === 'cyberpunk' ? { scoutTitle: 'Discovery Almanac', releaseRadarTitle: 'Fresh Horizons' } : {} };
          localStorage.setItem('backlogbuster:custom-themes:v1', JSON.stringify([theme]));
          localStorage.setItem('backlogbuster:custom-theme:v1', theme.id);
        }
      }, { custom, layout });
      const page = activePage = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.locator(`html[data-layout-mode="${layout}"]`).waitFor();
      if (custom) await page.locator('html[data-custom-theme="custom-discovery-qa"]').waitFor();
      await page.getByRole('button', { name: /CORTEX.*ADVISE NEXT GIG|NAVI.*SEEK GUIDANCE/ }).click();
      const dialog = page.getByRole('dialog'), scout = dialog.locator('.advisor-external-section');
      const radarLabel = custom && !fantasy ? 'Fresh Horizons' : fantasy ? 'New Chronicles' : 'New & Upcoming Radar';
      const popularLabel = fantasy ? 'Tales of Renown' : 'Popular / Trending';
      const radar = scout.getByRole('tab', { name: radarLabel, exact: true }), popular = scout.getByRole('tab', { name: popularLabel, exact: true });
      assert.equal(await scout.getByRole('tab').count(), 3);
      if (custom && !fantasy) assert.equal(await scout.locator('h3').textContent(), 'Discovery Almanac');
      await radar.click();
      const panel = () => scout.getByRole('tabpanel').filter({ visible: true });
      await panel().locator('.discovery-card').first().waitFor({ timeout: 30000 });
      assert.deepEqual(await panel().locator('h4').allInnerTexts(), [recent.title, released.title, upcoming.title]);
      await panel().getByText(fantasy ? 'Town Crier’s Board // New Chronicles' : 'RELEASE RADAR // MARKET TELEMETRY', { exact: true }).waitFor();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const [tab, name] of [[radar, 'radar'], [popular, 'popular']]) {
          await tab.click(); await panel().locator('.discovery-card').first().waitFor();
          await panel().locator('.discovery-freshness').filter({ hasText: '18 hours' }).waitFor();
          const titles = await panel().locator('h4').allInnerTexts();
          assert(!titles.includes(owned.title)); assert(!titles.includes(dismissed.title));
          if (name === 'popular') assert(titles.includes(community.title));
          assert(await panel().getByRole('button', { name: '+ Add to Backlog / Wishlist', exact: true }).first().isVisible());
          for (const node of [dialog, scout.locator('.scout-subnav')]) {
            const bounds = await node.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
            assert(bounds.scroll <= bounds.client + 1, `${mode} ${width} ${name} overflow: ${JSON.stringify(bounds)}`);
          }
          await scout.locator('.scout-subnav').evaluate(el => {
            const modal = el.closest('.advisor-modal');
            modal.scrollTop += el.getBoundingClientRect().top - modal.getBoundingClientRect().top - 20;
          });
          assert.equal(await scout.locator('.scout-subnav').evaluate(el => getComputedStyle(el).display), 'flex');
          assert.equal(await tab.evaluate(el => parseFloat(getComputedStyle(el).minHeight)), 44);
          await page.screenshot({ path: `${artifacts}/${mode}-${name}-${width}.png` });
          results.push({ mode, width, tab: name, cards: titles.length, overflow: false });
        }
      }
      // Keyboard tab navigation also activates the matching panel.
      await popular.focus(); await page.keyboard.press('ArrowLeft');
      assert.equal(await radar.getAttribute('aria-selected'), 'true');
      await panel().locator('.discovery-card').first().waitFor();
      const upcomingCard = panel().locator('.discovery-card').filter({ has: page.getByRole('heading', { name: upcoming.title, exact: true }) });
      if (mode === 'cyberpunk') {
        const failSave = async route => {
          if (route.request().method() === 'POST' && route.request().postData()?.includes(upcoming.key)) await route.abort('failed');
          else await route.continue();
        };
        await page.route('**/*', failSave);
        await upcomingCard.getByRole('button', { name: '+ Add to Backlog / Wishlist', exact: true }).click();
        await panel().getByRole('alert').waitFor();
        await upcomingCard.waitFor();
        assert.equal(await prisma.game.count({ where: { userId: player.id, title: upcoming.title } }), 0);
        await page.unroute('**/*', failSave);
      }
      const documents = []; page.on('request', request => { if (request.isNavigationRequest() && request.resourceType() === 'document') documents.push(request.url()); });
      await upcomingCard.getByRole('button', { name: '+ Add to Backlog / Wishlist', exact: true }).click();
      await panel().getByRole('status').filter({ hasText: `${upcoming.title} added to your backlog / wishlist.` }).waitFor({ timeout: 30000 });
      assert.equal(await prisma.game.count({ where: { userId: player.id, title: upcoming.title, status: 'Backlog' } }), 1);
      assert.equal(await upcomingCard.count(), 0); assert(await dialog.isVisible());
      await panel().getByRole('button', { name: `Not interested in ${recent.title}`, exact: true }).click();
      await panel().getByRole('status').filter({ hasText: 'won’t appear in Scout or discovery feeds' }).waitFor();
      assert.equal(await prisma.recommendationDismissal.count({ where: { userId: player.id, titleKey: recent.title.toLowerCase() } }), 1);
      await popular.click(); await panel().locator('.discovery-card').first().waitFor();
      assert(!(await panel().locator('h4').allInnerTexts()).some(title => title === upcoming.title || title === recent.title));
      assert.deepEqual(documents, [], 'Card actions do not reload the document');
      // Reload removes all client memory: server-side ownership and preferences must still filter both feeds.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: /CORTEX.*ADVISE NEXT GIG|NAVI.*SEEK GUIDANCE/ }).click();
      await radar.click(); await panel().locator('.discovery-card').first().waitFor();
      assert.deepEqual(await panel().locator('h4').allInnerTexts(), [released.title]);
      await scout.getByRole('tab', { name: 'Scout / Search', exact: true }).click();
      await scout.locator('#scout-panel-search').waitFor();
      assert.equal(await scout.locator('#scout-panel-search .advisor-refresh').count(), 1);
      assert.deepEqual(await prisma.discoveryFeed.findMany({ orderBy: { kind: 'asc' } }), cacheBefore,
        'Theme changes, tab switches and personal actions reuse the global snapshots');
      if (mode === 'custom-fantasy') {
        // Exercise the real Postgres claim/update and community aggregation SQL with
        // keys disabled, rather than relying exclusively on seeded warm-cache reads.
        for (const item of cards) {
          catalogKeys.push(item.key);
          await prisma.gameCatalog.create({ data: { key: item.key, title: item.title, releaseYear: item.releaseYear,
            releaseDate: item.releaseDate ? new Date(item.releaseDate) : null, platforms: item.platforms, genre: item.genre } });
        }
        for (const kind of ['radar', 'popular']) {
          await prisma.discoveryFeed.update({ where: { kind }, data: { items: [], expiresAt: new Date(0) } });
          await scout.getByRole('tab', { name: kind === 'radar' ? radarLabel : popularLabel, exact: true }).click();
          await panel().locator('.discovery-card').first().waitFor();
          const row = await prisma.discoveryFeed.findUniqueOrThrow({ where: { kind } });
          assert.equal(row.source, 'local'); assert.equal(row.leaseId, null);
          assert(row.expiresAt > new Date(Date.now() + 17 * 3600000));
          if (kind === 'popular') assert(row.items.some(item => item.signal === 'community' && item.title === owned.title));
        }
        for (const row of cacheBefore) await prisma.discoveryFeed.update({ where: { kind: row.kind }, data: row });
      }
      await context.close();
    }
    const cacheAfter = await prisma.discoveryFeed.findMany({ orderBy: { kind: 'asc' } });
    assert.deepEqual(cacheAfter, cacheBefore, 'All themes, tab switches and personal actions reuse the same global snapshots');
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${artifacts}/results.json`, JSON.stringify({ results, errors, cacheUnchanged: true, actionsPersisted: true, noDocumentReloads: true }, null, 2));
    console.log(`Passed ${results.length} theme/viewport/feed combinations, keyboard navigation, server filtering, persistent add/dismiss actions, no reloads and unchanged shared cache.`);
  } catch (error) {
    if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: `${artifacts}/failure.png` }).catch(() => {});
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
    for (const id of ids) await prisma.player.delete({ where: { id } });
    if (catalogKeys.length) await prisma.gameCatalog.deleteMany({ where: { key: { in: catalogKeys } } });
    if (seeded) for (const [kind, original] of originals) {
      if (original) await prisma.discoveryFeed.upsert({ where: { kind }, create: original, update: original });
      else await prisma.discoveryFeed.deleteMany({ where: { kind } });
    }
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
