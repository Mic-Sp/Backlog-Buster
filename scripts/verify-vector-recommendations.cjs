/* eslint-disable @typescript-eslint/no-require-imports -- Explicit, read-only live database verification. */
const assert = require("node:assert/strict");
const { loadCatalogModule } = require("./catalog-seed.cjs");

async function verifyVectorRecommendations(prisma) {
  const { CATALOG_VECTOR_VERSION } = loadCatalogModule("src/lib/catalog-vector.ts", prisma);
  const { buildPlayerTasteProfile, parseTasteVector } = loadCatalogModule("src/lib/player-taste.ts", prisma);
  const { isReleasedYear } = loadCatalogModule("src/lib/game-release.ts", prisma);
  const { normalizeGameTitle } = loadCatalogModule("src/lib/game-title.ts", prisma);
  const { retrieveCosineCandidates, recommendCatalogGames } = loadCatalogModule("src/lib/vector-recommendations.ts", prisma);
  const currentYear = new Date().getFullYear();
  const rows = await prisma.$queryRaw`
    SELECT "key", "title", "releaseYear", "genre", "genres", "seriesHints", "estimatedHours", "featureVectorVersion",
      "featureVector"::text AS "vectorText"
    FROM "GameCatalog" WHERE "featureVector" IS NOT NULL AND "featureVectorVersion" = ${CATALOG_VECTOR_VERSION}
    ORDER BY "key"
  `;
  const eligible = rows.filter(row => isReleasedYear(row.releaseYear, currentYear) && parseTasteVector(row.vectorText));
  assert(eligible.length >= 4, "Live verification needs at least four released, embedded catalog records.");
  assert(eligible.length <= 1000, "Increase the verification query limit before testing a larger catalog.");
  const favorite = { id: 1, title: eligible[0].title, releaseYear: eligible[0].releaseYear, status: "Completed", rating: 5,
    platform: "PC", franchise: null, earnedXp: 100, pinnedOrder: null };
  const profile = buildPlayerTasteProfile([favorite], rows);
  assert.equal(profile.source, "completed-favorites");
  const raw = await retrieveCosineCandidates(profile.values, [], { limit: 1000, currentYear });
  assert.equal(raw.length, eligible.length);
  const reference = new Map(eligible.map(row => {
    const values = parseTasteVector(row.vectorText);
    return [row.key, 1 - values.reduce((sum, value, index) => sum + value * profile.values[index], 0)];
  }));
  for (let index = 0; index < raw.length; index++) {
    assert(Math.abs(raw[index].distance - reference.get(raw[index].key)) < 0.000001, "Database cosine distance must agree with the JS reference.");
    if (index) assert(raw[index].distance >= raw[index - 1].distance, "SQL must return ascending cosine distance.");
  }
  assert(Math.abs(raw[0].distance) < 0.000001);
  // Synthetic library fixtures exercise real DB queries without modifying any player/game rows.
  const disliked = { ...favorite, id: 2, title: eligible[1].title, releaseYear: eligible[1].releaseYear, rating: 1 };
  const seen = eligible[2].title;
  const ranked = await recommendCatalogGames([favorite, disliked], [seen], { currentYear, limit: 5 });
  assert.equal(ranked.tasteSource, "completed-favorites"); assert.equal(ranked.anchorCount, 1);
  assert(ranked.recommendations.length > 0);
  const excluded = new Set([favorite.title, disliked.title, seen].map(normalizeGameTitle));
  const unique = new Set();
  for (const [index, pick] of ranked.recommendations.entries()) {
    const title = normalizeGameTitle(pick.title);
    assert(!excluded.has(title)); assert(!unique.has(title)); unique.add(title);
    assert(isReleasedYear(pick.releaseYear, currentYear)); assert(pick.reason.length > 0);
    assert(pick.score >= 0 && pick.score <= 1.000001);
    if (index) assert(ranked.recommendations[index - 1].score >= pick.score);
  }
  const cold = await recommendCatalogGames([], [], { currentYear });
  const active = await recommendCatalogGames([{ ...favorite, status: "Playing", rating: null }], [], { currentYear });
  const pinned = await recommendCatalogGames([{ ...favorite, status: "Backlog", rating: null, pinnedOrder: 1 }], [], { currentYear });
  assert.equal(cold.tasteSource, "cold-start"); assert.equal(cold.anchorCount, 0);
  assert.equal(active.tasteSource, "active-pinned"); assert.equal(pinned.tasteSource, "active-pinned");
  const diagnosed = await recommendCatalogGames([favorite], [], { currentYear, collectDiagnostics: true });
  assert(diagnosed.diagnostics.queryLatencyMs >= 0);
  assert(diagnosed.diagnostics.coverage.total >= rows.length);
  assert.equal(diagnosed.diagnostics.coverage.current, rows.length);
  assert.equal(diagnosed.diagnostics.coverage.released, eligible.length);
  const { getExternalRecommendations } = loadCatalogModule("src/lib/recommendations.ts", prisma);
  const { createScoutDebug } = loadCatalogModule("src/lib/scout-debug.ts", prisma);
  const debug = createScoutDebug();
  // A nonexistent synthetic player has an empty library. No auth/session or user rows are created.
  const emptyPlayer = `catalog-verification-${require("node:crypto").randomUUID()}`;
  const scoutPicks = await getExternalRecommendations(emptyPlayer, [], debug);
  assert.equal(scoutPicks.length, 3); assert.equal(debug.engineSource, "vector");
  assert.equal(debug.liveCallAttempted, false); assert.equal(debug.vector.picks.length, 3);
  assert.equal(debug.vector.coverage.current, rows.length);
  const cardFields = ["title", "platform", "genre", "releaseYear", "coverUrl", "lengthHours", "difficulty", "reason"].sort();
  for (const pick of scoutPicks) assert.deepEqual(Object.keys(pick).sort(), cardFields);
  return { embeddedCatalogRows: rows.length, releasedRowsChecked: raw.length, cosineDistancesVerified: raw.length,
    recommendationsChecked: ranked.recommendations.length, coldStartChecked: true, activeFallbackChecked: true, pinnedFallbackChecked: true,
    adminCoverageChecked: true, liveScoutVectorPicks: scoutPicks.length, providerCallsAttempted: debug.liveCallAttempted };
}

async function main() {
  require("dotenv/config");
  const { PrismaNeon } = require("@prisma/adapter-neon");
  const { neonConfig } = require("@neondatabase/serverless");
  const { PrismaClient } = require("../src/generated/prisma/client.ts");
  neonConfig.webSocketConstructor = require("ws");
  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
  try { console.log(JSON.stringify(await verifyVectorRecommendations(prisma))); }
  finally { await prisma.$disconnect(); }
}
module.exports = { verifyVectorRecommendations };
if (require.main === module) main().catch(() => {
  // Database errors may include connection credentials. Keep operator output bounded and sanitized.
  console.error("Vector retrieval verification failed. Check database connectivity, catalog coverage and the 3.1a vector deployment.");
  process.exitCode = 1;
});
