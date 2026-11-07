/* eslint-disable @typescript-eslint/no-require-imports -- Test real mutation, payload and backup boundaries offline. */
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, form, game } = require('./helpers/activity-fixture.cjs');
const { loadCatalogModule } = require('../scripts/catalog-seed.cjs');
const { normalizeMicroReview, readMicroReviewFields, dossierReviewQuote } = loadCatalogModule('src/lib/micro-review.ts');
const edit = extra => form({ id: 1, status: 'Completed', lengthHours: 10, difficulty: 1, ...extra });

test('micro-reviews normalize plain text and controls, enforce 280 characters, and clear to null', () => {
  assert.equal(normalizeMicroReview(' \0 Great\n\t ending! \u007f '), 'Great ending!');
  assert.equal(normalizeMicroReview('x'.repeat(280)), 'x'.repeat(280));
  for (const value of ['x'.repeat(281), 123, {}, new Blob(['x'])]) assert.throws(() => normalizeMicroReview(value));
  assert.equal(normalizeMicroReview(' \n\t '), null);
  assert.deepEqual(readMicroReviewFields(form({})), {});
  assert.deepEqual(readMicroReviewFields(form({ review: 'Hello', reviewSpoiler: 'true' })), { review: 'Hello', reviewSpoiler: true });
  assert.deepEqual(readMicroReviewFields(form({ review: 'Hello' })), { review: 'Hello', reviewSpoiler: false });
  assert.deepEqual(readMicroReviewFields(form({ review: ' ', reviewSpoiler: 'true' })), { review: null, reviewSpoiler: false });
  assert.throws(() => readMicroReviewFields(form({ reviewSpoiler: 'yes' })));
});

test('completions and ratings atomically persist a review without disclosing private notes', async () => {
  const f = fixture({ games: [game(1, { status: 'Playing' })] });
  const result = await f.actions.completeGame(edit({ review: ' A memorable\n finale. ', reviewSpoiler: 'true', rating: 5 }));
  assert(!result.error, result.error);
  assert.equal(f.games[0].review, 'A memorable finale.'); assert.equal(f.games[0].reviewSpoiler, true);
  assert.equal(f.games[0].notes, 'PRIVATE_NOTES');
  assert.deepEqual(f.events.map(event => event.type), ['game_completed', 'rating_logged']);
  for (const event of f.events) {
    assert.equal(event.metadata.review, 'A memorable finale.'); assert.equal(event.metadata.reviewSpoiler, true);
    assert(!JSON.stringify(event).includes('PRIVATE_NOTES'));
  }
  await f.actions.completeGame(edit({ review: 'A memorable finale.', reviewSpoiler: 'true', rating: 5 }));
  assert.equal(f.events.length, 2);
});

test('review edits and spoiler toggles emit new snapshots; clears, metadata-only and no-op edits preserve intent', async () => {
  const f = fixture({ games: [game(1, { status: 'Completed', rating: 4 })] });
  await f.actions.updateGame(edit({ review: 'Great exploration', rating: 4 }));
  assert.equal(f.events.length, 1); assert.equal(f.events[0].metadata.reviewSpoiler, false);
  await f.actions.updateGame(edit({ review: 'Great exploration', reviewSpoiler: 'true', rating: 4 }));
  assert.equal(f.events.length, 2); assert.equal(f.events[1].metadata.reviewSpoiler, true);
  assert.equal(f.events[0].metadata.reviewSpoiler, false, 'old rows remain immutable');
  await f.actions.updateGame(edit({ title: 'Changed title', rating: 4 }));
  assert.equal(f.games[0].review, 'Great exploration'); assert.equal(f.games[0].reviewSpoiler, true);
  assert.equal(f.events.length, 2);
  await f.actions.updateGame(edit({ review: '', reviewSpoiler: 'true', rating: 4 }));
  assert.equal(f.games[0].review, null); assert.equal(f.games[0].reviewSpoiler, false); assert.equal(f.events.length, 2);
});

