/* eslint-disable @typescript-eslint/no-require-imports -- Exercise real deck handlers with isolated React/action boundaries. */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const { loader } = require("./helpers/social-fixture.cjs");
function component(file, mocks) {
  const filename = path.resolve(__dirname, "..", file), instance = new Module(filename, module);
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = instance.require.bind(instance);
  instance.require = name => name.endsWith(".css") ? {} : Object.hasOwn(mocks, name) ? mocks[name] : name === "@/lib/game-release" ? loader()("src/lib/game-release.ts") : original(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, filename);
  return instance.exports;
}
function deckFixture(releaseYear, source = "table", status = "Backlog") {
  const writes = [], pending = [], optimistic = [], cleared = [];
  const game = { id: 1, title: "Steam Quest", releaseYear, status, pinnedOrder: source === "deck" ? 1 : null };
  const noop = () => {};
  const mod = component("src/components/UpNextDeck.tsx", {
    react: { useEffect: noop, useRef: value => ({ current: value }), useState: value => [value, noop],
      useOptimistic: value => [value, move => optimistic.push(move)], useTransition: () => [false, work => pending.push(work())] },
    "@/app/actions": { assignDeckSlot: async (...args) => { writes.push(["assign", ...args]); return { success: true }; },
      swapDeckSlot: async (...args) => { writes.push(["swap", ...args]); return { success: true }; } },
    "@/lib/action-result": { unwrapActionResult: result => result },
    "@/lib/deck": loader()("src/lib/deck.ts"),
    "@/components/useDeckPins": { useDeckPins: () => ({ isPending: false }), DeckPinsContext: {} },
    "@/components/SafeForm": {}, "@/components/DeckPinButton": {},
  });
  const controller = mod.useUpNextDeckController({ games: [game], draggedGame: { gameId: 1, source },
    onDragGameChange: game => cleared.push(game), onDragPointerDown: noop, onGameDragStart: noop });
  let prevented = false, stopped = false;
  const event = { preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; },
    dataTransfer: { getData: () => JSON.stringify({ gameId: 1, source }) } };
  return { controller, event, writes, pending, optimistic, cleared, get prevented() { return prevented; }, get stopped() { return stopped; } };
}

test("null-year library drags pin to a chosen slot and reorder an equipped game", async () => {
  for (const source of ["table", "deck"]) {
    const f = deckFixture(null, source);
    assert.equal(f.controller.acceptsDrop, true);
    f.controller.dropIntoSlot(f.event, 3);
    await Promise.all(f.pending);
    assert.equal(f.prevented, true); assert.equal(f.stopped, true);
    assert.deepEqual(f.writes, [[source === "deck" ? "swap" : "assign", 1, 3]]);
    assert.deepEqual(f.optimistic, [{ id: 1, slot: 3, source }]); assert.deepEqual(f.cleared, [null]);
  }
});

test("future-year and Playing games cannot enter deck slots, and mismatched drag payloads never save", async () => {
  for (const f of [deckFixture(new Date().getFullYear() + 1), deckFixture(null, "table", "Playing")]) {
    assert.equal(f.controller.acceptsDrop, false); f.controller.dropIntoSlot(f.event, 2);
    assert.equal(f.prevented, false); assert.deepEqual(f.writes, []);
  }
  const f = deckFixture(null);
  f.event.dataTransfer.getData = () => JSON.stringify({ gameId: 999, source: "table" });
  f.controller.dropIntoSlot(f.event, 2); await Promise.all(f.pending);
  assert.deepEqual(f.writes, []);
});

test("pin control enables unknown dates while future dates remain disabled", () => {
  const pins = { isPending: false, errors: {}, togglePin: (...args) => writes.push(args) }, writes = [];
  const mod = component("src/components/DeckPinButton.tsx", {
    react: { useContext: () => pins }, "@/components/useDeckPins": { DeckPinsContext: {} },
    "@/components/LayoutText": { useLayoutCopy: () => cyberpunk => cyberpunk }, "@/lib/deck": { DECK_CAPACITY: 3 },
  });
  function button(year) {
    const wrapper = mod.default({ gameId: 1, pinnedOrder: null, pinnedCount: 0, releaseYear: year });
    return wrapper.type(wrapper.props).props.children[0];
  }
  const unknown = button(null); assert.equal(unknown.props.disabled, false); unknown.props.onClick();
  assert.deepEqual(writes, [[1, true]]);
  const future = button(new Date().getFullYear() + 1); assert.equal(future.props.disabled, true); future.props.onClick();
  assert.deepEqual(writes, [[1, true]]);
});
