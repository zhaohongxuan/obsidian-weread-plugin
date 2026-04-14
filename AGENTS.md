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
- No test runner is configured in this repo.
- There is no single-test command available.
- If you add tests, also document how to run a single test.

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

## Suggested verification
- `npm run lint`
- `npm run build`

## Documentation references
- `README.md` for user workflows and features.
- `docs/weread-api.md` for WeRead API details.
- `docs/template-editor-window.md` for template UI behavior.

## Notes for agents
- Do not edit synced note files directly; they are regenerated.
- Follow existing logging and Notice patterns for UX consistency.
- Use existing utilities for cookies, files, and frontmatter.
