/* eslint-disable @typescript-eslint/no-require-imports -- Run the actual provider effects against isolated browser tabs. */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const React = require("react");
const { loader } = require("./helpers/social-fixture.cjs");
const appearance = loader()("src/lib/appearance.ts");
const layoutKey = "backlogbuster:layout-mode";

function browser() {
  const tabs = [], events = [], writes = [], values = new Map();
  function write(source, key, value) {
    const before = values.get(key) ?? null;
    writes.push({ source, key, value }); values.set(key, value);
    if (before !== value) for (const tab of tabs) if (tab.name !== source) events.push({ tab, event: { key, oldValue: before, newValue: value } });
  }
  return { tabs, events, writes, values, write, drain() {
    let count = 0;
    while (events.length && count < 40) {
      const { tab, event } = events.shift(); tab.receive(event); count++;
    }
    assert.equal(events.length, 0, "Storage listeners must settle instead of echoing competing layouts forever");
  } };
}

function tab(bus, name, player = null) {
  const hooks = [], effects = [], frames = new Map(), listeners = new Set(), saves = [], audioThemes = [];
  let cursor = 0, dirty = false, tree, props = { player }, frameId = 0;
  const root = {}, audio = { setTheme: value => audioThemes.push(value), setEnabled() {}, play() {} };
  const env = {
    document: { documentElement: { dataset: root }, addEventListener() {}, removeEventListener() {} },
    window: { addEventListener: (type, fn) => { if (type === "storage") listeners.add(fn); }, removeEventListener: (type, fn) => { if (type === "storage") listeners.delete(fn); } },
    localStorage: { getItem: key => bus.values.get(key) ?? null, setItem: (key, value) => bus.write(name, key, value) },
    requestAnimationFrame: work => { const id = ++frameId; frames.set(id, work); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  function run(work) {
    const previous = Object.fromEntries(Object.keys(env).map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
    try {
      for (const [key, value] of Object.entries(env)) Object.defineProperty(global, key, { value, configurable: true, writable: true });
      return work();
    } finally {
      for (const [key, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(global, key, descriptor); else delete global[key];
      }
    }
  }
  const react = { ...React,
    useState(initial) {
      const slot = cursor++;
      if (!hooks[slot]) {
        const hook = hooks[slot] = { value: typeof initial === "function" ? initial() : initial };
        hook.set = next => { const value = typeof next === "function" ? next(hook.value) : next; if (!Object.is(value, hook.value)) { hook.value = value; dirty = true; } };
      }
      return [hooks[slot].value, hooks[slot].set];
    },
    useRef(initial) { const slot = cursor++; return hooks[slot] ??= { current: initial }; },
    useEffect(work, deps) {
      const slot = cursor++, previous = hooks[slot];
      if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) effects.push(() => {
        previous?.cleanup?.(); hooks[slot] = { deps, cleanup: work() };
      });
    },
  };
  const custom = { activeTheme: null, activeRef: { current: null }, ready: false, studioOpen: false, select() {} };
  const mocks = {
    "@/lib/custom-theme-runtime": { applyCustomTheme() {} },
    "@/components/useCustomThemes": { default: () => custom }, "@/components/CustomThemeStudio": { default: () => null },
    "@/components/SharedThemePreview": { default: () => null },
    react, "@/lib/appearance": appearance, "@/lib/ui-audio": { createUIAudio: () => audio },
    "@/components/HalloweenDecorations": {}, "@/components/FloatingFairies": {},
    "@/lib/action-result": { unwrapActionResult: value => value, actionErrorMessage: () => "Save failed" },
    "@/app/profile-actions": { savePreferredLayoutMode: async value => { saves.push(value); return { preferredLayoutMode: value }; } },
  };
  const filename = path.resolve(__dirname, "../src/components/ThemeProvider.tsx"), instance = new Module(filename, module);
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = instance.require.bind(instance);
  instance.require = name => name.endsWith(".css") ? {} : Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, filename);
  function render(next = props) {
    props = next;
    return run(() => {
      let passes = 0;
      do {
        dirty = false; cursor = 0; tree = instance.exports.default(props);
        while (effects.length) effects.shift()();
        for (const [id, work] of frames) { frames.delete(id); work(); }
        assert(++passes < 10, "Provider renders must settle");
      } while (dirty);
      return tree;
    });
  }
  const result = { name, root, saves, audioThemes, render,
    receive: event => run(() => { for (const fn of listeners) fn(event); render(); }),
    toggle: () => run(() => { tree.props.children.props.value.toggleLayout(); render(); }),
    sync: player => run(() => { tree.props.value(player); render(); }),
  };
  bus.tabs.push(result); render(); return result;
}

test("conflicting workspace snapshots and an open dossier cannot create a storage feedback loop", () => {
  const bus = browser();
  const first = tab(bus, "first", { id: "viewer", preferredLayoutMode: "cyberpunk" });
  const second = tab(bus, "second", { id: "viewer", preferredLayoutMode: "fantasy" });
  const dossier = tab(bus, "dossier", { id: "viewer", preferredLayoutMode: "fantasy" });
  const before = bus.writes.length;
  bus.drain();
  assert.equal(bus.writes.length, before, "Receiving storage events never writes preferences back");
  assert.equal(first.root.layoutMode, "cyberpunk"); assert.equal(second.root.layoutMode, "fantasy"); assert.equal(dossier.root.layoutMode, "fantasy");
});

test("foreign layout/storage-clear events preserve the authenticated viewer's layout without echo writes", () => {
  const bus = browser(), f = tab(bus, "viewer", { id: "viewer", preferredLayoutMode: "fantasy" });
  bus.write("other-account", layoutKey, "cyberpunk");
  const before = bus.writes.length;
  bus.drain(); f.receive({ key: null });
  assert.equal(f.root.layoutMode, "fantasy"); assert.equal(bus.writes.length, before);
  bus.write("other-tab", "backlogbuster:theme", "halloween"); bus.drain();
  assert.equal(f.root.theme, "fantasy"); assert.equal(f.root.cyberpunkTheme, "halloween");
});

test("explicit viewer toggles save once and equivalent server/relationship refreshes preserve their appearance", async () => {
  const bus = browser(), f = tab(bus, "viewer", { id: "viewer", preferredLayoutMode: "cyberpunk" });
  f.toggle(); await Promise.resolve();
  assert.equal(f.root.layoutMode, "fantasy"); assert.deepEqual(f.saves, ["fantasy"]);
  f.sync({ id: "viewer", preferredLayoutMode: "fantasy" });
  const before = bus.writes.length;
  for (let i = 0; i < 4; i++) f.sync({ id: "viewer", preferredLayoutMode: "fantasy" });
  assert.equal(f.root.layoutMode, "fantasy"); assert.equal(bus.writes.length, before); assert.deepEqual(f.saves, ["fantasy"]);
});

test("anonymous dossiers follow device storage without writing it or saving an account preference", () => {
  const bus = browser(); bus.values.set(layoutKey, "fantasy");
  const f = tab(bus, "anonymous"); assert.equal(f.root.layoutMode, "fantasy");
  bus.write("other-tab", layoutKey, "cyberpunk"); bus.drain();
  assert.equal(f.root.layoutMode, "cyberpunk"); assert.deepEqual(f.saves, []);
  assert(bus.writes.every(write => write.source !== "anonymous"));
});
