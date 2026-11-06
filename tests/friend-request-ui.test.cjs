/* eslint-disable @typescript-eslint/no-require-imports -- Exercise notification effects and real UI handlers with isolated browser/action boundaries. */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const { loader } = require("./helpers/social-fixture.cjs");
const helpers = loader()("src/lib/friend-request-notifications.ts");
const pending = (id = "request-1", viewerId = "alice") => ({ viewerId, total: 1, requests: [{ id, requester: { id: "nova", operatorName: "Nova", handle: "nova" } }] });

function fixture(t, { enabled = true, stored = new Map(), response } = {}) {
  const hooks = [], effects = [], events = new Map(), timers = new Map(), calls = [];
  let cursor = 0, nextTimer = 0, data = pending(), currentEnabled = enabled;
  function listen(type, fn) { const set = events.get(type) ?? new Set(); set.add(fn); events.set(type, set); }
  const env = {
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
    document: { hidden: false, addEventListener: listen, removeEventListener: (type, fn) => events.get(type)?.delete(fn) },
    window: { setInterval: (fn, ms) => { assert.equal(ms, 30000); const id = ++nextTimer; timers.set(id, fn); return id; },
      clearInterval: id => timers.delete(id), addEventListener: listen, removeEventListener: (type, fn) => events.get(type)?.delete(fn) },
  };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
  for (const [key, value] of Object.entries(env)) Object.defineProperty(global, key, { value, configurable: true, writable: true });
  t.after(() => {
    for (const hook of hooks) hook?.cleanup?.();
    for (const [key, descriptor] of Object.entries(previous)) if (descriptor) Object.defineProperty(global, key, descriptor); else delete global[key];
  });
  const react = {
    useState(initial) { const slot = cursor++; hooks[slot] ??= { value: typeof initial === "function" ? initial() : initial };
      const hook = hooks[slot]; return [hook.value, next => { hook.value = typeof next === "function" ? next(hook.value) : next; }]; },
    useRef(initial) { const slot = cursor++; return hooks[slot] ??= { current: initial }; },
    useCallback: fn => fn,
    useEffect(work, deps) { const slot = cursor++, before = hooks[slot];
      if (!before || deps.some((value, index) => !Object.is(value, before.deps[index]))) effects.push(() => { before?.cleanup?.(); hooks[slot] = { deps, cleanup: work() }; }); },
  };
  const mod = loader({ react, "@/app/social-actions": { fetchIncomingFriendRequests: async () => {
    calls.push(true); return response ? response() : structuredClone(data);
  } } })("src/components/useFriendRequestNotifications.ts");
  const render = (value = currentEnabled) => { currentEnabled = value; cursor = 0;
    const result = mod.useFriendRequestNotifications(value); while (effects.length) effects.shift()(); return result; };
  return { calls, stored, render, env, setData: value => { data = value; }, setResponse: value => { response = value; },
    emit: (type, event = {}) => { for (const fn of events.get(type) ?? []) fn(event); },
    tick: () => { for (const fn of timers.values()) fn(); },
    flush: async () => { await new Promise(setImmediate); return render(); } };
}

test("dismissal survives refresh while the pending header count remains until the request is resolved", async t => {
  const f = fixture(t); f.render(); let state = await f.flush();
  assert.equal(state.count, 1); assert.equal(state.notification[0].requester.operatorName, "Nova");
  state.dismiss(); state = f.render(); assert.equal(state.count, 1); assert.deepEqual(state.notification, []);
  f.emit("focus"); state = await f.flush(); assert.deepEqual(state.notification, []);
  assert.deepEqual(helpers.readSeenFriendRequests(f.env.localStorage, "alice"), ["request-1"]);
  f.setData({ viewerId: "alice", total: 0, requests: [] });
  f.emit(helpers.FRIENDSHIP_CHANGE_EVENT); state = await f.flush(); assert.equal(state.count, 0);
  f.setData(pending("request-2")); f.emit("focus"); state = await f.flush(); assert.equal(state.notification[0].id, "request-2");
});

test("guests never poll and disabled/unmounted effects discard delayed responses", async t => {
  let resolve;
  const f = fixture(t, { enabled: false, response: () => new Promise(done => { resolve = done; }) });
  assert.equal(f.render().count, 0); assert.equal(f.calls.length, 0);
  f.render(true); assert.equal(f.calls.length, 1); f.render(false);
  resolve(pending()); const state = await f.flush(); assert.equal(state.count, 0); assert.deepEqual(state.notification, []);
});

