/* eslint-disable @typescript-eslint/no-require-imports -- Exercise component handlers/effects with isolated browser and action boundaries. */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");

function load(file, mocks) {
  const filename = path.resolve(__dirname, "..", file), instance = new Module(filename, module);
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = instance.require.bind(instance);
  instance.require = name => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, filename);
  return instance.exports;
}

// Small hook harness follows the repository's cooldown tests. Component code,
// event handlers, effect cleanup and async request sequencing all run unchanged.
function hooks() {
  const slots = [], effects = [];
  let cursor = 0;
  const changed = (a, b) => !a || b.some((value, i) => value !== a[i]);
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useId() { cursor++; return "test-title"; },
    useTransition() { cursor++; return [false, operation => operation()]; },
    useCallback(callback, deps) {
      const i = cursor++;
      if (changed(slots[i]?.deps, deps)) slots[i] = { deps, callback };
      return slots[i].callback;
    },
    useEffect(callback, deps) {
      const i = cursor++;
      if (changed(slots[i]?.deps, deps)) effects.push(() => {
        slots[i]?.cleanup?.();
        slots[i] = { deps, cleanup: callback() };
      });
    },
  };
  return {
    react,
    render(Component, props) { cursor = 0; const tree = Component(props); while (effects.length) effects.shift()(); return tree; },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
function get(tree, predicate) { const node = nodes(tree).find(predicate); assert(node, "Expected component element"); return node; }
const item = (title = "Portal 2", year = 2011) => ({ title, releaseYear: year, platforms: ["PC", "PS3"], genre: "Puzzle", estimatedHours: 9, coverUrl: "https://example.com/portal.jpg" });
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function autocompleteFixture(fetcher = async () => Response.json([item()])) {
  const original = { fetch: global.fetch, document: global.document, Node: global.Node, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  const timers = new Map(), listeners = new Map(), requests = [], selected = [];
  let now = 0, timerId = 0, changes = 0;
  class FakeNode {}
  global.Node = FakeNode;
  global.document = {
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name, handler) => { if (listeners.get(name) === handler) listeners.delete(name); },
  };
  global.setTimeout = (callback, ms) => { const id = ++timerId; timers.set(id, { callback, at: now + ms }); return id; };
  global.clearTimeout = id => timers.delete(id);
  global.fetch = async (url, options) => { requests.push({ url, options }); return fetcher(url, options); };
  const h = hooks();
  const Component = load("src/components/TitleAutocomplete.tsx", { react: h.react }).default;
  const props = { id: "title", onSelect: value => selected.push(value), onTitleChange: () => changes++ };
  const input = new FakeNode(), root = new FakeNode();
  let focused = 0, scrolled = 0, tree;
  input.focus = () => focused++;
  root.contains = target => target === input || target === root;
  root.querySelector = () => ({ scrollIntoView: () => scrolled++ });
  function render() {
    tree = h.render(Component, props);
    tree.props.ref.current = root;
    get(tree, node => node.type === "input").props.ref.current = input;
    return tree;
  }
  render();
  return {
    requests, selected, listeners, timers,
    get tree() { return render(); },
    get input() { return get(render(), node => node.type === "input").props; },
    get options() { return nodes(render()).filter(node => node.props?.role === "option"); },
    get changes() { return changes; }, get focused() { return focused; }, get scrolled() { return scrolled; },
    change(value) { this.input.onChange({ target: { value } }); render(); },
    focus() { this.input.onFocus(); render(); },
    blur() { this.input.onBlur(); render(); },
    key(key, composing = false) {
      let prevented = false;
      this.input.onKeyDown({ key, nativeEvent: { isComposing: composing }, preventDefault: () => { prevented = true; } });
      render(); return prevented;
    },
    async advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
      await settle(); render();
    },
    unmount: () => h.unmount(),
    cleanup() { h.unmount(); Object.assign(global, original); },
  };
}

test("title lookup waits for two characters and debounces a typing burst for 275ms", async () => {
  const f = autocompleteFixture();
  try {
    f.change("p"); await f.advance(500); assert.equal(f.requests.length, 0);
    f.change("po"); await f.advance(200); assert.equal(f.requests.length, 0);
    f.change("por"); await f.advance(274); assert.equal(f.requests.length, 0);
    await f.advance(1);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].url, "/api/catalog/search?q=por");
    assert.equal(f.input["aria-expanded"], true);
    f.change(" "); await f.advance(300);
    assert.equal(f.options.length, 0); assert.equal(f.requests.length, 1);
  } finally { f.cleanup(); }
});

