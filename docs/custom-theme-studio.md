# Custom Theme Studio

## Architecture audit

The existing theme system separates `LayoutMode` (`cyberpunk` / `fantasy`) from the Cyberpunk variant (`default` / `halloween`). `ThemeProvider` owns layout, sound, seasonal decorations and account preference synchronization. The pre-paint script in `appearance.ts` restores device preferences; an authenticated player's saved layout remains authoritative for built-in layouts. `ThemePlayerSync` supplies the current player after the suspended workspace renders.

CSS uses `data-layout-mode`, `data-cyberpunk-theme` and `data-theme` on the root. The core variables include `--canvas`, `--paper`, `--ink`, `--muted`, `--line` and accent variables. Many component surfaces also have literal colors, so changing only those variables would leave parts of the app unthemed. Fantasy adds parchment/forest artwork, rounded borders and serif typography. Haunted Net / Blackwall Glitch adds its palette, ghosts, bats and other decorations. Floating fairies are a separate shared component. A scanline overlay is available only for custom themes; the existing Cyberpunk background was gradients rather than a separate scanline toggle.

Custom themes extend that same provider and root-attribute pattern. The built-in stylesheet contents, names, layout controllers, sound preferences and game/account data remain intact.

## Data model

`src/lib/custom-theme.ts` exports the `CustomTheme` interface and strict Zod `customThemeSchema`:

| Field | Values |
| --- | --- |
| `id` | Unique custom ID beginning `custom-`; built-in IDs cannot be replaced. |
| `name` | Required, trimmed, 1–60 characters. |
| `baseLayout` | Optional on import; `cyberpunk` by default, or `fantasy`. Controls existing layout, typography and fallback terminology. |
| `colors` | Required six-digit hex strings: `background`, `surface`, `text`, `muted`, `accent`, `border`. |
| `effects` | Optional booleans: `scanlines`, `particles`, `parchment`, `haunted`; omitted toggles default to false. |
| `borderRadius` | Optional integer from 0–32 pixels; defaults to 3. |
| `terminology` | Optional display-label overrides: `workspaceTitle`, `libraryTitle`, `statsTitle`, `inventoryTitle`, `deckTitle`, `authTitle`. Blank values retain the base layout's labels. |

Imports reject unknown fields, arbitrary CSS, URLs as colors, invalid IDs, malformed types and oversized JSON. Labels render as React text. Terminology changes presentation only: database statuses, sorting, filters and other game behavior are unchanged.

## Runtime and persistence

`custom-theme-runtime.ts` maps validated colors onto `--custom-*` root variables and the existing token aliases. Scoped `data-custom-theme` rules paint the shared cards, panels, controls and dialogs, including portals. Existing CSS continues to own their layout and behavior. Leaving a custom theme removes all owned inline tokens and effect attributes so the original built-in stylesheet values become active again.

The studio retains its own readable editor palette while experimental app palettes are previewed. Its live sample card uses the draft colors as a direct reference. Existing fairy and Halloween components are reused; their toggles, the Fantasy backdrop, custom scanlines and corner radius are independent.

`useCustomThemes` stores up to 50 themes in:

```text
backlogbuster:custom-themes:v1
backlogbuster:custom-theme:v1
```

These device-local keys are separate from the existing layout, seasonal-theme and audio keys. Selecting or previewing a custom theme does not save its base layout to the player account. Explicit built-in switching retains the established account-layout behavior. The legacy layout/Halloween/audio buttons remain available alongside the new selector and studio button.

The startup script restores safe CSS values before hydration. Full Zod validation runs again on storage restoration and import. Storage events synchronize saved themes and selections across tabs without writing received preferences back. Deleted or invalid selections fall back to the prior built-in appearance. Storage failures keep drafts available and explain how to export them.

## Editor behavior

