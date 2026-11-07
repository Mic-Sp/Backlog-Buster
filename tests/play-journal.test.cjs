/* eslint-disable @typescript-eslint/no-require-imports -- Exercise actual transitions, validation and backup persistence offline. */
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, form, game } = require('./helpers/activity-fixture.cjs');
const { loadCatalogModule } = require('../scripts/catalog-seed.cjs');
const journal = loadCatalogModule('src/lib/play-journal.ts');
const date = journal.parseJournalDate;
const edit = extra => form({ id: 1, status: 'Playing', lengthHours: 10, difficulty: 1, ...extra });
const day = value => value?.toISOString().slice(0, 10) ?? null;

test('interactive starts/completions stamp missing dates once; all status entry points share the rule', async () => {
  for (const action of ['startGame', 'acceptQuest', 'updateGame']) {
    const f = fixture(), today = new Date().toISOString().slice(0, 10);
    const result = await (action === 'acceptQuest' ? f.actions.acceptQuest(1) : f.actions[action](edit({})));
    assert(!result.error, result.error); assert.equal(day(f.games[0].startedAt), today);
    await f.actions.completeGame(edit({ rating: 5 }));
    assert.equal(day(f.games[0].completedAt), today);
    const before = structuredClone(f.games[0]);
    await f.actions.completeGame(edit({ rating: 5 }));
    assert.deepEqual(f.games[0], before);
  }
});

test('creation as Playing/Completed stamps only the relevant date and accepts backdated history', async () => {
  for (const status of ['Backlog', 'Playing', 'Completed']) {
    const f = fixture({ games: [] });
    const result = await f.actions.createGame(form({ title: 'Created game', platform: 'PC', lengthHours: 10, difficulty: 1, status }));
    assert(!result.error, result.error);
    assert.equal(Boolean(f.games[0].startedAt), status === 'Playing');
    assert.equal(Boolean(f.games[0].completedAt), status === 'Completed');
  }
  const f = fixture({ games: [] });
  await f.actions.createGame(form({ title: 'Historical', platform: 'PC', lengthHours: 10, difficulty: 1, status: 'Completed', startedAt: '2020-02-01', completedAt: '2020-03-01' }));
  assert.equal(day(f.games[0].startedAt), '2020-02-01'); assert.equal(day(f.games[0].completedAt), '2020-03-01');
});

test('backdating, clearing and partial date edits persist without emitting activity or changing XP/status', async () => {
  const f = fixture({ games: [game(1, { status: 'Completed', earnedXp: 100 })] });
  await f.actions.updateGame(edit({ status: 'Completed', startedAt: '2020-02-29', completedAt: '2020-03-01' }));
  assert.equal(day(f.games[0].startedAt), '2020-02-29'); assert.equal(day(f.games[0].completedAt), '2020-03-01');
  assert.equal(f.events.length, 0); assert.equal(f.games[0].activityRevision, 0); assert.equal(f.games[0].earnedXp, 100);
  const result = await f.actions.updateGame(edit({ status: 'Completed', completedAt: '2020-02-28' }));
  assert.match(result.error, /earlier than the start date/); assert.equal(day(f.games[0].completedAt), '2020-03-01');
  await f.actions.updateGame(edit({ status: 'Completed', startedAt: '', completedAt: '' }));
  assert.equal(f.games[0].startedAt, null); assert.equal(f.games[0].completedAt, null);
  await f.actions.updateGame(edit({ status: 'Completed', notes: 'New note' }));
  assert.equal(f.games[0].completedAt, null, 'ordinary edits must not refill deliberately cleared or unknown dates');
});

test('returning to Backlog, replaying and flatlining retain dates; explicit clears override automatic stamping', async () => {
  const f = fixture({ games: [game(1, { status: 'Completed', startedAt: date('2020-01-01'), completedAt: date('2020-02-01') })] });
  for (const status of ['Backlog', 'Playing', 'Flatlined', 'Completed']) {
    const result = await f.actions.updateGame(edit({ status })); assert(!result.error, result.error);
    assert.equal(day(f.games[0].startedAt), '2020-01-01'); assert.equal(day(f.games[0].completedAt), '2020-02-01');
  }
  const clear = fixture(); await clear.actions.startGame(edit({ startedAt: '' })); assert.equal(clear.games[0].startedAt, null);
  await clear.actions.completeGame(edit({ completedAt: '' })); assert.equal(clear.games[0].completedAt, null);
});

test('unchanged editor fields allow automatic stamps and preserve fresher stored history', async () => {
  const f = fixture();
  await f.actions.startGame(edit({ startedAt: '', startedAtOriginal: '', completedAt: '', completedAtOriginal: '' }));
  assert(f.games[0].startedAt instanceof Date);
  const parsed = journal.readPlayJournalFields(form({ startedAt: '2020-01-01', startedAtOriginal: '2020-01-01', completedAt: '', completedAtOriginal: '' }));
  assert.deepEqual(parsed, {});
  assert.equal(day(journal.resolvePlayJournal({ status: 'Playing', startedAt: date('2019-01-01') }, 'Playing', parsed).startedAt), '2019-01-01');
});

