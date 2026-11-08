# Workspace collapse audit and behavior

## Audit findings

`GameLibrary.tsx` shares library, filter, draft, and deck controllers across both presentations. Cyberpunk renders most content in one collection; Fantasy uses `display: contents` and pane attributes to distribute its quest, inventory, and chronicle sections through the workspace. Those pane attributes must remain on the outer sections.

Before this change, Cyberpunk telemetry and saga chains used closed native `details` drawers. Custom Lists had an intentionally closed inner manager, but its outer panel could not collapse. Deck slots, Fantasy equipment, medallions, inventory, and the chronicle remained fully visible. Player statistics also had no collapse control. Individual record editors, milestones, and the new-entry form already had intentional native disclosure defaults.

## Section coverage and defaults

| Section | Cyberpunk | Fantasy | Initial state |
| --- | --- | --- | --- |
| Player statistics | Operator stats | Hero’s Record | Open |
| Custom Lists | Curated collections | Curator’s shelves | Open |
| List contents | Ranked picks / shelf contents | Ranked picks / shelf contents | Open when editing a list |
| Main library | Library inventory | Adventurer’s Inventory | Open |
| Filters | Library filters | Quest filters | Open |
| Deck | On Deck / Up Next | C-Button equipment | Open |
| Quest status and equipment | — | Parent quest panel | Open |
| Medallions | Existing milestone drawer | Sage Medallions | Fantasy open; existing Cyberpunk default preserved |
| Chronicle | — | Hylian Chronicle | Open |
| Selected saga timeline | Saga timeline | Saga map | Open when present |
| Quest inspection | Existing per-game editors | Quest inspection | Open |
| Telemetry | Telemetry and critic matrix | Existing player statistics | Existing Cyberpunk closed default preserved |
| Telemetry subsections | Stats, ratings, library breakdown, genre and platform groups | — | Open inside telemetry |
| Saga selector | Active Saga Chains | Chronicle selector | Existing Cyberpunk closed default preserved |

The existing inner list manager, new-entry form, milestone drawers, and per-game record disclosures keep their original defaults and native keyboard semantics.

## Shared interaction

`WorkspaceSection.tsx` provides a real header button with `aria-expanded`, a stable `aria-controls` target, a caret, and an independently visible summary badge. All newly introduced disclosures default to open. Count badges remain visible in both states; Custom Lists also retains the active shelf name when collapsed. Long filter names truncate within the header instead of overflowing a narrow screen.

The body uses `hidden` and stays mounted. Closing a panel removes its controls from keyboard navigation and the accessibility tree without discarding unsaved input, nested manager state, selected games, or filters. A scoped CSS rule prevents grid/flex styles from overriding hidden bodies. Toggle state lasts for the mounted view and resets to its initial default on reload; no local-storage preferences change the initial experience.

Explicit library navigation can reveal a closed destination. New-game events, starting a game, and “View in library” reopen the main inventory. Saga selection reopens its inventory/chronicle destinations, and inspecting a quest from a saga map reopens the inventory. Ordinary data refreshes leave a player's collapse choices intact.

## Verification

`tests/workspace-collapse.test.cjs` exercises production disclosure handlers and theme view composition: default-open behavior, preserved closed defaults, linked accessible controls, expand/collapse state, mounted content, active-list/capacity summaries, both deck presentations, and explicit navigation reveal. Existing inventory and deck behavior tests remain in the full suite.

Browser verification covers both themes at 1440px and 390px, including Enter/Space activation, visible count badges, hidden-but-mounted content, unsaved list drafts, compact active-shelf summaries, horizontal overflow, saga navigation, and revealing previously collapsed libraries.
