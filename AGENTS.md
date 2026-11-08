# Agent Guide for obsidian-weread-plugin

This file is for agentic coding assistants working in this repo.
It includes general collaboration guidance plus repo-specific rules.

## General collaboration rules (通用知识)

- Prefer small, focused changes that are easy to review.
- Read nearby code and follow existing patterns before introducing new ones.
- Avoid destructive operations (force-push, hard reset) unless explicitly asked.
- If you bump `package.json` version, update `manifest.json` version too.
- Keep user data safe: never edit synced notes directly; use the sync pipeline.
- When unsure about a requirement, propose a default and ask one focused question.
- Document any new scripts, settings, or feature flags you introduce.

## Project overview

- Obsidian community plugin for syncing WeRead (微信读书) data into Markdown.
- Core code lives in `src/`; templates in `src/assets/`.
- Sync is overwrite-based; synced notes should not be edited in place.

## Must-read instructions (from Copilot rules)

- Main logic is in `src/`, with subfolders for API, models, rendering, settings, and utils.
- Use Nunjucks templates (`.njk` in `src/assets/`) for rendering output.
- Respect the overwrite sync model; never edit user notes in place.
- For new settings, update both `src/settings.ts` and `src/settingTab.ts`.
- Cookie management lives in `src/cookieCloud.ts` and `src/utils/cookiesUtil.ts`.
- File/frontmatter logic is in `src/utils/fileUtils.ts` and `src/utils/frontmatter.ts`.
- External integration: WeRead web APIs (see `docs/weread-api.md`).

## Repo map (high level)

- `main.ts`: plugin entry, registration, commands.
- `src/api.ts`: WeRead API requests, cookie refresh, error handling.
- `src/syncNotebooks.ts`: sync orchestration and notebook saving.
- `src/renderer.ts`: Markdown rendering via Nunjucks.
- `src/settings.ts`: settings store and persistence.
- `src/settingTab.ts`: settings UI.
- `src/models.ts`: shared types/interfaces.
- `src/parser/parseResponse.ts`: API response parsing and transforms.
- `src/utils/`: helpers for cookies, dates, file/frontmatter, sanitization.

## Build, lint, test

All commands are from `package.json`.

- Install deps: `npm install`
- Clean build artifacts: `npm run clean`
- Lint (auto-fix): `npm run lint`
- Build (type check + lint + webpack): `npm run build`
- Dev build + sync helper: `npm run deploy`

Tests:

- Run `npm test` for the full Node test suite, including real headless Chrome UI regressions when Chrome is available. Fixtures use synthetic data and mock network/settings; no WeRead credentials or installed Obsidian vault are needed.
- See **Testing workflow (测试与验收)** below for prerequisites, focused commands, native Obsidian acceptance, screenshots and release checks.
- Run a single test with `node --test --test-name-pattern='partial failures' tests/journal.mjs`.
- Journal cache code lives in `src/journal.ts` / `src/journalHelpers.ts`; it persists JSON under the plugin directory and must never rewrite synced Markdown or persist credentials.
- Favorites are durable vault-owned data, defaulting to vault-root `favorites.canvas`; `favoritesCanvasFolder` configures its vault-relative directory. Preserve legacy `WereadData/favorites` during the verified first-location migration, persist the location marker only after successful verification, never overwrite an occupied destination, and never resurrect preserved legacy copies after a known primary is removed. Keep the singleton service across directory changes, flush native drafts and close matching Canvas editors before switching, and await settings persistence before publishing the effective location. Favorites remain independent of journal caches and authentication. Never delete favorites when clearing caches or logging out. Preserve original legacy JSON during migration and native card text/layout/free nodes/edges during mutations. Recognizable managed metadata lives in standard text-node comments, not custom Canvas properties. Structurally unsupported but valid JSON must stay read-only; only actual JSON parse damage may recover via verified backup/quarantine. Use the singleton `WereadFavoritesService` and Vault create/modify events. Run `node --test tests/favorites.mjs tests/favoritesCanvas.mjs tests/favoritesFilesystem.mjs`; fixtures use synthetic data, not installed vaults.

