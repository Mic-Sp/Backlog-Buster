/* eslint-disable @typescript-eslint/no-require-imports -- Inspect the request-specific dossier composition without database or browser services. */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const React = require("react");
function route(viewer, targetMode = "cyberpunk") {
  const sync = () => null;
  const mocks = {
    react: { ...React, cache: work => work },
    "next/server": { connection: async () => {} }, "next/navigation": { notFound() { throw Error("Not found"); } }, "next/link": { default: () => null },
    "@/components/ThemeProvider": { ThemePlayerSync: sync, ThemeToggle: () => null },
    "@/components/PublicCustomLists": { default: () => null },
    "@/components/PublicDossierCard": { default: () => null }, "@/components/DossierSignalLost": { default: () => null },
    "@/components/SocialControls": { default: () => null }, "@/lib/dossier-metadata": {},
    "@/lib/player": { getCurrentPlayer: async () => { if (viewer instanceof Error) throw viewer; return viewer; } },
    "@/lib/social": { getDossierSocialContext: async () => null },
    "@/lib/public-dossier": { getPublicDossier: async () => ({ identity: { handle: "target", callsign: "Target" }, preferredLayoutMode: targetMode }),
      getPublicDossierArtwork: async () => ({}) },
  };
  const filename = path.resolve(__dirname, "../src/app/dossier/[handle]/page.tsx"), instance = new Module(filename, module);
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = instance.require.bind(instance);
  instance.require = name => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, filename);
  return async () => {
    const page = instance.exports.default({ params: Promise.resolve({ handle: "target" }) });
    const content = await page.props.children.type(page.props.children.props);
    return React.Children.toArray(content.props.children).find(child => child.type === sync).props.player;
  };
}

test("public dossiers synchronize the authenticated viewer's layout, regardless of the target's preference", async () => {
  for (const mode of ["cyberpunk", "fantasy"]) {
    const result = await route({ id: "viewer", preferredLayoutMode: mode, isLocal: false }, mode === "fantasy" ? "cyberpunk" : "fantasy")();
    assert.deepEqual(result, { id: "viewer", preferredLayoutMode: mode });
  }
});

test("anonymous, unclaimed and unavailable viewer sessions keep device-local dossier appearance", async () => {
  for (const viewer of [null, { id: "default-player", preferredLayoutMode: "cyberpunk", isLocal: true }, Error("Session unavailable")]) {
    assert.equal(await route(viewer, "fantasy")(), null);
  }
});
