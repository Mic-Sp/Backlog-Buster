/* eslint-disable @typescript-eslint/no-require-imports -- Real app/browser/database QA with disposable accounts and an explicit provider fixture. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomBytes, createHash, scryptSync } = require('node:crypto'), { spawn } = require('node:child_process');
require('dotenv/config');
const cli = (flag, fallback) => { const i = process.argv.indexOf(flag); return i < 0 ? fallback : process.argv[i + 1]; };
const { chromium } = require(cli('--playwright-module', process.env.PLAYWRIGHT_MODULE || 'playwright'));
const { neonConfig } = require('@neondatabase/serverless'); neonConfig.webSocketConstructor = require('ws');
const { PrismaNeon } = require('@prisma/adapter-neon'), { PrismaClient } = require('../src/generated/prisma/client.ts');
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
const base = 'http://localhost:3013', artifacts = '/tmp/backlog-steam-openid-browser';
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
    await page.screenshot({ path: `${artifacts}/${name}-${width}.png`, fullPage: await modal.count() === 0 });
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
  // Snapshot existing accounts and active sessions; report only counts/booleans.
  const originals = await prisma.player.findMany({ orderBy: { id: 'asc' } }), originalIds = originals.map(row => row.id);
  const originalSessions = await prisma.playerSession.findMany({ where: { userId: { in: originalIds }, expiresAt: { gt: new Date(Date.now() + 600000) } }, orderBy: { tokenHash: 'asc' } });
  try {
    fs.writeFileSync('.steam-qa-tsconfig.json', JSON.stringify({ extends: './tsconfig.json', include: ['src/**/*.ts', 'src/**/*.tsx', 'next-env.d.ts'], exclude: ['node_modules', '.next-google-qa', '.next-steam-qa'] }));
    const log = fs.openSync(`${artifacts}/server.log`, 'w');
    server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3013'], {
      cwd: path.resolve(__dirname, '..'), detached: true, stdio: ['ignore', log, log], env: { ...process.env, APP_URL: base,
        STEAM_API_KEY: '', RESEND_API_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '',
        BB_STEAM_QA_FIXTURE: fixturePath, NODE_OPTIONS: `--require=${path.resolve(__dirname, '../tests/helpers/steam-provider.cjs')}`,
        BACKLOG_BUILD_DIR: '.next-steam-qa', BACKLOG_TSCONFIG: '.steam-qa-tsconfig.json' },
    }); fs.closeSync(log);
    await until(async () => { try { return (await fetch(`${base}/access`)).ok; } catch { return false; } }, 'QA server did not start');
    const libraryPath = cli('--library-path', process.env.AUTH_BROWSER_LIBRARY_PATH);
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], env: { ...process.env, ...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}) } });
    for (const theme of ['cyberpunk', 'fantasy']) {
      const suffix = randomBytes(6).toString('hex'), email = `steam-qa-${suffix}@example.invalid`, legacyEmail = `steam-local-${suffix}@example.invalid`;
      let steamId; do { steamId = (76561197960265729n + BigInt(randomBytes(4).readUInt32BE())).toString(); } while (await prisma.player.findUnique({ where: { steamVerifiedId: steamId } }));
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await context.addInitScript(theme => { localStorage.setItem('backlogbuster:layout-mode', theme); localStorage.setItem('backlogbuster:ui-muted', 'true'); }, theme);
      await context.route(/\/api\/auth\/steam\?/, async route => {
        const response = await route.fetch({ maxRedirects: 0 }); assert.equal(response.status(), 307);
        const location = response.headers().location, auth = new URL(location); assert.equal(auth.origin, 'https://steamcommunity.com');
        attemptedStates.push(createHash('sha256').update(`steam-state-v1:${new URL(auth.searchParams.get('openid.return_to')).searchParams.get('state')}`).digest('hex'));
        auths.set(route.request().frame().page(), location);
        await route.fulfill({ response, status: 200, headers: { ...response.headers(), 'content-type': 'text/html' }, body: '<title>Steam provider fixture</title><p data-provider-stub>Local OpenID provider fixture</p>' });
      });
      const page = currentPage = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/access`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: 'Continue with Steam', exact: true }).waitFor(); await image(page, `${theme}-login`);
      await page.getByRole('button', { name: /REGISTER \/\/ NEW ARCHIVE|INSCRIBE \/\/ NEW LEDGER/ }).click();
      await image(page, `${theme}-signup`);
      // Manually entered profiles must not be mistaken for login identities.
      const legacy = await prisma.player.create({ data: { email: legacyEmail, passwordHash: passwordHash(), googleId: `qa-google-${suffix}`, steamId,
        handle: `steam-legacy-${suffix}`, operatorName: `QA ${theme}`, preferredLayoutMode: theme } }); playerIds.push(legacy.id);
      await prisma.game.create({ data: { userId: legacy.id, title: 'Steam ownership preservation fixture', platform: 'PC', status: 'Completed', playthroughCount: 1, earnedXp: 300 } });
      let auth = await start(page); await complete(page, auth, steamId, 'wrong-state');
      await page.getByRole('status').filter({ hasText: 'expired or has already been used' }).waitFor();
      assert.equal(await prisma.player.count({ where: { steamVerifiedId: steamId } }), 0);
      await page.goto(`${base}/access`); auth = await start(page); await complete(page, auth, steamId, 'forged');
      await page.getByRole('status').filter({ hasText: 'could not be verified' }).waitFor();
      assert.equal(await prisma.player.count({ where: { steamVerifiedId: steamId } }), 0);
      await page.goto(`${base}/access`); auth = await start(page); const callback = await complete(page, auth, steamId);
      await page.getByRole('button', { name: '⚙ ACCOUNT SECURITY', exact: true }).waitFor({ timeout: 90000 });
      const created = await prisma.player.findUniqueOrThrow({ where: { steamVerifiedId: steamId } }); playerIds.push(created.id);
      assert.notEqual(created.id, legacy.id); assert.equal(created.email, null); assert.equal(created.passwordHash, null); assert.equal(created.preferredLayoutMode, theme);
      let panel = await security(page); await panel.getByText(`✓ Steam ownership verified · ${steamId}`, { exact: true }).waitFor();
      assert.equal(await panel.locator('[name=currentPassword]').count(), 0); assert.equal(await panel.getByRole('button', { name: 'Resend verification email', exact: true }).count(), 0);
      await image(page, `${theme}-steam-only-security`);
      // Add an email alone, then add an optional local password.
      await panel.locator('[name=newEmail]').fill(email); await panel.locator('.security-save-button').click();
      await panel.getByRole('status').filter({ hasText: 'SECURITY CREDENTIALS UPDATED' }).waitFor();
      let updated = await prisma.player.findUniqueOrThrow({ where: { id: created.id } }); assert.equal(updated.email, email); assert.equal(updated.passwordHash, null); assert.equal(updated.emailVerifiedAt, null);
      await panel.locator('[name=newPassword]').fill(password); await panel.locator('.security-save-button').click();
      await panel.locator('[name=currentPassword]').waitFor(); updated = await prisma.player.findUniqueOrThrow({ where: { id: created.id } }); assert(updated.passwordHash); assert.equal(updated.steamVerifiedId, steamId);
      await image(page, `${theme}-credentials-added`); await panel.getByRole('button', { name: 'Close account security', exact: true }).click();
      await logout(page); await login(page, email); await logout(page);
      auth = await start(page); await complete(page, auth, steamId);
      await page.getByRole('button', { name: '⚙ ACCOUNT SECURITY', exact: true }).waitFor({ timeout: 90000 });
      // The old callback is single-use even with an established session.
      await page.goto(callback); await page.getByRole('status').filter({ hasText: 'expired or has already been used' }).waitFor();
      await page.goto(base); await logout(page); await login(page, legacyEmail);
      panel = await security(page); await panel.getByText('Steam ownership not verified', { exact: true }).waitFor();
      await image(page, `${theme}-link-available`);
      auth = await start(page, 'link'); await complete(page, auth, steamId);
      await page.getByRole('status').filter({ hasText: 'already verified by another player' }).waitFor(); await image(page, `${theme}-link-conflict`);
      let preserved = await prisma.player.findUniqueOrThrow({ where: { id: legacy.id } }); assert.equal(preserved.steamVerifiedId, null); assert.equal(preserved.passwordHash, legacy.passwordHash); assert.equal(preserved.googleId, legacy.googleId);
      const verifyOther = (BigInt(steamId) > 76561197960265730n ? BigInt(steamId) - 1n : BigInt(steamId) + 1n).toString();
      assert.equal(await prisma.player.count({ where: { steamVerifiedId: verifyOther } }), 0);
      await page.goto(base); panel = await security(page); auth = await start(page, 'link'); await complete(page, auth, verifyOther);
      await page.getByRole('region', { name: 'Steam library sync' }).waitFor(); await image(page, `${theme}-link-complete`);
      preserved = await prisma.player.findUniqueOrThrow({ where: { id: legacy.id } });
      for (const field of ['email', 'passwordHash', 'googleId', 'steamId', 'handle']) assert.equal(preserved[field], legacy[field]);
      assert.equal(preserved.steamVerifiedId, verifyOther); assert.equal(await prisma.game.count({ where: { userId: legacy.id } }), 1);
      await page.goto(base); panel = await security(page); await panel.getByText(`✓ Steam ownership verified · ${verifyOther}`, { exact: true }).waitFor();
      await image(page, `${theme}-verified-manual-profile`); await panel.getByRole('button', { name: 'Close account security', exact: true }).click();
      await page.getByRole('button', { name: theme === 'fantasy' ? /ROYAL ARCHIVE/ : /DATA VAULT.*IMPORT/ }).click();
      await page.getByRole('button', { name: 'Direct Steam Sync', exact: true }).click();
      await page.getByText(`✓ Steam ownership verified · ${verifyOther}`, { exact: true }).waitFor(); await image(page, `${theme}-steam-sync-settings`);
      await context.close();
      results.push({ theme, widths: [1440, 390], steamOnlySignup: true, forgedAssertionRejected: true, stateReplayRejected: true, localLogin: true, steamLogin: true, emailAndPasswordAdded: true,
        verifiedLink: true, conflictPrevented: true, legacyCredentialsGoogleLibraryAndManualProfilePreserved: true, noHorizontalOverflow: true });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(await prisma.player.findMany({ where: { id: { in: originalIds } }, orderBy: { id: 'asc' } }), originals);
    assert.deepEqual(await prisma.playerSession.findMany({ where: { tokenHash: { in: originalSessions.map(row => row.tokenHash) } }, orderBy: { tokenHash: 'asc' } }), originalSessions);
    fs.writeFileSync(`${artifacts}/results.json`, JSON.stringify({ provider: 'explicit fixture; app, routes, sessions and database are real', results, originalAccountsPreserved: originals.length, originalActiveSessionsPreserved: originalSessions.length, runtimeErrors: errors }, null, 2));
    console.log('PASS: Steam signup/signin/linking, local credentials, state/replay/forgery/conflicts, account preservation, and both themes at 1440/390px. Steam provider verification was stubbed.');
  } catch (error) { if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: `${artifacts}/failure.png`, fullPage: true }).catch(() => {}); throw error; }
  finally {
    await browser?.close();
    if (server) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
    await prisma.player.deleteMany({ where: { id: { in: playerIds } } });
    await prisma.steamOpenIDAttempt.deleteMany({ where: { stateHash: { in: attemptedStates } } });
    await prisma.steamOpenIDNonce.deleteMany({ where: { nonceHash: { in: assertionNonces } } });
    fs.unlinkSync(fixturePath);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
