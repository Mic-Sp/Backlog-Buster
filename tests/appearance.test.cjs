/* eslint-disable @typescript-eslint/no-require-imports -- Isolated preference helpers run without a browser. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");

const instance = { exports: {} };
const source = fs.readFileSync(require("node:path").join(__dirname, "../src/lib/appearance.ts"), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
new Function("module", "exports", code)(instance, instance.exports);
const { readAppearance, applyAppearance, appearanceStartupScript } = instance.exports;

test("layout preference preserves the Cyberpunk sub-theme and restores portal root attributes before paint", () => {
  const previous = global.localStorage;
  try {
    const stored = new Map([["backlogbuster:layout-mode", "fantasy"], ["backlogbuster:theme", "halloween"]]);
    global.localStorage = { getItem: key => stored.get(key) ?? null };
    const root = {};
    const appearance = readAppearance(root);
    assert.deepEqual(appearance, { layoutMode: "fantasy", cyberpunkTheme: "halloween" });
    applyAppearance(root, appearance);
    assert.deepEqual(root, { layoutMode: "fantasy", cyberpunkTheme: "halloween", theme: "fantasy" });
    const startupRoot = {};
    vm.runInNewContext(appearanceStartupScript, { document: { documentElement: { dataset: startupRoot } }, localStorage: global.localStorage });
    assert.deepEqual(startupRoot, root);
    stored.set("backlogbuster:layout-mode", "cyberpunk");
    applyAppearance(root, readAppearance(root));
    assert.equal(root.theme, "halloween");
    assert.equal(root.cyberpunkTheme, "halloween");
    stored.clear();
    applyAppearance(root, readAppearance(root));
    assert.deepEqual(root, { layoutMode: "cyberpunk", cyberpunkTheme: "default", theme: "cyberpunk" });
    stored.set("backlogbuster:layout-mode", "invalid");
    stored.set("backlogbuster:theme", "invalid");
    assert.deepEqual(readAppearance(root), { layoutMode: "cyberpunk", cyberpunkTheme: "default" });
  } finally {
    if (previous === undefined) delete global.localStorage;
    else global.localStorage = previous;
  }
});

test("blocked storage preserves in-memory preferences and cannot break startup", () => {
  const previous = global.localStorage;
  try {
    global.localStorage = { getItem() { throw Error("Storage blocked"); } };
    const root = { layoutMode: "fantasy", cyberpunkTheme: "halloween", theme: "fantasy" };
    assert.deepEqual(readAppearance(root), { layoutMode: "fantasy", cyberpunkTheme: "halloween" });
    assert.doesNotThrow(() => vm.runInNewContext(appearanceStartupScript, { document: { documentElement: { dataset: {} } }, localStorage: global.localStorage }));
  } finally {
    if (previous === undefined) delete global.localStorage;
    else global.localStorage = previous;
  }
});

test("database layout wins over conflicting local preferences before paint and during restoration", () => {
  const previous = global.localStorage;
  try {
    for (const preferred of ["cyberpunk", "fantasy"]) {
      global.localStorage = { getItem: key => key === "backlogbuster:layout-mode" ? (preferred === "fantasy" ? "cyberpunk" : "fantasy") : "halloween" };
      const root = { playerLayout: preferred };
      assert.equal(readAppearance(root).layoutMode, preferred);
      vm.runInNewContext(appearanceStartupScript, { document: { documentElement: { dataset: root } }, localStorage: global.localStorage });
      assert.equal(root.layoutMode, preferred);
      assert.equal(root.theme, preferred === "fantasy" ? "fantasy" : "halloween");
    }
  } finally {
    if (previous === undefined) delete global.localStorage;
    else global.localStorage = previous;
  }
});
