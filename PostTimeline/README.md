# Danbooru Post Timeline

A Tampermonkey userscript that shows the full timeline of a Danbooru post: when the artwork was originally published, when its image first arrived on Danbooru, and when this particular post was created.

[**Click here to install (v1.3)**](https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/PostTimeline/PostTimeline.user.js) — requires [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).

## What you see

The script adds three rows to a post's Information section, in chronological order:

| Row | Meaning |
| :--- | :--- |
| **Source** | When the artwork was first published on its original platform (Pixiv, X, etc.) |
| **Asset** | When the image file was first uploaded to Danbooru (could be by anyone, in any post) |
| **Post** | When *this* Danbooru post was created (replaces the default `Date:` row) |

Each row shows the time relative to now (`3 years ago`) and refreshes every 60 seconds so the values stay accurate as you read.

Hover, tap, or `Tab` onto any row to reveal a tooltip with the exact timestamp and the gap to the next stage:

```
Pixiv:  15 years ago      →  2011-03-19 18:30:17 +0900  (12y before Asset)
Asset:  3 years ago       →  2023-03-19 18:30:17 +0900  (3y before Post)
Post:   41 minutes ago    →  2026-03-20 14:30:17 +0900
```

## Tooltip colors

Delta gaps are color-coded to highlight two common scenarios at a glance:

- **Red — sniper upload.** The post hit Danbooru within seconds of going up at the source. By default this triggers when *Source → Asset* is under 60 seconds **and** *Asset → Post* is under 15 seconds.
- **Green — archive dig.** A much older artwork that finally landed on Danbooru. By default this triggers when *Source → Asset* is at least 30 days.
- **No color** — anything in between (the normal case).

The three thresholds are tunable — see [Configuration](#configuration) below if the defaults don't match your taste.

## Supported source platforms

| Platform | Login needed? | Notes |
| :--- | :--- | :--- |
| Pixiv | Only for R-18 works | |
| X / Twitter | No | Timestamp is recovered from the tweet ID itself — no network call |
| Bluesky | No | |
| Fanbox | **Yes** | |
| Fantia | **Yes** | |
| Nico Seiga | **Yes** | |
| Pawoo | No | |
| ArtStation | No | |
| DeviantArt | No | Mature-content works show *unavailable* |

For login-gated platforms, the Source row says *login required* with a clickable link when it can't see your session. On Safari, Violentmonkey, and Greasemonkey — where the script can't read cross-site cookies — it shows *unavailable* instead, because logging in wouldn't help.

Posts whose source isn't listed above (or that don't have a source URL at all) are silently skipped — the script changes nothing on the page.

## Configuration

The defaults are sensible, so most users don't need to touch anything.

If you want to tweak the color rules, open the Tampermonkey extension menu (the toolbar icon) and click **Edit color thresholds…**. A small dialog lets you set:

- **Sniper Source → Asset** (seconds)
- **Sniper Asset → Post** (seconds)
- **Archive Source → Asset** (days)

Press *Save* and the page reloads with the new thresholds applied. *Reset* fills the form with the built-in defaults but doesn't save until you confirm.

## Performance notes

- Source dates are cached after the first successful lookup, so revisiting a post you've already seen renders the timeline instantly with no network call.
- Failed and *login required* states are intentionally **not** cached, so logging in (or a service recovering) shows fresh data on the next visit instead of a stale error.
- In-flight network requests are cancelled when you navigate away mid-fetch, so the script never holds up Danbooru's normal Turbo navigation.

## License

MIT
