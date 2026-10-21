/* eslint-disable @typescript-eslint/no-require-imports -- Mock DNS and sockets to test the proxy without private-network access. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const { EventEmitter } = require('node:events'), { Readable } = require('node:stream');
function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.resolve(__dirname, '..', file), instance = new Module(filename, module);
    instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = name => name === 'server-only' ? {} : Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : original(name);
    instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
    cache.set(file, instance.exports); return instance.exports;
  }
  return load;
}

test('artwork URLs and resolved addresses reject private networks and non-web URLs', () => {
  const { parseArtworkUrl, isPublicImageAddress } = loader()('src/lib/dossier-artwork.ts');
  for (const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','172.31.1.1','100.100.100.200','0.0.0.0','224.1.1.1','192.0.2.1','198.18.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::']) assert.equal(isPublicImageAddress(ip), false, ip);
  for (const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888']) assert.equal(isPublicImageAddress(ip), true, ip);
  for (const value of ['file:///etc/passwd','data:image/png,abc','https://user:pass@example.com/a','http://localhost/a','https://cdn.internal/a','https://example.com:8080/a',' ']) assert.throws(() => parseArtworkUrl(value));
  assert.equal(parseArtworkUrl(' https://example.com/a.png#ignored ').href,'https://example.com/a.png');
});

test('image fetch pins validated DNS, coalesces requests, bounds transfers, and rechecks redirects', async () => {
  let requests = 0, mode = 'ok', dns = 0;
  const png = fs.readFileSync(path.resolve(__dirname,'../public/hud-logo.png'));
  const request = (url, options, handle) => {
    requests++; assert.equal(options.agent, false); assert(!options.headers.Cookie); assert(!options.headers.Authorization); assert(options.signal);
    options.lookup(url.hostname, {}, (err, address) => { assert.equal(err, null); assert.equal(address, '8.8.8.8'); });
    const req = new EventEmitter();
    req.end = () => queueMicrotask(() => {
      const content = mode === 'large' ? [Buffer.alloc(8*1024*1024),Buffer.alloc(1)] : [png];
      const response = Readable.from(content);
      response.statusCode = mode === 'redirect' ? 302 : 200;
      response.headers = mode === 'redirect' ? { location:'http://127.0.0.1/private' } : { 'content-type': mode === 'html' ? 'text/html' : 'image/png' };
      handle(response);
    });
    return req;
  };
  const load = loader({ 'node:dns/promises': { lookup: async () => { dns++; return mode === 'private-dns' ? [{address:'10.0.0.1',family:4}] : [{address:'8.8.8.8',family:4}]; } }, 'node:http': { request }, 'node:https': { request } });
  const { fetchDossierArtwork } = load('src/lib/dossier-artwork.ts');
  const [one,two] = await Promise.all([fetchDossierArtwork('https://cdn.example/a.png'),fetchDossierArtwork('https://cdn.example/a.png')]);
  assert.equal(requests,1); assert.equal(dns,1); assert(one.bytes.equals(png)); assert(two.bytes.equals(png));
  for (const failure of ['redirect','private-dns','large','html']) { mode=failure; await assert.rejects(fetchDossierArtwork(`https://cdn.example/${failure}.png`)); }
  assert.equal(requests,4); // Private DNS and redirected loopback never reach a socket.
});

test('artwork route requires a player, bounds payloads, and returns private same-origin image bytes', async () => {
  let current = null, fetches = 0;
  const png = fs.readFileSync(path.resolve(__dirname,'../public/hud-logo.png'));
  const route = loader({ '@/lib/player': { getCurrentPlayer: async () => current }, '@/lib/dossier-artwork': { fetchDossierArtwork: async url => { fetches++; assert.equal(url,'https://cdn.example/a.png'); return {bytes:png,contentType:'image/png'}; } } })('src/app/api/dossier-artwork/route.ts');
  const send = content => route.POST(new Request('http://localhost/api/dossier-artwork',{method:'POST',body:content}));
  assert.equal((await send('{}')).status,401); assert.equal(fetches,0);
  current = {id:'test-player'};
  assert.equal((await send('a'.repeat(4097))).status,413); assert.equal(fetches,0);
  assert.equal((await send('broken json')).status,400);
  const response = await send(JSON.stringify({url:'https://cdn.example/a.png'}));
  assert.equal(response.status,200); assert.equal(response.headers.get('content-type'),'image/png'); assert.equal(response.headers.get('cache-control'),'no-store'); assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin'); assert(Buffer.from(await response.arrayBuffer()).equals(png));
});
