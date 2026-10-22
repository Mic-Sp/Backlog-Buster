/* eslint-disable @typescript-eslint/no-require-imports -- Render the actual directory with deterministic server data and selected controls. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const players = [
  { id: 'owner', isAdmin: true, isOwner: true },
  { id: 'admin', isAdmin: true, isOwner: false },
  { id: 'peer', isAdmin: true, isOwner: false },
  { id: 'player', isAdmin: false, isOwner: false },
  { id: 'unclaimed', isAdmin: false, isOwner: false, email: null },
].map(player => ({ operatorName: player.id, email: `${player.id}@example.com`, gameCount: 2, totalXp: 100, level: 1,
  activeSessionCount: 2, preferredLayoutMode: player.id === 'player' ? 'fantasy' : 'cyberpunk', createdAt: '2026-01-01T12:00:00Z', lastRecordedActivityAt: '2026-01-01T12:00:00Z', ...player }));
function render(viewer, target, selection) {
  let stateIndex = 0;
  const overrides = { 0: { players: [players.find(p => p.id === target)], page: 1, pageCount: 1, totalCount: 1 }, 3: false };
  if (selection === 'password') overrides[6] = target;
  if (selection === 'delete') overrides[7] = target;
  if (selection === 'email') overrides[8] = target;
  if (selection === 'role') overrides[9] = { id: target, isAdmin: target === 'player' || target === 'unclaimed' };
  const filename = path.resolve(__dirname, '../src/components/AdminPlayerDirectory.tsx');
  const instance = new Module(filename, module); instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = instance.require.bind(instance);
  instance.require = name => name === 'react' ? { ...React, useState: initial => [Object.hasOwn(overrides, stateIndex) ? overrides[stateIndex++] : (stateIndex++, initial), () => {}] }
    : name.startsWith('@/') ? {} : original(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename);
  return renderToStaticMarkup(React.createElement(instance.exports.default, {
    currentPlayerId: viewer, currentPlayerIsOwner: viewer === 'owner', disabled: false, onBusyChange() {}, async onAccountsChanged() {},
  }));
}
const button = (html, label) => html.match(new RegExp(`<button\\b([^>]*)>${label}</button>`))?.[1];

test('directory displays saved layouts and gates inline preference controls by hierarchy', () => {
  for (const [viewer, target, allowed] of [['admin', 'player', true], ['owner', 'admin', true], ['admin', 'peer', false], ['owner', 'owner', false]]) {
    const html = render(viewer, target);
    const control = html.match(/<select\b([^>]*)>(.*?)<\/select>/s);
    assert(control);
    assert.equal(control[1].includes('disabled'), !allowed);
    assert.match(control[2], /value="cyberpunk"/);
    assert.match(control[2], /value="fantasy"/);
    assert.match(control[2], target === 'player' ? /value="fantasy" selected=""/ : /value="cyberpunk" selected=""/);
    assert.match(html, /Preferred Layout/);
  }
});

test('Owner badge and immunity hide every account mutation, including stale selections', () => {
  for (const viewer of ['owner', 'admin']) for (const selection of [undefined, 'password', 'email', 'delete', 'role']) {
    const html = render(viewer, 'owner', selection);
    assert.match(html, /data-owner="true">OWNER \/\/ ROOT/);
    assert.match(html, /OWNER ACCOUNT \/\/ PROTECTED/);
    for (const label of ['RESET PASSWORD', 'UPDATE EMAIL', 'DELETE ACCOUNT', 'FORCE SIGN-OUT', 'DEMOTE ADMIN', 'CONFIRM WIPE', 'CONFIRM DEMOTION']) assert.equal(button(html, label), undefined);
    assert.doesNotMatch(html, /<form/);
  }
});

test('standard Admin cannot mutate own or peer Admin rows, even with a selected form', () => {
  for (const target of ['admin', 'peer']) for (const selection of [undefined, 'password', 'email', 'delete', 'role']) {
    const html = render('admin', target, selection);
    assert.match(html, /ADMIN ACCOUNT \/\/ OWNER ACCESS REQUIRED/);
    for (const label of ['RESET PASSWORD', 'UPDATE EMAIL', 'DELETE ACCOUNT', 'FORCE SIGN-OUT', 'DEMOTE ADMIN', 'CONFIRM WIPE', 'CONFIRM DEMOTION']) assert.equal(button(html, label), undefined);
    assert.doesNotMatch(html, /<form/);
  }
});

test('standard Admin can manage regular credentials and sessions but cannot promote', () => {
  const html = render('admin', 'player', 'role');
  for (const label of ['RESET PASSWORD', 'UPDATE EMAIL', 'DELETE ACCOUNT', 'FORCE SIGN-OUT']) assert.doesNotMatch(button(html, label), /disabled/);
  assert.match(button(html, 'PROMOTE TO ADMIN'), /disabled/);
  assert.equal(button(html, 'CONFIRM PROMOTION'), undefined);
  assert.match(render('admin', 'player', 'password'), /<form class="admin-password-reset"/);
  assert.match(render('admin', 'player', 'email'), /<form class="admin-email-update"/);
});

test('Owner can manage another Admin and explicitly confirm role changes or deletion', () => {
  const html = render('owner', 'admin', 'role');
  for (const label of ['RESET PASSWORD', 'UPDATE EMAIL', 'DELETE ACCOUNT', 'FORCE SIGN-OUT', 'DEMOTE ADMIN', 'CONFIRM DEMOTION']) assert.doesNotMatch(button(html, label), /disabled/);
  assert.equal(button(html, 'CONFIRM WIPE'), undefined);
  assert.doesNotMatch(button(render('owner', 'admin', 'delete'), 'CONFIRM WIPE'), /disabled/);
  assert.equal(button(render('owner', 'player'), 'CONFIRM PROMOTION'), undefined);
  assert.doesNotMatch(button(render('owner', 'player', 'role'), 'CONFIRM PROMOTION'), /disabled/);
});

test('unclaimed profiles cannot receive admin privileges or expose a role confirmation', () => {
  for (const viewer of ['owner', 'admin']) {
    const html = render(viewer, 'unclaimed', 'role');
    assert.match(button(html, 'PROMOTE TO ADMIN'), /disabled/);
    assert.equal(button(html, 'CONFIRM PROMOTION'), undefined);
    assert.match(button(html, 'FORCE SIGN-OUT'), /disabled/);
  }
});
