/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the real view's handlers with isolated React state and controller boundaries. */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const nodes = tree => !tree || typeof tree !== "object" ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const text = tree => typeof tree === "string" ? tree : Array.isArray(tree) ? tree.map(text).join("") : tree?.props ? text(tree.props.children) : "";

function fixture(selectedGameId = null) {
  let cursor = 0;
  const state = [], writes = [], sounds = [];
  const games = [1, 2, 3].map(id => ({ id, title: `Quest ${id}`, platform: "PC", status: "Backlog", pinnedOrder: null, rating: null, coverUrl: null }));
  const controller = {
    selectedGameId, setSelectedGameId: id => { writes.push(id); controller.selectedGameId = id; },
    games, visibleGames: games, achievements: [], advisor: {}, roulette: {}, vault: {}, social: {}, deck: {},
    activeView: "Backlog", viewCounts: { Backlog: 3, Playing: 0, Completed: 0, Flatlined: 0, All: 3 },
    platforms: [], genres: [], chains: [], selectedSaga: null, sortBy: "default", searchQuery: "", platformFilter: "", genreFilter: "",
    isReorderableRow: () => false, canDragToDeck: () => true,
  };
  const empty = () => null;
  const mocks = {
    react: { useState: initial => { const slot = cursor++; if (!Object.hasOwn(state, slot)) state[slot] = initial;
      return [state[slot], next => { state[slot] = typeof next === "function" ? next(state[slot]) : next; }]; }, useId: () => "inventory-help" },
    "@/components/SocialHub": { SocialHubTrigger: empty },
    "@/components/CustomLists": { default: empty },
    "@/components/WorkspaceSection": { default: empty },
    "@/components/FantasyAccents": { FantasyCorners: empty, NaviFairy: empty, SlotBrackets: empty },
    "@/components/WorkspaceShell": { useSubscreen: () => ({ showPane() {} }) },
    "@/components/ThemeProvider": { useUIEffects: () => ({ playSfx: sound => sounds.push(sound) }) },
    "@/components/SagaChains": { SagaBadge: empty, SagaOrderControls: empty },
    "@/components/Ownership": { OwnershipField: () => null, OwnershipBadge: () => null, OwnershipFilterControl: () => null },
    "@/components/PlayJournal": { PlayJournalBadges: () => null, PlayJournalEditor: () => null },
    "@/components/MicroReview": { MicroReview: () => null, MicroReviewEditor: () => null },
    "@/components/CommunityGameStats": { CommunityStatsReadout: empty },
    "@/components/SagaChronologyDebugger": { SagaChronologyDebuggerView: empty },
    "@/components/SafeForm": { default: empty, SafeActionButton: empty },
    "@/lib/game-record": { gameRecordKey: game => String(game.id) }, "@/lib/trailers": { buildTrailerUrl: () => "#" },
  };
  for (const name of ["FantasyEquipmentDeck", "DeckPinButton", "StarRatingInput", "AgentBriefing"]) mocks[`@/components/${name}`] = { default: empty };
  const filename = path.resolve(__dirname, "../src/components/FantasySubscreenView.tsx"), instance = new Module(filename, module);
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = instance.require.bind(instance);
  instance.require = name => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, filename);
  const render = () => { cursor = 0; return instance.exports.default({ controller }); };
  const row = (tree, id) => nodes(tree).find(node => node.type === "li" && node.props["data-library-game-id"] === id);
  const slot = (tree, id) => nodes(row(tree, id)).find(node => node.props?.className === "fantasy-inventory-slot");
  const inspected = tree => nodes(tree).find(node => typeof node.type === "function" && node.type.name === "FantasyQuestDialogue")?.props.game.id;
  return { controller, games, writes, sounds, render, row, slot, inspected };
}

test("unlocked inventory previews the first slot and follows hover/focus without creating a lock", () => {
  const f = fixture(); let tree = f.render();
  assert.equal(f.inspected(tree), 1);
  for (const game of f.games) assert.equal(f.slot(tree, game.id).props["aria-pressed"], false);
  f.slot(tree, 2).props.onMouseEnter(); tree = f.render();
  assert.equal(f.inspected(tree), 2); assert.equal(f.row(tree, 2).props["data-preview"], true);
  f.slot(tree, 3).props.onFocus(); tree = f.render();
  assert.equal(f.inspected(tree), 3); assert.deepEqual(f.writes, []);
  assert.equal(f.slot(tree, 3).props["aria-describedby"], "inventory-help");
  assert.match(text(tree), /Preview mode.*Enter or Space to lock/);
});

