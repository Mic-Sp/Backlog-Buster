/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in local provider fixture; never imported by app code. */
const fs = require('node:fs');
const fixturePath = process.env.BB_STEAM_QA_FIXTURE;
if (fixturePath) {
  if (process.env.NODE_ENV === 'production') throw Error('Steam QA provider cannot run in production.');
  const originalFetch = global.fetch;
  global.fetch = async (input, options) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url !== 'https://steamcommunity.com/openid/login') return originalFetch(input, options);
    const body = new URLSearchParams(await new Request(input, options).text());
    const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const expected = fixtures[body.get('openid.sig')];
    const valid = expected && body.get('openid.mode') === 'check_authentication' && Object.entries(expected).every(([key, value]) => key === 'openid.mode' || body.get(key) === value);
    return new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${Boolean(valid)}\n`, { headers: { 'Content-Type': 'text/plain' } });
  };
}
