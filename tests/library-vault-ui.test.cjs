/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the shared vault controller with isolated action boundaries. */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
function load(file, mocks) {
  const filename = path.resolve(__dirname, "..", file), instance = new Module(filename, module);
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = instance.require.bind(instance);
  instance.require = name => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  return instance.exports;
}
const { ActionFailure, unwrapActionResult } = load("src/lib/action-result.ts", {});
const nodes = tree => !tree || typeof tree !== "object" ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const text = tree => typeof tree === "string" || typeof tree === "number" ? String(tree) : Array.isArray(tree) ? tree.map(text).join("") : tree?.props ? text(tree.props.children) : "";
function fixture({ savedSteamId, layout = "cyberpunk", response = async () => ({ steamId: "76561198000000000", addedCount: 300, updatedCount: 2, skippedCount: 4 }) } = {}) {
  const slots = [], pending = [], calls = [], imports = [], cooldownCalls = [];
  let cursor = 0;
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect() {},
    useTransition() { const i = cursor++; slots[i] ??= false; return [slots[i], work => { slots[i] = true; pending.push(Promise.resolve(work()).finally(() => { slots[i] = false; })); }]; },
  };
  const cooldown = { seconds: 0, start: (...args) => cooldownCalls.push(args) };
  const vaultModule = load("src/components/LibraryDataVault.tsx", {
    react, "react-dom": { createPortal: child => child },
    "@/components/LayoutText": { useLayoutCopy: () => (cyber, fantasy) => layout === "fantasy" ? fantasy : cyber },
    "@/components/FantasyAccents": { FantasyCorners: () => null },
    "@/lib/action-result": { ActionFailure, unwrapActionResult },
    "@/components/useCooldown": { default: () => cooldown }, "@/lib/cooldown": { DEFAULT_COOLDOWN_SECONDS: 10 },
    "@/lib/library-import": { MAX_IMPORT_BYTES: 500000 },
    "@/app/actions": {
      syncSteamLibrary: async payload => { calls.push(payload); return response(payload); },
      bulkImportGames: async payload => { imports.push(payload); return { importedCount: 1, duplicateCount: 0, invalidCount: 0 }; },
    },
  });
  const render = () => { cursor = 0; return vaultModule.useLibraryDataVaultController({ games: [], savedSteamId }); };
  return { render, calls, imports, cooldown, cooldownCalls, flush: async () => { await Promise.all(pending.splice(0)); },
    view: controller => { const before = global.document; global.document = { body: {} }; try { return vaultModule.LibraryDataVaultView({ controller, part: "overlay" }); } finally { global.document = before; } } };
}

test("saved Steam ID prefills the shared controller with safe option defaults", () => {
  const f = fixture({ savedSteamId: "76561198000000000" });
  const c = f.render();
  assert.equal(c.steamIdentifier, "76561198000000000"); assert.equal(c.includeUnplayed, true); assert.equal(c.updateHoursPlayed, false);
  assert.equal(fixture().render().steamIdentifier, "");
});

test("sync forwards options, locks pending work, prevents duplicate submission and reports resolved ID/counts", async () => {
  let release;
  const f = fixture({ response: () => new Promise(resolve => { release = resolve; }) });
  let c = f.render(); c.open(); c.setMode("steam"); c.setSteamIdentifier("  my-handle  "); c.setIncludeUnplayed(false); c.setUpdateHoursPlayed(true);
  c = f.render(); c.syncSteam(); c.syncSteam();
  c = f.render(); assert.equal(c.isSyncing, true); assert.equal(c.busy, true); c.close(); assert.equal(f.render().isOpen, true);
  assert.deepEqual(f.calls, [{ identifier: "my-handle", includeUnplayed: false, updateHoursPlayed: true }]);
  let tree = f.view(c); assert.match(text(tree), /SYNCING STEAM LIBRARY/);
  assert(nodes(tree).filter(node => node.type === "input").every(node => node.props.disabled));
  release({ steamId: "76561198000000000", addedCount: 300, updatedCount: 2, skippedCount: 4 }); await f.flush();
  c = f.render(); assert.equal(c.busy, false); assert.equal(c.steamIdentifier, "76561198000000000");
  assert.deepEqual(c.steamSummary, { steamId: "76561198000000000", addedCount: 300, updatedCount: 2, skippedCount: 4 });
  assert.equal(c.message, "Steam library synced."); assert.equal(c.error, "");
  tree = f.view(c); assert.match(text(tree), /Added300Updated \/ linked2Skipped4/);
  assert.equal(f.cooldownCalls[0][0], 10);
});

test("private-profile and transport errors stay inline, preserve input, and clear after a successful retry", async () => {
  let attempt = 0;
  const f = fixture({ savedSteamId: "76561198000000000", response: async () => {
    attempt++;
    if (attempt === 1) return { error: "Set your Steam profile and Game details to Public." };
    if (attempt === 2) throw Error("Steam is unavailable.");
    return { steamId: "76561198000000000", addedCount: 0, updatedCount: 0, skippedCount: 300 };
  } });
  let c = f.render(); c.open(); c.setMode("steam");
  c = f.render(); c.syncSteam(); await f.flush(); c = f.render();
  assert.match(c.error, /Game details to Public/); assert.equal(c.steamSummary, null); assert.equal(c.busy, false);
  assert.equal(nodes(f.view(c)).find(node => node.props?.role === "alert").props.children, c.error);
  c.syncSteam(); await f.flush(); c = f.render(); assert.equal(c.error, "Steam is unavailable.");
  c.syncSteam(); await f.flush(); c = f.render(); assert.equal(c.error, ""); assert.equal(c.steamSummary.skippedCount, 300);
});

test("blank identifiers and cooldowns block dispatch; provider retry duration reaches the countdown", async () => {
  const f = fixture({ response: async () => ({ error: "Steam quota exceeded", retryAfterSeconds: 23 }) });
  let c = f.render(); c.syncSteam(); assert.equal(f.calls.length, 0); assert.match(f.render().error, /Enter a Steam ID/);
  c.setSteamIdentifier("vanity"); c = f.render(); f.cooldown.seconds = 5; c.syncSteam(); assert.equal(f.calls.length, 0);
  f.cooldown.seconds = 0; c.syncSteam(); await f.flush(); assert.equal(f.cooldownCalls[0][0], 23);
});

test("both layout variants expose Steam input/toggles and preserve title/JSON/CSV import modes", async () => {
  for (const layout of ["cyberpunk", "fantasy"]) {
    const f = fixture({ layout }); let c = f.render(); c.open(); c.setMode("steam"); c = f.render();
    const tree = f.view(c);
    assert.match(text(tree), layout === "fantasy" ? /Royal Archive/ : /Data Vault/);
    assert.match(text(tree), /Direct Steam Sync/);
    assert.equal(nodes(tree).filter(node => node.props?.type === "checkbox").length, 2);
    const syncButton = nodes(tree).find(node => node.props?.type === "submit"); assert.equal(syncButton.props.disabled, true);
    c.importGames(); assert.equal(f.imports.length, 0);
    c.setMode("json"); c.setJson('[{"title":"Game"}]'); c = f.render(); c.importGames(); await f.flush();
    assert.deepEqual(f.imports[0], { mode: "json", content: '[{"title":"Game"}]', defaultPlatform: "" });
  }
});
