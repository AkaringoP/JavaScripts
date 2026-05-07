# GroupingTags - Claude Instructions

## Overview
A userscript that adds tag grouping syntax to the Danbooru tag editor.
Users can organize tags into named groups (e.g., `Clothes[shirt pants]`) which are persisted in IndexedDB and flattened on submission.

TypeScript project built with Vite + vite-plugin-monkey. Output: `dist/groupingtags.user.js`

## Build & Test
- `npm run dev` — Vite dev server
- `npm run build` — Run tests + compile + build (`vitest run && tsc && vite build`)
- `npm run test` — Run Vitest
- `npm run lint` / `npm run fix` — GTS lint / auto-fix

## External Dependencies
- **lz-string** — Compression for Gist sync data
- **vite-plugin-monkey** — Tampermonkey header generation and GM_* API bridging

Uses `GM_getValue`, `GM_setValue`, `GM_xmlhttpRequest`, `GM_deleteValue` via `@grant`.

## Architecture

### Entry Point
`src/main.ts` → `main()`: Initializes AutoSync, toggle UI, form interception, syntax highlighting, and sidebar.

### Data Flow
1. User edits tags with grouping syntax in textarea
2. `parser.ts` parses groups on form submit
3. Groups saved to IndexedDB via `db.ts`, tags flattened for Danbooru submission
4. On page load, groups restored from IndexedDB and re-applied to textarea
5. Optionally synced to GitHub Gist via `core/sync-manager.ts`

## Key Rules
- Artist/Copyright/Meta tags cannot be grouped (validation enforced on submit)
- The grouping syntax is `GroupName[ tag1 tag2 tag3 ]`
- `dist/` output is a single bundled `.user.js` — do not edit directly
