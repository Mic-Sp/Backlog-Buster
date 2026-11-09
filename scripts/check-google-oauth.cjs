/* eslint-disable @typescript-eslint/no-require-imports -- Explicit local browser QA with disposable accounts and a provider stub. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createHash, generateKeyPairSync, randomBytes, scryptSync } = require('node:crypto');
const { spawn } = require('node:child_process');
require('dotenv/config');
const cli = (flag, fallback) => { const position = process.argv.indexOf(flag); return position >= 0 ? process.argv[position + 1] : fallback; };
const { chromium } = require(cli('--playwright-module', process.env.PLAYWRIGHT_MODULE || 'playwright'));
const { neonConfig } = require('@neondatabase/serverless'); neonConfig.webSocketConstructor = require('ws');
const { PrismaNeon } = require('@prisma/adapter-neon'), { PrismaClient } = require('../src/generated/prisma/client.ts');
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
const base = 'http://localhost:3012', artifacts = '/tmp/backlog-google-browser';
const missingConfigOnly = process.argv.includes('--missing-config-only');
fs.mkdirSync(artifacts, { recursive: true });
const fixturePath = `${artifacts}/provider-fixture.json`, logPath = `${artifacts}/server.log`;
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const provider = { publicJwk: { ...keys.publicKey.export({ format: 'jwk' }), kid: 'browser-qa-key' }, privatePem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), codes: {} };
const saveProvider = () => fs.writeFileSync(fixturePath, JSON.stringify(provider), { mode: 0o600 });
saveProvider();
const emails = [], runtimeErrors = [], results = [];
const attemptHashes = [];
const authorizations = new WeakMap();
let server, browser, currentPage;
async function until(check, label) { for (let i = 0; i < 120; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 500)); } throw Error(label); }
async function image(page, name) {
  // The CSS theme is restored before hydration; wait for matching interactive
  // theme copy too so screenshots capture the settled client UI.
  const theme = await page.locator('html').getAttribute('data-layout-mode');
  await page.getByRole('button', { name: theme === 'fantasy' ? 'Switch to Cyberpunk Deck' : 'Switch to Fantasy Subscreen', exact: true }).first().waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} overflows at ${width}px`);
    await page.screenshot({ path: `${artifacts}/${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function security(page) {
  await page.getByRole('button', { name: '⚙ ACCOUNT SECURITY', exact: true }).click();
  await page.locator('.security-google-status').waitFor({ timeout: 30000 });
  return page.getByRole('dialog');
}
async function startGoogle(page, mode = 'signin') {
  const selector = mode === 'link' ? '.security-google .google-oauth-button' : '.auth-panel:visible .google-oauth-button';
  const previous = authorizations.get(page);
  await page.locator(selector).click();
  await until(() => authorizations.get(page) && authorizations.get(page) !== previous, 'OAuth authorization redirect missing');
  await page.locator('[data-provider-stub]').waitFor();
  const url = new URL(authorizations.get(page));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('redirect_uri'), `${base}/api/auth/google/callback`);
  return url;
}
async function completeGoogle(page, auth, profile, wrongState = false) {
  const code = randomBytes(16).toString('hex');
  provider.codes[code] = { profile, nonce: auth.searchParams.get('nonce'), challenge: auth.searchParams.get('code_challenge'), redirectUri: auth.searchParams.get('redirect_uri') };
  saveProvider();
  const callback = new URL(auth.searchParams.get('redirect_uri'));
  callback.searchParams.set('code', code); callback.searchParams.set('state', wrongState ? randomBytes(32).toString('base64url') : auth.searchParams.get('state'));
  await page.goto(callback.toString(), { waitUntil: 'domcontentloaded', timeout: 120000 });
}
async function localLogin(page, email, password) {
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
  if (process.argv.includes('--compare-rollout-baseline')) {
    const baseline = JSON.parse(fs.readFileSync('/tmp/backlog-google-baseline.json', 'utf8'));
    const [accounts] = await prisma.$queryRaw`SELECT COUNT(*)::int AS accounts, md5(string_agg(concat_ws(chr(31), id, email, "passwordHash", "emailVerifiedAt"::text), chr(30) ORDER BY id)) AS fingerprint FROM "Player" WHERE email IS NOT NULL`;
    const [sessions] = await prisma.$queryRaw`SELECT md5(string_agg(concat_ws(chr(31), "tokenHash", "userId", "expiresAt"::text), chr(30) ORDER BY "tokenHash")) AS fingerprint FROM "PlayerSession"`;
    await prisma.$disconnect();
    assert.deepEqual(accounts, baseline.accounts); assert.deepEqual(sessions, baseline.sessions);
    fs.writeFileSync(`${artifacts}/rollout-preservation.json`, JSON.stringify({ accounts: accounts.accounts, credentialsAndVerificationPreserved: true, originalSessionsPreserved: true }, null, 2));
    fs.unlinkSync(fixturePath);
    console.log(`All ${accounts.accounts} pre-rollout accounts, credentials, verification timestamps and session records are unchanged.`);
    return;
  }
  const originals = await prisma.player.findMany({ orderBy: { id: 'asc' } });
  const ids = originals.map(player => player.id);
  const originalSessions = await prisma.playerSession.findMany({ where: { userId: { in: ids } }, orderBy: { tokenHash: 'asc' } });
  try {
    fs.mkdirSync('.next-google-qa', { recursive: true });
    fs.writeFileSync('.google-qa-tsconfig.json', JSON.stringify({ extends: './tsconfig.json', include: ['src/**/*.ts', 'src/**/*.tsx', 'next-env.d.ts'], exclude: ['node_modules'] }));
    const log = fs.openSync(logPath, 'w');
    server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3012'], { cwd: path.resolve(__dirname, '..'), detached: true, stdio: ['ignore', log, log], env: {
      ...process.env, APP_URL: base, GOOGLE_CLIENT_ID: missingConfigOnly ? '' : 'browser-qa-client', GOOGLE_CLIENT_SECRET: missingConfigOnly ? '' : 'browser-qa-secret', RESEND_API_KEY: '',
      BB_GOOGLE_QA_FIXTURE: fixturePath, NODE_OPTIONS: `--require=${path.resolve(__dirname, '../tests/helpers/google-provider.cjs')}`,
      BACKLOG_BUILD_DIR: '.next-google-qa', BACKLOG_TSCONFIG: '.google-qa-tsconfig.json',
    } });
    fs.closeSync(log);
    await until(async () => { try { return (await fetch(`${base}/access`)).ok; } catch { return false; } }, 'QA server failed to start');
    const libraryPath = cli('--library-path', process.env.AUTH_BROWSER_LIBRARY_PATH);
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], env: { ...process.env, ...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}) } });
    if (missingConfigOnly) {
      for (const theme of ['cyberpunk', 'fantasy']) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addInitScript(theme => { localStorage.setItem('backlogbuster:layout-mode', theme); localStorage.setItem('backlogbuster:ui-muted', 'true'); }, theme);
        const page = currentPage = await context.newPage(); page.on('pageerror', error => runtimeErrors.push(error.message));
        await page.goto(`${base}/access`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('link', { name: 'Continue with Google', exact: true }).click();
        await page.getByRole('status').filter({ hasText: 'Google sign-in is not configured' }).waitFor();
        await image(page, `${theme}-unconfigured`);
        await page.getByRole('link', { name: 'Back to sign in', exact: true }).click();
        await page.locator('[name=email]').waitFor(); assert(await page.locator('[name=password]').isVisible());
        await context.close();
      }
      assert.deepEqual(runtimeErrors, []);
      fs.writeFileSync(`${artifacts}/missing-config-results.json`, JSON.stringify({ themes: ['cyberpunk', 'fantasy'], widths: [1440, 390], missingConfigurationHandled: true, runtimeErrors }, null, 2));
      console.log('Missing Google configuration is handled cleanly in both themes at 1440/390px. Email/password login remains available.');
      return;
    }
    for (const theme of ['cyberpunk', 'fantasy']) {
      const nonce = randomBytes(5).toString('hex'), email = `google-qa-${theme}-${nonce}@example.invalid`, legacyEmail = `google-local-${theme}-${nonce}@example.invalid`;
      emails.push(email, legacyEmail);
      const profile = { googleId: `qa-google-${nonce}`, email, name: `QA ${theme}` };
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await context.addInitScript(theme => { localStorage.setItem('backlogbuster:layout-mode', theme); localStorage.setItem('backlogbuster:ui-muted', 'true'); }, theme);
      await context.route('https://accounts.google.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Isolated Google provider stub</title><p>Provider response mocked for browser QA.</p>' }));
      // Capture the app's real 307 without following it to an external provider.
      await context.route(/\/api\/auth\/google\?/, async route => {
        const response = await route.fetch({ maxRedirects: 0 });
        assert.equal(response.status(), 307);
        const location = response.headers().location;
        assert.equal(new URL(location).origin, 'https://accounts.google.com');
        attemptHashes.push(createHash('sha256').update(`google-state-v1:${new URL(location).searchParams.get('state')}`).digest('hex'));
        authorizations.set(route.request().frame().page(), location);
        await route.fulfill({ response, status: 200, headers: { ...response.headers(), 'content-type': 'text/html' }, body: '<title>Isolated provider stub</title><p data-provider-stub>Provider response mocked for browser QA.</p>' });
      });
      const page = currentPage = await context.newPage(); page.on('pageerror', error => runtimeErrors.push(error.message));
      await page.goto(`${base}/access`, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(theme => document.documentElement.dataset.layoutMode === theme, theme);
      assert.equal(await page.getByRole('link', { name: 'Continue with Google', exact: true }).count(), 1);
      await image(page, `${theme}-login`);
      await page.getByRole('button', { name: /REGISTER \/\/ NEW ARCHIVE|INSCRIBE \/\/ NEW LEDGER/ }).click();
      assert.equal(await page.getByRole('link', { name: 'Continue with Google', exact: true }).count(), 1); await image(page, `${theme}-signup`);
      // Wrong state must be rejected without creating an account.
      let auth = await startGoogle(page); await completeGoogle(page, auth, profile, true);
      await page.getByRole('status').filter({ hasText: 'expired or could not be verified' }).waitFor(); assert.equal(await prisma.player.count({ where: { email } }), 0);
      await page.goto(`${base}/access`, { waitUntil: 'domcontentloaded' });
      auth = await startGoogle(page); await completeGoogle(page, auth, profile);
      await page.getByRole('button', { name: '⚙ ACCOUNT SECURITY', exact: true }).waitFor({ timeout: 90000 });
      const oauth = await prisma.player.findUniqueOrThrow({ where: { email } });
      assert.equal(oauth.googleId, profile.googleId); assert.equal(oauth.passwordHash, null); assert(oauth.emailVerifiedAt); assert.equal(oauth.preferredLayoutMode, theme);
      let panel = await security(page);
      assert.equal(await panel.locator('.security-google-status').textContent(), '✓ Google account connected');
      assert.equal(await panel.locator('[name=currentPassword]').count(), 0); assert.equal(await panel.locator('[name=newEmail]').count(), 0);
      await image(page, `${theme}-google-only-security`);
      // Database activity guard must accept a registered Google-only account.
      await prisma.activityEvent.create({ data: { actorId: oauth.id, type: 'library_imported', metadata: { count: 0, provider: 'qa' }, deduplicationKey: `qa-google:${nonce}` } });
      const localPassword = `QA-${nonce}-local-password`;
      await panel.locator('[name=newPassword]').fill(localPassword); await panel.getByRole('button', { name: /UPDATE SECURITY CREDENTIALS/ }).click();
      await panel.getByText('SECURITY CREDENTIALS UPDATED // ARCHIVE LOCKED', { exact: true }).waitFor();
      await panel.locator('[name=currentPassword]').waitFor(); assert((await prisma.player.findUniqueOrThrow({ where: { id: oauth.id } })).passwordHash);
      await image(page, `${theme}-password-added`);
      await panel.getByRole('button', { name: 'Close account security' }).click(); await logout(page); await localLogin(page, email, localPassword); await logout(page);
      // Stable-subject Google login returns to that same account.
      auth = await startGoogle(page); await completeGoogle(page, auth, profile); await page.getByRole('button', { name: '⚙ ACCOUNT SECURITY', exact: true }).waitFor();
      assert.equal(await prisma.player.count({ where: { googleId: profile.googleId } }), 1); await logout(page);
      // A local account with a verified Google email is linked in place.
      const salt = randomBytes(16), passwordHash = `scrypt$131072$8$1$${salt.toString('hex')}$${scryptSync(localPassword, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 }).toString('hex')}`;
      const legacy = await prisma.player.create({ data: { email: legacyEmail, passwordHash, operatorName: `Local ${theme}`, preferredLayoutMode: theme } });
      const game = await prisma.game.create({ data: { userId: legacy.id, title: 'OAuth preservation fixture', platform: 'PC' } });
      const legacyProfile = { googleId: `qa-legacy-${nonce}`, email: legacyEmail, name: 'Google name must not replace local profile' };
      auth = await startGoogle(page); await completeGoogle(page, auth, legacyProfile); await page.getByRole('button', { name: '⚙ ACCOUNT SECURITY', exact: true }).waitFor();
      const linkedLegacy = await prisma.player.findUniqueOrThrow({ where: { id: legacy.id } });
      assert.equal(linkedLegacy.passwordHash, passwordHash); assert.equal(linkedLegacy.operatorName, legacy.operatorName); assert.equal(linkedLegacy.googleId, legacyProfile.googleId); assert(linkedLegacy.emailVerifiedAt);
      assert(await prisma.game.findUnique({ where: { id: game.id } })); await logout(page);
      // Logged-in linking retains the current player's different primary email.
      await prisma.player.update({ where: { id: legacy.id }, data: { googleId: null } });
      await localLogin(page, legacyEmail, localPassword); panel = await security(page);
      await image(page, `${theme}-link-available`); auth = await startGoogle(page, 'link');
      await completeGoogle(page, auth, profile); await page.getByRole('status').filter({ hasText: 'already connected to another player' }).waitFor();
      assert.equal((await prisma.player.findUniqueOrThrow({ where: { id: legacy.id } })).googleId, null);
      await page.goto(base, { waitUntil: 'domcontentloaded' }); panel = await security(page); auth = await startGoogle(page, 'link');
      await completeGoogle(page, auth, { googleId: legacyProfile.googleId, email: `different-${nonce}@example.invalid`, name: 'Different Google email' });
      await page.getByRole('heading', { name: 'Google account linked', exact: true }).waitFor(); await image(page, `${theme}-link-complete`);
      const linked = await prisma.player.findUniqueOrThrow({ where: { id: legacy.id } }); assert.equal(linked.email, legacyEmail); assert.equal(linked.passwordHash, passwordHash); assert.equal(linked.googleId, legacyProfile.googleId);
      await page.goto(base, { waitUntil: 'domcontentloaded' }); panel = await security(page); assert.equal(await panel.locator('.security-google-status').textContent(), '✓ Google account connected');
      await context.close();
      results.push({ theme, widths: [1440, 390], loginAndSignupUI: true, newGoogleAccount: true, addLocalPassword: true, emailAutoLink: true, signedInLink: true, conflictRejected: true, csrfRejected: true, googleOnlyActivity: true });
      console.log(`${theme}: passed UI at 1440/390px, Google-only signup, password setup/login, email auto-link, signed-in linking, conflicts and CSRF.`);
    }
    assert.deepEqual(runtimeErrors, []);
    assert.deepEqual(await prisma.player.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } }), originals);
    assert.deepEqual(await prisma.playerSession.findMany({ where: { userId: { in: ids } }, orderBy: { tokenHash: 'asc' } }), originalSessions);
    fs.writeFileSync(`${artifacts}/results.json`, JSON.stringify({ provider: 'isolated mock; real app routes, PKCE and JWT verification', results, originalAccountsPreserved: originals.filter(player => player.email).length, runtimeErrors }, null, 2));
    console.log('Original accounts, credentials and sessions preserved. No browser runtime errors.');
  } catch (error) {
    console.error(error); process.exitCode = 1;
    if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: `${artifacts}/failure.png`, fullPage: true }).catch(() => {});
  } finally {
    if (browser) await browser.close();
    if (server) { try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    await prisma.player.deleteMany({ where: { email: { in: emails } } });
    await prisma.googleOAuthAttempt.deleteMany({ where: { stateHash: { in: attemptHashes } } });
    await prisma.$disconnect();
    fs.unlinkSync(fixturePath);
    if (fs.existsSync('.google-qa-tsconfig.json')) fs.unlinkSync('.google-qa-tsconfig.json');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
