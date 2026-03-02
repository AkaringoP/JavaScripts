# DanbooruInsights - Claude Instructions

## Overview
A userscript that injects a GitHub-style contribution graph and analytics dashboard into Danbooru profile, wiki, and artist pages.
Single-file structure (`DanbooruInsights.user.js`, ~12,000 lines).

## External Dependencies (`@require`)
- **d3.v7** - Charts and visualization
- **cal-heatmap** - Calendar heatmap
- **Dexie.js** - IndexedDB wrapper (local caching)

`@grant none` project — GM_* APIs are unavailable.

## Architecture

### Entry Point
`main()` → Routes based on URL path:
- **Profile mode** (`/users/*`, `/profile`): runs `GrassApp` + `UserAnalyticsApp`
- **Tag mode** (`/wiki_pages/*`, `/artists/*`): runs `TagAnalyticsApp`

### Core Classes
| Class | Location (line) | Role |
|---|---|---|
| `CONFIG` | ~25 | Global settings, theme definitions |
| `GLOBAL_CSS` | ~109 | Centralized CSS management |
| `SettingsManager` | ~306 | User settings via localStorage |
| `Database` | ~494 | Dexie.js extension, IndexedDB cache layer |
| `ProfileContext` | ~604 | Extracts user info from the current profile page |
| `DataManager` | ~750 | Danbooru API calls and cache management |
| `GraphRenderer` | ~1524 | Contribution graph UI rendering |
| `GrassApp` | ~3269 | Contribution calendar heatmap app |
| `UserAnalyticsApp` | ~3412 | User analytics dashboard app |
| `AnalyticsDataManager` | ~6524 | DataManager extension for tag analytics |
| `RateLimitedFetch` | ~8376 | API request rate limiter |
| `TagAnalyticsApp` | ~8539 | Tag/artist analytics dashboard app |

### CSS Management
- All styles are centralized in the `GLOBAL_CSS` constant (~line 109)
- Injected once via `injectGlobalStyles()` (~line 290) as a `<style>` tag
- CSS class prefix: `di-` (Danbooru Insights)

### Data Flow
1. `ProfileContext` / `detectCurrentTag()` → Identify target
2. `DataManager` / `AnalyticsDataManager` → Danbooru API calls + IndexedDB caching
3. `GraphRenderer` / App classes → Render visualization with D3.js

## Notes
- File is large — always read the full scope of the relevant class/function before editing
- When adding themes to `CONFIG.THEMES`, maintain the light/dark section comments
- All API calls must go through `RateLimitedFetch` to respect Danbooru rate limits
- `Database` schema changes require version migration (Dexie.js requirement)