test("visible polling, focus and relationship changes coalesce requests and recover from failures", async t => {
  let resolve;
  const f = fixture(t, { response: () => new Promise(done => { resolve = done; }) });
  f.render(); f.emit("focus"); f.emit(helpers.FRIENDSHIP_CHANGE_EVENT); assert.equal(f.calls.length, 1);
  f.setResponse(undefined); resolve(pending()); let state = await f.flush();
  assert.equal(f.calls.length, 2); assert.equal(state.count, 1);
  f.env.document.hidden = true; f.tick(); assert.equal(f.calls.length, 2);
  f.env.document.hidden = false; f.setResponse(async () => ({ error: "Sign in" }));
  f.tick(); state = await f.flush(); assert.equal(state.count, 0); assert.deepEqual(state.notification, []);
  f.setResponse(undefined); f.emit("visibilitychange"); state = await f.flush(); assert.equal(state.count, 1);
});

test("reload and cross-tab dismissal respect per-account seen IDs without storage echo loops", async t => {
  const stored = new Map([[`${helpers.FRIEND_REQUEST_SEEN_PREFIX}alice`, '["request-1"]']]);
  const f = fixture(t, { stored }); f.render(); let state = await f.flush(); assert.deepEqual(state.notification, []);
  f.setData(pending("request-2")); f.emit("focus"); state = await f.flush(); assert.equal(state.notification.length, 1);
  stored.set(`${helpers.FRIEND_REQUEST_SEEN_PREFIX}alice`, '["request-1","request-2"]');
  f.emit("storage", { key: `${helpers.FRIEND_REQUEST_SEEN_PREFIX}alice` }); state = await f.flush(); assert.deepEqual(state.notification, []);
  f.setData(pending("request-1", "bob")); f.emit("focus"); state = await f.flush(); assert.equal(state.notification.length, 1);
});

const nodes = tree => !tree || typeof tree !== "object" ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
function views(mode) {
  const mocks = {
    "react-dom": { createPortal: node => node },
    "@/components/ThemeProvider": { useUIEffects: () => ({ layoutMode: mode }) },
    "@/components/LayoutText": { useLayoutCopy: () => (cyber, fantasy) => mode === "fantasy" ? fantasy : cyber },
    "@/lib/action-result": {}, "@/app/social-actions": {}, "@/app/activity-actions": {}, "@/app/friendship-actions": {},
    "@/components/SocialControls": {}, "@/components/OperatorAvatar": {}, "@/components/useFriendRequestNotifications": {},
  };
  const filename = path.resolve(__dirname, "../src/components/SocialHub.tsx"), instance = new Module(filename, module);
  instance.paths = Module._nodeModulePaths(path.dirname(filename)); const original = instance.require.bind(instance);
  instance.require = name => name.endsWith(".css") ? {} : Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, filename);
  return instance.exports;
}

test("both themed triggers and notification buttons open incoming requests and expose accessible counts", () => {
  for (const mode of ["cyberpunk", "fantasy"]) {
    const ui = views(mode), calls = [];
    const controller = { enabled: true, isOpen: false, requestsView: true, open: () => calls.push("friends"), openRequests: () => calls.push("incoming"),
      requests: { count: 1, notification: pending().requests, dismiss: () => calls.push("dismiss") } };
    const trigger = ui.SocialHubTrigger({ controller }); trigger.props.onClick();
    assert.equal(trigger.props["data-social-theme"], mode);
    assert.equal(nodes(trigger).find(node => node.props?.className === "social-request-count").props["aria-label"], "1 incoming friend request");
    const before = global.document; global.document = { body: {} };
    try {
      const toast = ui.SocialHubOverlay({ controller });
      nodes(toast).find(node => node.props?.className === "social-request-toast-open").props.onClick();
      nodes(toast).find(node => node.props?.className === "social-request-toast-dismiss").props.onClick();
      assert.equal(nodes(toast).find(node => node.props?.role === "status").props["data-social-theme"], mode);
      controller.isOpen = true;
      assert.equal(nodes(ui.SocialHubOverlay({ controller })).find(node => node.type?.name === "SocialHubDialog").props.initialRequests, true);
    } finally { if (before === undefined) delete global.document; else global.document = before; }
    assert.deepEqual(calls, ["incoming", "incoming", "dismiss"]);
    controller.requests.count = 0; ui.SocialHubTrigger({ controller }).props.onClick(); assert.equal(calls.at(-1), "friends");
  }
});
