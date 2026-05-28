# Danbooru Upload Bounty Helper

A UserScript that surfaces Danbooru's **[Upload Bounty Thread](https://danbooru.donmai.us/forum_topics/24186)** — a forum thread where Approvers recommend artists worth uploading — directly on the pages where you'd actually act on it: the Danbooru upload form, Pixiv artist pages, and X (Twitter) profiles and timelines. Plus an in-thread popover that turns the bounty list itself into a sortable table.

> **The gap this fills.** The bounty thread is the single source of truth for "which artists are worth uploading," but it's a long, paginated forum thread mixed with non-Approver replies. There's no native way to tell "is this Pixiv artist on the bounty list?" while you're browsing Pixiv, or "is this upload page's artist a bounty target?" while you're filling out the form. This script does the lookup for you, in-place, on every relevant page.

## At a Glance

- **Green BOUNTY label** on the Danbooru upload page when the artist you're uploading is a bounty target — click it to jump to the Approver's forum comment.
- **Green checkmark badge** next to artist names on Pixiv and X profile / artwork / timeline pages — same click target.
- **In-thread popover** on the Bounty Thread itself: sortable / paginated table of all bounty artists, with completed (struck-through) entries hidden behind a toggle.
- **Upload-page safety signals** beyond bounty: a transient "duplicate detected — check Similar tab" reminder, and a hard block on Pixel-Perfect Duplicate uploads (Post button disabled + callout).
- **Two-hour cache** with stale-while-revalidate — Pages stay snappy after the first load and refresh in the background.
- **No login or account required.** All data is pulled from a small JSON file the project's own GitHub Actions cron publishes — your browser never queries Danbooru's API.

## Where You'll See It

| Page | Marker | Click behaviour |
| :--- | :--- | :--- |
| `danbooru.donmai.us/uploads/*` | Green `BOUNTY` text label among the upload warning badges | Opens the most recent Approver forum comment in a new tab |
| `danbooru.donmai.us/uploads/*` (duplicate detected) | Amber bubble: "A post with this image already exists" | Auto-dismisses after ~5s; click to dismiss early |
| `danbooru.donmai.us/uploads/*` (pixel-perfect duplicate) | Red callout + disabled Post button | Post button is hard-blocked until the page changes |
| `danbooru.donmai.us/forum_topics/24186` | Small box-with-magnifier icon next to the thread heading | Opens the Bounty Artist List popover |
| `pixiv.net` profile / artwork | Green box-with-check icon next to the display name (or alongside each artwork author) | Opens the forum comment in a new tab |
| `x.com` / `twitter.com` profile header / timeline tweet author | Same green icon next to the display name | Opens the forum comment in a new tab |

## Install

