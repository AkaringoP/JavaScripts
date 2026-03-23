# JavaScripts Monorepo - Claude Instructions

## Project Overview
A collection of Tampermonkey userscripts for Danbooru and related sites.
GitHub repository: `AkaringoP/JavaScripts`

### Project List
| Project | Language | Build | Description |
|---|---|---|---|
| DanbooruInsights | TS | Vite + vite-plugin-monkey | Contribution graph & analytics dashboard |
| GroupingTags | TS | Vite + vite-plugin-monkey | Tag grouping |
| LocateInGallery | JS | None (single file) | Gallery page location finder |
| MobileNoteAssist | JS | None (single file) | Mobile note assistant |
| NextRandomPost | JS | None (single file) | Random post navigation |
| PostTimeline | JS | None (single file) | Post timeline (source publish date, asset upload, post creation) |

## Common Environment
- All scripts are Tampermonkey userscripts
- Browser environment only (Node.js APIs unavailable)
- JS projects: single `.user.js` file output (no bundler)
- TS projects (DanbooruInsights, GroupingTags): built with Vite, output to `dist/` directory

## Code Style
- JavaScript: Follow [GJS (Google JavaScript Style Guide)](https://google.github.io/styleguide/jsguide.html)
- TypeScript: Follow [GTS (Google TypeScript Style Guide)](https://google.github.io/styleguide/tsguide.html)

## Working Principles
- **Report before changing behavior**: Always confirm before making changes that affect existing behavior
- **Report changed files after each task**: Clearly state which files were changed and how
- **One task at a time**: Do not mix multiple tasks in a single session
- **Preserve UserScript headers**: Do not arbitrarily modify metadata blocks such as `@version`, `@match`, `@grant`

## Multi-Model Workflow
When multiple tasks are queued, use a two-model pipeline:
1. **Opus** — Algorithms, core logic, architectural decisions, and code review after each task
2. **Sonnet** — Straightforward implementation (dead code removal, refactoring, mechanical changes)

Process per task:
1. Opus or Sonnet implements (based on complexity)
2. Opus reviews the result
3. If issues found → Sonnet fixes → Opus re-reviews
4. Move to next task once review passes

## Git Branching Strategy
- `main` — Stable releases only. Always deployable.
- `feature/*` — New features and improvements. Branch off from `main`, merge back to `main`.
- `hotfix/*` — Urgent bug fixes. Branch off from `main`, merge back to `main`.
- Direct commits to `main` are not allowed.
- Branch naming: `feature/<short-description>` / `hotfix/<short-description>`

## Notes
- Projects with `@grant none` cannot use GM_* APIs
- External libraries must be loaded via `@require` only (no import/require, except for TS build projects)
- CSS is managed collectively in a `GLOBAL_CSS` constant and injected via JS (no separate CSS files)
