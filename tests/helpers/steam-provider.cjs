/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in local provider fixture; never imported by app code. */
const fs = require('node:fs');
const fixturePath = process.env.BB_STEAM_QA_FIXTURE;
if (fixturePath) {
  if (process.env.NODE_ENV === 'production') throw Error('Steam QA provider cannot run in production.');
  const originalFetch = global.fetch;
  global.fetch = async (input, options) => {
    const url = String(input instanceof Request ? input.url : input);
    const target = new URL(url);
    if (target.origin === 'https://api.steampowered.com' && process.env.BB_STEAM_QA_LIBRARIES === '1') {
      const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
      if (target.pathname.includes('GetPlayerSummaries')) return Response.json({ response: { players: [] } });
      if (target.pathname.includes('GetOwnedGames')) {
        const steamId = JSON.parse(target.searchParams.get('input_json')).steamid;
        const library = fixtures.__libraries?.[steamId];
        if (!library) return Response.json({ response: {} });
        if (library.delayMs) await new Promise(resolve => setTimeout(resolve, library.delayMs));
        if (library.private) return Response.json({ response: {} });
        return Response.json({ response: { game_count: library.games.length, games: library.games } });
      }
      if (target.pathname.includes('GetPlayerAchievements')) return Response.json({ playerstats: { success: true, steamID: target.searchParams.get('steamid'), achievements: [{ apiname: 'FIRST', achieved: 1 }, { apiname: 'SECOND', achieved: 0 }] } });
      throw Error('Unexpected Steam fixture endpoint');
    }
    if (url !== 'https://steamcommunity.com/openid/login') return originalFetch(input, options);
    const body = new URLSearchParams(await new Request(input, options).text());
    const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const expected = fixtures[body.get('openid.sig')];
    const valid = expected && body.get('openid.mode') === 'check_authentication' && Object.entries(expected).every(([key, value]) => key === 'openid.mode' || body.get(key) === value);
    return new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${Boolean(valid)}\n`, { headers: { 'Content-Type': 'text/plain' } });
  };
}
