# PostTimeline - Claude Instructions

## Overview
A userscript that displays the upload timeline of a post in Danbooru's Information section.
Single file (`PostTimeline.user.js`, ~1100 lines). `@grant GM_xmlhttpRequest`, `@grant GM_cookie.list`.

Shows three chronological entries above the Size row:
1. **Source platform** — when the artwork was published on its origin (Pixiv, X/Twitter, Bluesky, Fanbox, Fantia, Nico Seiga, Pawoo, ArtStation)
2. **Asset** — when the media asset was first uploaded to Danbooru
3. **Post** — when the Danbooru post was created (Danbooru's Date row, relabelled)

## Supported Platforms

| Platform | Method | Auth | Notes |
|---|---|---|---|
| Pixiv | `/ajax/illust/{id}` API | None (R-18 needs login) | `GM_xmlhttpRequest` for CORS |
| X/Twitter | Snowflake ID bitwise extraction | None | No network request — pure client-side math |
| Bluesky | `public.api.bsky.app` public API | None | Two-step: resolve handle → get post thread |
| Fanbox | `api.fanbox.cc/post.info` API | Session cookie | `GM_cookie.list` for explicit cookie sending |
| Fantia | `fantia.jp/api/v1/posts/{id}` API | Session cookie | `GM_cookie.list` for explicit cookie sending |
| Nico Seiga | HTML scraping of `<span class="created">` | Session cookie | `GM_cookie.list` for explicit cookie sending |
| Pawoo | `pawoo.net/api/v1/statuses/{id}` public API | None | Mastodon instance |
| ArtStation | `artstation.com/projects/{hash}.json` public API | None | Uses `published_at` field |

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
2. `fetchSourceDate(source)` dispatches to platform-specific fetcher → returns `SourceDateResult`
3. `fetchMediaAssetDate(id)` calls Danbooru's same-origin API
4. Both fetches run in parallel via `Promise.all`
5. DOM rows inserted before Danbooru's Date row; loading placeholders replaced on completion
6. Tooltip deltas and colors computed after all dates are resolved

### Turbo Lifecycle
- `turbo:load` triggers `init()` on Turbo navigation
- `turbo:before-visit` triggers `cleanup()` to clear refresh interval
- Generation counter (`initGeneration`) discards stale async results
- Duplicate guard via `#pt-source-row` prevents double execution

### Third-Party Cookie Handling
- Modern browsers block third-party cookies (Chrome Privacy Sandbox, Firefox ETP, Safari ITP)
- `GM_xmlhttpRequest` cookie forwarding is affected when the target domain differs from `danbooru.donmai.us`
- `readCookies(url)` uses `GM_cookie.list` to read from the browser's unpartitioned cookie store and attaches cookies manually via the `Cookie` header
- `HAS_GM_COOKIE` constant: when `false` (Safari, Violentmonkey, Greasemonkey), auth-required platforms show "unavailable" instead of "login required" to avoid misleading users into futile login attempts

## Code Structure

| Function | Role |
|---|---|
| `injectStyles()` | Injects `GLOBAL_CSS` into document head (duplicate-guarded) |
| `detectSource()` | Identifies platform from Source URL (8 platforms) |
| `fetchSourceDate(source)` | Dispatches to correct fetcher; returns `SourceDateResult` |
| `fetchPixivDate(id)` | Pixiv API via `GM_xmlhttpRequest` |
| `getTwitterTimestamp(id)` | Snowflake ID → ISO timestamp (no network) |
| `fetchBlueskyDate(handle, rkey)` | Resolve handle → DID, then fetch post thread |
| `readCookies(url)` | Reads cookies via `GM_cookie.list`; returns empty string if unavailable |
| `fetchFanboxDate(postId)` | Fanbox API; explicit cookies via `readCookies`; loginRequired on 400/401/403 |
| `fetchFantiaDate(postId)` | Fantia API; explicit cookies via `readCookies`; parses RFC 2822 `posted_at` |
| `parseSeigaDate(dateStr)` | `"2024年03月19日 18:30:17"` → ISO 8601 (+09:00 fixed) |
| `fetchSeigaDate(illustId)` | HTML scraping of Seiga page; explicit cookies via `readCookies` |
| `fetchPawooDate(statusId)` | Pawoo (Mastodon) public API |
| `fetchArtStationDate(hash)` | ArtStation public JSON API; uses `published_at` |
| `fetchMediaAssetDate(id)` | Danbooru `/media_assets/{id}.json` via `fetch` |
| `createTooltipSpan(text, absTime, deltaText, color)` | Builds `.pt-tooltip` wrapper with custom CSS tooltip |
| `createSourceRow(label, date, tooltipOpts, loginOpts)` | Builds source platform `<li>`; shows "login required (log in)" or "unavailable" |
| `createAssetRow(date, tooltipOpts)` | Builds asset `<li>` with relative time + tooltip |
| `annotateDateRow(row, postDate)` | Renames Danbooru Date label to "Post:", replaces time with our `formatRelativeTime` |
| `formatRelativeTime(date)` | `"X seconds ago"`, `"about X hours ago"`, etc. |
| `formatDeltaAbbrev(from, to)` | Abbreviated delta for tooltips: `"12y"`, `"3mo"`, `"5d"`, etc. |
| `determineDeltaColors(source, asset, post)` | Returns `{sourceColor, assetColor}` based on sniper/archive rules |
| `formatAbsoluteTime(date)` | Tooltip format: `"2026-03-19 18:30:17 +0900"` |
| `cleanup()` | Clears refresh interval (called on Turbo navigation) |
| `init()` | Main orchestrator with generation counter for async safety |

## Constants

| Constant | Role |
|---|---|
| `CLOCK_CURSOR` | SVG clock icon cursor for date elements |
| `TWITTER_EPOCH` | Snowflake epoch `1288834974657n` (2010-11-04T01:42:54.657Z) |
| `HAS_GM_COOKIE` | Whether `GM_cookie.list` is available; controls auth-failure UI |
| `GLOBAL_CSS` | CSS for `.pt-tooltip` / `.pt-tip` custom tooltip component |

## Key Design Decisions
- All three rows show "ago" (relative to now) for consistency; deltas moved to tooltips
- All three rows refresh every 60s via our own `setInterval`; Danbooru's `<time>` is hidden to prevent inconsistent rounding
- Custom CSS tooltips (`.pt-tooltip` / `.pt-tip`) used instead of native `title` to support colored delta text
- Turbo lifecycle handled via `turbo:load` / `turbo:before-visit` events
- Generation counter pattern prevents stale async fetch results from modifying the DOM
- Danbooru's `<time datetime>` may be truncated to the minute; the `title` attribute has full precision
- Twitter Snowflake epoch: `1288834974657` (2010-11-04T01:42:54.657Z)
- `getMediaAssetId()` null → Asset row shows "unavailable", no Post tooltip delta
- `SourceDateResult` typedef: `{date: string|null, loginRequired?: boolean, loginUrl?: string}`
- Auth-required platforms (Fanbox, Fantia, Seiga) use `readCookies()` + `GM_cookie.list` to explicitly attach session cookies, bypassing third-party cookie restrictions
- When `HAS_GM_COOKIE` is false (Safari + Tampermonkey, Violentmonkey, Greasemonkey), auth-failure shows "unavailable" instead of "login required (log in)" — logging in cannot fix the issue since cookies cannot be forwarded
- When `HAS_GM_COOKIE` is true (Chrome/Firefox + Tampermonkey), auth-failure shows "login required (log in)" with a link to the platform's login page
