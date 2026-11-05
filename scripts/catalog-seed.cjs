/* eslint-disable @typescript-eslint/no-require-imports -- Operator-only Node entry point. */
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const ts = require("typescript");

// Isolated server-module loader: resolves the app's TS alias and server-only marker
// without importing Next request APIs. Never registered as a global require hook.
function loadCatalogModule(file, prisma) {
  const cache = new Map();
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
    const filename = path.resolve(__dirname, "..", relative), instance = new Module(filename, module);
    instance.filename = filename;
    instance.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = instance.require.bind(instance);
    instance.require = name => name === "server-only" ? {} : name === "@/lib/prisma" ? { prisma }
      : name.startsWith("@/") ? load(`src/${name.slice(2)}.ts`) : original(name);
    cache.set(relative, instance.exports);
    instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText, filename);
    cache.set(relative, instance.exports);
    return instance.exports;
  }
  return load(file);
}

async function main() {
  require("dotenv/config");
  const { PrismaNeon } = require("@prisma/adapter-neon");
  const { neonConfig } = require("@neondatabase/serverless");
  const { PrismaClient } = require("../src/generated/prisma/client.ts");
  const args = process.argv.slice(2);
  const options = {};
  let vectorsOnly = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--vectors-only") vectorsOnly = true;
    else if (args[index] === "--limit" && args[index + 1]) options.limit = Number(args[++index]);
    else if (args[index] === "--after" && args[index + 1]) options.after = args[++index];
    else throw new Error("Use --vectors-only, --limit N, or --after CURSOR.");
  }
  neonConfig.webSocketConstructor = require("ws");
  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
  try {
    const result = vectorsOnly
      ? { backfilled: await loadCatalogModule("src/lib/catalog-store.ts", prisma).backfillCatalogVectors() }
      : await loadCatalogModule("src/lib/catalog-seed.ts", prisma).seedRecommendationCatalog(options);
    console.log(JSON.stringify(result));
  } finally { await prisma.$disconnect(); }
}

module.exports = { loadCatalogModule };
if (require.main === module) main().catch(() => {
  // Provider URLs/DB errors may contain credentials. Never print raw exceptions.
  console.error("Catalog seed failed. Check database/schema connectivity, RAWG_API_KEY and command arguments. Committed rows are safe to retry.");
  process.exitCode = 1;
});