- Book details live inside `WereadLibraryView` as a retained-origin route; new navigation must never create another Obsidian leaf or replace the library with the legacy detail view. Keep workspace state to book selection/origin only, normalize numeric YAML IDs with `journalId`, and retain bookshelf DOM/filter/scroll/focus. `WereadBookDetailPanel` guards remote/local/async actions by book and generation. Derive favorites via `parseJournalNotes`; local Markdown fallback IDs are synthetic and cannot become personal favorites. Detail refresh is read-only; note sync requires the explicit action. Run `node --test tests/libraryView.mjs tests/bookDetailHelpers.mjs tests/bookDetailView.mjs`.

## Tooling configuration

- TypeScript: `tsconfig.json` (ESNext modules, ES6 target, `noImplicitAny: true`).
- Lint: `.eslintrc` with `@typescript-eslint` and `prettier`.
- Format: `.prettierrc` (single quotes, semicolons, print width 100).
- Bundler: `webpack.config.js` with `ts-loader` and `svelte-loader`.

## Code style guidelines

### Language and types

- TypeScript is the default. Prefer explicit types for public APIs.
- `noImplicitAny` is on; avoid implicit `any`.
- `@typescript-eslint/no-explicit-any` is off, but use `any` only when needed.
- Use `type`/`interface` definitions in `src/models.ts` for shared data shapes.

### Imports

- Use ES module imports.
- Order imports by: external libraries, Obsidian APIs, internal modules.
- Use `type` imports when possible for types (e.g., `import type { Notebook } ...`).
- Use the `~` alias (webpack) for `src/` when it improves clarity.

### Formatting

- Prettier rules:
    - Semicolons required.
    - Single quotes for strings.
    - Trailing commas: none.
    - Print width: 100.
- Run `npm run lint` to apply formatting fixes.

### Naming

- Classes: `PascalCase` (e.g., `ApiManager`).
- Functions/variables: `camelCase`.
- Constants: `UPPER_SNAKE_CASE` when global/static; otherwise `camelCase`.
- Files: `camelCase` for utilities and modules (e.g., `fileUtils.ts`).

### Error handling and logging

- Prefer user-visible errors via Obsidian `Notice` for user-facing failures.
- Use `console.log`/`console.error` for debug and developer visibility.
- For API calls, follow patterns in `src/api.ts` (retry + cookie refresh).
- Avoid throwing unhandled errors from UI flows; surface failures with `Notice`.

### State and settings

- Settings live in `src/settings.ts` and are stored via the Svelte store.
- Update UI in `src/settingTab.ts` when adding new settings.
- Keep defaults in `DEFAULT_SETTINGS` and persist via `plugin.saveData`.

### Sync behavior

- Sync is overwrite-based: do not mutate user notes in place.
- Filtering logic and skip rules live in `src/syncNotebooks.ts`.
- Honor blacklist and note count filters in sync workflows.

### Rendering and templates

- Use Nunjucks for Markdown rendering (`src/renderer.ts`).
- Custom filters should be added in renderer environments.
- Template changes should be mirrored in `src/assets/*.njk`.

### Frontmatter

- Use `src/utils/frontmatter.ts` for YAML generation.
- Preserve existing frontmatter where possible; merge with new fields.
- Respect `saveReadingInfoToggle` when adding reading metadata.

### Svelte UI

- Svelte components are used in settings-related modals/windows.
- Keep UI logic in components, state in settings store.

## Patterns to follow

- Parsing: `src/parser/parseResponse.ts` handles API shape conversions.
- API: `src/api.ts` centralizes request headers and cookie handling.
- File ops: use utilities in `src/utils/fileUtils.ts` and `src/fileManager.ts`.
- Avoid duplicated string manipulation; use helper functions when available.

## When adding or changing features

