/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the real draft hook with isolated React state and form boundaries. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./helpers/social-fixture.cjs');
const { game } = require('./helpers/activity-fixture.cjs');

function fixture() {
  const previous = { Element: global.Element, FormData: global.FormData };
  class Field {
    constructor(form, name) { this.form = form; this.name = name; }
    closest() { return this.form; }
    getAttribute(name) { return name === 'name' ? this.name : null; }
  }
  global.Element = Field;
  global.FormData = class {
    constructor(form) { this.values = form.values; }
    get(name) { return this.values[name] ?? null; }
  };
  let state, games = [game(1, { title: 'Saved title', platform: 'PC' })];
  const useDrafts = loader({ react: { useState: initial => {
    state ??= initial;
    return [state, update => { state = typeof update === 'function' ? update(state) : update; }];
  } } })('src/components/useGameDrafts.ts').default;
  const render = () => useDrafts(games);
  return {
    get row() { return games[0]; },
    get draft() { return render().getGameDraft(games[0]); },
    refresh(changes) { games = [{ ...games[0], ...changes }]; },
    change(name, value, otherFields = {}) {
      const form = { dataset: { gameEditorId: '1' }, values: { ...otherFields, [name]: value } };
      render().captureGameDraft({ target: new Field(form, name) });
    },
    fields(changes) { render().setGameDraftFields(games[0], changes); },
    rating(value) { render().setGameDraftRating(games[0], value); },
    clear() { render().clearGameDraft(1); },
    cleanup() { global.Element = previous.Element; global.FormData = previous.FormData; },
  };
}

test('draft capture records only the changed input and never promotes stale hidden fields to edits', () => {
  const f = fixture();
  try {
    f.change('status', 'Playing');
    f.change('title', 'Typed title', { status: 'Backlog', platform: 'PC', hoursPlayed: '0' });
    assert.equal(f.draft.status, 'Playing'); assert.equal(f.draft.title, 'Typed title');
    f.refresh({ platform: 'PS5', hoursPlayed: 12, title: 'Server title' });
    assert.equal(f.draft.platform, 'PS5'); assert.equal(f.draft.hoursPlayed, '12');
    assert.equal(f.draft.title, 'Typed title'); assert.equal(f.draft.status, 'Playing');
    f.change('notes', 'Private draft', { platform: 'PC' });
    assert.equal(f.draft.platform, 'PS5');
  } finally { f.cleanup(); }
});

test('all metadata, catalog autofill, rating and unchecked spoilers survive refresh until a successful save clears them', () => {
  const f = fixture();
  try {
    f.refresh({ reviewSpoiler: true, franchise: 'Saved saga' });
    const metadata = { title: 'Catalog title', platform: 'Switch', genre: 'Puzzle', ownershipType: 'Borrowed', franchise: '', releaseYear: '2020', chronologicalOrder: '3', coverUrl: 'https://example.test/cover.png' };
    f.fields(metadata);
    f.rating(4); f.change('reviewSpoiler', 'true'); f.change('reviewSpoiler', null);
    f.refresh({ title: 'Refreshed title', platform: 'PS5', ownershipType: 'Digital', reviewSpoiler: true });
    for (const [name, value] of Object.entries(metadata)) assert.equal(f.draft[name], value, name);
    assert.equal(f.draft.rating, '4'); assert.equal(f.draft.reviewSpoiler, 'false');
    f.clear();
    assert.equal(f.draft.title, 'Refreshed title'); assert.equal(f.draft.platform, 'PS5');
    assert.equal(f.draft.ownershipType, 'Digital'); assert.equal(f.draft.rating, ''); assert.equal(f.draft.reviewSpoiler, 'true');
  } finally { f.cleanup(); }
});
