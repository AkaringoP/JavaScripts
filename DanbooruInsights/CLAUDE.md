# DanbooruInsights - Claude Instructions

## Overview
A userscript that injects a GitHub-style contribution graph and analytics dashboard into Danbooru profile, wiki, and artist pages.

**Current state: TypeScript migration complete (v7.0.0).**

## Critical Rule
**ZERO functional changes.** Any future work must preserve all existing user-facing behavior.

## External Dependencies (`@require` / `externalGlobals`)
- **d3.v7** — Charts and visualization (global: `d3`)
- **cal-heatmap** — Calendar heatmap (global: `CalHeatmap`)
- **Dexie.js** — IndexedDB wrapper (global: `Dexie`)

`@grant none` project — GM_* APIs are unavailable.

## Build & Dev
- `npm run dev` — Vite dev server with HMR
- `npm run build` — `vitest run && tsc && vite build` → outputs `dist/danbooruinsights.user.js`
- `npm run lint` / `npm run fix` — GTS lint / auto-fix
- `npm run test` — Run 55 unit tests with Vitest

## Architecture

### Entry Point
`src/main.ts` → `main()` → Routes based on URL path:
- **Profile mode** (`/users/*`, `/profile`): runs `GrassApp` + `UserAnalyticsApp`
- **Tag mode** (`/wiki_pages/*`, `/artists/*`): runs `TagAnalyticsApp`

### Module Structure
```
src/
├── main.ts                        # Entry point, routing
├── config.ts                      # CONFIG object, theme definitions
├── styles.ts                      # GLOBAL_CSS, injectGlobalStyles()
├── types.ts                       # Shared interfaces and type aliases
├── utils.ts                       # isTopLevelTag, helpers
├── core/
│   ├── settings.ts                # SettingsManager (localStorage)
│   ├── database.ts                # Database (Dexie.js extension)
│   ├── profile-context.ts         # ProfileContext (DOM extraction)
│   ├── data-manager.ts            # DataManager (API + cache)
│   ├── analytics-data-manager.ts  # AnalyticsDataManager (extends DataManager)
│   └── rate-limiter.ts            # RateLimitedFetch
├── ui/
│   └── graph-renderer.ts          # GraphRenderer
└── apps/
    ├── grass-app.ts               # GrassApp (calendar heatmap)
    ├── user-analytics-app.ts      # UserAnalyticsApp (user dashboard)
    └── tag-analytics-app.ts       # TagAnalyticsApp (tag/artist dashboard)
```

### Test Coverage (55 tests in `test/`)
| Test file | Target | What's tested |
|---|---|---|
| `config.test.ts` | `config.ts` | Theme required fields, constant integrity |
| `settings.test.ts` | `core/settings.ts` | Deep merge, legacy migration, fallback |
| `rate-limiter.test.ts` | `core/rate-limiter.ts` | Token bucket refill, queue routing, concurrency |
| `utils.test.ts` | `utils.ts` | `isTopLevelTag()` API call / result |
| `analytics-data-manager.test.ts` | `core/analytics-data-manager.ts` | `getBestThumbnailUrl()` URL selection |
| `main.test.ts` | `main.ts` | `detectCurrentTag()` wiki branch |

### CSS Management
- All styles are centralized in `src/styles.ts` as `GLOBAL_CSS`
- Injected once via `injectGlobalStyles()` as a `<style>` tag
- CSS class prefix: `di-` (Danbooru Insights)

### Data Flow
1. `ProfileContext` / `detectCurrentTag()` → Identify target
2. `DataManager` / `AnalyticsDataManager` → Danbooru API calls + IndexedDB caching
3. `GraphRenderer` / App classes → Render visualization with D3.js

## TypeScript Notes
- `strict: false`, `noImplicitAny: false` — progressive typing policy
- `d3` is typed as `any` (no `@types/d3` installed — would break app file typing)
- Dexie table properties declared as `Table<any>` in `database.ts`
- App classes retain `[key: string]: any` index signature (intentional)

## Notes
- When adding themes to `CONFIG.THEMES`, maintain the light/dark section comments
- All API calls must go through `RateLimitedFetch` to respect Danbooru rate limits
- `Database` schema changes require version migration (Dexie.js requirement)
- `dist/` output is a single bundled `.user.js` — do not edit directly