test("click locks the preview and both hover and keyboard focus respect the locked game", () => {
  const f = fixture(); let tree = f.render();
  f.slot(tree, 2).props.onMouseEnter(); tree = f.render();
  f.slot(tree, 2).props.onClick(); tree = f.render();
  assert.equal(f.inspected(tree), 2); assert.equal(f.controller.selectedGameId, 2);
  assert.equal(f.row(tree, 2).props["data-selected"], true); assert.equal(f.slot(tree, 2).props["aria-pressed"], true);
  assert(f.games.every(game => !f.row(tree, game.id).props["data-preview"]));
  f.slot(tree, 3).props.onMouseEnter(); f.slot(tree, 1).props.onFocus(); tree = f.render();
  assert.equal(f.inspected(tree), 2); assert.deepEqual(f.writes, [2]);
  assert.match(text(tree), /Locked: Quest 2/);
});

test("clicking the locked slot again unlocks it and immediately restores hover/focus preview", () => {
  const f = fixture(); let tree = f.render();
  f.slot(tree, 2).props.onClick(); tree = f.render();
  f.slot(tree, 2).props.onClick(); tree = f.render();
  assert.equal(f.controller.selectedGameId, null); assert.equal(f.inspected(tree), 2);
  assert.equal(f.slot(tree, 2).props["aria-pressed"], false);
  f.slot(tree, 3).props.onMouseEnter(); tree = f.render(); assert.equal(f.inspected(tree), 3);
  f.slot(tree, 1).props.onFocus(); tree = f.render(); assert.equal(f.inspected(tree), 1);
  assert.deepEqual(f.writes, [2, null]);
});

test("activating another slot moves the lock, including when focus preview is suppressed", () => {
  const f = fixture(2); let tree = f.render();
  f.slot(tree, 3).props.onFocus(); tree = f.render(); assert.equal(f.inspected(tree), 2);
  f.slot(tree, 3).props.onClick(); tree = f.render();
  assert.equal(f.inspected(tree), 3); assert.equal(f.slot(tree, 2).props["aria-pressed"], false);
  assert.equal(f.slot(tree, 3).props["aria-pressed"], true);
});

test("mouse movement resumes preview after keyboard unlock when the pointer never left another slot", () => {
  const f = fixture(1); let tree = f.render();
  f.slot(tree, 3).props.onMouseEnter(); tree = f.render(); assert.equal(f.inspected(tree), 1);
  f.slot(tree, 1).props.onClick(); tree = f.render();
  f.slot(tree, 3).props.onMouseMove(); tree = f.render();
  assert.equal(f.inspected(tree), 3); assert.equal(f.controller.selectedGameId, null);
});

test("quick-pin focus previews only in unlocked mode and never toggles the inventory lock", () => {
  const f = fixture(); let tree = f.render();
  const pin = (tree, id) => nodes(f.row(tree, id)).find(node => node.props?.className === "fantasy-inventory-quick-pin");
  pin(tree, 2).props.onFocus(); tree = f.render(); assert.equal(f.inspected(tree), 2); assert.equal(f.controller.selectedGameId, null);
  f.slot(tree, 1).props.onClick(); tree = f.render();
  pin(tree, 2).props.onFocus(); tree = f.render(); assert.equal(f.inspected(tree), 1); assert.deepEqual(f.writes, [1]);
});

test("filtering/removing a locked slot does not prevent previewing visible games or resurrect a stale lock", () => {
  const f = fixture(2); f.controller.visibleGames = [f.games[0], f.games[2]];
  let tree = f.render(); assert.equal(f.inspected(tree), 1);
  f.slot(tree, 3).props.onMouseEnter(); tree = f.render(); assert.equal(f.inspected(tree), 3);
  assert.equal(f.controller.selectedGameId, null);
  f.controller.visibleGames = f.games; tree = f.render(); assert.equal(f.inspected(tree), 3);
  f.controller.visibleGames = []; tree = f.render(); assert.equal(f.inspected(tree), undefined);
  assert.match(text(tree), /Your satchel is empty|No quests match/);
});