test('strict dates reject rollovers, ambiguous strings, bad timestamps and inverted ranges before writes', async () => {
  for (const value of ['2025-02-29', '2020-02-30', '2020-13-01', '2020-00-10', '0000-01-01', '02/03/2020', 'today', 123, {}, '2020-01-01T00:00:00Z']) assert.throws(() => date(value));
  for (const value of ['2020-02-30T00:00:00Z', '2020-01-01T25:00:00Z', new Date('bad')]) assert.throws(() => journal.importJournalDate(value));
  assert.equal(day(journal.importJournalDate('2020-02-29T23:59:59.999Z')), '2020-02-29');
  const f = fixture();
  assert((await f.actions.updateGame(edit({ startedAt: '2020-03-01', completedAt: '2020-02-01' }))).error);
  assert.equal(f.games[0].status, 'Backlog'); assert.equal(f.games[0].startedAt, null);
});

test('foreign/revoked writes and failed activity transactions cannot persist journal dates', async () => {
  const foreign = fixture({ games: [game(1, { userId: 'other' })] });
  assert((await foreign.actions.startGame(edit({}))).error); assert.equal(foreign.games[0].startedAt, null);
  const revoked = fixture(); revoked.revoke(); assert((await revoked.actions.startGame(edit({}))).error);
  const rollback = fixture(); rollback.failEvents(); assert((await rollback.actions.startGame(edit({}))).error);
  assert.equal(rollback.games[0].startedAt, null); assert.equal(rollback.games[0].status, 'Backlog');
});

test('JSON and CSV backups round-trip calendar dates and preserve unknown legacy dates without stamping', () => {
  const { sanitizeImportedGame, parseBackupRecords } = loadCatalogModule('src/lib/library-import.ts');
  const { serializeLibraryBackup } = loadCatalogModule('src/lib/library-backup.ts');
  const record = sanitizeImportedGame({ title: 'Historical', status: 'Completed', startedAt: '2020-01-01', completedAt: '2020-02-29' });
  for (const format of ['json', 'csv']) {
    const restored = sanitizeImportedGame(parseBackupRecords(serializeLibraryBackup([record], format), format)[0]);
    assert.equal(day(restored.startedAt), '2020-01-01'); assert.equal(day(restored.completedAt), '2020-02-29');
    const unknown = sanitizeImportedGame(parseBackupRecords(serializeLibraryBackup([{ ...record, startedAt: null, completedAt: null }], format), format)[0]);
    assert.equal(unknown.startedAt, null); assert.equal(unknown.completedAt, null);
  }
  assert.equal(sanitizeImportedGame({ title: 'Legacy', status: 'Completed' }).completedAt, null);
  assert.throws(() => sanitizeImportedGame({ title: 'Bad', startedAt: '2020-02-01', completedAt: '2020-01-01' }));
});

test('backup and Steam bulk paths never manufacture journal dates or overwrite existing history', async () => {
  const imported = fixture({ games: [] });
  await imported.actions.bulkImportGames({ mode: 'json', content: JSON.stringify([{ title: 'Legacy clear', status: 'Completed' }, { title: 'Legacy active', status: 'Playing' }]) });
  assert(imported.games.every(game => game.startedAt === null && game.completedAt === null));
  const active = imported.games.find(game => game.status === 'Playing');
  await imported.actions.updateGame(edit({ id: active.id, status: 'Playing', genre: 'Puzzle' }));
  assert.equal(imported.games.find(game => game.id === active.id).startedAt, null, 'metadata edits do not invent a start date for imported active games');
  const steam = fixture({ games: [] });
  await steam.actions.syncSteamLibrary({ identifier: '76561198000000000', updateHoursPlayed: true });
  assert.equal(steam.games[0].startedAt, null); assert.equal(steam.games[0].completedAt, null);
  const existing = fixture({ games: [game(1, { title: 'Steam Game', steamAppId: '1', startedAt: date('2020-01-01'), completedAt: date('2020-02-01'), status: 'Completed' })] });
  await existing.actions.syncSteamLibrary({ identifier: '76561198000000000', updateHoursPlayed: true });
  assert.equal(day(existing.games[0].startedAt), '2020-01-01'); assert.equal(day(existing.games[0].completedAt), '2020-02-01');
});

test('completion sorting is stable in either direction with library-added fallback, and labels never shift dates', () => {
  const games = [
    { id: 1, completedAt: '2020-01-01', createdAt: '2026-01-01' },
    { id: 2, completedAt: null, createdAt: '2022-01-01' },
    { id: 3, completedAt: '2024-01-01', createdAt: '2019-01-01' },
    { id: 4, completedAt: '2024-01-01', createdAt: '2018-01-01' },
  ];
  assert.deepEqual([...games].sort((a,b) => journal.compareCompletionDates(a,b)).map(game => game.id), [3,4,2,1]);
  assert.deepEqual([...games].reverse().sort((a,b) => journal.compareCompletionDates(a,b,'asc')).map(game => game.id), [1,2,3,4]);
  assert.equal(journal.journalDateLabel('2020-02-29'), 'Feb 29, 2020');
});

test('authenticated vault export and restore preserve actual persisted dates in JSON and CSV', async () => {
  const source = fixture({ games: [game(1, { status: 'Completed', startedAt: date('2019-05-06'), completedAt: date('2019-06-07') })] });
  for (const format of ['json', 'csv']) {
    const exported = await source.load('src/lib/library-vault.ts').getLibraryExport(format);
    assert(exported.content.includes('2019-05-06')); assert(exported.content.includes('2019-06-07'));
    const restored = fixture({ games: [] });
    const result = await restored.actions.bulkImportGames({ mode: format, content: exported.content });
    assert(!result.error, result.error); assert.equal(result.importedCount, 1);
    assert.equal(day(restored.games[0].startedAt), '2019-05-06'); assert.equal(day(restored.games[0].completedAt), '2019-06-07');
  }
});
