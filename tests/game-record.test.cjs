/* eslint-disable @typescript-eslint/no-require-imports -- Test the shared edit/reconciliation contract without React. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const instance = { exports: {} };
const code = ts.transpileModule(fs.readFileSync(require("node:path").join(__dirname, "../src/lib/game-record.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
new Function("module", "exports", code)(instance, instance.exports);
const { gameRecordKey, gameDraftDefaults, mergeGameDraft, updateGameDraft } = instance.exports;
const game = { id: 1, title: "The Hero’s Journey", platform: "PC", genre: "Adventure", status: "Playing", lengthHours: 20, hoursPlayed: 3, difficulty: 2, notes: "Found the forest shrine.", rating: 4, releaseYear: 2020, coverUrl: null, franchise: "Hero", chronologicalOrder: 1 };

test("shared editor defaults preserve progress, notes, ratings and empty optional fields", () => {
  const metadata = { title: game.title, platform: "PC", genre: "Adventure", franchise: "Hero", releaseYear: "2020", chronologicalOrder: "1", coverUrl: "" };
  assert.deepEqual(gameDraftDefaults(game), { playthroughCount: "0", status: "Playing", lengthHours: "20", hoursPlayed: "3", difficulty: "2", notes: "Found the forest shrine.", rating: "4", review: "", reviewSpoiler: "false", startedAt: "", completedAt: "", ownershipType: "", ...metadata });
  assert.deepEqual(gameDraftDefaults({ ...game, notes: null, rating: null }), { playthroughCount: "0", status: "Playing", lengthHours: "20", hoursPlayed: "3", difficulty: "2", notes: "", rating: "", review: "", reviewSpoiler: "false", startedAt: "", completedAt: "", ownershipType: "", ...metadata });
});

test("server record changes refresh editors while pin/backlog moves preserve their identity", () => {
  const initial = gameRecordKey(game);
  assert.equal(gameRecordKey({ ...game, pinnedOrder: 2, backlogOrder: 3 }), initial);
  for (const field of ["title", "platform", "genre", "status", "lengthHours", "hoursPlayed", "difficulty", "notes", "rating", "releaseYear", "coverUrl", "franchise", "chronologicalOrder", "review", "reviewSpoiler", "startedAt", "completedAt", "ownershipType", "playthroughCount"]) {
    const updated = { ...game, [field]: typeof game[field] === "number" ? game[field] + 1 : `${game[field] ?? ""} changed` };
    assert.notEqual(gameRecordKey(updated), initial, `${field} changed on the server`);
  }
});

test("background refreshes preserve dirty fields and accept fresh values for untouched fields", () => {
  const edits = updateGameDraft(game, {}, { title: "Unsaved title", ownershipType: "Physical", notes: "", status: "Completed" });
  const refreshed = { ...game, title: "Server title", platform: "PS5", ownershipType: "Digital", hoursPlayed: 12, startedAt: "2026-01-02" };
  const result = mergeGameDraft(refreshed, edits);
  assert.equal(result.title, "Unsaved title"); assert.equal(result.ownershipType, "Physical");
  assert.equal(result.notes, ""); assert.equal(result.status, "Completed");
  assert.equal(result.platform, "PS5"); assert.equal(result.hoursPlayed, "12"); assert.equal(result.startedAt, "2026-01-02");
  assert.equal(mergeGameDraft(refreshed).title, "Server title", 'clearing a successful draft restores authoritative values');
});

test("reverting a field releases its override, and all metadata fields can retain drafts", () => {
  const defaults = gameDraftDefaults(game);
  let edits = {};
  for (const name of Object.keys(defaults)) edits = updateGameDraft(game, edits, { [name]: `${defaults[name]} edited` });
  assert.equal(Object.keys(edits).length, Object.keys(defaults).length);
  assert.deepEqual(mergeGameDraft(game, edits), Object.fromEntries(Object.entries(defaults).map(([name, value]) => [name, `${value} edited`])));
  edits = updateGameDraft(game, edits, defaults);
  assert.deepEqual(edits, {});
});
