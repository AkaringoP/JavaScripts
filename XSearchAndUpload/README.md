# X (Twitter) Danbooru Search and Upload

A userscript for x.com that tells you, for every image in a tweet, whether it is already on [Danbooru](https://danbooru.donmai.us), and lets you start an upload of that image with one tap. It is built for one-handed use on the mobile web version of X (Firefox for Android + Tampermonkey) and works on desktop too.

[**Click here to install**](https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/XSearchAndUpload/XSearchAndUpload.user.js) — requires [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).

## Quick start

1. Install the script and open x.com.
2. Log in to Danbooru in the same browser. The script works logged out, but more slowly (see [Accounts and limits](#accounts-and-limits)).
3. Scroll. Under each tweet's images a thin bar appears, one segment per image, and each image gets a small Danbooru button in its top-left corner.

## The status bar

The bar sits between the images and the reply / repost / like row. Each state has its own shape as well as its own colour, so it reads in bright light and without colour vision.

| Segment | Meaning | Tap |
| :--- | :--- | :--- |
| Solid green | On Danbooru | Opens the post |
| Green diagonal stripes | The tweet is only partly on Danbooru (fewer posts than images) | Opens the post, or the tweet's search results when there are several |
| Red outline | Not on Danbooru | Checks again now |
| Blue dashes | The lookup failed | Retries and says why |
| Thin grey line, pulsing | Checking, or waiting until the tweet is near the screen | Nothing |

A long press on a green segment gives the browser's link menu (open in new tab, copy link).

The script finds posts by their **source**: a tweet counts as posted when a Danbooru post names that tweet (or that image file) as its source. Two consequences:

- An image uploaded from another site (Pixiv, Fanbox, …) shows as *not on Danbooru*. Danbooru's own duplicate check on the upload page still catches identical files.
- When only some images of a tweet are posted, the bar cannot tell which ones: every segment shows stripes with a label such as `1 of 4 images posted`. Tap the upload button of the image you care about; if that exact file is already posted, Danbooru sends you to the existing post.

## The upload button

Tapping the button on an image opens Danbooru's upload page for **that image only**, with the tweet set as its source. The whole tweet is opened instead when the image cannot be named exactly: videos and GIFs, images served as `webp`, and tweets whose author name is not in the link.

- A long press offers the link menu; that link always uploads the whole tweet.
- The button gets a green ring once its image is known to be on Danbooru.
- A second tap within 1.5 seconds is ignored, so a double tap does not open two tabs.

## In the photo viewer

When you open an image full screen, one button in the bottom-left corner stands for the image you are looking at and follows you as you swipe. Its border shows the state (solid green: on Danbooru, dashed green: tweet partly posted, solid red: not on Danbooru, dashed blue: lookup failed, dotted grey: checking). Tap it to open the post, to upload that image, or to retry, depending on the state.

## After you upload

Come back to the X tab and the tweet is checked again by itself, at once and then a few more times over the next minute if the post is not there yet. The bar keeps its old state and pulses while this runs. Tapping **Like** on a tweet also re-checks it; this can be turned off in the menu.

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

Messages you may see at the bottom of the screen:

- **Not logged in to Danbooru – lookups limited.** Tap it to log in. If you *are* logged in and still see it, your browser is not sending Danbooru's cookie with the script's requests; lookups still work, two tweets at a time.
- **Danbooru safe mode is on – only rating:g posts are visible.** Posts with other ratings will show as *not on Danbooru*. This comes from your account setting or from using `safebooru.donmai.us`.
- **Danbooru blocked the request – open Danbooru once.** Usually a browser check on Danbooru's side. Open Danbooru in a tab, pass the check, and return.

## What is not covered

- Images inside quoted tweets, and the thumbnail grid of a profile's Media tab.
- Userscript managers that only provide the promise-style `GM.*` API (Userscripts for Safari on iOS, Greasemonkey 4).
- If you also run a general "upload to Danbooru" script that supports X, you will see its button as well (typically at the end of the action row). The two do not interfere; exclude x.com in that script's settings if you want only one.

## For maintainers

Single file, no build step: `XSearchAndUpload.user.js`. The sections in the file, in order: config, styles, helpers, toast, state, DOM scan, search queue, account check, coloring, bar segment taps, photo viewer pill, re-check after an upload, Like trigger, MutationObserver and polling.

### How a lookup works

1. A scan (on DOM additions, on a 2 s poll, on return to the tab) walks `article` elements, identifies the tweet from its own permalink, and creates one bar segment and one **ref** per media tile. A ref is `{tweetId, imageHash, photoIndex, bar, btn, …}` and lives in `imageRefs`.
2. Each tweet id is queued. A batch is `GET /posts.json?limit=100&only=id,source,is_deleted,is_banned&tags=status:any ~source:*status/<id>* …`. Results are sorted back to tweets by parsing each post's source exactly, so the wildcard cannot mis-assign a post.
3. A tweet with no post gets a second lookup per image by media hash (`~source:*media/<hash>*`), which finds older posts whose source is the raw image URL. The segment is shown red in the meantime and turns green if this finds something.
4. `applyColors()` turns cache state into segment state. It is the only code that writes segment state to the DOM, and it writes only when its per-ref key changes.

### Rules that must keep holding

- **One request at a time.** `flushPending()` is called only from the `scheduleFlush()` timer. Wake the queue with `scheduleFlush()` or, to lift a pause, `resumeQueue()`.
- **The viewport decides.** `takeBatch()` takes keys whose segment is within one screen height of the viewport, nearest first. Farther keys stay queued without a request; keys with no connected segment are dropped from queue and cache. "In the DOM" does not mean "on screen": X keeps many tweets mounted.
- **Cache writes are guarded.** `runBatch()` captures the entry objects before it awaits and writes only into entries that are still the same object. A refresh may delete an entry while its request is in flight.
- **A retry keeps the entry object** (`retryEntry()`), so `tries` and `at` survive and the guard above passes.
- **Segments are `<a>` elements from creation** and are never replaced; only `href` is toggled. Refs point at the element, so swapping it would orphan the ref.
- **Markers are not trusted blindly.** An article is skipped as done only while its bar is in place before the Like row, has one segment per tile, and every tile still has its button.
- **A tweet is identified by its own permalink**, never a quoted tweet's (`div[role="link"]`), and the page URL is a fallback only for the focal tweet of a detail page.
- **The per-image upload URL is built only from known facts**: the media hash, a `jpg`/`png` format read from the image URL, and a tweet URL that names the user. Danbooru downloads exactly the format it is given, so guessing uploads a converted file.
- **Response handling** (`classifyResponse()`): a tag-limit 422 splits the batch and lowers the batch size; 401/403 and 429 pause the queue for 60 s; other 4xx fail without retry; 5xx, timeouts and network errors retry once, then back off 30 s / 2 min / 10 min.
- **No timers when idle**: the viewer's URL watcher runs only while the viewer is open, and nothing reschedules a flush while only out-of-range keys are queued.

### Danbooru behaviour the script relies on

Checked against the Danbooru source in November 2026.

- A post uploaded from a tweet has `https://x.com/<user>/status/<id>` as its source: no `/photo/N`, no media hash. This is why "posted" is judged by counting posts against images.
- The search-term limit is 2 logged out, 3 for Members, unlimited from Gold; `source:` costs one term each and `status:` is free. `/profile.json` answers logged out too and reports the limit (`tag_query_limit`, `null` meaning unlimited).
- `uploads/new?url=<image URL>&ref=<tweet URL>` uploads that one image with the tweet as its source.
- Safe mode adds `rating:g` to every search on the server side; it cannot be switched off per request.
- New posts are searchable immediately.

### Values worth knowing

| Name | Purpose |
| :--- | :--- |
| `MAX_QUERY_BATCH` | Upper bound on tweets per request, whatever the account allows |
| `RECHECK_DELAYS_MS` | Delays of the re-checks after returning from an upload |
| `ERROR_BACKOFF_MS`, `PAUSE_MS` | Retry back-off and the length of a queue pause |
| `TOAST_BOTTOM`, `PILL_POS` | Position of the toast and of the viewer button; tune these on a real phone |
| `SMALL_TILE_PX` | Tiles lower than this keep the 32px upload button |

Stored with `GM_setValue`: `booru` (host URL), `likeRecheck`, `detectedBatch` (last known batch size), `watch` (tweets awaiting a re-check, kept 30 minutes).

### Verifying a change

x.com (login wall) and Danbooru (browser check) cannot be driven from automation, so changes were verified in a harness: Playwright Chromium with a phone viewport and touch, stub `GM_*` functions (the request stub returns controlled status codes and bodies), synthetic tweet markup that matches the script's selectors, and the script injected unmodified. Tweets must stay mounted and be laid out near the viewport, as on the real site, or queue behaviour is not exercised. Things only a real phone can show: tap accuracy in Firefox for Android, X's own overlays and the viewer's layout, and whether the manager sends Danbooru's cookie.

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

### Open items

- In the photo viewer, *on Danbooru* and *not on Danbooru* differ only by border colour, as do *partly posted* and *lookup failed*. The bar does not have this problem.
- The viewer button was built without access to the real viewer's markup. When the tweet is not mounted underneath, the image for a per-image upload is taken from what is on screen, and the whole tweet is opened when that is uncertain.
- Possible additions that were left out: status dots in a profile's Media tab, a cache that survives a page reload, and telling apart the images of a partly posted tweet.
