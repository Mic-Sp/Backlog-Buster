/* eslint-disable @typescript-eslint/no-require-imports -- Real app/browser/database QA with disposable accounts and an explicit provider fixture. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomBytes, createHash, scryptSync } = require('node:crypto'), { spawn } = require('node:child_process');
require('dotenv/config');
const cli = (flag, fallback) => { const i = process.argv.indexOf(flag); return i < 0 ? fallback : process.argv[i + 1]; };
const { chromium } = require(cli('--playwright-module', process.env.PLAYWRIGHT_MODULE || 'playwright'));
const { neonConfig } = require('@neondatabase/serverless'); neonConfig.webSocketConstructor = require('ws');
const { PrismaNeon } = require('@prisma/adapter-neon'), { PrismaClient } = require('../src/generated/prisma/client.ts');
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
const base = 'http://localhost:3013', artifacts = '/tmp/backlog-steam-population-browser';
fs.mkdirSync(artifacts, { recursive: true });
const fixturePath = `${artifacts}/provider.json`, fixtures = {}, playerIds = [], attemptedStates = [], assertionNonces = [], results = [], errors = [];
const auths = new WeakMap(); let server, browser, currentPage;
const save = () => fs.writeFileSync(fixturePath, JSON.stringify(fixtures), { mode: 0o600 });
save();
const password = 'Steam QA exact password';
function passwordHash() { const salt = randomBytes(16); return `scrypt$131072$8$1$${salt.toString('hex')}$${scryptSync(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString('hex')}`; }
async function until(check, label) { for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 500)); } throw Error(label); }
async function image(page, name) {
  const theme = await page.locator('html').getAttribute('data-layout-mode');
  await page.getByRole('button', { name: theme === 'fantasy' ? 'Switch to Cyberpunk Deck' : 'Switch to Fantasy Subscreen', exact: true }).first().waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const dismiss = page.getByRole('button', { name: /^Dismiss .* (achievement|notification)$/ });
    for (let i = 0; i < 10 && await dismiss.count(); i++) await dismiss.first().click();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} overflow at ${width}`);
    const modal = page.locator('[role=dialog]');
    if (await modal.count()) assert(await modal.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${name} modal overflow at ${width}`);
    // Capture the feature being reviewed inside the scrolling modal.
    const feature = page.locator(name.endsWith('credentials-added') ? '.security-update-form' : '.security-steam');
    if (await feature.count()) await feature.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${artifacts}/${name}-${width}.png`, fullPage: false });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function security(page) {
  await page.getByRole('button', { name: '⚙ ACCOUNT SECURITY', exact: true }).click();
  await page.locator('.steam-verification-status').waitFor({ timeout: 30000 });
  return page.getByRole('dialog');
}
async function start(page, mode = 'signin') {
  const previous = auths.get(page);
  await page.getByRole('link', { name: mode === 'link' ? 'Verify & Link with Steam' : 'Continue with Steam', exact: true }).click();
  await until(() => auths.get(page) && auths.get(page) !== previous, 'Missing Steam authorization redirect');
  await page.locator('[data-provider-stub]').waitFor();
  return new URL(auths.get(page));
}
async function complete(page, auth, steamId, mode = 'valid') {
  const callback = new URL(auth.searchParams.get('openid.return_to'));
  const nonce = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') + randomBytes(10).toString('hex'); assertionNonces.push(createHash('sha256').update(nonce).digest('hex'));
  const params = { 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': mode === 'cancel' ? 'cancel' : 'id_res',
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login', 'openid.claimed_id': `https://steamcommunity.com/openid/id/${steamId}`,
    'openid.identity': `https://steamcommunity.com/openid/id/${steamId}`, 'openid.return_to': callback.toString(), 'openid.response_nonce': nonce,
    'openid.assoc_handle': 'qa-association', 'openid.signed': 'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle', 'openid.sig': randomBytes(32).toString('base64') };
  fixtures[params['openid.sig']] = params; save();
  for (const [key, value] of Object.entries(params)) callback.searchParams.set(key, value);
  if (mode === 'wrong-state') callback.searchParams.set('state', randomBytes(32).toString('base64url'));
  if (mode === 'forged') callback.searchParams.set('openid.sig', 'invalid-signature');
  await page.goto(callback.toString(), { waitUntil: 'domcontentloaded', timeout: 120000 });
  return callback.toString();
}
async function login(page, email) {
  await page.goto(`${base}/access`, { waitUntil: 'domcontentloaded' });
  await page.locator('[name=email]').fill(email); await page.locator('[name=password]').fill(password); await page.locator('.auth-submit').click();
  await page.getByRole('button', { name: '⚙ ACCOUNT SECURITY', exact: true }).waitFor({ timeout: 90000 });
}
async function logout(page) {
  await page.getByRole('button', { name: 'LOG OUT', exact: true }).click();
  await page.locator('.auth-panel:visible').first().waitFor({ timeout: 30000 });
  await page.goto(`${base}/access`, { waitUntil: 'domcontentloaded' });
}

async function main() {
  const originals = await prisma.player.findMany({ orderBy: { id: 'asc' } }), ids = originals.map(row => row.id);
  const originalSessions = await prisma.playerSession.findMany({ where: { userId: { in: ids }, expiresAt: { gt: new Date(Date.now() + 600000) } }, orderBy: { tokenHash: 'asc' } });
  try {
    fs.writeFileSync('.steam-qa-tsconfig.json', JSON.stringify({ extends: './tsconfig.json', include: ['src/**/*.ts', 'src/**/*.tsx', 'next-env.d.ts'], exclude: ['node_modules', '.next-google-qa', '.next-steam-qa'] }));
    const log = fs.openSync(`${artifacts}/server.log`, 'w');
    server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3013'], {
      cwd: path.resolve(__dirname, '..'), detached: true, stdio: ['ignore', log, log], env: { ...process.env, APP_URL: base,
        STEAM_API_KEY: 'local-fixture-only', RAWG_API_KEY: '', IGDB_CLIENT_ID: '', IGDB_CLIENT_SECRET: '', RESEND_API_KEY: '',
        GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', BB_STEAM_QA_LIBRARIES: '1', BB_STEAM_QA_FIXTURE: fixturePath,
        NODE_OPTIONS: `--require=${path.resolve(__dirname, '../tests/helpers/steam-provider.cjs')}`,
        BACKLOG_BUILD_DIR: '.next-steam-qa', BACKLOG_TSCONFIG: '.steam-qa-tsconfig.json' },
    }); fs.closeSync(log);
    await until(async () => { try { return (await fetch(`${base}/access`)).ok; } catch { return false; } }, 'QA server did not start');
    const libraryPath = cli('--library-path', process.env.AUTH_BROWSER_LIBRARY_PATH);
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], env: { ...process.env, ...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}) } });
    fixtures.__libraries = {};
    for (const theme of ['cyberpunk', 'fantasy']) {
      const suffix = randomBytes(6).toString('hex'), email = `steam-pop-${suffix}@example.invalid`;
      const publicId = (76561197960265729n + BigInt(randomBytes(4).readUInt32BE() % 4294967294)).toString();
      const privateId = (BigInt(publicId) + 1n).toString(), manualId = (BigInt(publicId) + 2n).toString();
      assert.equal(await prisma.player.count({ where: { steamVerifiedId: { in: [publicId, privateId] } } }), 0);
      const owned = [{ appid: 440, name: `QA Played ${suffix}`, playtime_forever: 150, playtime_2weeks: 90 },
        { appid: 570, name: `QA Unplayed ${suffix}`, playtime_forever: 0, playtime_2weeks: 0 }];
      fixtures.__libraries[publicId] = { games: owned, delayMs: 3500 };
      fixtures.__libraries[privateId] = { private: true }; save();
      const main = await prisma.player.create({ data: { email, passwordHash: passwordHash(), googleId: `qa-pop-google-${suffix}`,
        handle: `qa-pop-${suffix}`, operatorName: 'Main archive', steamId: manualId, preferredLayoutMode: theme } }); playerIds.push(main.id);
      const saved = await prisma.game.create({ data: { userId: main.id, steamAppId: '440', title: 'My existing title', platform: 'PC', status: 'Playing', hoursPlayed: 8,
        rating: 4, notes: 'Keep my checkpoint', review: 'Keep my verdict' } });
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await context.addInitScript(theme => { localStorage.setItem('backlogbuster:layout-mode', theme); localStorage.setItem('backlogbuster:ui-muted', 'true'); }, theme);
      await context.route(/\/api\/auth\/steam\?/, async route => {
        const response = await route.fetch({ maxRedirects: 0 }); assert.equal(response.status(), 307);
        const location = response.headers().location, auth = new URL(location); assert.equal(auth.origin, 'https://steamcommunity.com');
        attemptedStates.push(createHash('sha256').update(`steam-state-v1:${new URL(auth.searchParams.get('openid.return_to')).searchParams.get('state')}`).digest('hex'));
        auths.set(route.request().frame().page(), location);
        await route.fulfill({ response, status: 200, headers: { ...response.headers(), 'content-type': 'text/html' }, body: '<p data-provider-stub>Local Steam provider fixture</p>' });
      });
      const page = currentPage = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/access`); let auth = await start(page); await complete(page, auth, publicId);
      await page.locator('.steam-library-sync[data-state=pending], .steam-library-sync[data-state=running]').waitFor();
      await image(page, `${theme}-signup-syncing`);
      await page.locator('.steam-library-sync[data-state=completed]').waitFor({ timeout: 60000 });
      const created = await prisma.player.findUniqueOrThrow({ where: { steamVerifiedId: publicId } }); playerIds.push(created.id);
      const games = await prisma.game.findMany({ where: { userId: created.id }, orderBy: { steamAppId: 'asc' } });
      assert.equal(games.length, 2); assert.equal(games[0].hoursPlayed, 2); assert.equal(games[1].hoursPlayed, 0);
      assert.equal(games[0].steamAchievementsUnlocked, 1); assert.equal(games[0].steamAchievementsTotal, 2);
      assert(games.every(game => game.status === 'Backlog')); await image(page, `${theme}-signup-populated`);
      await logout(page); await login(page, email); await security(page); auth = await start(page, 'link'); await complete(page, auth, publicId);
      await page.getByRole('status').filter({ hasText: 'already verified by another player' }).waitFor();
      assert.equal((await prisma.player.findUniqueOrThrow({ where: { id: main.id } })).steamVerifiedId, null);
      // A private accidental signup remains empty and can be reclaimed by its verified owner.
      await page.goto(base); await logout(page); auth = await start(page); await complete(page, auth, privateId);
      await page.locator('.steam-library-sync[data-state=failed]').waitFor({ timeout: 60000 });
      await page.getByRole('alert').filter({ hasText: 'Game details to Public' }).waitFor(); await image(page, `${theme}-private-library`);
      const empty = await prisma.player.findUniqueOrThrow({ where: { steamVerifiedId: privateId } }); playerIds.push(empty.id);
      assert.equal(await prisma.game.count({ where: { userId: empty.id } }), 0);
      await prisma.playerSession.create({ data: { userId: empty.id, tokenHash: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 86400000) } });
      await logout(page); await login(page, email); await security(page);
      fixtures.__libraries[privateId] = { games: owned, delayMs: 3500 }; save();
      auth = await start(page, 'link'); await complete(page, auth, privateId);
      await page.locator('.steam-library-sync[data-state=pending], .steam-library-sync[data-state=running]').waitFor(); await image(page, `${theme}-link-syncing`);
      await page.locator('.steam-library-sync[data-state=completed]').waitFor({ timeout: 60000 });
      await page.getByRole('status').filter({ hasText: 'Steam account verified and linked.' }).waitFor();
      const linked = await prisma.player.findUniqueOrThrow({ where: { id: main.id } });
      assert.equal(linked.steamVerifiedId, privateId); assert.equal(linked.steamId, manualId); assert.equal(linked.steamLibrarySourceId, privateId);
      for (const field of ['email', 'passwordHash', 'googleId', 'handle']) assert.equal(linked[field], main[field]);
      const old = await prisma.player.findUniqueOrThrow({ where: { id: empty.id } });
      assert.equal(old.steamVerifiedId, null); assert.equal(old.profileVisibility, 'private'); assert.equal(old.operatorName, empty.operatorName);
      assert.equal(await prisma.playerSession.count({ where: { userId: empty.id } }), 0);
      assert.equal(await prisma.game.count({ where: { userId: main.id } }), 2);
      const retained = await prisma.game.findUniqueOrThrow({ where: { id: saved.id } });
      for (const field of ['title', 'hoursPlayed', 'status', 'rating', 'notes', 'review']) assert.equal(retained[field], saved[field]);
      await image(page, `${theme}-reclaimed-and-populated`);
      // Steam sign-in now resolves the main account and re-imports idempotently.
      await logout(page); auth = await start(page); await complete(page, auth, privateId);
      await page.locator('.steam-library-sync[data-state=completed]').waitFor({ timeout: 60000 });
      assert.equal(await prisma.player.count({ where: { steamVerifiedId: privateId } }), 1);
      assert.equal(await prisma.game.count({ where: { userId: main.id } }), 2);
      assert.equal((await prisma.steamAuthSync.findUniqueOrThrow({ where: { userId: main.id } })).addedCount, 0);
      await image(page, `${theme}-signin-synced`);
      await context.close(); results.push({ theme, widths: [1440, 390], signupAutoPopulation: true, unplayedIncluded: true, playtimeAndAchievements: true,
        privatePrivacyGuidance: true, nonemptyConflictProtected: true, emptyShellReclaimed: true, shellSessionsRevoked: true, mainCredentialsAndProgressPreserved: true,
        manualProfilePreserved: true, verifiedSourceUsed: true, signinImportIdempotent: true });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(await prisma.player.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } }), originals);
    assert.deepEqual(await prisma.playerSession.findMany({ where: { tokenHash: { in: originalSessions.map(row => row.tokenHash) } }, orderBy: { tokenHash: 'asc' } }), originalSessions);
    fs.writeFileSync(`${artifacts}/results.json`, JSON.stringify({ provider: 'explicit OpenID and Steam Web API fixtures; real app/database/sessions', results,
      originalAccountsPreserved: originals.length, originalActiveSessionsPreserved: originalSessions.length, runtimeErrors: errors }, null, 2));
    console.log('PASS: Steam auth automatically imports played/unplayed games, hours and achievements, refreshes both themes, explains private profiles, and safely reclaims empty shells. Provider calls were stubbed.');
  } catch (error) { if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: `${artifacts}/failure.png`, fullPage: true }).catch(() => {}); throw error; }
  finally {
    await browser?.close(); if (server) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
    await prisma.player.deleteMany({ where: { id: { in: playerIds } } });
    await prisma.steamOpenIDAttempt.deleteMany({ where: { stateHash: { in: attemptedStates } } });
    await prisma.steamOpenIDNonce.deleteMany({ where: { nonceHash: { in: assertionNonces } } });
    fs.unlinkSync(fixturePath);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
