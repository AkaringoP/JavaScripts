# Danbooru Post Timeline

Shows **when** an illustration was published on its source platform and how quickly it made its way to Danbooru.

Three chronological entries are inserted into the Information section, right above the existing Date row:

1. **Source platform** — when the artwork was originally published (relative time from now)
2. **Asset** — when the media asset was first uploaded to Danbooru (delta from source)
3. **Post** — when the Danbooru post was created (delta from asset), replacing the default `Date:` label

Hover any entry to see the full absolute datetime.

## Supported Platforms

| Platform | Method | Notes |
| :--- | :--- | :--- |
| Pixiv | `/ajax/illust/{id}` API via `GM_xmlhttpRequest` | R-18 works require Pixiv login |
| X / Twitter | Snowflake ID bitwise extraction | No network request — pure client-side math |
| Bluesky | `public.api.bsky.app` public API | Resolves handle → DID, then fetches post thread |

Posts with unsupported or missing source URLs are silently skipped.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. **[Click here to install](https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/PostTimeline/PostTimeline.user.js)**
3. Confirm the installation in your extension.

## How It Works

- **Source row** displays relative time (e.g. `1 day ago`) and refreshes every 60 seconds to stay in sync with Danbooru's live-updating Date field.
- **Asset row** shows a delta from the source date (e.g. `↳ 33 minutes later`). If the source date is unavailable, it falls back to relative time.
- **Post row** annotates Danbooru's existing Date row with a delta from the asset upload (e.g. `↳ 22 minutes later`).
- Asset and Post deltas are fixed durations and never refresh.
- The precise post timestamp is read from Danbooru's `<time title>` attribute, which has full second-level precision.

## Example
- Pixiv: 1 day ago
- Asset: &nbsp;&nbsp;&nbsp;&nbsp;↳ 33 minutes later
- Post:  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;↳ 22 minutes later

## License

MIT
