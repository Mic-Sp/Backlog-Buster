# Custom lists and ranked shelves

## Architectural audit

- `prisma/schema.prisma`: a `Game` is a player's library copy, not a global catalog entry. `GameCatalog` is shared public metadata. Deleting a player cascades their games, sessions, achievements, and activity. Custom shelves therefore reference owned `Game` rows rather than catalog rows.
- `src/app/actions.ts` and `src/lib/player.ts`: writes require a signed, unexpired session belonging to a registered player. The unclaimed `default-player` fallback is read-only. Existing actions use structured `safeAction` errors, explicit owner conditions, route revalidation, and transaction-scoped advisory locks.
- `src/components/GameLibrary.tsx`: one controller drives both library themes. Deck slots (`pinnedOrder`), backlog priority (`backlogOrder`), and saga chronology (`chronologicalOrder`) have separate meanings. Shelf membership and ordering must not reuse those columns.
- `src/lib/public-dossier.ts`, `src/lib/profile-privacy.ts`, and `src/app/dossier/[handle]/page.tsx`: visibility is checked in the database query before retrieval. Private profiles are owner-only; friends profiles require accepted friendship; either participant's block denies the peer access. React's dossier cache is request-scoped. The viewer's appearance controls the public page's theme.
- `src/components/NetrunnerDossier.tsx` and `src/components/NetrunnerIdCard.tsx`: the private editor and exported SVG contain a deliberately bounded career snapshot and three profile favorites. Custom lists appear beside the public card; the snapshot format and favorites remain independent.
- `src/lib/activity-events.ts` and `src/lib/activity-feed.ts`: events are allowlisted immutable snapshots. Feed reads require accepted friendship and apply current profile/block rules. List titles or membership in immutable event metadata could survive a later switch to private visibility. List edits consequently emit no activity events.
- `src/lib/library-vault.ts`, `src/lib/library-backup.ts`, and `src/lib/library-import.ts`: backup fields are allowlisted, imported IDs/owners are discarded, and imports merge duplicates by normalized title/platform. Imports lock per player, recheck the session, and write atomically. Legacy limits remain 200 games and 500 KB per import; CSV remains a game-only format.

## Data and write boundaries

`CustomList` stores an owner, a title of 1–80 characters, an optional description of up to 280 characters, ranking and public flags, and timestamps. Both flags default to false. A registered player can maintain 20 lists with 50 unique games each.

`CustomListEntry` stores `listId`, `userId`, `gameId`, and an explicit position. Composite foreign keys to `(listId, userId)` and `(gameId, userId)` enforce equal ownership in PostgreSQL. The primary key prevents duplicate membership; a unique list/position constraint prevents ambiguous ordering. Account, list, and game deletion cascade membership cleanup. Deleting a game can leave position gaps; reads sort deterministically and presentation numbers the surviving entries 1–N.

`src/lib/custom-lists.ts` owns validation and persistence. All list writes acquire the existing per-player deck/import advisory lock and recheck authentication after waiting. Counts are checked under that lock, so concurrent application requests cannot exceed bounds. Membership edits operate on the current locked sequence. Reorder requests must be complete permutations of the current membership. Replacing up to 50 entry rows within one transaction avoids transient unique-position collisions; failures roll back the entire edit. Foreign-key constraints also protect against concurrent game deletion, which has its own existing action path.

`src/app/custom-list-actions.ts` wraps these operations with structured errors and invalidates the workspace and dossier route. These actions accept no owner ID. Counts and text validation are enforced at the application boundary; direct administrative SQL must honor those bounds too.

## Workspace and public presentation

Both themes use the same list editor: Cyberpunk data shards and Fantasy curated scrolls. Players can create, edit, delete, add/remove library games, and immediately persist changes with labeled up/down buttons. A second confirmation is required for deletion; games remain in the library.

Selecting a shelf opens all its statuses in saved order and clears previous filters. Search, platform, ownership, genre, and status filters can subsequently narrow it. Default sorting preserves shelf order. Existing deck/backlog/saga reordering is disabled while a shelf is selected. Starting a queued game preserves the shelf selection; adding a new library game clears it so the new record can be revealed.

Public lists are selected as a nested relation of the already-authorized profile query, with `isPublic: true`, bounded results, and explicit game projections. Public DTOs contain list details, game title/platform, and cover URL. They contain no player IDs, private notes, review/spoiler text, or undisplayed private memberships. The same profile/block rules apply even when the list itself is public. Lists are rendered in expandable sections in either theme.

## Backup compatibility

JSON exports containing shelves use `{ format: "backlog-buster", version: 2, games, customLists }`. Each shelf references zero-based offsets into the exported game array, preserving order without exporting database/account IDs. Empty shelves and visibility/ranking flags are preserved. Without shelves, JSON retains the legacy game-array shape. CSV export/import retains its previous game-only shape.

The importer supports both JSON shapes. Versioned archives validate list counts, text, flags, unique references, and array bounds before writing. A malformed versioned game fails the archive rather than shifting references after a skipped row. Entries resolve only to the importing player's game rows, using the existing title/platform merge semantics; duplicate library copies with the same title/platform follow that existing deduplication rule. Identical restored shelves are skipped, while distinct shelves are added without overwriting current lists. Exceeding the 20-list limit rolls back games and shelves together. Empty-game archives can restore empty shelves.

## Verification

`tests/custom-lists.test.cjs` covers CRUD, ownership/session failures, private defaults, deterministic item order, duplicate membership, complete reorder validation, transaction rollback, concurrent list/item bounds, profile/friend/block audiences, public projections, and archive validation/remapping/restore limits. Existing dossier, inventory, vault, ownership, activity, and account tests also run as part of the full suite.

Browser checks exercise both themes at 1440px and 390px, including keyboard ordering, selected queues, public/private visibility, database ownership constraints, cascade deletion, and live JSON export/restore. Temporary browser-test accounts are deleted after verification.
