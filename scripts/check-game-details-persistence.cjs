/* eslint-disable @typescript-eslint/no-require-imports -- Native browser regressions against disposable live database records. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, scryptSync } = require('node:crypto');
const { spawn } = require('node:child_process');
require('dotenv/config');

// Run after a production build. Browser dependencies can live outside the repo,
// matching the other check-standard-* scripts. No existing account is modified.
const arg = (key, fallback) => { const i = process.argv.indexOf(key); return i < 0 ? fallback : process.argv[i + 1]; };
const { chromium } = require(arg('--playwright-module', 'playwright'));
const { neonConfig } = require('@neondatabase/serverless');
neonConfig.webSocketConstructor = require('ws');
const { PrismaNeon } = require('@prisma/adapter-neon');
const { PrismaClient } = require('../src/generated/prisma/client.ts');
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
const base = `http://localhost:${arg('--port', '3031')}`;
const artifacts = arg('--artifacts', '/tmp/backlog-game-details-persistence');
fs.mkdirSync(artifacts, { recursive: true });
let server, browser, page, playerId;
const errors = [], results = [];
async function until(check, label) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 300)); }
  throw Error(`Timed out: ${label}`);
}
const read = id => prisma.game.findUniqueOrThrow({ where: { id, userId: playerId } });
const date = value => value?.toISOString().slice(0, 10) ?? '';
async function fieldValues(form, expected) {
  for (const [name, value] of Object.entries(expected)) {
    const field = form.locator(`[name="${name}"]`);
    if (name === 'reviewSpoiler') assert.equal(await field.isChecked(), value === 'true', name);
    else assert.equal(await field.inputValue(), value, name);
  }
}
async function openSections(form) {
  // Open only native details sections; don't alter React state or field values.
  await form.locator('details').evaluateAll(nodes => nodes.forEach(node => { node.open = true; }));
}
async function nativeStatus(form, value) {
  const index = ['Backlog', 'Playing', 'Completed', 'Flatlined'].indexOf(value);
  await form.locator('select[name="status"]').focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  assert.equal(await form.locator('select[name="status"]').inputValue(), value, 'native status selection must survive input/change ordering');
}
async function allGames(mode) {
  if (mode === 'fantasy') await page.getByRole('button', { name: 'ALL PANES', exact: true }).click();
  if (mode === 'biohazard') await page.getByRole('button', { name: 'ITEM BOX', exact: true }).click();
  const tabs = page.locator('.standard-status-tabs, .library-tabs, .fantasy-status-tabs, .bio-storage-tabs').filter({ visible: true });
  await tabs.getByRole('button', { name: /^All/i }).click();
}
async function switchTheme(mode) {
  const selector = page.locator('.theme-selector:visible').first();
  if (!await selector.count()) await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await page.locator('.theme-selector:visible').first().selectOption(mode);
  await page.waitForFunction(mode => document.documentElement.dataset.theme === mode, mode);
  await until(async () => (await prisma.player.findUniqueOrThrow({ where: { id: playerId } })).preferredLayoutMode === mode, 'saved theme');
}
async function editor(mode, id) {
  if (mode === 'standard') {
    await page.locator(`.standard-game-card[data-library-game-id="${id}"] .standard-card-cover`).click();
    return page.locator('.standard-game-details');
  }
  if (mode === 'cyberpunk') {
    const row = await read(id);
    await page.locator(`.library-tabs [data-view="${row.status.toLowerCase()}"]`).click();
    if (row.status === 'Completed') await page.locator(`.trophy-card[data-library-game-id="${id}"] .trophy-edit-drawer`).evaluate(node => { node.open = true; });
    return page.locator(`form[data-game-editor-id="${id}"]:visible`).first();
  }
  if (mode === 'fantasy') {
    await page.locator(`.fantasy-inventory-grid [data-library-game-id="${id}"] button`).first().click();
    return page.locator(`.fantasy-quest-editor[data-game-editor-id="${id}"]`);
  }
  await page.locator(`.bio-inventory-grid [data-library-game-id="${id}"] .bio-inventory-slot`).click();
  await page.getByRole('button', { name: 'EXAMINE / EDIT', exact: true }).click();
  return page.locator(`.bio-record-editor[data-game-editor-id="${id}"]`);
}
async function metadata(mode, id, form) {
  if (mode === 'standard') { await openSections(form); return form; }
  if (mode === 'cyberpunk') await page.locator(`[data-metadata-trigger-id="${id}"]:visible`).first().click();
  else await form.getByRole('button', { name: /^(Edit metadata|EDIT METADATA)$/ }).click();
  return page.locator('.metadata-modal');
}
async function save(form) {
  await form.locator('button[type="submit"]:not([formaction])').first().click();
}
async function closeMetadata(mode) {
  if (mode === 'standard') await page.getByRole('button', { name: 'Close game details', exact: true }).click();
  else await page.locator('.metadata-modal .metadata-cancel-btn').click();
}

async function main() {
  try {
    const log = fs.openSync(`${artifacts}/server.log`, 'w');
    server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', new URL(base).port], {
      cwd: path.resolve(__dirname, '..'), detached: true, stdio: ['ignore', log, log],
      env: { ...process.env, APP_URL: base, STEAM_API_KEY: '', GEMINI_API_KEY: '', WS_NO_BUFFER_UTIL: '1', WS_NO_UTF_8_VALIDATE: '1' },
    });
    fs.closeSync(log);
    await until(async () => { try { return (await fetch(`${base}/access`)).ok; } catch { return false; } }, 'production server');
    const suffix = randomBytes(6).toString('hex'), salt = randomBytes(16), password = `Drawer QA ${randomBytes(10).toString('hex')}`;
    const player = await prisma.player.create({ data: {
      email: `drawer-${suffix}@example.invalid`, handle: `drawer-${suffix}`, operatorName: 'Drawer Regression QA', preferredLayoutMode: 'standard', emailVerifiedAt: new Date(),
      passwordHash: `scrypt$131072$8$1$${salt.toString('hex')}$${scryptSync(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString('hex')}`,
    } });
    playerId = player.id;
    const games = {};
    for (const mode of ['standard', 'cyberpunk', 'fantasy', 'biohazard', 'background']) games[mode] = await prisma.game.create({ data: {
      userId: playerId, title: `Drawer QA ${mode}`, platform: 'PC', status: 'Backlog', lengthHours: 10, difficulty: 1, hypeLevel: 2, releaseYear: 2020,
    } });
    browser = await chromium.launch({ headless: true, executablePath: arg('--browser-path', undefined), args: ['--no-sandbox'],
      env: { ...process.env, ...(arg('--library-path', '') ? { LD_LIBRARY_PATH: arg('--library-path') } : {}) } });
    page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /hydrat|did not match/i.test(message.text())) errors.push(message.text()); });
    await page.route('**/api/catalog/search**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
    await page.goto(`${base}/access`);
    await page.locator('[name="email"]').fill(player.email); await page.locator('[name="password"]').fill(password);
    await page.locator('.auth-submit').click(); await page.waitForURL(`${base}/`);

    for (const mode of ['standard', 'cyberpunk', 'fantasy', 'biohazard']) {
      await switchTheme(mode); await allGames(mode);
      const id = games[mode].id;
      let form = await editor(mode, id);
      await nativeStatus(form, 'Playing');
      if (mode === 'cyberpunk') {
        // Cyberpunk exposes played hours through session buttons, not a number
        // input. Exercise that existing path instead of inventing an editor.
        await save(form);
        await until(async () => (await read(id)).status === 'Playing', 'Cyberpunk native Playing transition');
        await allGames(mode); form = await editor(mode, id);
        for (let hours = 1; hours <= 7; hours++) {
          await form.getByRole('button', { name: `Log one hour for ${games[mode].title}`, exact: true }).click();
          await until(async () => (await read(id)).hoursPlayed === hours, 'Cyberpunk session hours');
        }
      }
      // Normal typing is essential: selectOption/dispatchEvent masks the old bug.
      if (mode === 'standard') {
        await openSections(form);
        await form.locator('[name="title"]').fill('Unsaved Standard title');
        await form.locator('[name="notes"]').fill('Unsaved private draft');
        await form.locator('[name="ownershipType"]').selectOption('Physical');
        // Simulate a Steam/background refresh: change untouched fields, then let
        // another disposable game's real Server Action deliver refreshed RSC data.
        await prisma.game.update({ where: { id, userId: playerId }, data: { platform: 'PS5', hoursPlayed: 12 } });
        await page.locator(`.standard-game-card[data-library-game-id="${games.background.id}"] form`).evaluate(form => form.requestSubmit());
        await until(async () => await form.locator('[name="platform"]').inputValue() === 'PS5', 'live record refresh inside open drawer');
        await fieldValues(form, { title: 'Unsaved Standard title', notes: 'Unsaved private draft', ownershipType: 'Physical', status: 'Playing', hoursPlayed: '12', platform: 'PS5' });
        await closeMetadata(mode); await allGames(mode); form = await editor(mode, id); await openSections(form);
        await fieldValues(form, { title: 'Unsaved Standard title', notes: 'Unsaved private draft', ownershipType: 'Physical', status: 'Playing' });
      }
      await openSections(form);
      const progress = { lengthHours: '25', hoursPlayed: '7', difficulty: '2', playthroughCount: '2', startedAt: '2025-01-01', completedAt: '2025-02-01', review: `A memorable ${mode} adventure.`, notes: `Private ${mode} notes.` };
      await nativeStatus(form, 'Completed');
      for (const [name, value] of Object.entries(progress)) {
        if (mode === 'cyberpunk' && name === 'hoursPlayed') continue;
        const field = form.locator(`[name="${name}"]`);
        if (name === 'difficulty') await field.selectOption(value); else await field.fill(value);
      }
      await form.locator('[name="reviewSpoiler"]').check();
      await form.getByRole('button', { name: 'Rate 4 out of 5 stars', exact: true }).click();
      await save(form);
      await until(async () => { const row = await read(id); return row.status === 'Completed' && row.difficulty === 2 && row.review === progress.review; }, `${mode} progress persisted`);
      let row = await read(id);
      for (const [name, value] of Object.entries(progress)) assert.equal(name.endsWith('At') ? date(row[name]) : String(row[name]), value, `${mode}.${name}`);
      assert.equal(row.rating, 4); assert.equal(row.reviewSpoiler, true); assert.equal(row.earnedXp, 500); assert.equal(row.pinnedOrder, null);
      if (mode === 'standard') assert.equal(row.title, 'Unsaved Standard title');

      await allGames(mode); form = await editor(mode, id);
      const meta = await metadata(mode, id, form);
      const fields = { title: `Edited ${mode} title`, platform: 'Switch', genre: 'Puzzle', ownershipType: 'Borrowed', franchise: `QA ${mode} saga`, releaseYear: '2024', chronologicalOrder: '3', coverUrl: `${base}/hud-logo.png` };
      for (const [name, value] of Object.entries(fields)) {
        const field = meta.locator(`[name="${name}"]`);
        if (name === 'ownershipType') await field.selectOption(value); else await field.fill(value);
      }
      await fieldValues(meta, fields);
      // Closing/reopening must retain every metadata draft, including ownership.
      await closeMetadata(mode);
      if (mode === 'standard') { await allGames(mode); form = await editor(mode, id); }
      const reopened = await metadata(mode, id, form);
      await fieldValues(reopened, fields);
      await save(reopened);
      await until(async () => (await read(id)).title === fields.title, `${mode} metadata persisted`);
      row = await read(id);
      for (const [name, value] of Object.entries(fields)) assert.equal(String(row[name]), value, `${mode}.${name}`);
      await page.reload(); await allGames(mode); form = await editor(mode, id); await openSections(form);
      const restored = { status: 'Completed', ...progress, rating: '4', reviewSpoiler: 'true' };
      if (mode === 'cyberpunk') delete restored.hoursPlayed;
      await fieldValues(form, restored);
      const reloadedMeta = await metadata(mode, id, form); await fieldValues(reloadedMeta, fields);
      await closeMetadata(mode);
      if (mode === 'standard') { await allGames(mode); form = await editor(mode, id); }
      // Exercise Dropped's internal Flatlined value and the unchanged Backlog policy.
      await nativeStatus(form, 'Flatlined'); await save(form);
      await until(async () => (await read(id)).status === 'Flatlined', `${mode} dropped status`);
      await allGames(mode); form = await editor(mode, id);
      await nativeStatus(form, 'Backlog'); await save(form);
      await until(async () => (await read(id)).status === 'Backlog', `${mode} backlog status`);
      row = await read(id); assert.equal(row.hoursPlayed, 0); assert.equal(row.rating, null); assert.equal(row.playthroughCount, 2);
      results.push({ mode, nativeStatus: true, manualTitle: true, fullFieldPersistence: true, reopenAndReload: true, backlogPolicy: true });
      console.log(`PASS: ${mode} native status, manual title, all fields, reopen/reload, and Backlog policy.`);
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${artifacts}/results.json`, JSON.stringify({ results, backgroundRefreshPreservesDrafts: true, runtimeErrors: errors }, null, 2));
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: `${artifacts}/failure.png` }).catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    if (server) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
    try {
      if (playerId) {
        await prisma.player.delete({ where: { id: playerId } });
        assert.equal(await prisma.game.count({ where: { userId: playerId } }), 0, 'disposable games cleaned up');
        assert.equal(await prisma.player.count({ where: { id: playerId } }), 0, 'disposable account cleaned up');
        console.log('Disposable account and all game records cleaned up.');
      }
    } finally { await prisma.$disconnect(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
