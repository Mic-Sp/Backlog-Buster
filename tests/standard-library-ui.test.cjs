/* eslint-disable @typescript-eslint/no-require-imports -- Render the real Standard grid/drawer with isolated server boundaries. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { loader } = require('./helpers/social-fixture.cjs');
const { standardCopy } = loader()('src/lib/standard-copy.ts');
const Empty = () => null;
function fixture() {
  const games = Array.from({ length: 45 }, (_, i) => ({ id: i + 1, title: `Game ${i + 1}`, status: 'Backlog', platform: 'PC', lengthHours: 12, difficulty: 2, hoursPlayed: 0, releaseYear: 2025, hypeLevel: 2, pinnedOrder: null, playthroughCount: 0, rating: null }));
  const c = { games, visibleGames: games, viewCounts: { All: 45, Backlog: 45, Playing: 0, Completed: 0, Flatlined: 0 }, activeView: 'Backlog', currentYear: 2026,
    platforms: ['PC'], genres: [], sortBy: 'default', searchQuery: '', platformFilter: '', genreFilter: '', ownershipFilter: '', customLists: [], chains: [], social: {}, deck: {},
    canDragToDeck: () => true, isReorderableRow: () => true, openMetadata() {}, actions: {}, getGameDraft: game => ({ status: game.status, lengthHours: '12', hoursPlayed: '0', difficulty: '2', playthroughCount: '0', review: '', reviewSpoiler: 'false', notes: '', rating: '', startedAt: '', completedAt: '' }),
    metadataModalRef: { current: null }, visibleTimelinePositions: new Map(), visibleBacklogPositions: new Map(), visibleBacklogIds: games.map(g => g.id),
  };
  const mocks = {
    '@/components/LayoutText': { useLayoutCopy: () => standardCopy },
    '@/components/games/HypeMeter': { default: () => React.createElement('button', { className: 'hype-meter-button', type: 'button' }, 'Hype'), HypedOnlyFilter: Empty },
    '@/components/SafeForm': { default: ({ action, onSuccess, ...props }) => React.createElement('form', { ...props, action: undefined }), SafeActionButton: ({ formAction, ...props }) => React.createElement('button', props) },
    '@/components/Ownership': { OwnershipFilterControl: Empty }, '@/components/SocialHub': { SocialHubTrigger: Empty }, '@/components/UpNextDeck': { UpNextDeckView: Empty },
    '@/components/LibraryTelemetry': { default: Empty }, '@/components/CustomLists': { default: Empty }, '@/components/SagaChains': { default: Empty }, '@/components/StandardNavigation': { openStandardAddGame() {} },
    '@/components/GameMetadataEditor': { MetadataFields: () => React.createElement('input', { name: 'title', defaultValue: 'Game 1' }) },
    '@/components/SteamProgress': { default: () => React.createElement('button', { type: 'button' }, 'Sync Steam Achievements') },
    '@/components/ReplayTracking': { ReplayCountEditor: () => React.createElement('input', { name: 'playthroughCount' }) },
    '@/components/PlayJournal': { PlayJournalEditor: Empty }, '@/components/MicroReview': { MicroReviewEditor: () => React.createElement('textarea', { name: 'review' }) },
    '@/components/StarRatingInput': { default: Empty }, '@/components/DeckPinButton': { default: Empty }, '@/app/actions': { logGameReplay() {} },
  };
  const loadTS = loader();
  function load(file) {
    const filename = path.resolve(__dirname, '..', file), m = new Module(filename, module); m.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = m.require.bind(m);
    m.require = name => Object.hasOwn(mocks, name) ? mocks[name] : name.endsWith('.css') ? {} : name.startsWith('@/') ? loadTS(`src/${name.slice(2)}.ts`) : original(name);
    m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);return m.exports;
  }
  return { c, games, render: (file, props) => renderToStaticMarkup(React.createElement(load(file).default, props)) };
}

test('Standard renders a bounded cover grid with quick actions and no inline game editors', () => {
  const f = fixture(), html = f.render('src/components/StandardLibraryView.tsx', { controller: f.c });
  assert.equal((html.match(/class="standard-game-card"/g) ?? []).length, 20);
  assert.match(html, /Page 1 of 3/); assert.match(html, /1–20 of 45 games/);
  assert.match(html, /data-reorder-row-id="1"/);
  assert.match(html, /data-deck-draggable="true"/);
  assert.match(html, /draggable="true"/);
  assert.match(html, /View details for Game 1/); assert.match(html, /Start playing Game 1/);
  assert.match(html, /name="lengthHours" value="12"/); assert.match(html, /name="difficulty" value="2"/);
  assert.doesNotMatch(html, /class="game-row|name="playthroughCount"|name="review"|name="hoursPlayed"|Completed runs|02 \/ YOUR LIBRARY/);
  assert.match(html, />Dropped</); assert.doesNotMatch(html, /Stopped Playing|Flatlined</);
});

test('Standard provides a welcoming empty state and keeps unavailable releases out of the Start action', () => {
  const f = fixture(); f.c.games = []; f.c.visibleGames = [];
  assert.match(f.render('src/components/StandardLibraryView.tsx', { controller: f.c }), /Make room for your next adventure/);
  f.c.games = f.c.visibleGames = [{ ...f.games[0], releaseYear: 2099 }];
  const html = f.render('src/components/StandardLibraryView.tsx', { controller: f.c });
  assert.match(html, /Upcoming · View Details/); assert.doesNotMatch(html, /Start playing Game 1/);
});

test('all heavy editing belongs to a single focused dialog with Steam sync, review, status, hours, and deletion', () => {
  const f = fixture(); f.c.editingMetaGame = { ...f.games[0], steamAppId: "620" };
  const html = f.render('src/components/StandardGameDetails.tsx', { controller: f.c });
  assert.equal((html.match(/<form/g) ?? []).length, 1, 'No nested forms');
  assert.match(html, /role="dialog"/); assert.match(html, /aria-modal="true"/);
  for (const name of ['status', 'lengthHours', 'hoursPlayed', 'difficulty', 'playthroughCount', 'review', 'notes']) assert(html.includes(`name="${name}"`), name);
  for (const label of ['Hype', 'Sync Steam Achievements', 'Save Changes', 'Delete Game', 'Game information']) assert(html.includes(label), label);
  assert.doesNotMatch(html, /02 \/|ADMIN \/\/|SLOT 01|Stopped Playing/);
  f.c.editingMetaGame = { ...f.c.editingMetaGame, status: 'Completed', playthroughCount: 1 };
  const completed = f.render('src/components/StandardGameDetails.tsx', { controller: f.c });
  assert.equal((completed.match(/<form/g) ?? []).length, 1);
  assert.match(completed, /Log completed replay/);
});


test('Standard cards expose shared drag identity, eligibility, and active source state', () => {
  const f = fixture();
  f.c.dragSourceId = 1;
  f.c.canDragToDeck = game => game.status === 'Backlog' && game.releaseYear <= 2026;
  f.c.isReorderableRow = () => false;
  f.c.games = f.c.visibleGames = [f.games[0], { ...f.games[1], status: 'Playing' }, { ...f.games[2], releaseYear: 2099 }];
  const html = f.render('src/components/StandardLibraryView.tsx', { controller: f.c });
  const cards = html.match(/<li class="standard-game-card"[^>]*>/g);
  assert.match(cards[0], /data-reorder-row-id="1"/);
  assert.match(cards[0], /data-deck-draggable="true"/); assert.match(cards[0], /data-dragging="true"/); assert.match(cards[0], /draggable="true"/);
  for (const card of cards.slice(1)) { assert.match(card, /draggable="false"/); assert.doesNotMatch(card, /data-deck-draggable|data-dragging/); }
  f.c.rowReorderBusy = true;
  assert.doesNotMatch(f.render('src/components/StandardLibraryView.tsx', { controller: f.c }), /\sdraggable="true"/);
});