- Keep module boundaries: API, parser, renderer, sync, settings, utils.
- Update README only for user-visible changes.
- Respect existing Obsidian plugin patterns and APIs.

## Testing workflow (测试与验收)

### 1. Prerequisites and full checks

Use Node.js 20 or newer (CI config uses Node 20), run commands from this repository root, and install dependencies with `npm install` when needed. Browser regressions launch Chrome through CDP with an isolated temporary profile; Playwright/Puppeteer and a running Obsidian instance are not required.

On macOS the default Chrome path is `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Override it on other systems, for example:

```bash
export CHROME_BIN=/usr/bin/google-chrome
test -x "$CHROME_BIN"
```

Before submitting executable changes, run:

```bash
npx --no-install tsc --noEmit
npm test
npm run build
git diff --check
```

`npm run build` already includes Svelte/TypeScript diagnostics, auto-fixing lint and webpack; inspect the resulting diff because lint can change files. Do not run `npm run deploy` as a test command: it invokes `sync.sh`, which writes to installed vaults. Inspect its destinations before any authorized deployment.

Report pass/fail/skip counts. Missing Chrome causes browser tests to **skip**, so a green exit code or green CI alone does not prove the UI was exercised. For UI changes, set a valid `CHROME_BIN` and confirm the relevant browser tests actually ran without skips. Do not freeze the expected total test count; use the current suite output. Documentation-only changes need link/path, formatting and diff checks, not a repeated full runtime suite.

### 2. Focused regressions by changed area

Run the affected group while developing, then the full checks above for executable changes:

| Area                                                         | Command                                                                                                                                                                      |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API, pagination and authentication                           | `node --test tests/apiPagination.mjs tests/apiKeyValidation.mjs tests/cookieNotebooks.mjs`                                                                                   |
| Sync results, chapter titles and legacy parser compatibility | `node --test tests/syncResults.mjs tests/reviewChapterTitles.mjs tests/legacyParserSyntax.mjs`                                                                               |
| Journal/cache and Today/Review UI                            | `node --test tests/journal.mjs tests/journalExclusionSettings.mjs tests/journalView.mjs`                                                                                     |
| Favorites data, Canvas, filesystem and directory settings    | `node --test tests/favorites.mjs tests/favoritesCanvas.mjs tests/favoritesFilesystem.mjs tests/favoritesStorage.mjs tests/favoritesSettings.mjs tests/favoriteBookFiles.mjs` |
| Favorites layout, search, counts and palette                 | `node --test tests/favoritesMasonry.mjs`                                                                                                                                     |
| Library and in-page book details                             | `node --test tests/libraryView.mjs tests/bookDetailHelpers.mjs tests/bookDetailView.mjs`                                                                                     |
| Reader positioning and tab/window lifecycle                  | `node --test tests/webReaderBookmark.mjs tests/readingNavigation.mjs tests/windowNavigation.mjs`                                                                             |
| Statistics/cache, insights and layout                        | `node --test tests/statsCache.mjs tests/statsInsights.mjs tests/statsPanel.mjs tests/statsView.mjs`                                                                          |

For a narrow reproduction, use `node --test --test-name-pattern='fractional browser zoom' tests/favoritesMasonry.mjs`. A targeted name filter intentionally excludes other cases; it does not replace the complete group/full suite.

### 3. What browser regressions must establish

- Reuse production panels/CSS and the existing [browser harness](tests/helpers/detailBrowserHarness.mjs), with synthetic fixtures. Judge rendered geometry and user-visible behavior, not a copy of the implementation's formula. For a bug fix, reproduce the failure and keep a regression that detects it.
- Favorites: unequal card heights, no overlaps and approximately 20px column gaps; 1/2/3 columns; text growth and cover failure; fractional zoom; filtering/sort/pagination; filtered unique-book counts; stable pale colors across rerenders; flat list mode; observer/RAF/subscription cleanup on close and reopen. Browser zoom may resolve a declared `1px` track to a fractional size, so validate actual spacing.
- Details: counts below the cover, loaded/zero/error states, missing/broken covers, visible and accessible action names, narrow layouts, preserved origin state and async book/generation guards.
- Statistics: compact cells, month/weekday alignment, tooltip values, wide side-by-side/narrow stacked cards, and retained obsolete style tags. Native hot reload can leave old injected CSS behind; a fresh-page test alone can miss that regression.
- Reader: actual visible text/Canvas paint matches the target; sidebar/hidden prerender text never proves success; same-chapter replacement, bounded paging, cancellation and tab/window closure work. Success closes only the notes drawer's own mask; failed navigation preserves the drawer and unrelated dialogs remain open.

### 4. Native Obsidian acceptance

Browser fixtures cannot establish real Obsidian lifecycle, upstream reader paint or vault integrity. For changes involving those behaviors:

1. Build first. Before updating an authorized test installation, back up its existing `main.js`, `manifest.json` and `style.css`; replace only those three runtime files. Preserve `data.json`, caches, synced Markdown, favorites Canvas, backups and migration originals. Record the current favorites count/path and hashes before testing; do not assume a fixed count or use an installed vault as an automated fixture.
2. Reload only this plugin and wait for its services and restored workspace to settle. Check the running plugin version against the installed manifest; if refreshing Obsidian's in-memory manifest metadata, preserve its resolved runtime fields such as the plugin directory. Keep the existing Obsidian CLI disabled if it was disabled.
3. Open the actual Library/Reader through plugin actions and test the changed behavior. Exercise narrow/wide panes, real images, content changes and the active theme. For reader positioning, start from a genuine highlight deep in a chapter, test another highlight in the same chapter and both configured tab/window modes, and verify the painted/visible target before accepting success. Confirm the notes drawer collapses on success.
4. If an existing DataviewJS/Advanced URI setup is used for temporary automation, put async work inside an **unawaited outer** `setTimeout(async () => { /* acceptance steps */ }, 1000)` so URI focus restoration finishes before revealing the target leaf. Wait for concrete loaded/rendered state with bounded timeouts, not an arbitrary long sleep. Never log credentials or publish raw vault/config data.
5. For read-only UI checks, compare favorites bytes/path/count and configuration before/after; inspect any difference before claiming preservation. For intentional Canvas mutations/migrations, use isolated fixtures and assert the expected changes plus preservation of unrelated nodes/edges/drafts. Remove only nonce-marked helper notes created by the test and detach their exact Markdown leaves. Do not restore whole user files blindly or leave helper tabs behind.

### 5. Screenshots and release verification

- README screenshots should show the current real native UI. Wait for data and visible cover images, crop to the plugin pane, account for Electron zoom when capturing, and inspect every final image. Exclude vault chrome, account information, credentials and helper tabs. Never use annotated bug-report images as product previews.
- Match the six current previews: bookshelf, Today, Review, book details, favorites and statistics. Use WebP at a readable size (the existing refresh uses 1600px width and `cwebp -q 88`), verify every README image link, and keep raw captures/helpers in an ignored diagnostics directory.
- For a version bump, verify `package.json`, both root version fields in `package-lock.json`, `manifest.json`, and the new `versions.json` compatibility entry agree; preserve the supported minimum Obsidian version unless intentionally changed. Verify the built manifest too.
- After an authorized release, wait for the exact candidate/main CI and tag release workflow. Download the published ZIP plus `main.js`, `manifest.json` and `style.css`; check asset SHA-256 digests, manifest version, and byte equality between the three ZIP entries and flat downloads. A successful upload alone does not establish package integrity. If installing locally, use those verified release files and repeat the native version/data-preservation check above.

## Documentation references

- `README.md` for user workflows and features.
- `docs/weread-api.md` for WeRead API details.
- `docs/template-editor-window.md` for template UI behavior.

## Notes for agents

- Do not edit synced note files directly; they are regenerated.
- Follow existing logging and Notice patterns for UX consistency.
- Use existing utilities for cookies, files, and frontmatter.
