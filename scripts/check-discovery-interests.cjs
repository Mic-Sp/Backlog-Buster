/* eslint-disable @typescript-eslint/no-require-imports -- Real production browser/storage QA; fixtures are restored in finally. */
const assert = require('node:assert/strict'), fs = require('node:fs');
const { randomBytes, createHash, createHmac } = require('node:crypto'), { spawn } = require('node:child_process');
require('dotenv/config');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const { chromium } = require(arg('--playwright-module', 'playwright'));
const { neonConfig } = require('@neondatabase/serverless'); neonConfig.webSocketConstructor = require('ws');
const { PrismaNeon } = require('@prisma/adapter-neon'), { PrismaClient } = require('../src/generated/prisma/client.ts');
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
const artifacts = '/tmp/backlog-interests-browser', port = '3019', base = `http://localhost:${port}`;
fs.mkdirSync(artifacts, { recursive: true });
const originals = new Map(), catalogKeys = [], players = [], errors = [], results = [];
let browser, server, activePage, snapshotsTouched = false;
const nonce = randomBytes(5).toString('hex'), now = new Date(), year = now.getUTCFullYear();
const date = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const vector = (x, y = 0) => `[${[x, y, ...Array(126).fill(0)].join(',')}]`;
const card = (label, days, title) => ({ key: `interests-qa-${nonce}-${label}`, title: title ?? `Interest QA ${label} ${nonce}`, releaseYear: year,
  releaseDate: days === null ? null : date(days), platforms: ['PC', 'PlayStation 5'], genre: 'Role-playing', estimatedHours: 20, coverUrl: null, signal: 'release' });
const seed = card('Anchor', -365), negative = card('Counterpoint', -20), match = card('Kindred', 10), strong = card('Favorite', 20),
  saga = card('Saga', 30, `Resident Evil IX: QA ${nonce}`), offpath = card('Different', -30), owned = card('Owned', 5), dismissed = card('Dismissed', 5),
  undated = card('Undated', null), fresh = card('Fresh', 40);
