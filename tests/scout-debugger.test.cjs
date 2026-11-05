/* eslint-disable @typescript-eslint/no-require-imports -- Render admin diagnostics and exercise server redaction in isolation. */
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
function load(file) {
  const filename = path.resolve(__dirname, "..", file), instance = new Module(filename, module);
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = instance.require.bind(instance);
  instance.require = name => name === "server-only" || name.endsWith(".css") ? {} : original(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, filename);
  return instance.exports;
}
const Debugger = load("src/components/ScoutDebugger.tsx").default;
const { createScoutDebug } = load("src/lib/scout-debug.ts");
const { sanitizeScoutDebug } = load("src/lib/scout-debug-server.ts");
const render = (debug, busy = false) => renderToStaticMarkup(React.createElement(Debugger, { debug, busy }));
function vectorDebug() {
  const debug = createScoutDebug();
  debug.engineSource = "vector"; debug.source = "vector";
  Object.assign(debug.vector, { status: "passed", latencyMs: 8, queryLatencyMs: 2.5, tasteSource: "completed-favorites", anchorCount: 1,
    vectorVersion: "catalog-features-v1", candidateCount: 30, returnedCount: 3,
    coverage: { total: 89, embedded: 89, current: 89, released: 85, eligible: 82 },
    picks: [{ title: "Match", cosineSimilarity: .9, score: .8, scores: { cosine: .63, series: .1, genre: .05, playtime: .02 } }] });
  return debug;
}

test("debugger renders vector source, coverage, timings and accessible per-pick score components", () => {
  const html = render(vectorDebug());
  for (const value of ["VECTOR", "89 current / 89 catalog games", "85 released", "82 eligible", "2.5 ms", "8.0 ms",
    "completed-favorites", "0.900", "0.800", "Cosine 0.630", "Series 0.100", "Genre 0.050", "Playtime 0.020"]) assert(html.includes(value), value);
  assert.match(html, /<caption>Served vector picks/); assert.match(html, /scope="col"/);
  assert.match(html, /scope="row">Match/); assert.match(html, /no provider request needed/);
});

test("mixed/fallback diagnostics remain readable with unavailable metrics and no vector matches", () => {
  const debug = createScoutDebug();
  debug.engineSource = "gemini-fallback"; debug.source = "live-ai"; debug.fallbackTriggered = true;
  debug.vector.status = "failed"; debug.vector.fallbackReason = "Vector discovery unavailable; using the provider fallback.";
  const html = render(debug);
  assert.match(html, /GEMINI FALLBACK/); assert.match(html, /FALLBACK TRIGGERED/);
  assert.match(html, /Unavailable/); assert.match(html, /Vector discovery unavailable/);
  assert(!html.includes("NaN")); assert(!html.includes("<table"));
  debug.engineSource = "mixed";
  assert.match(render(debug), /VECTOR \+ PROVIDER FALLBACK/);
});

test("busy/empty debugger states do not render stale metric tables or payloads", () => {
  assert.match(render(vectorDebug(), true), /Waiting for this scan/);
  assert(!render(vectorDebug(), true).includes("0.900"));
  assert.match(render(null), /Run an External Scout scan/);
});

test("final telemetry transport redacts secrets from vector titles/reasons, anchors, provider diagnostics and model metadata", () => {
  const keys = ["GEMINI_API_KEY", "RAWG_API_KEY", "TWITCH_CLIENT_SECRET", "STEAM_API_KEY", "DATABASE_URL"];
  const previous = keys.map(key => process.env[key]);
  try {
    for (const key of keys) process.env[key] = `fixture-private-${key}`;
    const secret = keys.map(key => process.env[key]).join(" ");
    const debug = vectorDebug();
    debug.vector.picks[0].title = secret; debug.vector.fallbackReason = secret; debug.vector.vectorVersion = secret;
    debug.anchors = [{ title: secret, rating: 5 }]; debug.picks = [{ title: secret, source: "vector", anchor: { title: secret, rating: 5 } }];
    debug.fallbackReason = secret; debug.promptPreview = secret; debug.responsePreview = secret; debug.model = secret; debug.playtimeStatus = secret;
    debug.validationIssues = [{ path: secret, message: secret }];
    const safe = sanitizeScoutDebug(debug), serialized = JSON.stringify(safe);
    for (const key of keys) assert(!serialized.includes(process.env[key]), key);
    assert(serialized.includes("[REDACTED]")); assert.equal(safe.vector.picks[0].cosineSimilarity, .9);
    assert.equal(debug.vector.picks[0].title, secret, "Sanitization must not mutate the collected snapshot");
    assert(!render(safe).includes("fixture-private"));
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});
