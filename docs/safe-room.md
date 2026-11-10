# Safe Room persona

Safe Room (`biohazard`) is a third layout, alongside Cyberpunk and Fantasy. The design uses the classic Resident Evil pause-screen composition: recessed ECG, personnel card, eight-wedge research seal, beveled equipment slots, Item Box rack, and a separate examination panel. It has its own renderer, not a recolored Cyberpunk table.

## Architectural audit and ownership

- `GameLibrary` owns a single `useGameLibraryController`. Its three renderer branches share filtering, ordering, drafts, saga selection, list selection, session logging, and actions.
- `BiohazardSubscreenView` owns Safe Room's spatial composition. `WorkspaceShell` owns its independent five-mode navigation through `SafeRoomContext`. Explicit library navigation from shared controllers maps to the appropriate Safe Room mode.
- The streamed server summary supplies `BiohazardStatusDeck` with profile, rank, XP and counts. That component mounts either the existing summary or the dedicated medical deck. Account controls, milestones and personnel-dossier tools reuse the same data.
- Shared advisor, social, archive-transfer, roulette and metadata overlays remain outside the renderer branch in `GameLibrary`, preserving their controllers across layout changes. `WorkspaceSection` presents static file headings in Safe Room; Cyberpunk and Fantasy retain their disclosures.
- The game-entry form remains at its stable server slot. Safe Room exposes it only at the typewriter station. The station opens its disclosure on entry; typed input produces the synthesized key clack. Record editing, ratings, journal dates, reviews, ownership, replay tracking and play-session logging use the existing actions and draft controller.
- Lists use manila research folders; sagas use incident binders with shared chronology controls and accessible ordering buttons. Files also exposes the library's full analytics.
- `BiohazardIdCard` supplies a dedicated exportable personnel SVG to both private and public dossiers.

## Appearance and sound

`appearance.ts` recognizes `biohazard` during startup, restoration and account preference changes. Registration, Google/Steam contexts, profile types, admin controls and custom-theme validation accept the third layout. The database already stores layout preferences as strings; no schema migration is needed.

`biohazard.css` scopes the steel/olive/ivory surfaces to this layout, including shared portaled dialogs. Custom theme colors remain available through the Safe Room tokens. Desktop uses four inventory columns plus an examination column; 390px uses two inventory columns and a stacked examination panel. Keyboard arrow navigation follows the rendered grid columns. Reduced-motion preferences stop the ECG and radar animations.

The ECG is a workload indicator: Fine for 0–2 active games, Caution for 3–5, Danger for 6+. The accessible label explains its active-game count. Clicking the monitor plays its pulse; cursor movement, subscreen changes and typing use separate synthesized sounds. The existing UI mute control gates them.

## Verification

Run `npm test` and `npm run typecheck`. `tests/biohazard.test.cjs` exercises restoration, custom themes, mode visibility, actual item-selection/filter/recon handlers, empty inventory and the medical-deck branch. Existing audio/provider/auth tests cover the new palette, three-layout cycling and registration layout retention.

With a local server and the existing database environment, run `node scripts/check-safe-room.cjs`. It creates an isolated QA account and games, switches through all three renderers, saves a journal record, checks all subscreens and shared dialogs at 1440px and 390px, and removes its fixtures in `finally`. Playwright can be resolved locally or through `PLAYWRIGHT_MODULE`. Artifacts default to `/tmp/backlog-safe-room-structural`; `SAFE_ROOM_BASE_URL` and `SAFE_ROOM_ARTIFACTS` override the server and destination. The browser audit checks overflow, leftover Cyberpunk copy, mounted layout structure and visible neon borders.
