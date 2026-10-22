/* eslint-disable @typescript-eslint/no-require-imports -- Render actual auth views with isolated theme, action and database boundaries. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function fixture(layout, mode = 'login', count = 4) {
  let stateIndex = 0;
  const copy = (cyberpunk, fantasy) => layout === 'fantasy' ? fantasy : cyberpunk;
  const mocks = {
    react: { ...React, useState: initial => [stateIndex++ === 0 ? mode : initial, () => {}], useActionState: () => [{}, async () => {}, false] },
    '@/components/LayoutText': { useLayoutCopy: () => copy, default: props => copy(props.cyberpunk, props.fantasy) },
    '@/components/ThemeProvider': { ThemeToggle: () => null },
    '@/components/useCooldown': { default: () => ({ seconds: 0, start() {} }) },
    'next/server': { connection: async () => {} },
    '@/lib/prisma': { prisma: { player: { count: async ({ where }) => {
      assert.deepEqual(where, { email: { not: null }, passwordHash: { not: null } });
      if (count instanceof Error) throw count;
      return count;
    } } } },
  };
  function load(file) {
    const filename = path.resolve(__dirname, '..', file), instance = new Module(filename, module);
    instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = name => Object.hasOwn(mocks, name) ? mocks[name]
      : name.endsWith('.css') || name.startsWith('@/') ? {} : original(name);
    instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, filename);
    return instance.exports;
  }
  const render = element => renderToStaticMarkup(element).replace(/&#x27;/g, "'");
  return { load, render };
}

test('Cyberpunk login and registration retain their original copy and field contracts', () => {
  for (const mode of ['login', 'register']) {
    const f = fixture('cyberpunk', mode);
    const html = f.render(React.createElement(f.load('src/components/AccountControls.tsx').AccountGate));
    for (const text of ['ARCHIVE LOCKED // IDENTIFY YOURSELF', 'ICE GATEWAY // OPERATOR AUTHENTICATION', 'Netrunner Access', 'Sign in to your private library, or register a new operator with an empty archive.', 'REGISTER // NEW ARCHIVE', mode === 'login' ? '▶ SIGN IN' : '⚡ CREATE NETRUNNER ACCOUNT']) assert(html.includes(text), text);
    assert.doesNotMatch(html, /Questkeeper|INSCRIBE|ADVENTURER VERIFICATION/);
    assert.match(html, /<input(?=[^>]*name="password")(?=[^>]*minLength="8")(?=[^>]*maxLength="128")[^>]*>/);
    if (mode === 'register') {
      assert.match(html, /Handle /); assert.match(html, /Operator name/);
      assert.match(html, /placeholder="night-city-runner"/);
    }
  }
});

test('Fantasy login and registration use sanctuary copy while preserving account form fields', () => {
  for (const mode of ['login', 'register']) {
    const f = fixture('fantasy', mode);
    const html = f.render(React.createElement(f.load('src/components/AccountControls.tsx').AccountGate));
    for (const text of ['CHAMBER SEALED // SPEAK YOUR NAME', 'TEMPLE GATEWAY // ADVENTURER VERIFICATION', "Questkeeper's Sanctuary", "Open your personal quest journal, or inscribe a new adventurer's ledger.", 'INSCRIBE // NEW LEDGER', mode === 'login' ? '▶ ENTER THE ARCHIVE' : '▶ INSCRIBE LEDGER']) assert(html.includes(text), text);
    assert.doesNotMatch(html, /NETRUNNER|Netrunner|ICE GATEWAY|Operator name|night-city-runner/);
    if (mode === 'register') {
      assert.match(html, /Adventurer alias/); assert.match(html, /Adventurer name/);
      assert.match(html, /name="handle"/); assert.match(html, /name="operatorName"/);
      assert.match(html, /placeholder="hero-of-time"/);
    }
  }
});

test('member badge keeps counts, singular/plural and failure states correct in both layouts', async () => {
  for (const layout of ['cyberpunk', 'fantasy']) {
    for (const count of [0, 1, 4]) {
      const f = fixture(layout, 'login', count);
      const suspense = f.load('src/components/MemberCount.tsx').default();
      const html = f.render(await suspense.props.children.type());
      assert.match(html, new RegExp(`<strong>${count}</strong>`));
      assert(html.includes(`REGISTERED ${layout === 'fantasy' ? count === 1 ? 'ADVENTURER' : 'ADVENTURERS' : count === 1 ? 'MEMBER' : 'MEMBERS'}`));
      assert.match(html, /member-count-crest/);
      assert(f.render(suspense.props.fallback).includes(layout === 'fantasy' ? 'UNFURLING THE ADVENTURER ROLL…' : 'SCANNING MEMBER REGISTRY…'));
    }
    const f = fixture(layout, 'login', new Error('offline'));
    const suspense = f.load('src/components/MemberCount.tsx').default();
    assert(f.render(await suspense.props.children.type()).includes(layout === 'fantasy' ? 'ADVENTURER ROLL TEMPORARILY UNAVAILABLE' : 'MEMBER COUNT TEMPORARILY OFFLINE'));
  }
});
