# Copilot Instructions for obsidian-weread-plugin

## Project Overview
- This is an Obsidian community plugin for syncing WeRead (微信读书) book metadata, highlights, notes, and reviews into Markdown files in an Obsidian vault.
- The plugin supports login via WeChat QR code, cookie management, custom templates (Nunjucks), and flexible file naming/frontmatter.
- Main logic is in `src/`, with subfolders for API, models, rendering, settings, and utilities. Templates are in `src/assets/`.

## Key Components
- `src/api.ts`: Handles WeRead API requests and data fetching.
- `src/syncNotebooks.ts`: Core sync logic for books, highlights, and notes.
- `src/renderer.ts`: Converts fetched data into Markdown using Nunjucks templates.
- `src/settings.ts` & `src/settingTab.ts`: Plugin settings UI and logic.
- `src/utils/`: Utility functions for cookies, dates, file management, frontmatter, etc.
- `src/components/`: UI models for login/logout and reading state.

## Developer Workflows
- **Build:** Use `npm run build` (uses webpack, see `webpack.config.js`).
- **Release:** See GitHub Actions workflows in `.github/workflows/` for CI and release automation.
- **Versioning:** Use `version-bump.mjs` and `versions.json` for version management.
- **Sync:** Main entry is `Sync Weread command` (see README for usage).

## Project Conventions
- All book/note sync is overwrite-based: do not edit synced files directly.
- Templates use Nunjucks (`.njk` in `src/assets/`).
- Settings and state are managed via Obsidian's plugin API and custom UI components.
- Cookie management is abstracted in `src/cookieCloud.ts` and `src/utils/cookiesUtil.ts`.
- File and frontmatter logic is in `src/utils/fileUtils.ts` and `src/utils/frontmatter.ts`.

## Integration Points
- Relies on WeRead web APIs (see `docs/weread-api.md`).
- Uses Nunjucks for template rendering.
- Integrates with Obsidian's plugin API for UI, commands, and file management.

## Examples & References
- See `README.md` for user-facing features and workflows.
- See `docs/weread-api.md` for API details.
- Templates: `src/assets/notebookTemplate.njk`, `src/assets/wereadOfficialTemplate.njk`.

## Tips for AI Agents
- When adding features, follow the modular structure (API, sync, render, settings, utils).
- Respect the overwrite sync model—never write code that edits user notes in place.
- Use existing utility functions for cookies, file, and frontmatter handling.
- Reference and extend Nunjucks templates for new output formats.
- For new settings, update both `settings.ts` and `settingTab.ts`.

---
_Last updated: 2025-11-13_
