/* eslint-disable @typescript-eslint/no-require-imports -- Exercise real actions and admin guard with isolated session/database boundaries. */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");

function loader(mocks) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.resolve(__dirname, "..", file), instance = new Module(filename, module);
    instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = name => name === "server-only" ? {} : Object.hasOwn(mocks, name) ? mocks[name]
      : name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`) : original(name);
    instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, filename);
    cache.set(file, instance.exports); return instance.exports;
  }
  return load;
}

function fixture({ admin = false, owner = false, active = true } = {}) {
  class AuthenticationRequiredError extends Error {
    constructor() { super("Sign in"); this.name = "AuthenticationRequiredError"; }
  }
  const state = { admin, owner, active, afterScan: () => {} };
  const calls = [];
  const load = loader({
    "next/cache": { revalidatePath() {} },
    "@/lib/prisma": { prisma: { playerSession: { findUnique: async () => state.active
      ? { player: { id: "player", isAdmin: state.admin, isOwner: state.owner } } : null } } },
    "@/lib/player": { AuthenticationRequiredError, getAuthenticatedPlayerId: async () => {
      if (!state.active) throw new AuthenticationRequiredError();
      return "player";
    } },
    "@/lib/auth-session": { readSessionHash: async () => state.active ? "verified-session" : null },
    "@/lib/api-resilience": { guardedRequest: async (_id, _feature, _input, work) => work() },
    "@/lib/recommendations": { getExternalRecommendations: async (...args) => {
      calls.push(args);
      if (args[2]) args[2].responsePreview = "ADMIN PRIVATE DIAGNOSTIC";
      state.afterScan();
      return [{ title: "Good" }];
    } },
    "@/lib/library-vault": {}, "@/lib/achievements": {}, "@/lib/rawg": {}, "@/lib/saga-lore": {},
    "@/lib/saga-chronology-cache": {},
  });
  return { state, calls, run: excluded => load("src/app/actions.ts").fetchExternalScout(excluded) };
}

test("Scout omits diagnostics and never collects previews for standard users", async () => {
  const f = fixture();
  const result = await f.run(["Seen"]);
  assert.deepEqual(result, { recommendations: [{ title: "Good" }] });
  assert.equal(f.calls[0].length, 2);
  assert(!JSON.stringify(result).includes("PRIVATE"));
});

test("active admins and owners receive Scout telemetry with a UTC request timestamp", async () => {
  for (const owner of [false, true]) {
    const f = fixture({ admin: true, owner });
    const result = await f.run([]);
    assert.equal(result.debug.responsePreview, "ADMIN PRIVATE DIAGNOSTIC");
    assert.match(result.debug.requestedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    assert.equal(f.calls[0][0], "player");
  }
});

test("Scout strips diagnostics on demotion and returns no data after logout during provider work", async () => {
  const demoted = fixture({ admin: true });
  demoted.state.afterScan = () => { demoted.state.admin = false; };
  assert.deepEqual(await demoted.run([]), { recommendations: [{ title: "Good" }] });
  const signedOut = fixture({ admin: true });
  signedOut.state.afterScan = () => { signedOut.state.active = false; };
  const result = await signedOut.run([]);
  assert.match(result.error, /Sign in/);
  assert(!JSON.stringify(result).includes("PRIVATE"));
});

test("Scout rejects signed-out and invalid requests before recommendations or debug collection", async () => {
  for (const settings of [{ active: false }, {}]) {
    const f = fixture(settings);
    const result = await f.run(Array(31).fill("Seen"));
    assert.equal(typeof result.error, "string"); assert.equal(f.calls.length, 0);
  }
});
