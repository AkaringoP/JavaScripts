# DanbooruInsights - Claude Instructions

## Overview
Danbooru 프로필/위키/아티스트 페이지에 GitHub 스타일 기여 그래프와 분석 대시보드를 삽입하는 Tampermonkey 유저스크립트.

**Current version: v7.2.2** · ~12,930 LoC (src) · 62 unit tests

## Critical Rule
**Report before changing behavior.** Always confirm before making changes that affect existing user-facing behavior.

## External Dependencies (`@require` / `externalGlobals`)
- **d3.v7** — Charts and visualization (global: `d3`)
- **cal-heatmap** — Calendar heatmap (global: `CalHeatmap`)
- **Dexie.js** — IndexedDB wrapper (global: `Dexie`)

`@grant none` project — GM_* APIs are unavailable.

## Build & Dev
- `npm run dev` — Vite dev server with HMR
- `npm run build` — `vitest run && tsc && vite build` → outputs `dist/danbooruinsights.user.js`
- `npm run lint` / `npm run fix` — GTS lint / auto-fix
- `npm run test` — Run 62 unit tests with Vitest

## Architecture

### Entry Point
`src/main.ts` → `main()` → Routes based on URL path:
- **Profile mode** (`/users/*`, `/profile`): runs `GrassApp` + `UserAnalyticsApp`
- **Tag mode** (`/wiki_pages/*`, `/artists/*`): runs `TagAnalyticsApp`

### Module Structure
```
src/                                 LoC
├── main.ts                           96   # Entry point, URL routing
├── config.ts                         89   # CONFIG object, 10 themes, rate limiter settings
├── styles.ts                        193   # GLOBAL_CSS, injectGlobalStyles()
├── types.ts                         108   # Shared interfaces and type aliases
├── utils.ts                          34   # escapeHtml, isTopLevelTag
├── core/
│   ├── settings.ts                  190   # SettingsManager (localStorage)
│   ├── database.ts                  130   # Database (Dexie.js, 9 schema versions)
│   ├── profile-context.ts           143   # ProfileContext (DOM extraction)
│   ├── rate-limiter.ts              206   # RateLimitedFetch (token bucket + 3 queues)
│   ├── data-manager.ts              807   # DataManager (grass data: fetch, sync, cache)
│   └── analytics-data-manager.ts   2051   # AnalyticsDataManager (extends DataManager)
├── ui/
│   └── graph-renderer.ts           1759   # CalHeatmap rendering, controls, theme UI
└── apps/
    ├── grass-app.ts                 154   # GrassApp (calendar heatmap orchestration)
    ├── user-analytics-app.ts       3299   # UserAnalyticsApp (profile analytics dashboard)
    └── tag-analytics-app.ts        3671   # TagAnalyticsApp (wiki/artist analytics dashboard)
```

### Test Coverage (54 tests in `test/`)
| Test file | Target | What's tested |
|---|---|---|
| `config.test.ts` | `config.ts` | Theme required fields, constant integrity |
| `settings.test.ts` | `core/settings.ts` | Deep merge, legacy migration, fallback |
| `rate-limiter.test.ts` | `core/rate-limiter.ts` | Token bucket refill, queue routing, concurrency |
| `utils.test.ts` | `utils.ts` | `isTopLevelTag()` API call / result |
| `analytics-data-manager.test.ts` | `core/analytics-data-manager.ts` | `getBestThumbnailUrl()` URL selection |
| `main.test.ts` | `main.ts` | `detectCurrentTag()` wiki/artist routing |

### CSS Management
- All styles are centralized in `src/styles.ts` as `GLOBAL_CSS`
- Injected once via `injectGlobalStyles()` as a `<style>` tag
- CSS class prefix: `di-` (Danbooru Insights)

## Data Flow
1. `ProfileContext` / `detectCurrentTag()` → Identify target (user or tag)
2. `DataManager` / `AnalyticsDataManager` → Danbooru API calls + IndexedDB caching
3. `GraphRenderer` / App classes → Render visualization with D3.js / CalHeatmap

## TypeScript Notes
- Extends `gts/tsconfig-google.json` with strict mode enabled
- `d3` is typed as `any` (no `@types/d3` installed — would break app file typing)
- Dexie table properties declared as `Table<any>` in `database.ts`
- App classes retain `[key: string]: any` index signature (intentional)

## Database Schema (Dexie.js, 9 versions)

| Table | Key fields | Purpose |
|---|---|---|
| `uploads` | id, userId, date, count | Daily upload counts |
| `approvals` | id, userId, date, count | Daily approval counts |
| `notes` | id, userId, date, count | Daily note edit counts |
| `posts` | id, uploader_id, no, created_at, score, rating | Full post history |
| `piestats` | [key+userId], updated_at | Cached pie chart statistics (24h expiry) |
| `completed_years` | userId, metric, year | Past year completion flags |
| `hourly_stats` | userId, metric, year | 24-hour distribution cache |
| `tag_analytics` | tagName, updatedAt | Wiki/artist tag report cache (24h expiry) |
| `grass_settings` | userId, width, xOffset | Graph layout persistence |