- Open **Custom Theme Studio** from the shared theme controls on the workspace, sign-in and recovery pages.
- Choose a saved theme, create a new one, or duplicate the current draft with a fresh ID.
- Native color inputs and paired hex fields preview changes immediately. Incomplete hex input stays in the editor and cannot be saved or applied as CSS.
- Change the base layout, effects, radius and optional headings. Preview changes stay in memory until saved.
- **Copy theme JSON** fills the JSON editor and writes to the clipboard. If clipboard access is unavailable, the populated field remains available for manual copying.
- **Copy Share Link** validates the current draft and copies a URL containing just the current origin, pathname and `theme` parameter. Unrelated query values and fragments are excluded. A selectable URL remains available if clipboard permission is denied.
- **Validate & preview JSON** reports field-specific errors and applies only a valid draft. Saving an imported ID updates that ID; duplicating creates a separate theme.
- **Save & apply theme** writes the palette and selection to localStorage. **Delete custom theme** removes the saved theme. Neither action changes built-in theme definitions.
- Closing, clicking the backdrop or pressing Escape cancels the unsaved preview. Focus returns to the opener. The modal traps focus, restores body scrolling and supports 390px viewports.

## Shareable theme links

`src/lib/theme-share.ts` serializes normalized theme JSON as UTF-8 Base64URL: `?theme=v1.<payload>.<checksum>`. A small checksum detects transit corruption; it is not a signature or proof of authorship. The decoder rejects unsupported versions, noncanonical Base64URL, invalid UTF-8/JSON, checksum mismatches, payloads over 8192 characters, and anything failing the existing strict `customThemeSchema`. No theme CSS, executable content or remote assets can be supplied by a link. Duplicate `theme` parameters are ignored as ambiguous.

The provider's suspended `SharedThemePreview` observes query changes on initial load and client navigation. Valid links occupy a temporary preview layer above the saved selection. They do not write custom-theme storage or account preferences. The floating banner identifies the theme and offers **Save & Apply** and **Dismiss / Revert**. Invalid links are inert. Preview controls retain a readable palette in both layouts.

Saving assigns a fresh ID, preserves any colliding local theme, persists the new selection, and then removes `theme` from the URL using the native history API. A full or blocked localStorage retains the preview and URL with a recoverable error. Dismissal removes the temporary layer and restores the previous selection without writing storage. Both actions preserve unrelated query values, fragments and Next's history state. Explicit theme switching also exits the shared preview.

Opening the studio temporarily hides the banner. A shared theme starts with a fresh draft ID to prevent accidentally editing/deleting an existing local theme with the same ID. Closing the studio restores the shared preview; saving its draft accepts the edited theme and cleans the URL.

## Verification

`tests/custom-theme.test.cjs` covers schema defaults, JSON round trips, unsafe imports, storage corruption/deduplication, runtime token cleanup and pre-paint restoration. `tests/theme-share.test.cjs` covers Unicode URL round trips, normalization, corrupt/oversized/schema-invalid payloads, and URL construction/cleanup. `tests/shared-theme-state.test.cjs` exercises the actual hook's temporary state, deferred restoration, collisions, fresh-ID persistence, quota/capacity failures, studio cancellation and explicit selection. Existing provider tests continue to check account layout authority, cross-tab feedback-loop prevention and the original controls.

Required checks:

```sh
npx tsc --noEmit
npm run build
```

The full test suite and focused ESLint are also run. Production browser QA is reproducible with:

```sh
node scripts/check-theme-studio.cjs --playwright-module /path/to/playwright
node scripts/check-theme-share.cjs --playwright-module /path/to/playwright
```

An optional `--library-path` supplies Chromium libraries on minimal Linux installations. The check starts the production build on port 3015 and uses disposable accounts, cleaned up afterward. It exercises Cyberpunk, Haunted Net / Blackwall Glitch and Fantasy at 1440px and 390px: live colors/effects, invalid hex/JSON, cancel restoration, clipboard export, save/edit/delete, cross-tab updates, startup with app chunks blocked, custom workspace terminology and storage quota errors. Artifacts are saved in `/tmp/backlog-theme-studio-browser/`.

The sharing check uses port 3016 without account/database mutations. It exercises both viewport sizes across all three built-in appearances, direct/history URL detection, preview and revert to built-in/custom themes, Unicode clipboard/manual sharing, shared-draft cancellation, colliding IDs, quota recovery, save/reload and invalid/ambiguous links. Reports and screenshots are saved in `/tmp/backlog-theme-share-browser/`.

Completed for shareable links: `npx tsc --noEmit`, `npm run build`, focused ESLint and all 77 test files pass. The 13 new codec/state cases also pass when run directly. Both production browser scripts pass across Cyberpunk, Haunted Net / Blackwall Glitch and Fantasy at 1440px and 390px with no runtime errors or horizontal overflow.
