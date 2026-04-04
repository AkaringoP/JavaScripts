# DanbooruInsights - Claude Instructions

## Overview
Danbooru 프로필/위키/아티스트 페이지에 GitHub 스타일 기여 그래프와 분석 대시보드를 삽입하는 Tampermonkey 유저스크립트.

## Critical Rules
- **Report before changing behavior.** Always confirm before making changes that affect existing user-facing behavior.
- After completing work, verify `npm run build` succeeds before reporting done.
- DB schema changes → bump version number in `database.ts` (Dexie.js migration requirement).
- New CSS classes must use `di-` prefix.
- All API calls must go through `RateLimitedFetch` — never use raw `fetch` for Danbooru API.

## Build & Dev
- `npm run dev` — Vite dev server with HMR
- `npm run build` — `vitest run && tsc && vite build` → outputs `dist/danbooruinsights.user.js`
- `npm run lint` / `npm run fix` — GTS lint / auto-fix
- `npm run test` — Unit tests with Vitest

## Domain Glossary
| Term | Meaning |
|---|---|
| Grass | GitHub-style calendar heatmap (contribution graph) |
| Quick Sync | Fast path for users with ≤1200 posts — sequential cursor pagination |
| Full Sync | Standard pagination with retry for large users |
| Delta Sync | Tag analytics incremental update — fetch first 100 posts, re-aggregate if diff ≥ 50 |
| Piestats | Cached aggregated statistics for pie charts (24h expiry) |

## Architecture

### Entry Point
`src/main.ts` → `main()` → Routes based on URL path:
- **Profile mode** (`/users/*`, `/profile`): runs `GrassApp` + `UserAnalyticsApp`
- **Tag mode** (`/wiki_pages/*`, `/artists/*`): runs `TagAnalyticsApp`

### Data Flow
1. `ProfileContext` / `detectCurrentTag()` → Identify target (user or tag)
2. `DataManager` / `AnalyticsDataManager` → Danbooru API calls + IndexedDB caching
3. `GraphRenderer` / App classes → Render visualization with D3.js / CalHeatmap

### Module Structure (post-Phase 5)
| Module | Role |
|---|---|
| `tag-analytics-app.ts` | Dashboard orchestration, modal, UI |
| `tag-analytics-data.ts` | `TagAnalyticsDataService` — API fetching, caching, computation |
| `tag-analytics-charts.ts` | `TagAnalyticsChartRenderer` — D3 charts, milestones, rankings |
| `user-analytics-app.ts` | Dashboard orchestration, sync UI |
| `user-analytics-data.ts` | `UserAnalyticsDataService` — data fetching coordination |
| `user-analytics-charts.ts` | Pie, top posts, milestones, history chart widgets |
| `user-analytics-scatter.ts` | Canvas scatter plot widget |
| `graph-renderer.ts` | CalHeatmap contribution graph |
| `settings-popover.ts` | Theme/threshold settings popover |
| `approval-detail-popover.ts` | Approval post list popover |

## Key Constraints
- `@grant none` — GM_* APIs are unavailable
- `d3` is typed as `any` — do not add `@types/d3` (breaks app file typing)
- Dexie table properties declared as `Table<any>` in `database.ts`
- App classes use composition (dataService, chartRenderer) — no index signatures
- `dist/` output is a single bundled `.user.js` — do not edit directly

## External Dependencies (`@require` / `externalGlobals`)
- **d3.v7** — Charts and visualization (global: `d3`)
- **cal-heatmap** — Calendar heatmap (global: `CalHeatmap`)
- **Dexie.js** — IndexedDB wrapper (global: `Dexie`)

## CSS Management
- All styles centralized in `src/styles.ts` as `GLOBAL_CSS`
- Injected once via `injectGlobalStyles()` as a `<style>` tag
- CSS class prefix: `di-` (Danbooru Insights)

## Rate Limiting (RateLimitedFetch)
Three-queue system with token bucket algorithm:
- **General Queue**: 6 concurrent requests, 6 req/sec, 50-150ms jitter
- **Report Queue**: Isolated, 3-second cooldown for `/reports/` URLs

## Quality Gates (mechanically enforced)
- `test/architecture.test.ts` enforces: dependency direction, no `[key: string]: any`, no raw `fetch()`
- Git pre-commit hook runs `npm run build` on DanbooruInsights changes

## Notes
- When adding themes to `CONFIG.THEMES`, maintain the light/dark section comments (currently 10 themes)
- `getBestThumbnailUrl()` priority: 720x720 webp > 360x360 webp > other variants > preview > file
- `mapConcurrent()` utility controls parallel API calls (used for count fetches, tag filtering)
