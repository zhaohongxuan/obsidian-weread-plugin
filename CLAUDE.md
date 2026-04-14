# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Obsidian community plugin for syncing WeRead (微信读书) data — book metadata, highlights, notes, and reviews — into Markdown files. Sync is overwrite-based; do not edit synced notes in place.

## Build Commands

```bash
npm install          # Install dependencies
npm run clean        # Remove dist/ and main.js
npm run lint         # ESLint with auto-fix
npm run build        # svelte-check + lint + webpack
npm run deploy       # Dev build + sync helper script
```

## Architecture

**Entry point**: `main.ts` — plugin registration and command setup

**Core flow**: `src/api.ts` → `src/parser/parseResponse.ts` → `src/renderer.ts` → `src/syncNotebooks.ts` → file output

- `src/api.ts` — WeRead API requests, cookie refresh, error handling
- `src/parser/parseResponse.ts` — API response parsing and data transforms
- `src/renderer.ts` — Nunjucks template rendering to Markdown
- `src/syncNotebooks.ts` — sync orchestration and notebook saving
- `src/settings.ts` — settings store and persistence (Svelte)
- `src/settingTab.ts` — settings UI

**Templates**: Nunjucks templates in `src/assets/*.njk` — `notebookTemplate.njk` for highlights/notes, `wereadOfficialTemplate.njk` for book metadata.

**Utilities**:
- `src/utils/cookiesUtil.ts` — cookie management
- `src/utils/frontmatter.ts` — YAML frontmatter generation
- `src/utils/fileUtils.ts` — file operations

**Settings pattern**: When adding settings, update both `src/settings.ts` (store/defaults) and `src/settingTab.ts` (UI).

## Key Patterns

- **Cookie handling**: `src/cookieCloud.ts` + `src/utils/cookiesUtil.ts` — automatic refresh on expiry
- **Overwrite sync**: Notes are regenerated on sync; use block references for annotations
- **Type definitions**: Shared interfaces in `src/models.ts`
- **Svelte stores**: Settings use Svelte reactive stores; UI updates in `settingTab.ts`

## WeRead API

External API integration documented in `docs/weread-api.md`. Cookie-based auth with automatic refresh.

## Tooling

- TypeScript with `noImplicitAny: true`
- ESLint + Prettier (single quotes, semicolons, print width 100)
- Webpack bundling with `ts-loader`
