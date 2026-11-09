/* eslint-disable @typescript-eslint/no-require-imports -- Explicit one-time data rollout. */
const rolloutId = 'email-verification-grandfather-v1';

async function backfillEmailVerification(prisma) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('backlogbuster-account-registration', 0))`;
    // Serialize with every writer, including older running app instances.
    await tx.$executeRaw`LOCK TABLE "Player" IN SHARE ROW EXCLUSIVE MODE`;
    if (await tx.authRollout.findUnique({ where: { id: rolloutId } })) return { status: 'already-completed', backfilled: 0 };
    // Do not update updatedAt, passwords, emails, roles, library data or sessions.
    const backfilled = await tx.$executeRaw`
      UPDATE "Player" SET "emailVerifiedAt" = COALESCE("createdAt", NOW())
      WHERE "email" IS NOT NULL AND "emailVerifiedAt" IS NULL
    `;
    await tx.authRollout.create({ data: { id: rolloutId } });
    return { status: 'completed', backfilled };
  }, { timeout: 30000 });
}

async function main() {
  require('dotenv/config');
  const { neonConfig } = require('@neondatabase/serverless');
  neonConfig.webSocketConstructor = require('ws');
  const { PrismaNeon } = require('@prisma/adapter-neon');
  const { PrismaClient } = require('../src/generated/prisma/client.ts');
  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
  try { console.log(JSON.stringify(await backfillEmailVerification(prisma))); }
  finally { await prisma.$disconnect(); }
}

module.exports = { backfillEmailVerification };
if (require.main === module) main().catch(() => {
  console.error('Email verification backfill failed. No partial backfill was committed; check connectivity and apply the Prisma schema first.');
  process.exitCode = 1;
});