test('invalid, foreign, revoked and failed-event writes cannot persist micro-reviews', async () => {
  const invalid = fixture();
  assert((await invalid.actions.updateGame(edit({ review: 'x'.repeat(281) }))).error);
  assert.equal(invalid.games[0].review, null); assert.equal(invalid.events.length, 0);
  const foreign = fixture({ games: [game(1, { userId: 'other' })] });
  assert((await foreign.actions.updateGame(edit({ review: 'forged' }))).error); assert.equal(foreign.games[0].review, null);
  invalid.revoke(); assert((await invalid.actions.updateGame(edit({ review: 'forged' }))).error);
  const rollback = fixture(); rollback.failEvents();
  assert((await rollback.actions.completeGame(edit({ review: 'Must roll back' }))).error);
  assert.equal(rollback.games[0].review, null); assert.equal(rollback.games[0].activityRevision, 0);
});

test('activity snippets are bounded and allowlisted with fail-closed spoiler flags and no review on starts/imports', () => {
  const { safeActivityPayload } = fixture().writer;
  const source = { title: 'Game', platform: 'PC', rating: 5, review: '<script>alert(1)</script>', reviewSpoiler: false, notes: 'PRIVATE', email: 'PRIVATE' };
  const safe = safeActivityPayload('rating_logged', source);
  assert.deepEqual(safe.metadata, { title: 'Game', platform: 'PC', rating: 5, review: source.review, reviewSpoiler: false });
  for (const flag of [undefined, null, 'false', 0, true]) assert.equal(safeActivityPayload('game_completed', { ...source, reviewSpoiler: flag }).metadata.reviewSpoiler, true);
  for (const review of ['x'.repeat(281), {}, 123]) assert.equal(safeActivityPayload('game_completed', { ...source, review }).metadata.review, undefined);
  assert.equal(safeActivityPayload('game_started', source).metadata.review, undefined);
  assert.equal(safeActivityPayload('library_imported', { ...source, source: 'backup', importedCount: 1 }).metadata.review, undefined);
});

test('backups round-trip reviews and flags without promoting legacy private notes to reviews', () => {
  const { sanitizeImportedGame, parseBackupRecords } = loadCatalogModule('src/lib/library-import.ts');
  const { serializeLibraryBackup } = loadCatalogModule('src/lib/library-backup.ts');
  const record = sanitizeImportedGame({ title: 'Quest', notes: 'PRIVATE', review: 'A great journey', reviewSpoiler: true });
  for (const format of ['json', 'csv']) {
    const restored = sanitizeImportedGame(parseBackupRecords(serializeLibraryBackup([record], format), format)[0]);
    assert.equal(restored.review, record.review); assert.equal(restored.reviewSpoiler, true); assert.equal(restored.notes, 'PRIVATE');
  }
  assert.equal(sanitizeImportedGame({ title: 'Legacy', notes: 'PRIVATE' }).review, null);
  assert.throws(() => sanitizeImportedGame({ title: 'Invalid', review: 'x'.repeat(281) }));
});

test('dossier quotes are bounded, omit spoiler text and handle public placeholders without source text', () => {
  assert.equal(dossierReviewQuote({ review: 'SECRET ENDING', reviewSpoiler: true }), 'SPOILER REVIEW · HIDDEN');
  assert.equal(dossierReviewQuote({ review: null, reviewSpoiler: true }), 'SPOILER REVIEW · HIDDEN');
  assert.equal(dossierReviewQuote({ review: 'SECRET ENDING' }), 'SPOILER REVIEW · HIDDEN');
  assert.equal(dossierReviewQuote({ review: 'Wonderful', reviewSpoiler: false }), '“Wonderful”');
  assert(dossierReviewQuote({ review: 'x'.repeat(280), reviewSpoiler: false }).length < 50);
});
