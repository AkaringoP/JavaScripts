# PostTimeline - Claude Instructions

## Overview
A userscript that displays the upload timeline of a post in Danbooru's Information section.
Single file (`PostTimeline.user.js`). `@grant GM_xmlhttpRequest`, `@grant GM_cookie.list`.

Shows three chronological entries above the Size row:
1. **Source platform** — when the artwork was published on its origin
2. **Asset** — when the media asset was first uploaded to Danbooru
3. **Post** — when the Danbooru post was created

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
| DeviantArt | `backend.deviantart.com/oembed` public oEmbed API | None | Uses `pubdate` field (RFC 2822); mature content shows "unavailable" |

Unsupported source URLs cause the script to exit silently.

## Key Design Decisions
- All three rows show relative time ("ago") for consistency; deltas moved to tooltips
- All three rows refresh every 60s via `setInterval`; Danbooru's `<time>` is hidden to prevent inconsistent rounding
- Custom CSS tooltips (`.pt-tooltip` / `.pt-tip`) used instead of native `title` to support colored delta text
- Delta colors in tooltips: red = sniper (source→asset < 60s AND asset→post < 15s), green = archive dig (source→asset ≥ 30d)

## Turbo Lifecycle
- `turbo:load` triggers `init()` on Turbo navigation
- `turbo:before-visit` triggers `cleanup()` to clear refresh interval
- Generation counter (`initGeneration`) discards stale async results
- Duplicate guard via `#pt-source-row` prevents double execution

## Third-Party Cookie Handling
- `GM_xmlhttpRequest` cookie forwarding is affected when the target domain differs from `danbooru.donmai.us`
- `readCookies(url)` uses `GM_cookie.list` to read from the browser's unpartitioned cookie store and attaches cookies manually via the `Cookie` header
- `HAS_GM_COOKIE` constant: when `false` (Safari, Violentmonkey, Greasemonkey), auth-required platforms show "unavailable" instead of "login required"
- When `HAS_GM_COOKIE` is `true` (Chrome/Firefox + Tampermonkey), auth-failure shows "login required (log in)" with a link
