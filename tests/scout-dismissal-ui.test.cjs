/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the actual controller with isolated action boundaries. */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const { loader } = require("./helpers/social-fixture.cjs");
const pure = loader(), results = pure("src/lib/action-result.ts"), { normalizeGameTitle } = pure("src/lib/game-title.ts");
const pick = title => ({ title, platform: "PC", genre: "RPG", releaseYear: 2020, coverUrl: null, lengthHours: 20, difficulty: 2, reason: "Try this" });

function fixture({ persist = async () => ({ titleKey: "cafe adventure 2" }) } = {}) {
  const slots = [], pending = [], calls = [], exclusions = [];
  let cursor = 0;
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo: callback => callback(), useEffect() {},
    useTransition() { const index = cursor++; slots[index] ??= false; return [slots[index], work => { slots[index] = true; pending.push(Promise.resolve(work()).finally(() => { slots[index] = false; })); }]; },
  };
  const mocks = {
    react, "react-dom": { createPortal: child => child },
    "@/components/LayoutText": { useLayoutCopy: () => cyber => cyber },
    "@/components/FantasyAccents": {}, "@/components/ThemeProvider": { useUIEffects: () => ({ playSfx() {} }) },
    "@/components/useCooldown": { default: () => ({ seconds: 0, start() {} }) },
    "@/lib/cooldown": { DEFAULT_COOLDOWN_SECONDS: 10 }, "@/lib/action-result": results,
    "@/lib/game-title": { normalizeGameTitle }, "@/lib/trailers": {},
    "@/components/ScoutDebugger": {}, "@/components/DeckPinButton": {}, "@/components/AgentBriefing": {},
    "@/app/actions": {
      dismissScoutRecommendation: title => { calls.push(title); return persist(title); },
      // Deliberately return excluded/stale cards to exercise client defense.
      fetchExternalScout: async titles => { exclusions.push(titles); return { recommendations: [pick("Café Adventure II"), pick("Safe")] }; },
      fetchBacklogAdvisor: async () => ({ continuationPick: null, palateCleanserPick: null }),
    },
  };
  const filename = path.resolve(__dirname, "../src/components/TacticalAdvisor.tsx"), instance = new Module(filename, module);
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = instance.require.bind(instance);
  instance.require = name => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, filename);
  const render = () => { cursor = 0; return instance.exports.useTacticalAdvisorController({ games: [] }); };
  const dismiss = (controller, game) => {
    const previous = global.requestAnimationFrame;
    global.requestAnimationFrame = () => 0;
    try { controller.dismissContract(game); } finally { global.requestAnimationFrame = previous; }
  };
  return { render, dismiss, calls, exclusions, flush: async () => { await Promise.all(pending.splice(0)); } };
}

test("Scout dismiss removes the card before persistence completes and never duplicates a save", async () => {
  let release;
  const f = fixture({ persist: () => new Promise(resolve => { release = resolve; }) });
  f.render().loadExternalPicks(); await f.flush();
  let controller = f.render();
  f.dismiss(controller, controller.externalPicks[0]); f.dismiss(controller, pick("Cafe Adventure 2"));
  controller = f.render();
  assert.deepEqual(controller.externalPicks.map(game => game.title), ["Safe"]);
  assert.match(controller.dismissalNotice, /Saving your preference/); assert.deepEqual(f.calls, ["Café Adventure II"]);
  release({ titleKey: "cafe adventure 2" }); await f.flush();
  assert.match(f.render().dismissalNotice, /won’t appear in future/);
});

test("failed/guest saves remain hidden through rescans and modal reopens with honest session-only feedback", async () => {
  for (const persist of [async () => ({ error: "Sign in to access your library." }), async () => { throw Error("offline"); }]) {
    const f = fixture({ persist });
    f.render().openAdvisor(); await f.flush();
    const controller = f.render(); f.dismiss(controller, controller.externalPicks[0]); await f.flush();
    assert.match(f.render().dismissalNotice, /hidden for this session only/);
    f.render().close(); f.render().openAdvisor(); await f.flush();
    assert.deepEqual(f.render().externalPicks.map(game => game.title), ["Safe"]);
    assert(f.exclusions[1].some(title => normalizeGameTitle(title) === "cafe adventure 2"));
    assert(f.exclusions[1].length <= 30);
  }
});
