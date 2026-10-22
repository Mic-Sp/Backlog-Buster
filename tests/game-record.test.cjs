/* eslint-disable @typescript-eslint/no-require-imports -- Test the shared edit/reconciliation contract without React. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const instance = { exports: {} };
const code = ts.transpileModule(fs.readFileSync(require("node:path").join(__dirname, "../src/lib/game-record.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
new Function("module", "exports", code)(instance, instance.exports);
const { gameRecordKey, gameDraftDefaults } = instance.exports;
const game = { id: 1, title: "The Hero’s Journey", platform: "PC", genre: "Adventure", status: "Playing", lengthHours: 20, hoursPlayed: 3, difficulty: 2, notes: "Found the forest shrine.", rating: 4, releaseYear: 2020, coverUrl: null, franchise: "Hero", chronologicalOrder: 1 };

test("shared editor defaults preserve progress, notes, ratings and empty optional fields", () => {
  assert.deepEqual(gameDraftDefaults(game), { status: "Playing", lengthHours: "20", hoursPlayed: "3", difficulty: "2", notes: "Found the forest shrine.", rating: "4" });
  assert.deepEqual(gameDraftDefaults({ ...game, notes: null, rating: null }), { status: "Playing", lengthHours: "20", hoursPlayed: "3", difficulty: "2", notes: "", rating: "" });
});

test("server changes invalidate stale edits while pin/backlog moves preserve the edit session", () => {
  const initial = gameRecordKey(game);
  assert.equal(gameRecordKey({ ...game, pinnedOrder: 2, backlogOrder: 3 }), initial);
  for (const field of ["title", "platform", "genre", "status", "lengthHours", "hoursPlayed", "difficulty", "notes", "rating", "releaseYear", "coverUrl", "franchise", "chronologicalOrder"]) {
    const updated = { ...game, [field]: typeof game[field] === "number" ? game[field] + 1 : `${game[field] ?? ""} changed` };
    assert.notEqual(gameRecordKey(updated), initial, `${field} changed on the server`);
  }
});