1. Install a UserScript manager:
   - **[Tampermonkey](https://www.tampermonkey.net/)** (recommended — Chrome / Edge / Firefox / Safari)
   - **[Violentmonkey](https://violentmonkey.github.io/)**
2. **[Click here to install](https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/UploadBountyHelper/UploadBountyHelper.user.js)**
3. Confirm the installation in your manager. The script will ask for one extra permission (`GM_xmlhttpRequest` + a cross-origin connection to `raw.githubusercontent.com`) — that's needed to fetch the bounty list on sites like X that have strict Content Security Policy.

After install, just open any of the supported pages — no setup needed.

## How It Works

### The data pipeline

The bounty list is built **outside your browser**. A GitHub Actions cron job (every 8 hours) walks the forum thread, filters to Approver-level (or higher) posts, extracts artist mentions (`[[wikilinks]]` plus Pixiv / X URL fallback), resolves any tag aliases, and writes a small JSON file (`data/bounty.json`) to this repository. Your browser fetches that single file — never Danbooru's API directly.

```
GitHub Actions (cron, every 8h)
    │
    ▼  build-bounty.mjs
data/bounty.json
    │
    ▼  fetched by your browser, cached 2h
UploadBountyHelper.user.js
    │
    ▼  decorates DOM on relevant pages
Danbooru upload / Pixiv / X / Bounty Thread
```

This means:

- The script makes **at most one network request** per 2-hour cache window, regardless of how many pages you visit.
- The forum thread is parsed once on the server side, so your browser doesn't need to read or render 400+ forum posts.
- If GitHub is down or the JSON fails to load, every site simply skips the markers and behaves normally.

### Identifying the artist

On each supported page the script identifies "who is this page about?" and looks them up in the bounty list:

- **Danbooru upload page** — Reads the selected artist tag from the upload form. Falls back to extracting the Pixiv user ID or X handle from the source URL if no artist tag is selected yet.
- **Pixiv profile** — Reads the user ID from the URL (works even when logged out).
- **Pixiv artwork** — Reads the user ID from each author link on the page (sidebar + bottom both get a marker, naturally).
- **X profile / tweet detail** — Reads the handle from the URL path, with a 25-entry blacklist for reserved paths like `/home`, `/i/lists/...`, `/settings`.
- **X timeline** — Reads the handle from each tweet card's author link, re-checking on virtual-scroll recycling so a recycled card doesn't keep a stale marker.

### The Bounty Thread popover

On the forum thread page itself, a small icon appears next to the heading. Clicking it opens a popover with the full bounty list:

<img width="770" height="515" alt="image" src="https://github.com/user-attachments/assets/6f4bdf8a-b547-45da-bb6b-86e1908835eb" />

- **Sortable columns** — Click `Name`, `Count`, `Approver`, or `Date` to sort. Clicking the active column toggles direction. Your sort choice + the Hide-completed toggle persist across page loads.
- **`Count`** is the artist's total post count at the time of the last cron run, with a `+N` growth suffix when the artist gained at least one post in the past 30 days.
- **`Date`** is when the bounty was first registered (date of the earliest Approver post that mentions the artist). Click it to open that specific forum post.
- **`Approver`** click opens that user's Danbooru profile.
- **Tag name** click opens the artist wiki; the small grid icon next to it opens the `/posts?tags=<artist>` gallery.
- **`Completed`** entries (artists whose tag is wrapped in `[s]...[/s]` strikethrough in the forum thread) are still shown by default with a strikethrough tag, so you can see "who used to be on the list and is now uploaded." Toggle them off if you want only the live targets.

## Privacy

- **No tracking, no analytics, no remote logging.** The only network request the script makes is the bounty JSON fetch, which goes to `raw.githubusercontent.com`.
- **localStorage usage** — two small keys:
  - `ubm_bounty_artists_v2` — the cached bounty list (cleared automatically after 2 hours, or on schema upgrade).
  - `ubm_bt_prefs_v1` — your popover sort preference and Hide-completed toggle.
- **No login, no cookies, no Danbooru API calls.** The script doesn't read or send any of your browser's authentication state.

## Compatibility

- Tested with Tampermonkey on Safari (the maintainer's primary browser) and Chrome/Firefox.
- Should work on any UserScript manager that supports `GM_xmlhttpRequest` and the standard `@match` directive.
- Requires a modern browser (`fetch`, `Promise`, optional chaining, CSS custom properties).
- Dark mode is detected via Danbooru's `body[data-current-user-theme="dark"]` attribute and the popover follows automatically.

## FAQ

**My uploaded artist is on the bounty list but I don't see a label — why?**
Most likely the page hasn't selected the artist tag yet. The label hooks into the selected artist tag list (`li.selected` under the tag area). If the source URL is recognised (Pixiv / X), the script falls back to URL-based lookup. Check the browser console for messages starting with `[UBM]`.

**The label/mark is amber instead of green on the upload page — why?**
Danbooru has detected a near-duplicate of your image. The bounty label tints amber to remind you to check the Similar tab before uploading — the artist is still a bounty target, just proceed with care.

**Will my upload be blocked if Danbooru flags it as a Pixel-Perfect Duplicate?**
Yes, the Post button is hard-disabled and a red callout appears. This is the script's safety block — the PPD warning means the exact same image is already posted. The block clears if the badge goes away (e.g. you change the file).

**How fresh is the bounty list?**
It's rebuilt every 8 hours by the cron. Your browser additionally caches for 2 hours, so worst case you're looking at a list up to ~10 hours behind the forum thread. New bounty additions take that long to propagate; struck-through completions are reflected on the same cycle.

**Does the bounty list include artists below Approver level?**
No. Only posts authored by users at Danbooru level 37+ (Approver, Moderator, Admin) are scanned. This is a deliberate trust signal — the thread is meant for Approver recommendations.

**Can I refresh the cache manually?**
Not via UI. The cache refreshes automatically when the 2-hour TTL expires. If you really need to force it, clear the `ubm_bounty_artists_v2` key in your browser's localStorage for `raw.githubusercontent.com` (or for the page domain you're on).

**Does the popover work on stale bounty.json (pre-v0.3 schema)?**
Yes. Missing newer fields (registered date, completed flag, post count, growth delta) gracefully degrade to `—` placeholders; the popover still opens and lists every artist.

## Changelog

- **v1.0.0** (2026-05-28) — Codebase review pass + security hardening: dedup `injectStyles` / `installSpaNavHooks` helpers, fetcher fix (in-flight guard for first fetch, 30s timeout, 5min negative backoff), build script input validation (length caps + response shape validation), `enrichWithUrls` concurrency, sort-tab contrast fix on the Bounty Thread popover. Released as v1.0.0 from the cumulative v0.1 → v0.3 cycles.
- **v0.3** (2026-05-28) — Bounty Thread popover: sortable / paginated artist list with hide-completed toggle, sort/filter persistence, post-count + 30-day growth indicator.
- **v0.2** (2026-05-27) — Pixiv and X (Twitter) external marks: profile + artwork + timeline. CSP-safe fetching via `GM_xmlhttpRequest` to work around X's strict `connect-src` policy.
- **v0.1.2** (2026-05-26) — Duplicate detection toast + Pixel-Perfect Duplicate upload block.
- **v0.1** (2026-05-26) — Initial release: GitHub Actions cron pipeline + Danbooru upload page bounty label.

## License

MIT. See the repository [LICENSE](https://github.com/AkaringoP/JavaScripts/blob/main/LICENSE) for details.
