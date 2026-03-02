# LocateInGallery - Claude Instructions

## Overview
A userscript that finds the gallery page number where the current post appears within a search query.
Single file (`LocateInGallery.user.js`, ~520 lines). `@grant none`.

## How It Works
Adds a "Locate in gallery" link to the post sidebar. When clicked, determines which page of the gallery listing contains the current post, then redirects to that page with the post highlighted.

### Search Strategies
| Strategy | When Used | Method |
|---|---|---|
| History (fast path) | Always tried first | Check localStorage for recent page visits |
| Calculation (O(1)) | Default sort or `order:id` | Uses `/counts/posts.json` to count preceding posts |
| Batch Search | Custom sort orders | Parallel batch scanning with adaptive limit detection |

### Key Constants
- `BATCH_SIZE = 5` — Parallel requests per batch
- `MAX_SCAN_LIMIT = 1000` — Max items per request (Gold users), falls back to 200
- `REQUEST_DELAY_MS = 600` — Delay between batches for rate limiting

### Features
- `order:random` query restoration via `sessionStorage`
- Keyboard shortcut: `Alt + Shift + Left Arrow`
- Abort with `Escape` key during search
- Adaptive limit detection (Gold 1000 / Basic 200)

## Code Structure
- Constants & config → Helper functions (`sleep`, `waitForElement`, `getEffectiveLimit`)
- `performCountCalculation()` — Strategy 1 (count API)
- `performBatchSearch()` — Strategy 2 (parallel scan)
- `logCurrentPage()` / `checkHistory()` — History-based fast path
- `executeLocate()` — Main orchestrator
- `restoreQueryContext()` — Restore `order:random` queries
- `init()` — UI injection and event listeners
