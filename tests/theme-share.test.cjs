/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the client codec without a browser or database. */
const test = require('node:test'), assert = require('node:assert/strict');
const { loader } = require('./helpers/social-fixture.cjs');
const load = loader(), themes = load('src/lib/custom-theme.ts'), share = load('src/lib/theme-share.ts');
// Build wire input independently, including inputs that the validated encoder refuses.
function pack(bytes) {
  let hash = 2166136261n;
  for (const byte of bytes) hash = ((hash ^ BigInt(byte)) * 16777619n) & 0xffffffffn;
  return `v1.${bytes.toString('base64url')}.${hash.toString(16).padStart(8, '0')}`;
}
const raw = value => pack(Buffer.from(JSON.stringify(value)));

test('share links round-trip UTF-8 names, terminology, all tokens and effects using URL-safe characters', () => {
  const theme = { ...themes.newCustomTheme('fantasy'), name: '月の庭 🌙 – Étoile',
    terminology: { libraryTitle: '冒険 & dragons 🐉', authTitle: '<Welcome> / Bienvenue', scoutTitle: 'Discovery Almanac',
      scoutSearchTitle: 'Search the realm', releaseRadarTitle: 'Fresh Horizons', popularFeedTitle: 'Around the Realm',
      alongInterestsTitle: 'Close to Your Heart', highTasteMatchTitle: 'Kindred Spirit', sagaFollowTitle: 'A Saga Continues' } };
  const encoded = share.encodeThemeShare(theme);
  assert.match(encoded, /^v1\.[A-Za-z0-9_-]+\.[a-f0-9]{8}$/);
  assert.equal(encoded, raw(theme));
  assert.deepEqual(share.decodeThemeShare(encoded), theme);
  assert.deepEqual(share.decodeThemeShare(new URL(`https://example.test/?theme=${encoded}`).searchParams.get('theme')), theme);
});

test('decoding and encoding apply the existing schema defaults and normalization', () => {
  const { id, colors } = themes.newCustomTheme('cyberpunk');
  const minimal = { id, name: '  Minimal  ', colors };
  const expected = themes.customThemeSchema.parse(minimal);
  assert.deepEqual(share.decodeThemeShare(raw(minimal)), expected);
  assert.deepEqual(share.decodeThemeShare(share.encodeThemeShare(minimal)), expected);
});

test('corrupt, truncated, oversized, noncanonical and invalid UTF-8/JSON payloads are inert', () => {
  const valid = share.encodeThemeShare(themes.newCustomTheme('cyberpunk'));
  const [version, body, digest] = valid.split('.');
  for (const value of [null, undefined, 42, {}, '', 'not-base64', valid.slice(1), valid.slice(0, -1),
    valid.replace('v1.', 'v2.'), `${version}.${body}=.${digest}`, `${version}.${body}.00000000`,
    `${version}.${body.slice(0, -1)}A.${digest}`, 'v1.A.00000000', 'v1.!!?.00000000',
    'a'.repeat(share.MAX_THEME_SHARE_LENGTH + 1), pack(Buffer.from('{bad')), pack(Buffer.from([0xff, 0xfe])),
    // Nonzero padding bits must be rejected even when decoded bytes/checksum agree.
    raw(null).replace('bnVsbA.', 'bnVsbB.'), raw(null), raw([])]) {
    assert.equal(share.decodeThemeShare(value), null, `Unsafe payload: ${String(value).slice(0, 70)}`);
  }
});

test('a valid checksum cannot bypass strict CustomTheme validation or introduce CSS/unknown fields', () => {
  const theme = themes.newCustomTheme('cyberpunk');
  for (const changes of [{ id: 'cyberpunk' }, { name: ' ' }, { baseLayout: 'unknown' }, { css: 'body{display:none}' },
    { colors: { ...theme.colors, accent: 'url(https://evil.test)' } }, { colors: { ...theme.colors, unknown: '#ffffff' } },
    { effects: { scanlines: 'true' } }, { effects: { unknown: true } }, { borderRadius: 100 },
    { terminology: { libraryTitle: 'x'.repeat(81) } }, { terminology: { unknown: 'Ignored?' } }]) {
    const invalid = { ...theme, ...changes };
    assert.equal(share.decodeThemeShare(raw(invalid)), null);
    assert.throws(() => share.encodeThemeShare(invalid));
  }
});

test('copied links contain only the current origin/path and theme, with no unrelated tokens or fragment', () => {
  const theme = themes.newCustomTheme('fantasy');
  const url = new URL(share.createThemeShareUrl(theme, 'https://app.example.test:444/access?resetToken=secret&theme=old#private'));
  assert.equal(url.origin, 'https://app.example.test:444'); assert.equal(url.pathname, '/access');
  assert.deepEqual([...url.searchParams.keys()], ['theme']); assert.equal(url.hash, '');
  assert.deepEqual(share.decodeThemeShare(url.searchParams.get('theme')), theme);
  assert.throws(() => share.createThemeShareUrl(theme, 'javascript:alert(1)'));
});

test('URL cleanup removes all theme parameters while retaining unrelated query values and fragment', () => {
  const clean = share.withoutSharedTheme('https://example.test/access?sort=recent&theme=one&tag=a&tag=b&theme=two#details');
  assert.equal(clean, '/access?sort=recent&tag=a&tag=b#details');
  assert.equal(share.withoutSharedTheme('https://example.test/?theme=one'), '/');
});

test('history cleanup uses the supported Next native-history signature and ignores unrelated URLs', () => {
  const previous = Object.getOwnPropertyDescriptor(global, 'window'), calls = [];
  const fake = { location: { href: 'https://example.test/access?other=keep&theme=one#details' },
    history: { state: { __NA: true }, replaceState: (...args) => calls.push(args) } };
  try {
    Object.defineProperty(global, 'window', { value: fake, configurable: true });
    share.clearSharedThemeUrl();
    assert.deepEqual(calls, [[null, '', '/access?other=keep#details']]);
    fake.location.href = 'https://example.test/access?other=keep';
    share.clearSharedThemeUrl(); assert.equal(calls.length, 1);
  } finally { if (previous) Object.defineProperty(global, 'window', previous); else delete global.window; }
});
