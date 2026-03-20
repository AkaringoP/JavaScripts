# Danbooru Post Timeline

Tracks the journey from source platform to Danbooru by showing when the artwork was originally published, when the media asset was uploaded, and when the post was created.

Three chronological entries are inserted into the Information section:

1. **Source platform** — when the artwork was originally published
2. **Asset** — when the media asset was first uploaded to Danbooru
3. **Post** — when the Danbooru post was created, replacing the default `Date:` label

All three rows display relative time from now (e.g. `3 years ago`). Hover any entry to see the full absolute datetime and an abbreviated delta to the next stage (e.g. `12y before Asset`).

## Supported Platforms

| Platform | Method | Notes |
| :--- | :--- | :--- |
| Pixiv | `/ajax/illust/{id}` API | R-18 works require Pixiv login |
| X / Twitter | Snowflake ID bitwise extraction | No network request — pure client-side math |
| Bluesky | `public.api.bsky.app` public API | Resolves handle → DID, then fetches post thread |
| Fanbox | `api.fanbox.cc` API | Requires Fanbox login |
| Fantia | `fantia.jp/api/v1` API | Requires Fantia login |
| Nico Seiga | HTML scraping | Requires Niconico login |
| Pawoo | Mastodon public API | No login required |
| ArtStation | Public JSON API | No login required |

Posts with unsupported or missing source URLs are silently skipped.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. **[Click here to install](https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/PostTimeline/PostTimeline.user.js)**
3. Confirm the installation in your extension.

## How It Works

- All three rows show relative time (e.g. `3 years ago`) and refresh every 60 seconds.
- Hover to see a custom tooltip with the absolute datetime and a delta to the next stage (e.g. `2023-03-19 18:30:17 +0900 (12y before Asset)`).
- Tooltip deltas are color-coded:
  - **Red** — sniper detected (source → asset < 60s AND asset → post < 15s)
  - **Green** — archive dig (source → asset ≥ 30 days)
- Auth-required platforms (Fanbox, Fantia, Nico Seiga) show a "login required" link when not logged in. On browsers/extensions without `GM_cookie` support (Safari, Violentmonkey), these show "unavailable" instead.

## Example

```
Pixiv:  15 years ago          tooltip: "2011-03-19 18:30:17 +0900 (12y before Asset)"
Asset:  3 years ago           tooltip: "2023-03-19 18:30:17 +0900 (3y before Post)"
Post:   41 minutes ago        tooltip: "2026-03-20 14:30:17 +0900"
```

## License

MIT
