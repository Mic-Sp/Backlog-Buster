/* eslint-disable @typescript-eslint/no-require-imports -- Explicit one-time metadata repair. */
const { loadCatalogModule } = require("./catalog-seed.cjs");

async function main() {
  require("dotenv").config({ quiet: true });
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--apply")) throw Error("Use --apply to persist repairs; omit it to preview.");
  const { neonConfig } = require("@neondatabase/serverless");
  const { PrismaNeon } = require("@prisma/adapter-neon");
  const { PrismaClient } = require("../src/generated/prisma/client.ts");
  neonConfig.webSocketConstructor = require("ws");
  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
  try {
    console.log(JSON.stringify(await loadCatalogModule("src/lib/library-release-repair.ts", prisma).repairLibraryReleaseYears(args.includes("--apply")), null, 2));
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch(() => {
  console.error("Library metadata repair failed. Check database/provider configuration; committed repairs are safe to retry.");
  process.exitCode = 1;
});
