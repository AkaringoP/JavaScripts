# NextRandomPost - Claude Instructions

## Overview
A userscript that navigates to a random post using the current search context.
Single file (`NextRandomPost.user.js`). `@grant none`.

## How It Works
Adds a "Next random post" link to the post sidebar. Uses a prefetch strategy to cache the next random post ID for instant navigation.

### Navigation Strategy
A click, the shortcut or a double tap waits (≤ `NAV_WAIT_MS`, 2 s) for the random-post request of the current search — the prefetch, or a new request if the search box changed since — then:
1. **`ok`**: navigate to `/posts/<id>?q=<tags>`
2. **`empty`** (API 404): stay and show `Danbooru.notice('No other posts match this search.')` (`console.warn` if `window.Danbooru` is missing)
3. **`error`** (other status, network, malformed body) **or timeout**: fall back to Danbooru's `/posts/random?tags=<tags>`

### Key Behaviors
- **Endpoint**: `/posts/random.json?tags=<q>&only=id` — one post object, no redirect. Not `/posts.json?random=true`: its redirect appends `random:1`, which counts against the tag limit (422 at the limit) and drops `only`
- **Prefetch**: one query-keyed request (`prefetch = {query, promise, result}`) shared by every caller, started on page load. Result is `ok` / `empty` / `error`; `fetchRandom` never rejects
- **API query** (`buildApiQuery`), all free metatags (no tag-limit cost), sent to the API only — never into the next page's `q`, the fallback URL or the search box:
  - drops whole `order:*` tokens only (tags such as `fate/grand_order:_first_order` stay)
  - `-is:banned` unless the user is an Approver (`data-current-user-is-approver`) or the search asks for `status:banned` / `is:banned`
  - `-status:deleted` unless "show deleted posts" is on (`data-current-user-show-deleted-posts`) or the search has a `status:` / `is:` value from `DELETED_VISIBLE_STATUSES` (Danbooru's gallery rule, `PostSets::Post#has_status_metatag?`)
  - `-id:<current>,<recent...>`
- **Recent history**: sessionStorage `nrp.recentPostIds`, newest first, ≤ `HISTORY_SIZE` (20) including the current post, recorded on every post page. If every match was seen, the history is reset to the current post and the fetch retried once (only then `empty`). Storage errors → only the current post is excluded
- **Scope**: runs only on `/posts/<id>` (anchored regex in `getCurrentPostId`); other `@match` pages (`/posts/123/events`, `/posts/new`, ...) exit in `init`
- **Sidebar link**: real `href` — the prefetched post's URL, or the fallback URL until it is ready — refreshed on `mousedown` / `touchstart` / `focus` / `contextmenu`. Only a plain left click is intercepted; middle / modified clicks are left to the browser and start a new prefetch so the next new tab differs
- **Navigation lock** (`isNavigating`): released at once on `empty`, and `NAV_LOCK_MS` (5 s) after leaving, which covers cancelled navigations. A bfcache restore (`pageshow` with `persisted`) resets state and re-prefetches. The first, non-persisted `pageshow` is ignored: it fires on load and can arrive while a click is still waiting
- Keyboard shortcut: `Alt + Shift + Right Arrow` (ignored when Ctrl/Meta is held or an input/select is focused)
- **Banned post escape**: when the current post is hidden for the user (takedown blank page, HTTP 451), a double-tap zone with a subtle hint is injected on the right third of the viewport; double-tap triggers the same navigation. Detection order (`detectHiddenPost`): `.image-container` / `#post-options` present → normal page; title "Page Removed" or the takedown message → hidden, no request (also covers `is_taken_down`); otherwise `/posts/{id}.json?only=id,is_banned`. The zone is fit between the on-screen header and footer at install and on `resize`. Approvers see the normal page, so they are never affected. CSS lives in the `GLOBAL_CSS` constant and is injected only on detected pages. Kept even with `-is:banned`, since fallback navigation, `is_taken_down` posts and non-random entry (direct links, prev/next) can still land on such a page
