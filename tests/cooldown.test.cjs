/* eslint-disable @typescript-eslint/no-require-imports -- Isolated hook/server tests with deterministic clocks. */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
function load(file, mocks = {}) {
  const filename = path.resolve(__dirname, "..", file), instance = new Module(filename, module);
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = instance.require.bind(instance);
  instance.require = name => name === "server-only" ? {} : Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`, mocks) : original(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
  return instance.exports;
}

test("cooldown hook ticks, extends, accounts for request time, and cleans up", () => {
  let now = 100000, cursor = 0, nextTimer = 0;
  const slots = [], effects = [], timers = new Map();
  const original = { now: Date.now, set: global.setInterval, clear: global.clearInterval };
  Date.now = () => now;
  global.setInterval = (callback, delay) => { assert.equal(delay, 1000); const id = ++nextTimer; timers.set(id, callback); return id; };
  global.clearInterval = id => timers.delete(id);
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useCallback(callback) { cursor++; return callback; },
    useEffect(callback, dependencies) {
      const index = cursor++, previous = slots[index];
      if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { dependencies, cleanup: callback() }; });
      }
    },
  };
  try {
    const useCooldown = load("src/components/useCooldown.ts", { react }).default;
    function render() { cursor = 0; const result = useCooldown(); while (effects.length) effects.shift()(); return result; }
    function advance(milliseconds) { now += milliseconds; for (const callback of [...timers.values()]) callback(); return render(); }
    let hook = render();
    assert.equal(hook.seconds, 0); assert.equal(timers.size, 0);
    hook.start(3); hook = render();
    assert.equal(hook.label, "COOLDOWN // 03s"); assert.equal(timers.size, 1);
    hook = advance(1000); assert.equal(hook.label, "COOLDOWN // 02s");
    hook = advance(1000); assert.equal(hook.label, "COOLDOWN // 01s");
    hook = advance(1000); assert.equal(hook.seconds, 0); assert.equal(timers.size, 0);
    hook.start(10, now - 7000); hook = render(); assert.equal(hook.seconds, 3);
    hook.start(20); hook = render(); assert.equal(hook.seconds, 20); assert.equal(timers.size, 1);
    hook.start(1); hook = render(); assert.equal(hook.seconds, 20);
    hook = advance(20000); assert.equal(hook.seconds, 0); assert.equal(timers.size, 0);
    hook.start(10, now - 15000); hook = render(); assert.equal(hook.seconds, 0);
    advance(1000); assert.equal(timers.size, 0);
    for (const invalid of [undefined, null, "10", NaN, Infinity, -1, 0]) hook.start(invalid);
    hook = render(); assert.equal(hook.seconds, 0);
    hook.start(5); render(); assert.equal(timers.size, 1);
    for (const slot of slots) slot?.cleanup?.();
    assert.equal(timers.size, 0);
  } finally {
    Date.now = original.now; global.setInterval = original.set; global.clearInterval = original.clear;
  }
});

test("authentication lockouts return the actual account/global reset window", async () => {
  const originalSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "x".repeat(32);
  try {
    for (const blockedQuery of [1, 2]) {
      let calls = 0;
      const session = load("src/lib/auth-session.ts", {
        "next/headers": {},
        "@/lib/prisma": { prisma: { $queryRaw: async () => {
          calls++;
          return [{ attempts: calls === blockedQuery ? 100 : 1, resetsAt: new Date(Date.now() + 23000) }];
        }, authRateLimit: { deleteMany: async () => {} } } },
      });
      await assert.rejects(session.consumeAuthAttempt("test@example.com"), error => error.retryAfterSeconds >= 22 && error.retryAfterSeconds <= 23);
      assert.equal(calls, blockedQuery);
    }
  } finally {
    if (originalSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = originalSecret;
  }
});
