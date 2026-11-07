/* eslint-disable @typescript-eslint/no-require-imports -- Offline server/database fixture. */
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../..");
function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.join(root, file), instance = new Module(filename, module);
    instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = name => name === "server-only" ? {} : Object.hasOwn(mocks, name) ? mocks[name]
      : name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`) : original(name);
    instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText, filename);
    cache.set(file, instance.exports); return instance.exports;
  }
  return load;
}
const player = (id, overrides = {}) => ({ id, email: `${id}@example.test`, passwordHash: "SECRET_HASH",
  handle: `${id}-handle`, operatorName: `${id} Callsign`, avatarUrl: null, profileVisibility: "public",
  tagline: "One more gig.", neonAccent: "CYAN", featuredTrophyIds: [], games: [], userAchievements: [], ...overrides });
function patternRegex(pattern, contains = false) {
  let expression = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "\\" && i + 1 < pattern.length) expression += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (char === "%") expression += ".*";
    else if (char === "_") expression += ".";
    else expression += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(contains ? expression : `^${expression}$`, "i");
}
function scalar(value, filter) {
  if (filter instanceof Date) return value instanceof Date && value.getTime() === filter.getTime();
  if (filter === null || typeof filter !== "object") return value === filter;
  for (const [key, compare] of Object.entries(filter)) {
    if (key === "gte" && !(value >= compare)) return false;
    if (key === "lt" && !(value < compare)) return false;
  }
  if (Object.hasOwn(filter, "not") && scalar(value, filter.not)) return false;
  if (filter.in && !filter.in.includes(value)) return false;
  if (Object.hasOwn(filter, "equals") && !(filter.mode === "insensitive" ? typeof value === "string" && patternRegex(filter.equals).test(value) : value === filter.equals)) return false;
  if (Object.hasOwn(filter, "contains") && !(typeof value === "string" && patternRegex(filter.contains, true).test(value))) return false;
  return true;
}
function projection(row, select) {
  if (!row) return null;
  if (!select) return structuredClone(row);
  return Object.fromEntries(Object.entries(select).filter(([, value]) => value).map(([field, value]) => [field,
    value === true ? structuredClone(row[field]) : Array.isArray(row[field]) ? row[field].filter(entry => !value.where || Object.entries(value.where).every(([key, filter]) => scalar(entry[key], filter))).map(entry => projection(entry, value.select)) : projection(row[field], value.select)]));
}
function fixture(initial = [player("alice"), player("bob"), player("carol"), player("default-player", { email: null, passwordHash: null })]) {
  let players = structuredClone(initial), rows = [], sequence = Promise.resolve(), failWrite = false, lockHook;
  const queries = [], writes = [], locks = [], revalidations = [], revoked = new Set();
  function matches(row, where = {}) {
    return Object.entries(where).every(([key, filter]) => {
      if (key === "AND") return (Array.isArray(filter) ? filter : [filter]).every(part => matches(row, part));
      if (key === "OR") return filter.some(part => matches(row, part));
      if (key === "NOT") return !(Array.isArray(filter) ? filter : [filter]).some(part => matches(row, part));
      if (key === "actor") { const actor = players.find(player => player.id === row.actorId); return Boolean(actor && matches(actor, filter)); }
      if (["player", "playerLow", "playerHigh"].includes(key)) { const person = players.find(player => player.id === row[key === "player" ? "userId" : `${key}Id`]); return Boolean(person && matches(person, filter)); }
      if (key === "friendshipsLow" || key === "friendshipsHigh") {
        const related = rows.filter(pair => pair[key === "friendshipsLow" ? "playerLowId" : "playerHighId"] === row.id);
        return (!filter.some || related.some(pair => matches(pair, filter.some))) && (!filter.none || !related.some(pair => matches(pair, filter.none)));
      }
      return scalar(row[key], filter);
    });
  }
  const pairKey = args => args.where.playerLowId_playerHighId;
  const findPair = pair => rows.find(row => row.playerLowId === pair.playerLowId && row.playerHighId === pair.playerHighId);
  const table = {
    findMany: async args => { queries.push(["players", args]); return players.filter(row => matches(row, args.where))
      .sort((a, b) => (a.handle === null ? b.handle === null ? 0 : 1 : b.handle === null ? -1 : a.handle.localeCompare(b.handle)) || a.id.localeCompare(b.id)).slice(0, args.take ?? Infinity).map(row => projection(row, args.select)); },
    findFirst: async args => { queries.push(["profile", args]); return projection(players.find(row => matches(row, args.where)), args.select); },
    findUniqueOrThrow: async args => { const row = players.find(row => matches(row, args.where)); if (!row) throw Error("Player missing"); return projection(row, args.select); },
    update: async args => { const row = players.find(row => matches(row, args.where)); if (!row) throw Error("Player not found");
      if (failWrite) throw Error("DATABASE_SECRET"); Object.assign(row, args.data); writes.push(["player", args]); return projection(row, args.select); },
  };
  const friendship = {
    findMany: async args => { queries.push(["relationships", args]); return rows.filter(row => matches(row, args.where)).slice(0, args.take ?? Infinity).map(row => projection({ ...row, playerLow: players.find(player => player.id === row.playerLowId), playerHigh: players.find(player => player.id === row.playerHighId) }, args.select)); },
    findUnique: async args => { queries.push(["pair", args]); return structuredClone(findPair(pairKey(args)) ?? null); },
    create: async args => {
      if (failWrite) throw Error("DATABASE_SECRET");
      assert(args.data.playerLowId < args.data.playerHighId);
      assert(!findPair(args.data), "Pair primary key must remain unique");
      const row = { ...args.data, createdAt: new Date(), updatedAt: new Date() };
      rows.push(row); writes.push(["create", args]); return structuredClone(row);
    },
    update: async args => { if (failWrite) throw Error("DATABASE_SECRET"); const row = findPair(pairKey(args)); assert(row);
      Object.assign(row, args.data); writes.push(["update", args]); return structuredClone(row); },
    delete: async args => { if (failWrite) throw Error("DATABASE_SECRET"); const row = findPair(pairKey(args)); assert(row);
      rows = rows.filter(other => other !== row); writes.push(["delete", args]); return row; },
  };
  const tx = { player: table, friendship, $executeRaw: async (sql, ...values) => {
    assert.match(sql.join(""), /pg_advisory_xact_lock/); locks.push(values[0]); if (lockHook) await lockHook(); return 1;
  } };
  const prisma = { player: table, friendship, game: { findMany: async args => { queries.push(["trophies", args]); return []; } },
    $transaction: work => {
      const run = sequence.then(async () => { const before = structuredClone(rows);
        try { return await work(tx); } catch (error) { rows = before; throw error; } });
      sequence = run.catch(() => {}); return run;
    },
  };
  class AuthenticationRequiredError extends Error { constructor() { super("Sign in"); this.name = "AuthenticationRequiredError"; } }
  function as(id) {
    const authenticate = async () => {
      const row = players.find(row => row.id === id);
      if (!row?.email || !row.passwordHash || revoked.has(id)) throw new AuthenticationRequiredError();
      return id;
    };
    const load = loader({ "@/lib/prisma": { prisma }, "@/lib/player": { AuthenticationRequiredError, getAuthenticatedPlayerId: authenticate,
      getOptionalAuthenticatedPlayerId: async () => { try { return await authenticate(); } catch { return null; } } },
      "next/cache": { revalidatePath: (...args) => revalidations.push(args) },
    });
    return { actions: load("src/app/friendship-actions.ts"), library: load("src/lib/friendships.ts"), load };
  }
  return { as, prisma, matches, queries, writes, locks, revalidations, get rows() { return rows; }, get players() { return players; },
    revoke: id => revoked.add(id), failWrites: () => { failWrite = true; }, onLock: hook => { lockHook = hook; },
    setRelationship: row => { rows = row ? [row] : []; },
  };
}
module.exports = { fixture, loader, player };
