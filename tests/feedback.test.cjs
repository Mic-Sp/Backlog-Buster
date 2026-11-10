/* eslint-disable @typescript-eslint/no-require-imports -- Isolate server boundaries without live services. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

function load(file, mocks = {}) {
  const filename = path.resolve(__dirname, "..", file);
  const instance = new Module(filename, module);
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = instance.require.bind(instance);
  instance.require = name => name === "server-only" ? {} : Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`, mocks) : original(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, filename);
  return instance.exports;
}
const valid = { category: "bug", message: "The queue button does not respond.", pathname: "/dossier/tester", metadata: { userAgent: "Test browser", viewport: { width: 390, height: 844 } } };
const { feedbackSchema } = load("src/lib/feedback-schema.ts");
const request = (body = valid, headers = {}) => new Request("https://backlog.test/api/feedback", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://backlog.test", ...headers }, body: JSON.stringify(body),
});
function handler(overrides = {}) {
  return load("src/app/api/feedback/route.ts", { "@/lib/feedback": {
    feedbackIdentity: async () => null, consumeFeedbackAttempt: async () => 0, deliverFeedback: async () => "report-id", ...overrides,
  } }).POST;
}
function service(prisma = {}, userId = null) {
  return load("src/lib/feedback.ts", { "@/lib/prisma": { prisma }, "@/lib/player": { getOptionalAuthenticatedPlayerId: async () => userId } });
}
function env(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const before = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
}

test("feedback validates bounds, categories, metadata, pathname and server-owned identity", () => {
  for (const category of ["bug", "feature", "other"]) assert.equal(feedbackSchema.safeParse({ ...valid, category }).success, true);
  for (const message of ["x".repeat(10), "x".repeat(3000)]) assert.equal(feedbackSchema.safeParse({ ...valid, message }).success, true);
  assert.equal(feedbackSchema.parse({ category: "other", message: "   Some helpful feedback   ", pathname: "/" }).message, "Some helpful feedback");
  for (const changes of [
    { category: "invalid" }, { message: "" }, { message: " ".repeat(20) }, { message: "too short" }, { message: "x".repeat(3001) },
    { pathname: "https://example.com" }, { pathname: "//example.com" }, { pathname: "/reset?token=secret" }, { pathname: "/#secret" }, { pathname: "/bad\\path" },
    { metadata: { viewport: { width: 0, height: 844 } } }, { metadata: { viewport: { width: 390.5, height: 844 } } },
    { metadata: { userAgent: "x".repeat(1025) } }, { metadata: { cookie: "secret" } }, { userId: "spoofed" }, { email: "spoof@example.com" },
  ]) assert.equal(feedbackSchema.safeParse({ ...valid, ...changes }).success, false, JSON.stringify(changes).slice(0, 100));
});

test("API rejects malformed, oversized and cross-site requests before delivery", async () => {
  const post = handler({ deliverFeedback: () => assert.fail("Invalid feedback delivered") });
  assert.equal((await post(request({ ...valid, message: "" }))).status, 400);
  assert.equal((await post(request({ ...valid, message: "x".repeat(3001) }))).status, 400);
  assert.equal((await post(request(valid, { Origin: "https://attacker.test" }))).status, 403);
  assert.equal((await post(request(valid, { "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal((await post(request(valid, { "Content-Type": "text/plain" }))).status, 415);
  assert.equal((await post(request(valid, { "Content-Length": "20001" }))).status, 413);
  assert.equal((await post(request({ ...valid, message: "x".repeat(21000) }))).status, 413);
  assert.equal((await post(new Request("https://backlog.test/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }))).status, 400);
  assert.equal((await post(new Request("https://backlog.test/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" } }))).status, 400);
});

test("API uses trusted identity and only acknowledges completed delivery", async () => {
  const identity = { userId: "real-player", email: "real@example.com" };
  let called = false;
  const response = await handler({ feedbackIdentity: async () => identity, consumeFeedbackAttempt: async (headers, userId) => { assert.equal(userId, identity.userId); return 0; },
    deliverFeedback: async (payload, player) => { assert.deepEqual(payload, valid); assert.deepEqual(player, identity); called = true; return "report-id"; },
  })(request());
  assert(called); assert.equal(response.status, 201); assert.deepEqual(await response.json(), { ok: true, id: "report-id" });
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("API checks the public proxy origin when Next uses an internal hostname", async () => {
  const post = handler();
  const make = headers => new Request("http://localhost:3008/api/feedback", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://preview.backlog.test", "x-forwarded-host": "preview.backlog.test", "x-forwarded-proto": "https", ...headers }, body: JSON.stringify(valid),
  });
  assert.equal((await post(make({}))).status, 201);
  assert.equal((await post(make({ Origin: "https://attacker.test" }))).status, 403);
  for (const headers of [{ "x-forwarded-host": "preview.backlog.test,attacker.test" }, { "x-forwarded-host": "attacker.test/path" }, { "x-forwarded-host": "user@attacker.test" }, { "x-forwarded-proto": "ftp" }]) {
    assert.equal((await post(make(headers))).status, 403);
  }
});

test("API returns retry interval and fails gracefully on session/storage errors", async t => {
  const limited = await handler({ consumeFeedbackAttempt: async () => 73, deliverFeedback: () => assert.fail("Rate-limited report delivered") })(request());
  assert.equal(limited.status, 429); assert.equal(limited.headers.get("Retry-After"), "73");
  t.mock.method(console, "error", () => {});
  for (const dependency of ["feedbackIdentity", "consumeFeedbackAttempt", "deliverFeedback"]) {
    const response = await handler({ [dependency]: async () => { throw Error("private database details"); } })(request());
    assert.equal(response.status, 503); assert(!JSON.stringify(await response.json()).includes("private database"));
  }
});

test("feedback identity includes authenticated email but never session credentials", async () => {
  assert.equal(await service().feedbackIdentity(), null);
  const identity = await service({ player: { findUnique: async args => { assert.deepEqual(args, { where: { id: "real" }, select: { email: true } }); return { email: "real@example.com" }; } } }, "real").feedbackIdentity();
  assert.deepEqual(identity, { userId: "real", email: "real@example.com" });
});

test("persistent feedback limits separate accounts, hide IPs and return the real cooldown", async t => {
  env(t, { DATABASE_URL: "configured" });
  const buckets = new Map(); let denyGlobal = false;
  const consume = service({
    $queryRaw: async (sql, key) => {
      assert(sql.join("").includes('ON CONFLICT ("key") DO UPDATE'));
      assert(!key.includes("192.0.2.1")); assert(!key.includes("tester"));
      const attempts = (buckets.get(key) || 0) + 1; buckets.set(key, attempts);
      return [{ attempts: denyGlobal && key === "feedback:global" ? 101 : attempts, resetsAt: new Date(Date.now() + 45000) }];
    }, authRateLimit: { deleteMany: async () => {} },
  }).consumeFeedbackAttempt;
  const headers = new Headers({ "x-forwarded-for": "192.0.2.1" });
  for (let index = 0; index < 5; index++) assert.equal(await consume(headers, "tester"), 0);
  assert.equal(await consume(headers, "tester"), 45);
  assert.equal(await consume(headers, "another-account"), 0);
  denyGlobal = true; assert.equal(await consume(headers, "third-account"), 45);
});

test("log-only mode throttles without a database, expires windows, and bounds anonymous global traffic", async t => {
  env(t, { DATABASE_URL: undefined });
  const consume = service().consumeFeedbackAttempt;
  for (let index = 0; index < 5; index++) assert.equal(await consume(new Headers()), 0);
  assert((await consume(new Headers())) > 0);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  t.mock.timers.tick(601000);
  // Expired per-client and global windows allow another five reports.
  for (let index = 0; index < 5; index++) assert.equal(await consume(new Headers()), 0);
  for (let index = 0; index < 95; index++) assert.equal(await consume(new Headers(), `account-${index}`), 0);
  assert((await consume(new Headers(), "over-global-limit")) > 0);
});

test("email forwarding formats reports and missing configuration/provider failures retain a structured record", async t => {
  const reports = [];
  t.mock.method(console, "info", (tag, line) => { assert.equal(tag, "[beta-feedback]"); reports.push(JSON.parse(line)); });
  t.mock.method(console, "warn", () => {});
  env(t, { RESEND_API_KEY: undefined, EMAIL_FROM: undefined, FEEDBACK_EMAIL_TO: undefined });
  const deliver = service().deliverFeedback;
  const malicious = { ...valid, message: 'A useful report\n[forged-log] {"secret":true}' };
  const id = await deliver(malicious, null);
  assert.equal(reports[0].id, id); assert.equal(reports[0].message, malicious.message);
  process.env.RESEND_API_KEY = "test-only"; process.env.EMAIL_FROM = "Feedback <feedback@example.com>";
  await deliver(valid, null); assert.equal(reports.length, 2); // A sender is not a recipient.
  process.env.FEEDBACK_EMAIL_TO = "team@example.com";
  const identity = { userId: "tester", email: "tester@example.com" };
  t.mock.method(global, "fetch", async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    const body = JSON.parse(options.body);
    assert.deepEqual(body.to, ["team@example.com"]); assert.equal(body.subject, "[Beta feedback] Bug");
    assert(body.text.includes(valid.pathname)); assert(body.text.includes(identity.email));
    assert(!("html" in body)); assert(options.signal instanceof AbortSignal);
    return Response.json({ id: "email-id" });
  });
  await deliver(valid, identity); assert.equal(reports.length, 2);
  t.mock.method(global, "fetch", async () => Response.json({ error: "provider secret" }, { status: 500 }));
  await deliver(valid, identity); assert.equal(reports.length, 3);
  t.mock.method(global, "fetch", async () => { throw Error("timeout"); });
  await deliver(valid, identity); assert.equal(reports.length, 4);
});
