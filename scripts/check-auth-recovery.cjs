/* eslint-disable @typescript-eslint/no-require-imports -- Explicit browser QA using disposable .invalid accounts only. */
// Start a development server with RESEND_API_KEY='' and APP_URL matching BASE_URL.
// PLAYWRIGHT_MODULE may point to an existing Playwright installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomBytes, createHash } = require('node:crypto');
require('dotenv/config');
const { neonConfig } = require('@neondatabase/serverless');
neonConfig.webSocketConstructor = require('ws');
const { PrismaNeon } = require('@prisma/adapter-neon');
const { PrismaClient } = require('../src/generated/prisma/client.ts');
const cli = (flag, fallback) => { const position = process.argv.indexOf(flag); return position >= 0 ? process.argv[position + 1] : fallback; };
const { chromium } = require(cli('--playwright-module', process.env.PLAYWRIGHT_MODULE || 'playwright'));
const libraryPath = cli('--library-path', process.env.AUTH_BROWSER_LIBRARY_PATH);
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
const base = process.env.AUTH_BROWSER_BASE_URL || 'http://localhost:3011';
const logPath = process.env.AUTH_BROWSER_SERVER_LOG || '/tmp/backlog-auth-dev.log';
const artifacts = process.env.AUTH_BROWSER_ARTIFACTS || '/tmp/backlog-auth-browser';
const createdEmails = [], errors = [], results = [];
fs.mkdirSync(artifacts, { recursive: true });
async function until(check, label) {
  for (let i = 0; i < 120; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 500)); }
  throw Error(label);
}
async function emailLink(email, purpose, previous = '') {
  let link;
  await until(async () => {
    const log = fs.readFileSync(logPath, 'utf8');
    const lines = log.split('\n');
    for (let i = 0; i < lines.length; i++) if (lines[i].includes(`[auth-email:development] ${purpose} to ${email}`)) {
      const match = lines[i + 1]?.match(/https?:\/\/[^\s]+/); if (match) link = match[0];
    }
    return link && link !== previous;
  }, `No ${purpose} development email for disposable account`);
  assert.equal(new URL(link).origin, base);
  return link;
}
async function screenshot(page, name) {
  await page.screenshot({ path: `${artifacts}/${name}.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} overflows on mobile`);
  await page.screenshot({ path: `${artifacts}/${name}-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 960 });
}
async function login(page, email, password) {
  await page.goto(`${base}/access`, { waitUntil: 'domcontentloaded' });
  await page.locator('[name=email]').fill(email); await page.locator('[name=password]').fill(password);
  await page.locator('.auth-submit').click();
  await page.getByRole('button', { name: '⚙ ACCOUNT SECURITY', exact: true }).waitFor({ timeout: 90000 });
}
async function security(page) {
  await page.getByRole('button', { name: '⚙ ACCOUNT SECURITY', exact: true }).click();
  await page.locator('.security-verification-badge').waitFor({ timeout: 30000 });
  return page.getByRole('dialog');
}
async function main() {
  let browser;
  // Keep a byte-for-byte snapshot of original credentials, verification and sessions.
  const originalPlayers = await prisma.player.findMany({ where: { email: { not: null } }, orderBy: { id: 'asc' },
    select: { id: true, email: true, passwordHash: true, emailVerifiedAt: true, createdAt: true } });
  const originalIds = originalPlayers.map(player => player.id);
  const originalSessions = await prisma.playerSession.findMany({ where: { userId: { in: originalIds } }, orderBy: { tokenHash: 'asc' } });
  assert(originalPlayers.every(player => player.emailVerifiedAt), 'Existing accounts must already be grandfathered');
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
      env: { ...process.env, ...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}) } });
    for (const mode of ['cyberpunk', 'fantasy']) {
      const nonce = randomBytes(5).toString('hex'), email = `auth-qa-${mode}-${nonce}@example.invalid`;
      const changedEmail = `auth-qa-new-${mode}-${nonce}@example.invalid`;
      const password = `Original-${nonce}-password`, newPassword = `New-${nonce}-password`;
      createdEmails.push(email, changedEmail);
      const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
      await context.addInitScript(mode => { localStorage.setItem('backlogbuster:layout-mode', mode); localStorage.setItem('backlogbuster:ui-muted', 'true'); }, mode);
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      console.log(`${mode}: registering disposable account through UI.`);
      await page.goto(`${base}/access`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForFunction(mode => document.documentElement.dataset.layoutMode === mode, mode);
      await page.getByRole('button', { name: /REGISTER \/\/ NEW ARCHIVE|INSCRIBE \/\/ NEW LEDGER/ }).click();
      await page.locator('[name=email]').fill(email); await page.locator('[name=password]').fill(password);
      await page.locator('[name=operatorName]').fill(`QA ${mode}`);
      await screenshot(page, `${mode}-signup`);
      await page.locator('.auth-submit').click();
      await page.getByRole('button', { name: '⚙ ACCOUNT SECURITY', exact: true }).waitFor({ timeout: 120000 });
      let player = await prisma.player.findUniqueOrThrow({ where: { email } });
      assert.equal(player.emailVerifiedAt, null); assert.equal(player.preferredLayoutMode, mode);
      const verification = await emailLink(email, 'verify_email');
      let panel = await security(page);
      assert.equal(await panel.locator('.security-verification-badge').textContent(), 'Email verification pending');
      await panel.getByRole('button', { name: 'Resend verification email', exact: true }).click();
      await panel.getByText(/Verification requested/).waitFor();
      assert(await panel.getByRole('button', { name: /COOLDOWN|RETRY|WAIT|[0-9]+s/i }).count() > 0 || await panel.locator('.security-verification button:disabled').count() > 0);
      await screenshot(page, `${mode}-verification-pending`);
      await panel.getByRole('button', { name: 'Close account security' }).click();
      await page.getByRole('button', { name: 'LOG OUT', exact: true }).click();
      // Soft verification login must work before the email is confirmed.
      await login(page, email, password);
      assert.equal((await prisma.player.findUniqueOrThrow({ where: { id: player.id } })).emailVerifiedAt, null);
      const sessionCount = await prisma.playerSession.count({ where: { userId: player.id } });
      await page.goto(verification, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Verify email address', exact: true }).waitFor();
      assert.equal((await prisma.player.findUniqueOrThrow({ where: { id: player.id } })).emailVerifiedAt, null, 'GET must not consume verification token');
      await page.getByRole('button', { name: 'Verify email address', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Email verified.' }).waitFor();
      assert.equal(await page.locator('.recovery-panel:visible').getByRole('alert').count(), 0, 'Verification success must not also display an invalid-link error');
      assert((await prisma.player.findUniqueOrThrow({ where: { id: player.id } })).emailVerifiedAt);
      assert.equal(await prisma.playerSession.count({ where: { userId: player.id } }), sessionCount);
      await screenshot(page, `${mode}-verified`);
      await page.goto(verification, { waitUntil: 'domcontentloaded' });
      await page.getByRole('alert').filter({ hasText: 'invalid, expired, or already used' }).waitFor();
      await page.goto(base, { waitUntil: 'domcontentloaded' }); panel = await security(page);
      assert.equal(await panel.locator('.security-verification-badge').textContent(), '✓ Email verified');
      // Updating an email invalidates links/sessions and immediately shows pending status.
      const staleToken = randomBytes(32).toString('base64url');
      await prisma.playerAuthToken.create({ data: { tokenHash: createHash('sha256').update(`backlogbuster-auth-link-v1:${staleToken}`).digest('hex'), userId: player.id, email, purpose: 'reset_password', expiresAt: new Date(Date.now() + 600000) } });
      await prisma.playerSession.create({ data: { tokenHash: randomBytes(32).toString('hex'), userId: player.id, expiresAt: new Date(Date.now() + 600000) } });
      await panel.getByLabel('Current Password', { exact: true }).fill(password);
      await panel.locator('[name=newEmail]').fill(changedEmail);
      await panel.getByRole('button', { name: /UPDATE SECURITY CREDENTIALS/ }).click();
      await panel.getByText('SECURITY CREDENTIALS UPDATED // ARCHIVE LOCKED', { exact: true }).waitFor();
      assert.equal(await panel.locator('.security-verification-badge').textContent(), 'Email verification pending');
      assert.equal(await prisma.playerSession.count({ where: { userId: player.id } }), 1);
      assert.equal(await prisma.playerAuthToken.count({ where: { userId: player.id, purpose: 'reset_password' } }), 0);
      const reverify = await emailLink(changedEmail, 'verify_email');
      assert.equal((await prisma.player.findUniqueOrThrow({ where: { id: player.id } })).emailVerifiedAt, null);
      await page.goto(reverify, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Verify email address', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Email verified.' }).waitFor();
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'LOG OUT', exact: true }).click();
      await page.goto(`${base}/access`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: 'Forgot password?' }).click();
      await page.getByLabel('Email', { exact: true }).fill(changedEmail);
      await page.getByRole('button', { name: 'Send password reset link', exact: true }).click();
      const generic = await page.locator('.recovery-success').textContent();
      assert(generic.includes('If an account matches that email'));
      await screenshot(page, `${mode}-forgot-sent`);
      const resetLink = await emailLink(changedEmail, 'reset_password');
      const resetToken = new URL(resetLink).searchParams.get('token');
      const resetHash = createHash('sha256').update(`backlogbuster-auth-link-v1:${resetToken}`).digest('hex');
      assert(await prisma.playerAuthToken.findUnique({ where: { tokenHash: resetHash } }));
      await prisma.playerSession.create({ data: { tokenHash: randomBytes(32).toString('hex'), userId: player.id, expiresAt: new Date(Date.now() + 600000) } });
      await page.goto(resetLink, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Save new password', exact: true }).waitFor();
      // Next's streamed response can briefly retain a hidden pre-hydration tree.
      await page.locator('.recovery-panel:visible [name=password]').fill(newPassword);
      await page.locator('.recovery-panel:visible [name=confirmPassword]').fill('different password');
      await page.getByRole('button', { name: 'Save new password', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Passwords do not match.' }).waitFor();
      assert(await prisma.playerAuthToken.findUnique({ where: { tokenHash: resetHash } }));
      await page.locator('.recovery-panel:visible [name=confirmPassword]').fill(newPassword);
      await screenshot(page, `${mode}-reset-form`);
      await page.getByRole('button', { name: 'Save new password', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Password updated.' }).waitFor();
      assert.equal(await page.locator('.recovery-panel:visible').getByRole('alert').count(), 0, 'Reset success must not also display an invalid-link error');
      await screenshot(page, `${mode}-reset-complete`);
      assert.equal(await prisma.playerSession.count({ where: { userId: player.id } }), 0);
      assert.equal(await prisma.playerAuthToken.count({ where: { userId: player.id } }), 0);
      await page.goto(resetLink, { waitUntil: 'domcontentloaded' });
      await page.getByRole('alert').filter({ hasText: 'invalid, expired, or already used' }).waitFor();
      await page.goto(`${base}/access`, { waitUntil: 'domcontentloaded' });
      await page.locator('[name=email]').fill(changedEmail); await page.locator('[name=password]').fill(password); await page.locator('.auth-submit').click();
      await page.getByRole('alert').filter({ hasText: 'Incorrect email or password.' }).waitFor();
      await login(page, changedEmail, newPassword);
      // Unknown accounts get exactly the same visible response, and local previews
      // stay in the terminal rather than exposing recovery links to the requester.
      await page.goto(`${base}/forgot-password`, { waitUntil: 'domcontentloaded' });
      await page.getByLabel('Email', { exact: true }).fill(`unknown-${nonce}@example.invalid`);
      await page.getByRole('button', { name: 'Send password reset link', exact: true }).click();
      await page.locator('.recovery-success').waitFor(); assert.equal(await page.locator('.recovery-success').textContent(), generic);
      assert(!await page.locator('a[href*="token="]').count());
      // Expired links are rejected before password entry.
      const expired = randomBytes(32).toString('base64url');
      await prisma.playerAuthToken.create({ data: { tokenHash: createHash('sha256').update(`backlogbuster-auth-link-v1:${expired}`).digest('hex'), userId: player.id, email: changedEmail, purpose: 'reset_password', expiresAt: new Date(Date.now() - 1000) } });
      await page.goto(`${base}/reset-password?token=${expired}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('alert').filter({ hasText: 'invalid, expired, or already used' }).waitFor();
      await screenshot(page, `${mode}-expired`);
      await context.close();
      results.push({ theme: mode, signup: true, softVerificationLogin: true, verificationSingleUse: true, emailChangeReverification: true, reset: true, staleSessionsRevoked: true, enumerationSafe: true, expiry: true, mobile: true });
      console.log(`${mode}: all signup, login, verification, email-change, reset, expiry, and desktop/mobile checks passed.`);
    }
    assert.deepEqual(errors, [], 'Browser runtime errors');
    assert.deepEqual(await prisma.player.findMany({ where: { id: { in: originalIds } }, orderBy: { id: 'asc' }, select: { id: true, email: true, passwordHash: true, emailVerifiedAt: true, createdAt: true } }), originalPlayers);
    assert.deepEqual(await prisma.playerSession.findMany({ where: { userId: { in: originalIds } }, orderBy: { tokenHash: 'asc' } }), originalSessions);
    fs.writeFileSync(`${artifacts}/results.json`, JSON.stringify({ results, originalAccountsPreserved: originalPlayers.length, runtimeErrors: errors }, null, 2));
    console.log(`Preserved all ${originalPlayers.length} original accounts and their session records.`);
  } catch (error) {
    console.error(error); process.exitCode = 1;
    if (browser) for (const context of browser.contexts()) for (const page of context.pages()) {
      console.error('Visible alerts:', await page.getByRole('alert').allTextContents());
      await page.screenshot({ path: `${artifacts}/failure.png`, fullPage: true }).catch(() => {});
    }
  } finally {
    if (browser) await browser.close();
    await prisma.player.deleteMany({ where: { email: { in: createdEmails } } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
