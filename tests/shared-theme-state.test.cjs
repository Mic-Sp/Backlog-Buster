/* eslint-disable @typescript-eslint/no-require-imports -- Run the actual custom-theme hook against isolated client storage. */
const test = require('node:test'), assert = require('node:assert/strict');
const { loader } = require('./helpers/social-fixture.cjs');
const { newCustomTheme, CUSTOM_THEMES_KEY: listKey, CUSTOM_THEME_SELECTION_KEY: selectedKey } = loader()('src/lib/custom-theme.ts');

function client(saved = [], selected = null, deferRestore = false) {
  const hooks = [], effects = [], frames = new Map(), listeners = new Set(), writes = [];
  const values = new Map([[listKey, JSON.stringify(saved)], [selectedKey, selected]].filter(([, value]) => value !== null));
  let cursor = 0, dirty = false, controller, nextFrame = 0, cleared = 0, quota = false;
  const react = {
    useState(initial) {
      const slot = cursor++;
      if (!hooks[slot]) hooks[slot] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[slot].value, next => { const value = typeof next === 'function' ? next(hooks[slot].value) : next;
        if (!Object.is(value, hooks[slot].value)) { hooks[slot].value = value; dirty = true; } }];
    },
    useRef(initial) { return hooks[cursor++] ??= { current: initial }; },
    useEffect(work, deps) {
      const slot = cursor++, previous = hooks[slot];
      if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) effects.push(() => { hooks[slot] = { deps, cleanup: work() }; });
    },
  };
  const useThemes = loader({ react, '@/lib/theme-share': { clearSharedThemeUrl: () => cleared++ } })('src/components/useCustomThemes.ts').default;
  const env = {
    localStorage: { getItem: key => values.get(key) ?? null,
      setItem(key, value) { if (quota) throw Error('QuotaExceeded'); writes.push([key, value]); values.set(key, value); },
      removeItem(key) { writes.push([key, null]); values.delete(key); } },
    window: { addEventListener: (name, fn) => listeners.add(fn), removeEventListener: (name, fn) => listeners.delete(fn) },
    requestAnimationFrame: work => { const id = ++nextFrame; frames.set(id, work); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  function run(work) {
    const previous = Object.fromEntries(Object.keys(env).map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
    try { for (const [key, value] of Object.entries(env)) Object.defineProperty(global, key, { value, configurable: true, writable: true }); return work(); }
    finally { for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(global, key, descriptor); else delete global[key]; } }
  }
  function render() {
    let count = 0;
    do { dirty = false; cursor = 0; controller = useThemes(); while (effects.length) effects.shift()(); assert(++count < 10); } while (dirty);
  }
  function restore() { for (const [id, work] of frames) { frames.delete(id); work(); } }
  run(() => { render(); if (!deferRestore) { restore(); render(); } });
  return { values, writes, get current() { return controller; }, get cleared() { return cleared; }, failStorage() { quota = true; },
    act(work) { return run(() => { try { return work(controller); } finally { render(); } }); },
    restore() { return run(() => { restore(); render(); }); },
    storageEvent() { return run(() => { for (const fn of listeners) fn({ key: listKey }); render(); }); },
  };
}

test('shared preview and dismissal never write storage and restore the prior saved theme', () => {
  const prior = newCustomTheme('fantasy'), shared = newCustomTheme('cyberpunk'), f = client([prior], prior.id);
  f.act(c => c.previewShared(shared));
  assert.deepEqual(f.current.activeTheme, shared); assert.deepEqual(f.current.sharedTheme, shared);
  assert.equal(f.current.selectedId, prior.id); assert.equal(f.values.get(selectedKey), prior.id); assert.equal(f.writes.length, 0);
  f.act(c => c.dismissShared());
  assert.deepEqual(f.current.activeTheme, prior); assert.equal(f.current.sharedTheme, null); assert.equal(f.writes.length, 0); assert.equal(f.cleared, 1);
});

test('shared preview survives deferred storage restoration and read-only cross-tab events', () => {
  const prior = newCustomTheme('fantasy'), shared = newCustomTheme('cyberpunk'), f = client([prior], prior.id, true);
  f.act(c => c.previewShared(shared)); f.restore(); f.storageEvent();
  assert.deepEqual(f.current.activeTheme, shared); assert.equal(f.current.selectedId, prior.id); assert.equal(f.writes.length, 0);
  f.act(c => c.dismissShared()); assert.deepEqual(f.current.activeTheme, prior);
});

test('Save & Apply assigns a fresh ID, preserves a colliding saved theme and clears preview/URL after persistence', () => {
  const prior = newCustomTheme('cyberpunk'), shared = { ...newCustomTheme('fantasy'), id: prior.id, name: 'Received theme' }, f = client([prior], prior.id);
  f.act(c => c.previewShared(shared)); f.act(c => c.saveShared());
  assert.equal(f.current.themes.length, 2); assert.deepEqual(f.current.themes[0], prior);
  const accepted = f.current.activeTheme;
  assert.notEqual(accepted.id, prior.id); assert.deepEqual({ ...accepted, id: shared.id }, shared);
  assert.equal(f.values.get(selectedKey), accepted.id); assert.deepEqual(JSON.parse(f.values.get(listKey)), f.current.themes);
  assert.equal(f.current.sharedTheme, null); assert.equal(f.cleared, 1);
});

test('storage errors and capacity limits retain the temporary preview and its URL without replacing saved data', () => {
  const prior = newCustomTheme('cyberpunk'), shared = newCustomTheme('fantasy'), f = client([prior], prior.id);
  const before = [...f.values]; f.act(c => c.previewShared(shared)); f.failStorage();
  assert.throws(() => f.act(c => c.saveShared()), /storage is unavailable or full/);
  assert.deepEqual([...f.values], before); assert.deepEqual(f.current.activeTheme, shared); assert.equal(f.cleared, 0);
  const full = Array.from({ length: 50 }, () => newCustomTheme('cyberpunk')), capped = client(full, full[0].id);
  capped.act(c => c.previewShared(shared)); assert.throws(() => capped.act(c => c.saveShared()), /up to 50/);
  assert.equal(capped.current.themes.length, 50); assert.deepEqual(capped.current.sharedTheme, shared); assert.equal(capped.cleared, 0);
});

test('closing a studio draft restores the shared preview; dismissing then restores the built-in selection', () => {
  const shared = newCustomTheme('fantasy'), draft = newCustomTheme('cyberpunk'), f = client();
  f.act(c => c.previewShared(shared)); f.act(c => c.openStudio()); f.act(c => c.preview(draft));
  assert.deepEqual(f.current.activeTheme, draft);
  f.act(c => c.closeStudio()); assert.deepEqual(f.current.activeTheme, shared);
  f.act(c => c.dismissShared()); assert.equal(f.current.activeTheme, null); assert.equal(f.values.get(selectedKey), undefined);
  assert.equal(f.writes.length, 0);
});

test('explicit selection exits the shared preview, while invalid theme objects cannot enter preview state', () => {
  const prior = newCustomTheme('cyberpunk'), shared = newCustomTheme('fantasy'), f = client([prior], prior.id);
  assert.throws(() => f.act(c => c.previewShared({ ...shared, css: 'body{}' })));
  assert.equal(f.current.sharedTheme, null); assert.deepEqual(f.current.activeTheme, prior);
  f.act(c => c.previewShared(shared)); f.act(c => c.select(prior.id));
  assert.equal(f.current.sharedTheme, null); assert.deepEqual(f.current.activeTheme, prior); assert.equal(f.cleared, 1);
});