const cards = [offpath, negative, match, strong, saga, owned, dismissed, undated];
async function seedFeeds() {
  for (const kind of ['radar', 'popular']) {
    const data = { items: cards, source: 'local', refreshedAt: new Date(), expiresAt: new Date(Date.now() + 18 * 3600000), leaseId: null, leaseUntil: null };
    await prisma.discoveryFeed.upsert({ where: { kind }, create: { kind, ...data }, update: data });
  }
}
async function ready() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/access`)).ok) return; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error('QA server did not start');
}
async function dismissToasts(page) {
  for (let i = 0; i < 12; i++) {
    const dismiss = page.getByRole('button', { name: /^Dismiss .* (achievement|notification)$/ });
    if (!(await dismiss.count())) return;
    await dismiss.first().click({ force: true }); await page.waitForTimeout(50);
  }
}
async function main() {
  try {
    for (const kind of ['radar', 'popular']) originals.set(kind, await prisma.discoveryFeed.findUnique({ where: { kind } }));
    for (const [game, embedding] of [[seed, vector(1)], [negative, vector(.6, .8)], [match, vector(.8, .6)], [strong, vector(1)],
      [saga, vector(0, 1)], [offpath, vector(0, 1)], [owned, null], [dismissed, null], [undated, null], [fresh, vector(1)]]) {
      catalogKeys.push(game.key);
      await prisma.gameCatalog.create({ data: { key: game.key, title: game.title, releaseYear: game.releaseYear,
        releaseDate: game.releaseDate ? new Date(game.releaseDate) : null, platforms: game.platforms, genre: game.genre } });
      if (embedding) await prisma.$executeRaw`UPDATE "GameCatalog" SET "featureVector" = ${embedding}::vector,
        "featureVectorVersion" = 'catalog-features-v1' WHERE "key" = ${game.key}`;
    }
    snapshotsTouched = true; await seedFeeds();
    const log = fs.openSync(`${artifacts}/server.log`, 'w');
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', port], {
      cwd: process.cwd(), stdio: ['ignore', log, log], env: { ...process.env, APP_URL: base,
        GEMINI_API_KEY: '', RAWG_API_KEY: '', TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '', STEAM_API_KEY: '' },
    }); fs.closeSync(log); await ready();
    const libraryPath = arg('--library-path', '');
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], env: { ...process.env, ...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}) } });
    for (const mode of ['cyberpunk', 'fantasy', 'custom-cyberpunk', 'custom-fantasy']) {
      await seedFeeds();
      const snapshotBefore = await prisma.discoveryFeed.findMany({ orderBy: { kind: 'asc' } });
      const custom = mode.startsWith('custom-'), fantasy = mode.endsWith('fantasy'), layout = fantasy ? 'fantasy' : 'cyberpunk', idNonce = randomBytes(4).toString('hex');
      const player = await prisma.player.create({ data: { email: `interests-${idNonce}@example.invalid`, passwordHash: 'disposable-qa',
        handle: `interests-${idNonce}`, operatorName: 'Radar Interests QA', preferredLayoutMode: layout, profileVisibility: 'private' } }); players.push(player.id);
      await prisma.game.createMany({ data: [
        { userId: player.id, title: seed.title, releaseYear: year, platform: 'PC', status: 'Completed', rating: 5, playthroughCount: 1 },
        { userId: player.id, title: 'Resident Evil 4', franchise: 'Biohazard', releaseYear: 2005, platform: 'PC', status: 'Playing', hoursPlayed: 3 },
        { userId: player.id, title: owned.title, platform: 'PC' },
      ] });
      await prisma.recommendationDismissal.create({ data: { userId: player.id, titleKey: dismissed.title.toLowerCase() } });
      const secret = process.env.AUTH_SECRET ? Buffer.from(process.env.AUTH_SECRET)
        : Buffer.from((await prisma.authSecret.findUniqueOrThrow({ where: { id: 'session-signing-v1' } })).value, 'hex');
      const token = randomBytes(32).toString('base64url'), payload = `v1.${token}`;
      await prisma.playerSession.create({ data: { userId: player.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000) } });
      const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
      await context.addCookies([{ name: '__Host-bb_session_v1', value: `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`,
        url: `https://localhost:${port}`, secure: true, httpOnly: true, sameSite: 'Lax' }]);
      await context.addInitScript(({ custom, layout }) => {
        localStorage.setItem('backlogbuster:layout-mode', layout); localStorage.setItem('backlogbuster:theme', 'default');
        if (custom) {
          const theme = { id: 'custom-interests-qa', name: 'Interests QA', baseLayout: layout,
            colors: { background: '#101827', surface: '#1e293b', text: '#f1f5f9', muted: '#cbd5e1', accent: '#fbbf24', border: '#64748b' },
            effects: { scanlines: false, particles: false, parchment: false, haunted: false }, borderRadius: 12,
            terminology: layout === 'cyberpunk' ? { alongInterestsTitle: 'Close to Your Heart', highTasteMatchTitle: 'Kindred Spirit', sagaFollowTitle: 'A Saga Continues' } : {} };
          localStorage.setItem('backlogbuster:custom-themes:v1', JSON.stringify([theme])); localStorage.setItem('backlogbuster:custom-theme:v1', theme.id);
        }
      }, { custom, layout });
      const page = activePage = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      const trigger = page.getByRole('button', { name: /CORTEX.*ADVISE NEXT GIG|NAVI.*SEEK GUIDANCE/ });
      await trigger.locator('.radar-unseen-badge').filter({ hasText: '3' }).waitFor({ timeout: 30000 });
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1050 }); await trigger.scrollIntoViewIfNeeded();
        await dismissToasts(page);
        const badge = await trigger.locator('.radar-unseen-badge').boundingBox(); assert(badge.width >= 22 && badge.height >= 22);
        await page.screenshot({ path: `${artifacts}/${mode}-unseen-${width}.png` });
      }
      let second;
      if (mode === 'cyberpunk') {
        second = await context.newPage(); await second.goto(base);
        await second.locator('.advisor-trigger-button .radar-unseen-badge').filter({ hasText: '3' }).waitFor();
      }
      await trigger.click();
      const dialog = page.getByRole('dialog'), scout = dialog.locator('.advisor-external-section');
      const radar = scout.getByRole('tab', { name: fantasy ? /^New Chronicles/ : /^New & Upcoming Radar/ });
      const popular = scout.getByRole('tab', { name: fantasy ? 'Tales of Renown' : 'Popular / Trending', exact: true });
      await radar.locator('.radar-unseen-badge').filter({ hasText: '3' }).waitFor();
      await radar.click();
      const panel = () => scout.getByRole('tabpanel').filter({ visible: true });
      await panel().locator('.discovery-card').first().waitFor({ timeout: 30000 });
      await page.waitForFunction(() => document.querySelector('#scout-tab-radar .radar-unseen-badge') === null);
      assert.equal(await prisma.radarSeen.count({ where: { userId: player.id } }), 3);
      if (second) { await second.locator('.advisor-trigger-button .radar-unseen-badge').waitFor({ state: 'hidden' }); await second.close(); }
      assert.deepEqual(await panel().locator('h4').allInnerTexts(), [offpath.title, negative.title, match.title, strong.title, saga.title]);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1050 });
        for (const [tab, label] of [[radar, 'radar'], [popular, 'popular']]) {
          await tab.click(); await panel().locator('.discovery-card').first().waitFor();
          await panel().getByRole('combobox', { name: 'Sort by', exact: true }).selectOption('best-match');
          assert.equal(await panel().locator('h4').first().innerText(), strong.title);
          await panel().getByRole('checkbox', { name: 'Along Your Interests only', exact: true }).check();
          assert.equal(await panel().locator('.discovery-card').count(), 3);
          assert.equal(await panel().locator('[data-affinity="taste"]').count(), 2);
          assert.equal(await panel().locator('[data-affinity="saga"]').count(), 1);
          assert((await panel().locator('[data-affinity="taste"]').allTextContents()).some(text => text.includes('(80%)')));
          if (custom && !fantasy) {
            assert((await panel().locator('.discovery-interest-heading').textContent()).includes('Close to Your Heart'));
            assert((await panel().locator('[data-affinity="taste"]').first().textContent()).includes('Kindred Spirit'));
          }
          for (const node of [dialog, panel().locator('.discovery-interest-controls')]) {
            const bounds = await node.evaluate(el => [el.scrollWidth, el.clientWidth]); assert(bounds[0] <= bounds[1] + 1, `${mode} ${width}: overflow`);
          }
          await scout.locator('.scout-subnav').evaluate(el => { const modal = el.closest('.advisor-modal'); modal.scrollTop += el.getBoundingClientRect().top - modal.getBoundingClientRect().top - 20; });
          await dismissToasts(page);
          await page.screenshot({ path: `${artifacts}/${mode}-${label}-${width}.png` });
          results.push({ mode, width, feed: label, highTaste: 2, sagaFollow: 1, overflow: false });
        }
      }
      await popular.click();
      await panel().getByRole('checkbox', { name: 'Along Your Interests only', exact: true }).uncheck();
      const docs = []; page.on('request', request => { if (request.isNavigationRequest() && request.resourceType() === 'document') docs.push(request.url()); });
      await panel().getByRole('button', { name: `Not interested in ${negative.title}`, exact: true }).click();
      await panel().getByRole('status').filter({ hasText: 'won’t appear in Scout or discovery feeds' }).waitFor({ timeout: 30000 });
      const target = panel().locator('.discovery-card').filter({ has: page.getByRole('heading', { name: match.title, exact: true }) });
      assert.equal(await target.locator('[data-affinity="taste"]').count(), 0);
      assert.equal(await target.locator('.discovery-match-percent').innerText(), 'Taste match: 64%');
      assert.equal(await panel().locator('[data-affinity="taste"]').count(), 1);
      // A cache refresh after acknowledgement introduces one unseen game. Viewing
      // or interacting with an older Popular snapshot must not clear that new key.
      await prisma.discoveryFeed.update({ where: { kind: 'radar' }, data: { items: [...cards, fresh] } });
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await radar.locator('.radar-unseen-badge').filter({ hasText: '1' }).waitFor({ timeout: 30000 });
      const strongCard = panel().locator('.discovery-card').filter({ has: page.getByRole('heading', { name: strong.title, exact: true }) });
      await strongCard.getByRole('button', { name: '+ Add to Backlog / Wishlist', exact: true }).click();
      await panel().getByRole('status').filter({ hasText: 'added to your backlog / wishlist' }).waitFor({ timeout: 30000 });
      assert.equal(await prisma.game.count({ where: { userId: player.id, title: strong.title } }), 1);
      assert.equal(await radar.locator('.radar-unseen-badge').innerText(), '1');
      assert.deepEqual(docs, [], 'negative steering/adds do not reload the document');
      await radar.click(); await panel().locator('.discovery-card').first().waitFor();
      await radar.locator('.radar-unseen-badge').waitFor({ state: 'hidden' });
      assert.equal(await prisma.radarSeen.count({ where: { userId: player.id, catalogKey: fresh.key } }), 1);
      await page.reload({ waitUntil: 'domcontentloaded' });
      const response = await context.request.get(`${base}/api/discovery/notifications`);
      assert.equal((await response.json()).unseenCount, 0);
      const snapshotAfter = await prisma.discoveryFeed.findMany({ orderBy: { kind: 'asc' } });
      assert.equal(snapshotAfter.find(row => row.kind === 'popular').refreshedAt.getTime(), snapshotBefore.find(row => row.kind === 'popular').refreshedAt.getTime());
      await context.close();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${artifacts}/results.json`, JSON.stringify({ results, errors, negativeSteering: '80% -> 64%',
      persistedSeen: true, crossTab: true, newerSnapshotPreserved: true, documentReloadsDuringActions: 0 }, null, 2));
    console.log(`Passed ${results.length} feed/theme/viewport combinations; cosine badges, saga follows, sort/filter, trigger/tab counts, cross-tab acknowledgement, durable seen state and reactive 80% -> 64% negative steering.`);
  } catch (error) {
    if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: `${artifacts}/failure.png` }).catch(() => {});
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
    for (const id of players) await prisma.player.delete({ where: { id } });
    if (catalogKeys.length) await prisma.gameCatalog.deleteMany({ where: { key: { in: catalogKeys } } });
    if (snapshotsTouched) for (const [kind, original] of originals) {
      if (original) await prisma.discoveryFeed.upsert({ where: { kind }, create: original, update: original });
      else await prisma.discoveryFeed.deleteMany({ where: { kind } });
    }
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
