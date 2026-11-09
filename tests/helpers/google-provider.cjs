/* eslint-disable @typescript-eslint/no-require-imports -- Explicit Node preload for isolated browser QA only. Never imported by app code. */
const fs = require('node:fs'), { createHash, sign } = require('node:crypto');
const fixturePath = process.env.BB_GOOGLE_QA_FIXTURE;
if (fixturePath) {
  if (process.env.NODE_ENV === 'production') throw Error('The Google QA provider must never run in production.');
  const originalFetch = global.fetch;
  global.fetch = async (input, options) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    if (url !== 'https://oauth2.googleapis.com/token' && url !== 'https://www.googleapis.com/oauth2/v3/certs') return originalFetch(input, options);
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    if (url.endsWith('/certs')) return Response.json({ keys: [fixture.publicJwk] }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
    const body = new URLSearchParams(await new Request(input, options).text());
    const request = fixture.codes[body.get('code')];
    if (!request || createHash('sha256').update(body.get('code_verifier') || '').digest('base64url') !== request.challenge || body.get('redirect_uri') !== request.redirectUri) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = `${encode({ alg: 'RS256', kid: fixture.publicJwk.kid })}.${encode({
      iss: 'https://accounts.google.com', aud: 'browser-qa-client', sub: request.profile.googleId, email: request.profile.email,
      email_verified: true, name: request.profile.name, nonce: request.nonce, iat: now, exp: now + 300,
    })}`;
    return Response.json({ id_token: `${payload}.${sign('RSA-SHA256', Buffer.from(payload), fixture.privatePem).toString('base64url')}` });
  };
}
