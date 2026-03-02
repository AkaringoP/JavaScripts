# JavaScripts Monorepo - Claude Instructions

## Project Overview
A collection of Tampermonkey userscripts for Danbooru and related sites.
GitHub repository: `AkaringoP/JavaScripts`

### Project List
| Project | Language | Build | Description |
|---|---|---|---|
| DanbooruInsights | JS | None (single file) | Contribution graph & analytics dashboard |
| GroupingTags | TS | Vite + vite-plugin-monkey | Tag grouping |
| LocateInGallery | JS | None (single file) | Gallery page location finder |
| MobileNoteAssist | JS | None (single file) | Mobile note assistant |
| NextRandomPost | JS | None (single file) | Random post navigation |

## Common Environment
- All scripts are Tampermonkey userscripts
- Browser environment only (Node.js APIs unavailable)
- JS projects: single `.user.js` file output (no bundler)
- TS projects (GroupingTags): built with Vite, output to `dist/` directory

## Code Style
- JavaScript: Follow [GJS (Google JavaScript Style Guide)](https://google.github.io/styleguide/jsguide.html)
- TypeScript: Follow [GTS (Google TypeScript Style Guide)](https://google.github.io/styleguide/tsguide.html)

## Working Principles
- **Report before changing behavior**: Always confirm before making changes that affect existing behavior
- **Report changed files after each task**: Clearly state which files were changed and how
- **One task at a time**: Do not mix multiple tasks in a single session
- **Preserve UserScript headers**: Do not arbitrarily modify metadata blocks such as `@version`, `@match`, `@grant`

## Git Branching Strategy (Simplified GitFlow)
- `main` — Stable releases only. Always deployable.
- `develop` — Integration branch. All feature branches merge here first.
- `feature/*` — New features and bug fixes. Branch off from `develop`, merge back to `develop`.
- Direct commits to `main` are not allowed. Merge via `develop → main` only.
- Branch naming: `feature/<short-description>` (e.g., `feature/artist-memo`)

## Notes
- Projects with `@grant none` cannot use GM_* APIs
- External libraries must be loaded via `@require` only (no import/require, except for TS build projects)
- CSS is managed collectively in a `GLOBAL_CSS` constant and injected via JS (no separate CSS files)
