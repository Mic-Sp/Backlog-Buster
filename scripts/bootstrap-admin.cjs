/* eslint-disable @typescript-eslint/no-require-imports -- Explicit operator-only Node command. */
const bootstrapId = "initial-admin-v1";

// Never imported by login, profile updates, or request authorization. An immutable
// existing player ID is the only accepted identifier; no email/handle fallback.
async function bootstrapAdmin(prisma, playerId) {
  return prisma.$transaction(async tx => {
    // Serialize concurrent bootstraps and all player changes until commit.
    await tx.$executeRaw`LOCK TABLE "Player" IN SHARE ROW EXCLUSIVE MODE`;
    if (await tx.adminBootstrap.findUnique({ where: { id: bootstrapId } })) {
      return { status: "already-completed" };
    }
    if (await tx.player.findFirst({ where: { isAdmin: true }, select: { id: true } })) {
      await tx.adminBootstrap.create({ data: { id: bootstrapId } });
      return { status: "admin-already-exists" };
    }
    if (typeof playerId !== "string" || !playerId.trim()) {
      throw new Error("Set ADMIN_BOOTSTRAP_PLAYER_ID to an existing account's Player.id.");
    }
    const player = await tx.player.findUnique({
      where: { id: playerId.trim() }, select: { id: true, email: true, passwordHash: true },
    });
    if (!player?.email || !player.passwordHash) {
      throw new Error("Bootstrap requires an existing registered account with email and password credentials.");
    }
    await tx.player.update({ where: { id: player.id }, data: { isAdmin: true }, select: { id: true } });
    await tx.adminBootstrap.create({ data: { id: bootstrapId } });
    return { status: "promoted", playerId: player.id };
  }, { timeout: 15000 });
}

async function main() {
  require("dotenv/config");
  const { neonConfig } = require("@neondatabase/serverless");
  const { PrismaNeon } = require("@prisma/adapter-neon");
  const { PrismaClient } = require("../src/generated/prisma/client.ts");
  neonConfig.webSocketConstructor = require("ws");
  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
  try {
    console.log(JSON.stringify(await bootstrapOwner(prisma, process.env.OWNER_BOOTSTRAP_PLAYER_ID || process.env.ADMIN_BOOTSTRAP_PLAYER_ID)));
  } finally {
    await prisma.$disconnect();
  }
}

// Separate durable latch upgrades an already-bootstrapped admin without reopening
// the legacy admin bootstrap. No request handler invokes either function.
async function bootstrapOwner(prisma, playerId) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`LOCK TABLE "Player" IN SHARE ROW EXCLUSIVE MODE`;
    const id = "initial-owner-v1";
    if (await tx.adminBootstrap.findUnique({ where: { id } })) return { status: "already-completed" };
    if (await tx.player.findFirst({ where: { isOwner: true }, select: { id: true } })) {
      await tx.adminBootstrap.create({ data: { id } });
      return { status: "owner-already-exists" };
    }
    if (typeof playerId !== "string" || !playerId.trim()) throw new Error("Set OWNER_BOOTSTRAP_PLAYER_ID to an existing registered Player.id.");
    const player = await tx.player.findUnique({ where: { id: playerId.trim() }, select: { id: true, email: true, passwordHash: true } });
    if (!player?.email || !player.passwordHash) throw new Error("Owner bootstrap requires an existing registered account.");
    await tx.player.update({ where: { id: player.id }, data: { isAdmin: true, isOwner: true }, select: { id: true } });
    await tx.adminBootstrap.create({ data: { id } });
    return { status: "owner-promoted", playerId: player.id };
  }, { timeout: 15000 });
}

module.exports = { bootstrapAdmin, bootstrapOwner };
if (require.main === module) main().catch(() => {
  console.error("Owner bootstrap failed. Verify database connectivity, owner constraints and OWNER_BOOTSTRAP_PLAYER_ID; no partial promotion was committed.");
  process.exitCode = 1;
});
