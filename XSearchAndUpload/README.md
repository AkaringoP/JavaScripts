# X (Twitter) Danbooru Search and Upload

A userscript for x.com that tells you, for every image in a tweet, whether it is already on [Danbooru](https://danbooru.donmai.us), and lets you start an upload of that image with one tap or click. It works on the mobile web version of X (Firefox for Android + Tampermonkey), where it is built for one-handed use, and on a desktop (Chrome or Firefox + Tampermonkey).

[**Click here to install (v2.1.0)**](https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/XSearchAndUpload/XSearchAndUpload.user.js) — requires [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).

## Quick start

1. Install the script and open x.com.
2. Log in to Danbooru in the same browser. The script works logged out, but more slowly (see [Accounts and limits](#accounts-and-limits)).
3. Scroll. Under each tweet's images a thin bar appears, one segment per image, and each image gets a small Danbooru button in its top-left corner.

## The status bar

The bar sits between the images and the reply / repost / like row. Each state has its own shape as well as its own colour, so it reads in bright light and without colour vision.

| Segment | Meaning |
| :--- | :--- |
| Solid green | On Danbooru |
| Green diagonal stripes | The tweet is only partly on Danbooru (fewer posts than images) |
| Red outline | Not on Danbooru |
| Blue dashes | The lookup failed |
| Thin grey line, pulsing | Checking, or waiting until the tweet is near the screen |

The bar only shows the state; it opens nothing. For details (how many posts, or why a lookup failed), tap a segment on a phone, which shows them next to it for a moment, or point at it with a mouse. Opening the post, uploading and retrying are done with the button on the image and with the button in the photo viewer (below).

The script finds posts by their **source**: a tweet counts as posted when a Danbooru post names that tweet (or that image file) as its source. Two consequences:

- An image uploaded from another site (Pixiv, Fanbox, …) shows as *not on Danbooru*. Danbooru's own duplicate check on the upload page still catches identical files.
- When only some images of a tweet are posted, the bar cannot tell which ones: every segment shows stripes, labelled for example `1 of 4 images posted`. Use the upload button of the image you care about; if that exact file is already posted, Danbooru sends you to the existing post.

A tweet shown as *not on Danbooru* or *partly posted* is looked up again when it comes back onto the page more than 10 minutes later, in case someone has posted it since.

### On a profile's Media tab

Each photo in the grid gets one bar along its bottom edge. It is green as soon as any post exists for that tweet (there are no stripes here), red when there is none, and grey until that is known. The script first asks Danbooru once for everything posted from that author, which turns the posted photos green together; the rest are then checked from where you are in the grid, four requests at a time. Video and GIF tiles get no bar. A tap or click on a bar here opens the photo, like the rest of its tile. Open a photo for the exact, per-image answer and the upload button.

## The upload button

Tapping or clicking the button on an image opens Danbooru's upload page for **that image only**, with the tweet set as its source. The whole tweet is opened instead when the image cannot be named exactly: videos and GIFs, images served as `webp`, and tweets whose author name is not in the link.

- The button gets a green ring once its image is known to be on Danbooru.
- A second tap within 1.5 seconds is ignored, so a double tap does not open two tabs.
- On a phone, a long press offers the browser's link menu; that link always uploads the whole tweet.
- With a mouse, `Ctrl`+click, `⌘`+click and a middle click open the upload page in a background tab. The link in the right-click menu uploads the whole tweet.

## In the photo viewer

When you open an image full screen, one button in the bottom-left corner stands for the image you are looking at and follows you as you move through the photos. Its border shows the state (solid green: on Danbooru, dashed green: tweet partly posted, solid red: not on Danbooru, dashed blue: lookup failed, dotted grey: checking). Tap or click it to open the post, to upload that image, or to retry, depending on the state.

## After you upload

Come back to X and the tweet is checked again by itself. The bar keeps its old state and pulses while this runs.

- Returning to the X tab checks at once, and a few more times over the next minute if the post is not there yet.
- With the upload page in a window of its own next to X, clicking into the X window or moving the mouse back over the page checks too (at most once every 15 seconds).
- A tweet stays watched until its post shows up, for up to 30 minutes and 12 lookups.

**Like** on a tweet also re-checks it, whether you press the button or, on a desktop, use X's `L` shortcut on the focused tweet. This can be turned off in the menu.

## Menu commands

Open your userscript manager's menu on x.com:

| Command | What it does |
| :--- | :--- |
| `Danbooru URL (<host>)` | Use another Danbooru host. Enter a full URL; the page reloads after a change |
| `Like = re-check: on / off` | Turn the Like trigger on or off. Applies at once |
| `XDSU legend` | Shows the meaning of the five bar states |

## Accounts and limits

Danbooru limits how many search terms one request may hold, and the script reads your limit and sizes its requests to it:

| Account | Tweets per request |
| :--- | :--- |
| Not logged in | 2 |
| Member | 3 |
| Gold and above | 6 |

Messages you may see near the bottom of the screen (centred in a desktop-sized window, in the bottom-left corner on a phone and in the photo viewer):

- **Not logged in to Danbooru – lookups limited.** Tap it to log in. If you *are* logged in and still see it, your browser is not sending Danbooru's cookie with the script's requests; lookups still work, two tweets at a time.
- **Danbooru safe mode is on – only rating:g posts are visible.** Posts with other ratings will show as *not on Danbooru*. This comes from your account setting or from using `safebooru.donmai.us`.
- **Danbooru blocked the request – open Danbooru once.** Usually a browser check on Danbooru's side. Open Danbooru in a tab or window, pass the check, and come back to X.

A message that comes up while the X tab is in the background waits until you look at the tab.

## What is not covered

- Images inside quoted tweets.
- Userscript managers that only provide the promise-style `GM.*` API (Userscripts for Safari on iOS, Greasemonkey 4).
- If you also run a general "upload to Danbooru" script that supports X, you will see its button as well (typically at the end of the action row). The two do not interfere; exclude x.com in that script's settings if you want only one.

## For maintainers

Single file, no build step: `XSearchAndUpload.user.js`. The sections in the file, in order: config, styles, helpers, toast, state, DOM scan, search queue, account check, coloring, clicks and failures, photo viewer pill, re-check after an upload, Like trigger, long sessions, MutationObserver and polling.

### How a lookup works

1. A scan walks `article` elements, identifies the tweet from its own permalink, and creates one bar segment and one **ref** per media tile. A ref is `{tweetId, imageHash, photoIndex, bar, btn, …}` and lives in `imageRefs`. A scan runs when an element is added inside a tweet, or one that is or holds a tweet or a media image; on a 2 s poll, which catches every other change; and on return to the tab.
2. Each tweet id is queued. A batch is `GET /posts.json?limit=100&only=id,source,is_deleted,is_banned&tags=status:any ~source:*status/<id>* …`. Results are sorted back to tweets by parsing each post's source exactly, so the wildcard cannot mis-assign a post.
3. A tweet with no post gets a second lookup per image by media hash (`~source:*media/<hash>*`), which finds older posts whose source is the raw image URL. The segment is shown red in the meantime and turns green if this finds something.
4. A photo-grid tile (a link to `/status/<id>/photo/<n>` outside every `article`) is a ref with `grid: true`. On that author's own profile (the first path segment of the page names them) it also carries the author's name, and the author is looked up first: `status:any source:*/<user>/status/*`, 200 posts a page, up to 5 pages, filed by tweet id in `authorCache`; no further page is read once the author's tiles have left the page. A post found there makes the tile green; a tile it leaves open waits for that lookup to end and then goes through steps 2 and 3. On any other grid (search results, where every tile may have another author) there is no author lookup and the tiles go straight to steps 2 and 3. The author lookup only ever proves "posted" (the author may have changed their name, and a post's source may be the raw image URL), and only grid tiles read it: the viewer button looks its tweet up itself.
5. `applyColors()` turns cache state into segment state. It is the only code that writes segment state to the DOM, and it writes only when its per-ref key changes.

### Rules that must keep holding

- **One request at a time, except on a photo grid.** `flushPending()` is called only from the `scheduleFlush()` timer. Wake the queue with `scheduleFlush()` or, to lift a pause, `resumeQueue()`. While a grid tile is in the page, `runLookups()` keeps up to `GRID_PARALLEL` tweet and hash lookups in flight: one that answers paints its tiles and its place goes to the next, chosen by where the viewport is then. After a 429 or a block the tab is back to one, and a lookup that was waiting to retry goes back into the queue instead of retrying into the pause. Account checks and author lookups always run alone.
- **The viewport decides.** `takeBatch()` takes keys whose segment is within one screen height of the viewport, nearest first. Farther keys stay queued without a request; keys with no connected segment are dropped from queue and cache. "In the DOM" does not mean "on screen": X keeps many tweets mounted.
- **Cache writes are guarded.** `runBatch()` captures the entry objects before it awaits and writes only into entries that are still the same object. A refresh may delete an entry while its request is in flight.
- **A retry keeps the entry object** (`retryEntry()`), so `tries` and `at` survive and the guard above passes.
- **Segments are `<span role="img">` elements from creation** and are never replaced; only their state, label and `data-match-url` change. Refs point at the element, so swapping it would orphan the ref. A segment swallows clicks and taps (they would otherwise land on the photo or the Like button); a tap shows its label as a tip (`showTip()`), a mouse click does nothing. A photo-grid bar takes no clicks at all: they go to the tile.
- **Markers are not trusted blindly.** An article is skipped as done only while its bar is in place before the Like row, has one segment per tile, and every tile still has its button.
- **A tweet is identified by its own permalink**, never a quoted tweet's (`div[role="link"]`), and the page URL is a fallback only for the focal tweet of a detail page.
- **The per-image upload URL is built only from known facts**: the media hash, a `jpg`/`png` format read from the image URL, and a tweet URL that names the user. Danbooru downloads exactly the format it is given, so guessing uploads a converted file.
- **Response handling** (`classifyResponse()`): a tag-limit 422 splits the batch and lowers the batch size; 401/403 and 429 pause the queue for 60 s; other 4xx fail without retry; 5xx, timeouts and network errors retry once, then back off 30 s / 2 min / 10 min. A return to the tab lifts a pause and retries at once; a window focus does so at most once per `RETURN_GAP_MS`.
- **Returns are counted against returns.** A return noticed while the tab stayed visible (focus, the mouse coming back) re-checks only if no return did so in the last `RETURN_GAP_MS`. The timed re-checks that follow a return to the tab do not count: the post may have been made since.
- **Nothing is sent from a tab that has never been shown**, and toasts show only while the tab is visible.
- **Layout follows the viewport width, press behaviour the pointer type.** The toast's place depends on `min-width`; button sizes and hover cues depend on `pointer` and `hover`.
- **No timers when idle**: the viewer's URL watcher runs only while the viewer is open, and nothing reschedules a flush while only out-of-range keys are queued.

### Danbooru behaviour the script relies on

Checked against the Danbooru source in November 2026.

- A post uploaded from a tweet has `https://x.com/<user>/status/<id>` as its source: no `/photo/N`, no media hash. This is why "posted" is judged by counting posts against images.
- The search-term limit is 2 logged out, 3 for Members, unlimited from Gold; `source:` costs one term each and `status:` is free. `/profile.json` answers logged out too and reports the limit (`tag_query_limit`, `null` meaning unlimited).
- `source:` matches without regard to case, and a page holds at most 200 posts.
- Danbooru itself sets no rate limit on reading (only on writing). What sits in front of it is unknown, which is why a 429 or a block ends the parallel lookups for the tab.
- `uploads/new?url=<image URL>&ref=<tweet URL>` uploads that one image with the tweet as its source.
- Safe mode adds `rating:g` to every search on the server side; it cannot be switched off per request.
- New posts are searchable immediately.

### Values worth knowing

| Name | Purpose |
| :--- | :--- |
| `MAX_QUERY_BATCH` | Upper bound on tweets per request, whatever the account allows |
| `GRID_PARALLEL` | Lookups in flight at once while a photo grid is in the page |
| `AUTHOR_PAGE_SIZE`, `AUTHOR_MAX_PAGES` | Size and number of the pages an author lookup reads |
| `RECHECK_DELAYS_MS` | Delays of the re-checks after returning from an upload |
| `WATCH_MAX_CHECKS`, `WATCH_MAX_AGE_MS` | How many lookups, and how long, a tweet is watched after an upload |
| `RETURN_GAP_MS` | Shortest time between two re-checks caused by focus or the mouse coming back |
| `PROFILE_MAX_AGE_MS` | Age past which the account check is repeated on a return, and up to which another tab's check is taken over |
| `RESULT_MAX_AGE_MS` | Age past which a "not posted" or "partly posted" result is looked up again when the tweet is mounted again |
| `CACHE_MAX_ENTRIES`, `CACHE_TRIM_TO` | Bound on the lookup results kept in a tab left open |
| `ERROR_BACKOFF_MS`, `PAUSE_MS` | Retry back-off and the length of a queue pause |
| `TOAST_BOTTOM`, `PILL_POS` | Position of the toast and of the viewer button on a phone; tune these on a real phone |
| `WIDE_MIN_WIDTH_PX`, `WIDE_TOAST_BOTTOM` | Viewport width from which the toast is centred, and its height there |
| `TIP_MS`, `TIP_GAP_PX` | How long the tip of a tapped segment stays, and its distance from the bar |
| `SMALL_TILE_PX` | Tiles lower than this keep the 32px upload button |

Stored with `GM_setValue`, and so shared by every X tab:

- `booru` (host URL), `likeRecheck`, `detectedBatch` (last known batch size).
- `watch`: tweets awaiting a re-check after an upload. An entry stays until its post count rises, 12 lookups were made, or 30 minutes passed. Each tab rewrites only its own entries.
- `accountCheck`: the last successful account check (host, time, batch size, logged in or not, safe mode; no id or name). A tab that starts or comes back takes it over when it is at most 10 minutes old, logged in and without safe mode. So a tab opened within 10 minutes of logging out shows the "not logged in" message only after its own next check.

### Verifying a change

x.com (login wall) and Danbooru (browser check) cannot be driven from automation, so changes are verified in the harness under `test/`: Playwright Chromium, stub `GM_*` functions (the request stub returns controlled status codes and bodies), synthetic tweet markup that matches the script's selectors, and the script injected unmodified. The default page is a phone (360x800, touch); `run_desktop.js` uses desktop pages (1280x800 and 1920x1080, mouse, no touch).

```bash
cd XSearchAndUpload/test
node run_all.js              # every scenario against ../XSearchAndUpload.user.js, about 10 minutes
node run_lookup.js current s8_tag_limit   # one file, one scenario
```

It needs Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`, or point `NODE_PATH` at a `node_modules` that has it). Several scenarios wait in real time (60 s queue pauses, retry back-off); `run_lookup.js` alone takes about 8 minutes, and `run_all.js` runs the files side by side and prints the time of each. After a change, run the files that cover it; run everything when the queue or other shared code changed, and before a release.

| File | Covers |
| :--- | :--- |
| `run_core.js`, `run_core_extra.js` | Happy path, remounts, refresh races, tweet identification |
| `run_fixes.js` | Icon fallback, video/GIF tiles, the URL setting, failed hash lookups |
| `run_upload.js` | Re-check after an upload, the Like trigger, the upload button, per-image upload URLs |
| `run_lookup.js` | Response handling, retries, account limits and the shared account check, queue order, toasts |
| `run_scroll.js` | The viewport-first queue, with tweets that stay mounted while the page scrolls |
| `run_matching.js` | Judging by post count, labels, photo numbers |
| `run_bar.js` | The display-only bar and the tip a tap shows, state shapes and contrast, menu commands |
| `run_markers.js` | The observer, bars and buttons restored after re-renders |
| `run_viewer.js` | The photo viewer button |
| `run_desktop.js` | Desktop pages: mouse clicks and modifiers, hover and focus, returns by focus and mouse, hidden tabs, long sessions, the photo grid and its lookups, the `L` key, the toast's place. A grid scenario that expects an author lookup must set the page path to that author's profile |
| `compare.js`, `compare_dom.js` | Run two versions on the same page and diff requests and DOM; for changes that must not alter behaviour |
| `perf.js` | Cost of one scan on a page with 25 media tweets; `--viewport` picks the page size, `--churn` adds unrelated DOM changes |

To compare against an earlier version, put a copy next to the runners (`git show main:XSearchAndUpload/XSearchAndUpload.user.js > base.user.js`) and run `node compare.js base,current`; every runner takes such names in place of `current`. Copies named `*.user.js` and the `out/` folder are ignored by git.

When writing a scenario, keep tweets mounted and laid out near the viewport, as on the real site, or queue behaviour is not exercised. A phone page needs x.com's `width=device-width` viewport when its layout width matters (`run_viewer.js` adds it); without it Chromium lays the page out 980px wide. Things only a real browser can show: tap accuracy in Firefox for Android, X's own overlays and the viewer's layout, whether the manager sends Danbooru's cookie, and whether the browser reports the mouse coming back to a window that is not focused.

### Style

The script follows the [Google JavaScript Style Guide](https://google.github.io/styleguide/jsguide.html): 80 columns, JSDoc on every function, line breaks after operators. It lints clean with `eslint-config-google` apart from two kinds of report that are expected: `new-cap` on the `GM_*` calls, and `max-len` on the metadata block and the embedded icon, which cannot be wrapped.

### History

The November 2026 audit rewrote most of the script in steps:

| Commit | Change |
| :--- | :--- |
| `3477ab1` | Broken behaviour: 404 icon, lookups stuck grey, a race on refresh, button rebuild loop, video tiles, URL setting |
| `0f658fa` | Re-check after returning from an upload, per-image upload, upload button rework |
| `d1ede33` | Response handling and retries, account limit detection, smaller responses, toast |
| `1d4e53c` | Lookups ordered by distance to the viewport |
| `039c900` | "Posted" judged by post count; photo numbers read from links |
| `c265499` | Tappable bar, shape per state, menu commands |
| `3387c1e` | Cleanup, restore of bars and buttons after re-renders |
| `e56e78d`, `0cbf6cb` | Photo viewer button, header fields |
| `3897d86` | Scenario harness under `test/` |
| `c701738` | Google JavaScript Style: 80 columns, JSDoc, operator placement |

All of the above was released together as **2.0.0**.

**2.1.0** made the script at home on a desktop and added the photo grid:

| Commit | Change |
| :--- | :--- |
| `130e917`, `9d0badb` | Desktop pages and scenarios in the harness; runners exit promptly |
| `51e3604`, `8a4982c` | Re-check on window focus and when the mouse comes back; watched tweets outlive the first minute; toasts wait for a visible tab |
| `07e3668` | Account check shared by tabs; nothing sent from a tab never shown |
| `0d877ec` | Stale "not posted" results looked up again; caches bounded |
| `528f898`, `cb565db` | Hover and focus cues, modifier and middle clicks, the `L` shortcut |
| `fc57e90` | Scans only for changes that can touch a tweet or the viewer |
| `b606ee0` | The bar only shows the state; it no longer acts on taps |
| `a6f1bfa`, `82d1e65`, `391d46b` | Bars on a profile's photo grid; lookup by author; parallel lookups there |
| `b224839` | The toast's place in a desktop-sized window |

`@version` in the header and the `VERSION` constant must be changed together.

### Open items

- In the photo viewer, *on Danbooru* and *not on Danbooru* differ only by border colour, as do *partly posted* and *lookup failed*. The bar does not have this problem.
- When the tweet is not mounted underneath the viewer, the image for a per-image upload is taken from what is on screen, and the whole tweet is opened when that is uncertain. This was checked against the desktop viewer's markup in Chrome; the phone's was not captured.
- On a desktop the script was tried by hand in Chrome only. The desktop scenarios also pass in Playwright's Firefox (`XDSU_BROWSER=firefox node run_desktop.js`) except `d16_hover_focus`: on the synthetic page the Tab key does not move on from the upload button there, with 2.0.0 as well. Whether that happens on the real site in Firefox was not checked.
- 500px, the width from which the toast is centred, is taken to be where X drops its bottom navigation; it was not measured.
- The `L` shortcut is not handled inside the photo viewer, where no tweet has the focus.
- Only a profile's photo grid was seen on the real site. Whether X's other photo grids (the media tab of a search) use the same markup was not checked; where they do, they get bars too, looked up tile by tile.
- A failed author lookup is not retried: for the next 10 minutes that grid's tiles are looked up one by one.
- On the photo grid a partly posted tweet shows green, and an author with more than 1000 posts is read only that far; older tiles are then looked up one by one.
- Possible additions that were left out: lookup results shared between tabs or kept across a page reload, and telling apart the images of a partly posted tweet.
