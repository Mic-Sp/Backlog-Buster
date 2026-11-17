/* eslint-disable @typescript-eslint/no-require-imports -- Native Chromium DnD against real actions and a disposable account. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomBytes, scryptSync } = require('node:crypto'), { spawn } = require('node:child_process');
require('dotenv/config');
const arg = (key, fallback) => { const i = process.argv.indexOf(key); return i < 0 ? fallback : process.argv[i + 1]; };
const { chromium } = require(arg('--playwright-module', 'playwright'));
const { neonConfig } = require('@neondatabase/serverless'); neonConfig.webSocketConstructor = require('ws');
const { PrismaNeon } = require('@prisma/adapter-neon'), { PrismaClient } = require('../src/generated/prisma/client.ts');
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
const port = Number(arg('--port', '3028')), base = `http://localhost:${port}`;
const artifacts = '/tmp/backlog-standard-deck-dnd'; fs.mkdirSync(artifacts, { recursive: true });
let server, browser, page, playerId;
const errors = [], results = [];
async function until(check, label) {
  for (let i = 0; i < 80; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 500)); }
  throw Error(`Timed out: ${label}`);
}
async function main() {
  try {
    const log = fs.openSync(`${artifacts}/server.log`, 'w');
    server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
      cwd: path.resolve(__dirname, '..'), detached: true, stdio: ['ignore', log, log],
      env: { ...process.env, APP_URL: base, STEAM_API_KEY: '', GEMINI_API_KEY: '', WS_NO_BUFFER_UTIL: '1', WS_NO_UTF_8_VALIDATE: '1' },
    }); fs.closeSync(log);
    await until(async () => { try { return (await fetch(`${base}/access`)).ok; } catch { return false; } }, 'production server');
    const suffix = randomBytes(6).toString('hex'), password = `Deck QA ${randomBytes(12).toString('hex')}`, salt = randomBytes(16);
    const player = await prisma.player.create({ data: { email: `deck-dnd-${suffix}@example.invalid`, preferredLayoutMode: 'standard', handle: `deck-dnd-${suffix}`, operatorName: 'Deck DnD QA',
      passwordHash: `scrypt$131072$8$1$${salt.toString('hex')}$${scryptSync(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString('hex')}` }, select: { id: true, email: true } });
    playerId = player.id;
    const games = [];
    for (const [title, year, status] of [['Drag Alpha', 2020, 'Backlog'], ['Drag Bravo', 2021, 'Backlog'], ['Drag Charlie', 2022, 'Backlog'], ['Unknown Release', null, 'Backlog'], ['Control Actions', 2020, 'Backlog'], ['Future Release', 2099, 'Backlog'], ['Already Playing', 2020, 'Playing']]) {
      games.push(await prisma.game.create({ data: { userId: playerId, title, platform: 'PC', releaseYear: year, status, lengthHours: 10, difficulty: 1, coverUrl: `${base}/hud-logo.png` }, select: { id: true, title: true } }));
    }
    const libraryPath = arg('--library-path', ''), executablePath = arg('--browser-path', undefined);
    browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'], env: { ...process.env, ...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}) } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, colorScheme: 'dark' }); page = await context.newPage();
    page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /hydration|did not match/i.test(message.text())) errors.push(message.text()); });
    await page.goto(`${base}/access`); await page.locator('input[name=email]').fill(player.email); await page.locator('input[name=password]').fill(password);
    await page.locator('.auth-submit').click(); await page.waitForURL(`${base}/`); await page.locator('.standard-game-card').first().waitFor();
    await page.evaluate(() => {
      window.qaDrags = [];
      document.addEventListener('dragstart', event => window.qaDrags.push({ type: event.dataTransfer.getData('application/x-backlogbuster-deck-game'), cancelled: event.defaultPrevented }));
    });
    const card = game => page.locator(`.standard-game-card[data-library-game-id="${game.id}"]`);
    const slot = number => page.locator(`.deck-grid > [data-deck-slot="${number}"]`);
    async function pinnedOrder() { return prisma.game.findMany({ where: { userId: playerId }, orderBy: { id: 'asc' }, select: { id: true, pinnedOrder: true } }); }
    async function expectSlot(game, number) {
      await until(async () => (await prisma.game.findUnique({ where: { id: game.id }, select: { pinnedOrder: true } })).pinnedOrder === number, `${game.title} persisted in slot ${number}`);
      await slot(number).locator(`[data-deck-game-id="${game.id}"]`).waitFor();
      await page.waitForFunction(() => !document.querySelector('.deck-card[aria-busy="true"]'));
    }
    async function drag(source, game, number, origin) {
      await source.scrollIntoViewIfNeeded();
      const from = await source.boundingBox(), to = await slot(number).boundingBox(); assert(from && to);
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
      try {
        await page.mouse.move(from.x + from.width / 2 + 15, from.y + from.height / 2 + 8, { steps: 5 });
        const dragging = origin === 'table' ? card(game) : page.locator(`.deck-card[data-deck-game-id="${game.id}"]`);
        await page.waitForFunction(selector => document.querySelector(selector)?.dataset.dragging === 'true', origin === 'table' ? `.standard-game-card[data-library-game-id="${game.id}"]` : `.deck-card[data-deck-game-id="${game.id}"]`);
        assert(Number(await dragging.evaluate(node => getComputedStyle(node).opacity)) < 1, 'Drag source fades');
        assert.equal(await page.locator('.deck-grid > [data-drop-active="true"]').count(), 3, 'Every slot accepts this drag');
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
        // Chromium needs a move after dragenter to dispatch the target's dragover.
        await page.mouse.move(to.x + to.width / 2 + 2, to.y + to.height / 2 + 2, { steps: 2 });
        await page.waitForFunction(number => document.querySelector(`.deck-grid > [data-deck-slot="${number}"]`)?.dataset.dropHover === 'true', number);
        const highlight = await slot(number).locator('.deck-card, .deck-empty-slot').evaluate(node => ({ border: getComputedStyle(node).borderColor, shadow: getComputedStyle(node).boxShadow }));
        assert.equal(highlight.border, 'rgb(56, 189, 248)'); assert.notEqual(highlight.shadow, 'none');
        await page.screenshot({ path: `${artifacts}/${origin}-over-slot-${number}.png` });
      } finally { await page.mouse.up(); }
      await expectSlot(game, number);
      assert.equal(await page.locator('.standard-game-details').count(), 0, 'Dragging does not open details');
      assert.equal(await page.locator('[data-dragging="true"]').count(), 0); assert.equal(await page.locator('.deck-grid > [data-drop-hover="true"]').count(), 0);
      results.push({ origin, slot: number, persisted: true, highlight: true, sourceOpacity: true });
      console.log(`Verified ${origin} drag into Up Next #${number}.`);
    }
    for (let index = 0; index < 3; index++) await drag(card(games[index]).locator('.standard-card-cover'), games[index], index + 1, 'table');
    const first = await pinnedOrder(); await page.reload(); await page.locator('.standard-game-card').first().waitFor();
    assert.deepEqual(await pinnedOrder(), first); for (let index = 0; index < 3; index++) await expectSlot(games[index], index + 1);
    await drag(card(games[3]).locator('h3'), games[3], 2, 'table');
    assert.equal((await prisma.game.findUnique({ where: { id: games[1].id }, select: { pinnedOrder: true } })).pinnedOrder, null, 'Grid drop replaces the occupied slot');
    await drag(slot(1).locator('.deck-drag-grip'), games[0], 3, 'deck'); await expectSlot(games[2], 1);
    const swapped = await pinnedOrder(); await page.reload(); await page.locator('.standard-game-card').first().waitFor(); assert.deepEqual(await pinnedOrder(), swapped);
    for (const [game, number] of [[games[2], 1], [games[3], 2], [games[0], 3]]) await expectSlot(game, number);
    // Clicking the same cover must still open details, while Hype and Start remain independent controls.
    await card(games[4]).locator('.standard-card-cover').click(); await page.getByRole('dialog', { name: games[4].title }).waitFor(); await page.keyboard.press('Escape');
    const hype = card(games[4]).locator('.hype-meter'); const before = Number(await hype.getAttribute('data-hype-level')); await hype.getByRole('button').click();
    await until(async () => (await prisma.game.findUnique({ where: { id: games[4].id }, select: { hypeLevel: true } })).hypeLevel === (before === 3 ? 1 : before + 1), 'Hype saves independently');
    assert.equal(await page.locator('[data-dragging="true"]').count(), 0);
    await card(games[4]).getByRole('button', { name: `Start playing ${games[4].title}` }).click();
    await until(async () => (await prisma.game.findUnique({ where: { id: games[4].id }, select: { status: true } })).status === 'Playing', 'Start Playing remains clickable');
    await page.getByRole('group', { name: 'Library view' }).getByRole('button', { name: /^Backlog/ }).click();
    // The existing modal pin control remains usable with touch/keyboard on a narrow viewport.
    await page.setViewportSize({ width: 390, height: 844 }); await slot(2).getByRole('button', { name: 'Remove', exact: true }).click();
    await until(async () => (await prisma.game.findUnique({ where: { id: games[3].id }, select: { pinnedOrder: true } })).pinnedOrder === null, 'Mobile unpin');
    await card(games[1]).locator('.standard-card-cover').click(); const details = page.getByRole('dialog', { name: games[1].title });
    const quickPin = details.getByRole('button', { name: 'Add to Up Next', exact: true }); await quickPin.focus(); await page.keyboard.press('Enter');
    await until(async () => (await prisma.game.findUnique({ where: { id: games[1].id }, select: { pinnedOrder: true } })).pinnedOrder === 2, 'Keyboard quick pin');
    await page.keyboard.press('Escape'); await page.reload(); await expectSlot(games[1], 2);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.deepEqual(errors, []);
    await page.screenshot({ path: `${artifacts}/mobile-persisted.png`, fullPage: false });
    fs.writeFileSync(`${artifacts}/results.json`, JSON.stringify({ results, reloadPersistence: true, occupiedSlotReplacement: true, deckSwap: true, normalClicks: true, mobileKeyboardPin: true, runtimeErrors: errors }, null, 2));
    console.log('PASS: native grid-cover drags into slots 1–3, occupied-slot replacement, deck swaps, database/reload persistence, inline controls, and mobile keyboard pinning.');
  } catch (error) { if (page && !page.isClosed()) await page.screenshot({ path: `${artifacts}/failure.png` }).catch(() => {}); throw error; }
  finally {
    await browser?.close(); if (server) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
    if (playerId) await prisma.player.deleteMany({ where: { id: playerId } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
