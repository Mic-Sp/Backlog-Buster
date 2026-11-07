# Custom lists and ranked shelves

## Audit

- `Player.games` owns library records. `Game` is a player's copy, not a canonical catalog record. All mutations in `actions.ts` authenticate a live registered session and constrain game IDs by `userId`. Deck writes serialize with a per-player advisory lock. Account deletion cascades games, sessions, achievements and activity.
- `GameLibrary` supplies a shared controller to Cyberpunk and Fantasy views. `pinnedOrder` controls the three-slot active deck, `backlogOrder` controls backlog priority, and saga ranks have a third ordering. Profile favorites in `Player.featuredTrophyIds` are independent of these queues.
- `NetrunnerDossier` edits identity/favorites and renders `NetrunnerIdCard` or its Fantasy equivalent. The exported SVG/PNG has three fixed showcase slots. Custom shelves live beside that card on the public dossier, keeping the compact identity snapshot stable.
- `public-dossier.ts` applies `visibleProfileWhere` in the database query. Public profiles allow anonymous visitors; friends profiles require accepted friendship; private profiles allow the owner. Either direction of blocking denies the peer. Unclaimed local profiles never become authenticated viewer identities. Public queries explicitly select fields and build fresh DTOs.
- Activity is append-only and stores allowlisted snapshots of status, rating, achievement and import events. Its read path rechecks current audience and friendship. List edits remain quiet: placing private list names or contents in immutable feed metadata would need a separate visibility/retraction design. List mutations do not award XP or emit game-status activity.
- The vault previously exported a game array or CSV, then restored allowlisted game fields with title/platform deduplication and server-owned player IDs. Imported XP is recomputed. Imports merge rather than replace; this remains the contract.

## Data and mutations

`CustomList` belongs to one player, has an 80-character title, optional 280-character description, ranked/shelf mode and public/private flag. New lists are private. There are at most 20 lists per player and 50 games per list.

`CustomListEntry` references the list and game through composite foreign keys including `userId`. The database forbids cross-player membership. Unique `(listId, gameId)` and `(listId, position)` constraints prevent duplicate membership and ordering ties. Game deletion cascades membership; list deletion cascades entries; account deletion cascades the whole structure. Gaps after a game deletion do not affect display numbering, which is computed from the sorted entries. Library reset deletes games and therefore empties retained list shells, consistent with its existing library-game reset boundary.

`custom-lists.ts` authenticates and rechecks a live registered session inside a transaction, serializes mutations with `backlogbuster-lists:<player>`, checks caps under that lock, and verifies list ownership. Reorder requests must be an exact permutation of current members. A revision prevents stale tabs from overwriting later edits. Ordering changes atomically replace at most 50 membership rows before incrementing the revision. Server action results use the existing safe error boundary and revalidate the workspace and dossier routes.

## Workspace and public rendering

Both themes share `CustomListsPanel`, with theme-specific framing and accessible forms, up/down controls, counts, pending/error feedback, deletion confirmation and responsive layouts. Create/edit, add/remove and reorder all persist immediately through the action. Details edits use an explicit save button. The library selector resets other filters and opens all statuses in saved list order; subsequent status/search/ownership filters narrow that queue. List order takes precedence over ordinary sorting. Backlog/saga reorder modes are disabled while a curated list is selected. Starting a queued game keeps that shelf selected; adding a new library game clears the shelf filter to reveal the new record.

The public dossier's authorized player query includes only `isPublic: true` lists and explicit game title/platform/cover projections, bounded to 20 lists and 50 entries. Private list names, private notes, reviews, account identifiers and library ownership fields never enter the public list DTO. Public lists are expandable and render in either viewer-selected theme.

## Backup compatibility

Legacy game-array JSON and CSV remain accepted. JSON export includes a version 2 envelope only when custom lists exist: `{ version: 2, games: [...], customLists: [...] }`. Lists use portable game title/platform references instead of database IDs. Restore resolves those references against the receiving player's library, preserving list order, ranking and visibility, and skips identical lists. It shares the list mutation lock, enforces list caps, and rolls back the import if referenced games are unavailable or capacity is exceeded. As with existing game restores, title/platform references use the vault's canonical deduplication convention: duplicate copies merge, and each restored shelf retains the first occurrence of a merged game. CSV remains game-only. Existing import limits remain 500 KB and 200 game rows per batch.

## Validation

Unit suites exercise CRUD, deterministic ordering and exact permutations, ownership/session validation, concurrency and stale revisions, duplicate membership, both caps, transaction rollback, public/friends/private/block audience checks, field projection, legacy backups and portable list restore. Live browser verification exercises both themes at desktop and mobile widths, keyboard ordering, saved-order library filtering, public shelves and privacy, and database cascade/foreign-key behavior using disposable accounts.
