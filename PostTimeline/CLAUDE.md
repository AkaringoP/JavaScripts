# PostTimeline - Claude Instructions

## Overview
A userscript that displays the upload timeline of a post in Danbooru's Information section.
Single file (`PostTimeline.user.js`, ~540 lines). `@grant GM_xmlhttpRequest`.

Shows three chronological entries above the Size row:
1. **Source platform** — when the artwork was published on its origin (Pixiv, X/Twitter, Bluesky)
2. **Asset** — when the media asset was first uploaded to Danbooru (delta from source)
3. **Post** — when the Danbooru post was created (delta from asset)

## Supported Platforms

| Platform | Method | Auth | Notes |
|---|---|---|---|
| Pixiv | `/ajax/illust/{id}` API | None (R-18 needs login) | `GM_xmlhttpRequest` for CORS |
| X/Twitter | Snowflake ID bitwise extraction | None | No network request — pure client-side math |
| Bluesky | `public.api.bsky.app` public API | None | Two-step: resolve handle → get post thread |

Unsupported source URLs cause the script to exit silently.

## How It Works

### Timeline Display
- Source row: relative time from now (e.g. `1 day ago`)
- Asset row: delta from source (e.g. `↳ 33 minutes later`)
- Post row: delta from asset (e.g. `↳ 22 minutes later`), replaces Danbooru's `Date:` label
- Hover any entry for absolute datetime tooltip (e.g. `2026-03-19 18:30:17 +0900`)
- Clock cursor on hover for all timeline entries

### Data Flow
1. `detectSource()` checks Source URL → returns `{type, label, ...ids}` or `null`
2. `fetchSourceDate(source)` dispatches to platform-specific fetcher
3. `fetchMediaAssetDate(id)` calls Danbooru's same-origin API
4. Both fetches run in parallel via `Promise.all`
5. DOM rows inserted before Danbooru's Date row; loading placeholders replaced on completion

## Code Structure

| Function | Role |
|---|---|
| `detectSource()` | Identifies platform from Source URL (Pixiv/X/Bluesky) |
| `fetchSourceDate(source)` | Dispatches to correct fetcher based on source type |
| `fetchPixivDate(id)` | Pixiv API via `GM_xmlhttpRequest` |
| `getTwitterTimestamp(id)` | Snowflake ID → ISO timestamp (no network) |
| `fetchBlueskyDate(handle, rkey)` | Resolve handle → DID, then fetch post thread |
| `fetchMediaAssetDate(id)` | Danbooru `/media_assets/{id}.json` via `fetch` |
| `createSourceRow(label, date)` | Builds source platform `<li>` with relative time |
| `createAssetRow(date, sourceDate)` | Builds asset `<li>` with `↳` delta |
| `annotateDateRow(row, assetDate)` | Replaces Danbooru Date row content with `↳` delta |
| `formatRelativeTime(date)` | `"X seconds ago"`, `"about X hours ago"`, etc. |
| `formatDelta(from, to)` | `"X minutes later"`, `"at the same time"`, etc. |
| `formatAbsoluteTime(date)` | Tooltip format: `"2026-03-19 18:30:17 +0900"` |

## Key Design Decisions
- Source row refreshes every 60s to stay in sync with Danbooru's live-updating Date field
- Asset and Post deltas are fixed durations and never refresh
- Danbooru's `<time datetime>` may be truncated to the minute; the `title` attribute has full precision
- Twitter Snowflake epoch: `1288834974657` (2010-11-04T01:42:54.657Z)