Key compound indexes: `[uploader_id+no]` (milestone lookups), `[uploader_id+score]` (top-score queries).
Schema changes require version migration (Dexie.js requirement).

## Rate Limiting (RateLimitedFetch)

Three-queue system with token bucket algorithm:
- **General Queue**: 6 concurrent requests, 6 req/sec, 50-150ms jitter
- **Report Queue**: Isolated, 3-second cooldown for `/reports/` URLs (e.g. `/reports/posts.json`)

All API calls must go through `RateLimitedFetch`.

## Sync Strategies

### Grass Sync (DataManager — uploads/approvals/notes)
- **Incremental**: Start from last cached date minus 3-day safety buffer
- **Integrity check**: For past years, compare remote count vs local sum; force re-fetch on mismatch
- **Completion cache**: Mark past years as complete to skip future fetches
- **Batch**: 200 items/page, 5 concurrent pages, exponential backoff on 429/5xx

### User Analytics Sync (AnalyticsDataManager)
- **Quick Sync** (`quickSyncAllPosts`): For users with ≤1200 total posts. Sequential cursor-based pagination. Auto-triggered in `renderDashboard()`.
- **Full Sync** (`syncAllPosts`): For large users. Standard pagination with retry, streaming iteration for memory efficiency.
- Both strategies store posts in IndexedDB and call `refreshAllStats()` to populate the piestats cache.

### Tag Analytics Sync (TagAnalyticsApp)
- **Cache-First**: Load from `tag_analytics` table, check 24h expiry + post count diff
- **Delta Sync**: Fetch first 100 posts to detect changes; if diff ≥ threshold (50), fetch delta and re-aggregate
- **Full Sync**: For new tags, fetch all posts and aggregate by user
- **Small Tag Optimization**: Tags with ≤1200 posts (`MAX_OPTIMIZED_POSTS`) are fetched entirely into memory — history, rankings, and milestones calculated locally without DB storage.

## App Features

### GrassApp (Profile — Calendar Heatmap)
- CalHeatmap contribution graph injected after `.user-statistics`
- Year dropdown (join year to current), metric buttons (uploads/approvals/notes)
- Per-user metric preference persistence
- Theme selector (10 themes: light/dark variants)
- Threshold customization per metric

### UserAnalyticsApp (Profile — Analytics Dashboard)
- Modal overlay triggered by 📊 button next to username
- **Summary**: Max uploads, streaks, active days, first/last upload
- **Monthly Timeline**: Aggregated monthly upload chart with gap-filling
- **Scatter Plot**: Score vs date, colored by rating (G/S/Q/E)
- **Distribution Charts**: Character, Copyright, Fav Copyright, Breast Size, Status, Rating (each with pie chart + top-10 list)
- **Special Posts**: Milestones (auto-scaling steps), Top Score by Rating, Recent Popular, Random
- **User History Timeline**: Promotion history, level change tracking (parsed from user_feedbacks)
- Lazy thumbnail enrichment in background
- Cached in piestats table (24h expiry)

### TagAnalyticsApp (Wiki/Artist — Tag Dashboard)
- Modal overlay on wiki/artist pages (category 1=Artist, 3=Copyright, 4=Character)
- **Overview**: Post count, contributor count, media type breakdown
- **Top Contributors**: Ranked by upload count, color-coded by user level
- **Milestones**: 100th, 1000th, 10000th posts with thumbnails
- **Timeline**: User contributions over time
- Inline status label (green=fresh cache, red=sync needed)

## API Endpoints Used

| Endpoint | Purpose |
|---|---|
| `/posts.json` | Fetch uploads (tags, only, limit, page) |
| `/post_approvals.json` | Fetch approvals (search params) |
| `/note_versions.json` | Fetch notes (search params) |
| `/counts/posts.json` | Count queries (integrity checks, rating counts) |
| `/related_tag.json` | Character/copyright distribution (category filter) |
| `/tag_implications.json` | Top-level tag detection |
| `/user_feedbacks.json` | Promotion/level change history |
| `/posts/random.json` | Random post fetch |
| `/posts/{id}.json` | Single post details (milestone thumbnails) |

## Notes
- When adding themes to `CONFIG.THEMES`, maintain the light/dark section comments (currently 10 themes)
- `dist/` output is a single bundled `.user.js` — do not edit directly
- `Database` schema changes require version migration with new version number
- `getBestThumbnailUrl()` priority: 720x720 webp > 360x360 webp > other variants > preview > file
- `mapConcurrent()` utility controls parallel API calls (used for count fetches, tag filtering)