test("stale requests are aborted and ignored even if the transport resolves after cancellation", async () => {
  const old = deferred(), fresh = deferred();
  const f = autocompleteFixture(url => url.includes("doom") ? fresh.promise : old.promise);
  try {
    f.change("portal"); await f.advance(275);
    f.change("doom");
    assert.equal(f.requests[0].options.signal.aborted, true);
    await f.advance(275);
    fresh.resolve(Response.json([item("Doom", 2016)])); await settle();
    assert.equal(f.options[0].props.children[1].props.children[0].props.children[0], "Doom");
    old.resolve(Response.json([item()])); await settle();
    assert.equal(f.options[0].props.children[1].props.children[0].props.children[0], "Doom");
  } finally { f.cleanup(); }
});

test("keyboard navigation exposes ARIA selection, wraps, scrolls, and Enter selects without submitting", async () => {
  const f = autocompleteFixture(async () => Response.json([item(), item("Portal", 2007)]));
  try {
    f.change("portal"); await f.advance(275);
    assert.equal(f.input.role, "combobox"); assert.equal(f.input["aria-autocomplete"], "list");
    assert.equal(f.input["aria-controls"], "title-suggestions");
    assert.equal(f.input["aria-activedescendant"], undefined);
    assert.equal(f.key("ArrowDown"), true);
    assert.equal(f.input["aria-activedescendant"], "title-suggestions-0");
    assert.equal(f.options[0].props["aria-selected"], true);
    f.key("ArrowUp"); assert.equal(f.input["aria-activedescendant"], "title-suggestions-1");
    assert(f.scrolled > 0);
    assert.equal(f.key("Enter", true), false); assert.equal(f.selected.length, 0);
    assert.equal(f.key("Enter"), true);
    assert.deepEqual(f.selected, [item("Portal", 2007)]);
    assert.equal(f.input.value, "Portal"); assert.equal(f.input["aria-expanded"], false);
    assert.equal(f.focused, 1); assert.equal(f.timers.size, 0);
    // No highlighted suggestion: normal form submission remains untouched.
    assert.equal(f.key("Enter"), false);
  } finally { f.cleanup(); }
});

test("mouse selection keeps input focus, shows metadata, and broken thumbnails reveal the placeholder", async () => {
  const f = autocompleteFixture();
  try {
    f.change("portal"); await f.advance(275);
    const option = f.options[0];
    let prevented = false;
    option.props.onMouseDown({ preventDefault: () => { prevented = true; } });
    assert(prevented);
    const text = nodes(option).flatMap(node => [node.props.children].flat()).filter(value => typeof value === "string").join(" ");
    assert.match(text, /Portal 2/); assert.match(text, /PC · Puzzle/);
    const image = get(option, node => node.type === "img");
    const target = { hidden: false };
    image.props.onError({ currentTarget: target }); assert.equal(target.hidden, true);
    option.props.onClick();
    assert.equal(f.input.value, "Portal 2"); assert.deepEqual(f.selected, [item()]);
    assert.equal(f.changes, 1);
  } finally { f.cleanup(); }
});

test("Escape, blur and outside pointer dismiss menus and pending requests; unmount cleans listeners/timers", async () => {
  const f = autocompleteFixture();
  try {
    f.change("portal"); assert.equal(f.key("Escape"), true); await f.advance(300);
    assert.equal(f.requests.length, 0);
    f.focus(); await f.advance(275); assert.equal(f.options.length, 1);
    // Inside clicks do not dismiss, outside clicks do.
    f.listeners.get("pointerdown")({ target: f.input.ref.current });
    assert.equal(f.options.length, 1);
    f.listeners.get("pointerdown")({ target: new global.Node() });
    assert.equal(f.options.length, 0);
    f.change("doom"); f.blur(); await f.advance(300);
    assert.equal(f.requests.length, 1);
    f.change("po"); f.unmount();
    assert.equal(f.listeners.size, 0); assert.equal(f.timers.size, 0);
  } finally { f.cleanup(); }
});

test("empty, HTTP/network failures and malformed payloads leave freeform Enter available", async () => {
  for (const fetcher of [async () => Response.json([]), async () => new Response(null, { status: 503 }),
    async () => { throw Error("offline"); }, async () => new Response("bad JSON"),
    async () => Response.json({ results: [] }), async () => Response.json([null, {}, { ...item(), platforms: null }])]) {
    const f = autocompleteFixture(fetcher);
    try {
      f.change("My custom quest"); await f.advance(275);
      assert.equal(f.options.length, 0); assert.equal(f.input.value, "My custom quest");
      assert.equal(f.key("Enter"), false);
      assert.equal(f.selected.length, 0);
      assert(!JSON.stringify(f.tree).includes("Searching titles"));
    } finally { f.cleanup(); }
  }
});

test("Enter submits freeform text even while suggestions are visible until an option is highlighted", async () => {
  const f = autocompleteFixture();
  try {
    f.change("My custom title"); await f.advance(275);
    assert.equal(f.options.length, 1); assert.equal(f.key("Enter"), false);
    assert.equal(f.input.value, "My custom title"); assert.equal(f.selected.length, 0);
  } finally { f.cleanup(); }
});

