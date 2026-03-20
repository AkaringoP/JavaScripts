# PostTimeline - Claude Instructions

## Overview
A userscript that displays the upload timeline of a post in Danbooru's Information section.
Single file (`PostTimeline.user.js`, ~700 lines). `@grant GM_xmlhttpRequest`.

Shows three chronological entries above the Size row:
1. **Source platform** — when the artwork was published on its origin (Pixiv, X/Twitter, Bluesky)
2. **Asset** — when the media asset was first uploaded to Danbooru
3. **Post** — when the Danbooru post was created (Danbooru's Date row, relabelled)

## Supported Platforms

| Platform | Method | Auth | Notes |
|---|---|---|---|
| Pixiv | `/ajax/illust/{id}` API | None (R-18 needs login) | `GM_xmlhttpRequest` for CORS |
| X/Twitter | Snowflake ID bitwise extraction | None | No network request — pure client-side math |
| Bluesky | `public.api.bsky.app` public API | None | Two-step: resolve handle → get post thread |

Unsupported source URLs cause the script to exit silently.

## How It Works

### Timeline Display
- All three rows show relative time from now (e.g. `3 years ago`) using our `formatRelativeTime`
- Post row: Danbooru's `Date:` label renamed to `Post:`, Danbooru's `<time>` hidden and replaced with our own `formatRelativeTime` for consistency
- Custom CSS tooltips on hover showing absolute datetime (e.g. `2026-03-19 18:30:17 +0900`)
- Source/Asset tooltips include abbreviated delta to the next row (e.g. `(12y before Asset)`)
- Post tooltip shows absolute time only (reference point, no delta)
- Delta colors in tooltips: red = sniper (source→asset < 60s AND asset→post < 15s), green = archive dig (source→asset ≥ 30d)
- Source/Asset rows: clock cursor on hover; Post row: pointer cursor (clickable link)

### Data Flow
1. `detectSource()` checks Source URL → returns `{type, label, ...ids}` or `null`
2. `fetchSourceDate(source)` dispatches to platform-specific fetcher
3. `fetchMediaAssetDate(id)` calls Danbooru's same-origin API
4. Both fetches run in parallel via `Promise.all`
5. DOM rows inserted before Danbooru's Date row; loading placeholders replaced on completion
6. Tooltip deltas and colors computed after all dates are resolved

### Turbo Lifecycle
- `turbo:load` triggers `init()` on Turbo navigation
- `turbo:before-visit` triggers `cleanup()` to clear refresh interval
- Generation counter (`initGeneration`) discards stale async results
- Duplicate guard via `#pt-source-row` prevents double execution

## Code Structure

| Function | Role |
|---|---|
| `injectStyles()` | Injects `GLOBAL_CSS` into document head (duplicate-guarded) |
| `detectSource()` | Identifies platform from Source URL (Pixiv/X/Bluesky) |
| `fetchSourceDate(source)` | Dispatches to correct fetcher based on source type |
| `fetchPixivDate(id)` | Pixiv API via `GM_xmlhttpRequest` |
| `getTwitterTimestamp(id)` | Snowflake ID → ISO timestamp (no network) |
| `fetchBlueskyDate(handle, rkey)` | Resolve handle → DID, then fetch post thread |
| `fetchMediaAssetDate(id)` | Danbooru `/media_assets/{id}.json` via `fetch` |
| `createTooltipSpan(text, absTime, deltaText, color)` | Builds `.pt-tooltip` wrapper with custom CSS tooltip |
| `createSourceRow(label, date, tooltipOpts)` | Builds source platform `<li>` with relative time + tooltip |
| `createAssetRow(date, tooltipOpts)` | Builds asset `<li>` with relative time + tooltip |
| `annotateDateRow(row, postDate)` | Renames Danbooru Date label to "Post:", replaces time with our `formatRelativeTime` |
| `formatRelativeTime(date)` | `"X seconds ago"`, `"about X hours ago"`, etc. |
| `formatDeltaAbbrev(from, to)` | Abbreviated delta for tooltips: `"12y"`, `"3mo"`, `"5d"`, etc. |
| `determineDeltaColors(source, asset, post)` | Returns `{sourceColor, assetColor}` based on sniper/archive rules |
| `formatAbsoluteTime(date)` | Tooltip format: `"2026-03-19 18:30:17 +0900"` |
| `cleanup()` | Clears refresh interval (called on Turbo navigation) |
| `init()` | Main orchestrator with generation counter for async safety |

## Key Design Decisions
- All three rows show "ago" (relative to now) for consistency; deltas moved to tooltips
- All three rows refresh every 60s via our own `setInterval`; Danbooru's `<time>` is hidden to prevent inconsistent rounding
- Custom CSS tooltips (`.pt-tooltip` / `.pt-tip`) used instead of native `title` to support colored delta text
- Turbo lifecycle handled via `turbo:load` / `turbo:before-visit` events
- Generation counter pattern prevents stale async fetch results from modifying the DOM
- Danbooru's `<time datetime>` may be truncated to the minute; the `title` attribute has full precision
- Twitter Snowflake epoch: `1288834974657` (2010-11-04T01:42:54.657Z)
- `getMediaAssetId()` null → Asset row shows "unavailable", no Post tooltip delta