function formFixture({ fail = false } = {}) {
  const original = { HTMLInputElement: global.HTMLInputElement, window: global.window, CustomEvent: global.CustomEvent };
  class Input { constructor(name) { this.name = name; this.value = ""; } }
  global.HTMLInputElement = Input;
  global.window = { dispatchEvent() {} }; global.CustomEvent = class {};
  const h = hooks(), calls = [], lookups = [], pendingLookup = deferred();
  const SafeForm = () => null, TitleAutocomplete = () => null;
  const Component = load("src/app/GameForm.tsx", {
    react: h.react,
    "@/components/useCooldown": { default: () => ({ seconds: 0, start() {} }) },
    "@/lib/cooldown": { DEFAULT_COOLDOWN_SECONDS: 10 },
    "@/lib/action-result": load("src/lib/action-result.ts", {}),
    "@/lib/game-playtime": load("src/lib/game-playtime.ts", {}),
    "@/components/SafeForm": { default: SafeForm },
    "@/components/TitleAutocomplete": { default: TitleAutocomplete },
    "./actions": {
      createGame: async data => { calls.push(data); return fail ? { error: "Fixture failure" } : { success: true, gameId: 42 }; },
      searchGameInfo: async title => { lookups.push(title); return pendingLookup.promise; },
    },
  }).default;
  const fields = Object.fromEntries(["title", "platform", "genre", "lengthHours", "coverUrl", "releaseYear"].map(name => [name, new Input(name)]));
  function render() {
    const tree = h.render(Component);
    tree.props.ref.current = { elements: { namedItem: name => fields[name] } };
    return tree;
  }
  return {
    fields, calls, lookups, pendingLookup,
    get tree() { return render(); },
    get autocomplete() { return get(render(), node => node.type === TitleAutocomplete); },
    edit(name, value) { fields[name].value = value; render().props.onChangeCapture({ target: fields[name] }); },
    cleanup() { Object.assign(global, original); },
  };
}

test("GameForm selection fills all metadata while preserving manually edited fields, including cleared ones", () => {
  const f = formFixture();
  try {
    f.edit("platform", "Switch"); f.edit("genre", "My genre"); f.edit("lengthHours", "");
    f.autocomplete.props.onSelect(item());
    assert.equal(f.fields.platform.value, "Switch"); assert.equal(f.fields.genre.value, "My genre");
    assert.equal(f.fields.lengthHours.value, ""); assert.equal(f.fields.releaseYear.value, "2011");
    assert.equal(f.fields.coverUrl.value, item().coverUrl);
    f.autocomplete.props.onSelect({ ...item("Doom", 2016), coverUrl: null });
    assert.equal(f.fields.releaseYear.value, "2016"); assert.equal(f.fields.coverUrl.value, "");
    f.autocomplete.props.onTitleChange();
    assert.equal(f.fields.releaseYear.value, ""); assert.equal(f.fields.genre.value, "My genre");
    assert.equal(f.fields.platform.value, "Switch");
  } finally { f.cleanup(); }
});

test("GameForm uses canonical estimated hours and resets customization tracking only after successful submission", async () => {
  const f = formFixture();
  try {
    f.autocomplete.props.onSelect(item());
    assert.equal(f.fields.lengthHours.value, "9");
    f.edit("lengthHours", "75");
    const key = f.autocomplete.key;
    const data = new FormData(); data.set("title", "A freeform quest");
    await f.tree.props.action(data);
    assert.equal(f.calls[0].get("title"), "A freeform quest");
    assert.notEqual(f.autocomplete.key, key);
    f.autocomplete.props.onSelect(item());
    assert.equal(f.fields.lengthHours.value, "9");
    const platforms = get(f.tree, node => node.type === "datalist");
    assert(nodes(platforms).some(node => node.props?.value === "PS3"));
  } finally { f.cleanup(); }
});

test("old Search Game Info responses cannot overwrite a newly typed title", async () => {
  const f = formFixture();
  try {
    f.fields.title.value = "Portal";
    const search = get(f.tree, node => node.type === "button" && node.props.className === "search-button");
    const pending = search.props.onClick();
    f.fields.title.value = "Doom";
    f.pendingLookup.resolve({ ...item(), playtime: 10 });
    await pending; await settle();
    assert.deepEqual(f.lookups, ["Portal"]);
    assert.equal(f.fields.genre.value, ""); assert.equal(f.fields.coverUrl.value, "");
  } finally { f.cleanup(); }
});

test("a failed create preserves the title component and customized metadata for retry", async () => {
  const f = formFixture({ fail: true });
  try {
    f.edit("lengthHours", "75");
    const key = f.autocomplete.key;
    await assert.rejects(f.tree.props.action(new FormData()), /Fixture failure/);
    assert.equal(f.autocomplete.key, key);
    f.autocomplete.props.onSelect(item());
    assert.equal(f.fields.lengthHours.value, "75");
  } finally { f.cleanup(); }
});
