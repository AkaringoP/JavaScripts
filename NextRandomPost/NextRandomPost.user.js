// ==UserScript==
// @name         Danbooru Next Random Post
// @namespace    https://github.com/AkaringoP
// @version      2.4
// @description  Navigates to a random post using the current input context.
// @author       AkaringoP
// @license      MIT
// @match        *://danbooru.donmai.us/posts/*
// @icon         https://danbooru.donmai.us/favicon.ico
// @updateURL    https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/NextRandomPost/NextRandomPost.user.js
// @downloadURL  https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/NextRandomPost/NextRandomPost.user.js
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // --- Constants ---

  /**
   * How long a click waits for an in-flight random-post request before giving
   * up and using Danbooru's own random URL instead.
   * @const {number}
   */
  const NAV_WAIT_MS = 2000;

  /**
   * Shown instead of navigating when no other post matches the search.
   * @const {string}
   */
  const NO_MATCH_MESSAGE = 'No other posts match this search.';

  /**
   * How long navigation stays locked after leaving for another page. If the
   * page never unloads (Stop button, a stalled request), the lock is
   * released after this delay so the link and shortcut work again.
   * @const {number}
   */
  const NAV_LOCK_MS = 5000;

  /**
   * sessionStorage key for the IDs of recently viewed posts (this tab only).
   * @const {string}
   */
  const HISTORY_KEY = 'nrp.recentPostIds';

  /**
   * How many recently viewed posts (including the current one) are excluded
   * from the random pick.
   * @const {number}
   */
  const HISTORY_SIZE = 20;

  /**
   * `status:` / `is:` values that make Danbooru's gallery show deleted posts
   * (server: `PostSets::Post#has_status_metatag?`). With one of these in the
   * search, deleted posts are part of what the user asked for.
   * @const {!Array<string>}
   */
  const DELETED_VISIBLE_STATUSES = [
    'all', 'any', 'active', 'unmoderated', 'modqueue', 'deleted', 'appealed',
  ];

  /**
   * Maximum delay between two taps to count as a double tap.
   * @const {number}
   */
  const DOUBLE_TAP_MS = 400;

  /**
   * Maximum distance between two taps to count as a double tap.
   * @const {number}
   */
  const DOUBLE_TAP_SLOP_PX = 40;

  /**
   * Styles for the double-tap zone shown on banned (takedown) post pages.
   * Injected only when such a page is detected. `top` / `bottom` are only
   * defaults: `positionDoubleTapZone` sets them from the header and footer.
   * @const {string}
   */
  const GLOBAL_CSS = `
    #nrp-double-tap-zone {
      position: fixed;
      top: 60px;
      right: 0;
      bottom: 60px;
      width: 33vw;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      touch-action: manipulation;
      user-select: none;
      -webkit-user-select: none;
      cursor: pointer;
    }
    #nrp-double-tap-zone .nrp-hint-icon {
      font-size: 48px;
      line-height: 1;
      opacity: 0.25;
    }
    #nrp-double-tap-zone .nrp-hint-text {
      margin-top: 8px;
      font-size: 12px;
      opacity: 0.35;
    }
  `;

  // --- State Management ---

  /**
   * Outcome of a random-post request.
   * - `ok`: `id` is the post to open.
   * - `empty`: no other post matches the search (HTTP 404).
   * - `error`: anything else (other status codes, network failure, malformed
   *   response).
   * @typedef {{status: string, id: (number|undefined)}} RandomResult
   */

  /**
   * The random-post request for the most recent query. Requests are keyed by
   * query, so a click after the search box changed starts a new one, and
   * callers asking for the same query share the in-flight promise.
   * Null until the first request, and after a reset. `result` is set once
   * the promise settles.
   * @type {?{
   *   query: string,
   *   promise: !Promise<!RandomResult>,
   *   result: ?RandomResult,
   * }}
   */
  let prefetch = null;

  /**
   * The "Next random post" sidebar link, once added.
   * @type {?HTMLAnchorElement}
   */
  let nextLink = null;

  /**
   * Flag indicating if a navigation event is currently in progress.
   * Used to prevent double-submissions or race conditions.
   * @type {boolean}
   */
  let isNavigating = false;

  /**
   * Timer that releases `isNavigating` if a navigation never completes.
   * @type {number|undefined}
   */
  let navLockTimer;

  // --- Core Logic ---

  /**
   * Extracts the current post ID from the URL path. Only the post page itself
   * (`/posts/123`) counts; sub-pages such as `/posts/123/events` do not.
   *
   * @return {number|undefined} The post ID, or undefined when the current page
   *     is not a post page.
   */
  const getCurrentPostId = () => {
    const match = window.location.pathname.match(/^\/posts\/(\d+)\/?$/);
    return match ? parseInt(match[1], 10) : undefined;
  };

  /**
   * Retrieves the current search query from the input box or URL parameters.
   * Priority is given to the input box value, falling back to URL 'q' or
   * 'tags'.
   *
   * @return {string} The current search tags as a trimmed string.
   */
  const getCurrentQuery = () => {
    const searchInput = document.querySelector('#tags') ||
        document.querySelector('input[name="tags"]');

    if (searchInput) {
      return searchInput.value.trim();
    }

    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('q') || urlParams.get('tags') || '';
  };

  /**
   * Reads the recently viewed post IDs, newest first.
   *
   * @return {!Array<number>} Empty if storage is unavailable or corrupt.
   */
  const readHistory = () => {
    try {
      const ids = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(ids) ?
          ids.filter((id) => Number.isInteger(id) && id > 0) :
          [];
    } catch (error) {
      return [];
    }
  };

  /**
   * Stores the recently viewed post IDs. Failures (storage blocked or full)
   * are ignored: the script then only excludes the current post.
   *
   * @param {!Array<number>} ids Newest first.
   */
  const writeHistory = (ids) => {
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(ids));
    } catch (error) {
      // Ignored, see above.
    }
  };

  /**
   * Returns the posts to exclude from the random pick: the current post
   * followed by the most recently viewed ones, `HISTORY_SIZE` at most.
   *
   * @return {!Array<number>}
   */
  const getRecentPostIds = () => {
    const currentId = getCurrentPostId();
    return [currentId, ...readHistory().filter((id) => id !== currentId)]
        .slice(0, HISTORY_SIZE);
  };

  /**
   * Returns metatags that keep posts this user would not normally see out of
   * the random pick. Both are free metatags (no tag-limit cost).
   * - `-is:banned`: banned posts are a blank "Page Removed" page below
   *   Approver, unless the search explicitly asks for banned posts.
   * - `-status:deleted`: deleted posts are hidden in the gallery unless the
   *   user's "show deleted posts" setting is on or the search has one of
   *   `DELETED_VISIBLE_STATUSES`.
   *
   * @param {!Array<string>} terms The user's search terms.
   * @return {!Array<string>}
   */
  const buildVisibilityFilters = (terms) => {
    const user = document.body.dataset;
    const statuses = terms
        .map((term) => /^(-?)(?:status|is):(\S+)$/i.exec(term))
        .filter(Boolean)
        .map(([, negated, value]) => ({negated, value: value.toLowerCase()}));
    const filters = [];

    const asksForBanned =
        statuses.some(({negated, value}) => !negated && value === 'banned');
    if (user.currentUserIsApprover !== 'true' && !asksForBanned) {
      filters.push('-is:banned');
    }

    const showsDeleted = user.currentUserShowDeletedPosts === 'true' ||
        statuses.some(({value}) => DELETED_VISIBLE_STATUSES.includes(value));
    if (!showsDeleted) {
      filters.push('-status:deleted');
    }
    return filters;
  };

  /**
   * Builds the API search query for a random post.
   *
   * Drops `order:` metatags, which conflict with random ordering. Only whole
   * tokens that start with `order:` are dropped, so tags that merely contain
   * it (e.g. `fate/grand_order:_first_order`) are kept. Adds the visibility
   * filters, which only ever go to the API, never into the URL or search box.
   *
   * @param {string} tags The user's search tags.
   * @param {!Array<number>} excludeIds Post IDs to exclude from results (the
   *     current post and recently viewed ones). `id:` costs no tag slot.
   * @return {string} The query to send to the API.
   */
  const buildApiQuery = (tags, excludeIds) => {
    const terms = tags.split(/\s+/)
        .filter((term) => term && !/^order:/i.test(term));
    terms.push(...buildVisibilityFilters(terms));
    if (excludeIds.length > 0) {
      terms.push(`-id:${excludeIds.join(',')}`);
    }
    return terms.join(' ');
  };

  /**
   * Fetches a random post from the API. Never rejects: every failure is
   * reported as a result.
   *
   * @param {string} tags The search tags to use for filtering the random post.
   * @param {!Array<number>} excludeIds Post IDs to exclude from results.
   * @return {!Promise<!RandomResult>}
   */
  const fetchRandom = async (tags, excludeIds) => {
    const apiQuery = buildApiQuery(tags, excludeIds);
    // `/posts/random.json` answers directly with one post object. The
    // `/posts.json?random=true` form redirects and appends `random:1`,
    // which counts against the user's tag limit.
    const apiUrl =
        `/posts/random.json?tags=${encodeURIComponent(apiQuery)}&only=id`;

    try {
      const response = await fetch(apiUrl);

      // 404 means no post matches the search: not an error.
      if (response.status === 404) {
        return {status: 'empty'};
      }
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      // Only accept a well-formed integer ID from the API response.
      const id = data ? data.id : null;
      if (!Number.isInteger(id)) {
        throw new Error('Malformed response');
      }
      return {status: 'ok', id};
    } catch (error) {
      console.warn('NextRandomPost: Fetch failed', error);
      return {status: 'error'};
    }
  };

  /**
   * Fetches a random post that is neither the current post nor one viewed
   * recently in this tab. If nothing is left, the fetch is retried once
   * excluding only the current post. When that finds a post, every match had
   * been viewed recently, so the history restarts from the current post and
   * small searches cycle instead of running dry. When it does not, the search
   * has no other posts at all (e.g. a typo) and the history is kept.
   *
   * @param {string} query The search tags.
   * @return {!Promise<!RandomResult>}
   */
  const fetchUnseenRandom = async (query) => {
    const excludeIds = getRecentPostIds();
    const result = await fetchRandom(query, excludeIds);
    if (result.status !== 'empty' || excludeIds.length <= 1) {
      return result;
    }
    const currentId = getCurrentPostId();
    const retry = await fetchRandom(query, [currentId]);
    if (retry.status === 'ok') {
      writeHistory([currentId]);
    }
    return retry;
  };

  /**
   * Returns the random-post request for `query`, starting one unless the
   * latest request was for the same query.
   *
   * @param {string} query The search tags.
   * @return {!Promise<!RandomResult>}
   */
  const requestRandom = (query) => {
    if (prefetch && prefetch.query === query) {
      return prefetch.promise;
    }
    const entry = {query, promise: null, result: null};
    entry.promise = fetchUnseenRandom(query).then((result) => {
      entry.result = result;
      if (prefetch === entry) {
        syncLinkHref();
      }
      return result;
    });
    prefetch = entry;
    return entry.promise;
  };

  /**
   * Starts fetching a random post for the current search, so a later click
   * can navigate without waiting.
   */
  const performPrefetch = () => {
    requestRandom(getCurrentQuery());
  };

  /**
   * Drops the current request and fetches a new random post, e.g. once the
   * prefetched post has been opened in another tab.
   */
  const renewPrefetch = () => {
    prefetch = null;
    performPrefetch();
  };

  /**
   * Resolves to the promise's value, or to `fallbackValue` if the promise
   * has not settled within `ms`.
   *
   * @param {!Promise<T>} promise
   * @param {number} ms
   * @param {T} fallbackValue
   * @return {!Promise<T>}
   * @template T
   */
  const withTimeout = (promise, ms, fallbackValue) => Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallbackValue), ms)),
  ]);

  /**
   * Builds the URL of a post page that keeps the search tags.
   *
   * @param {number} postId The ID of the post to navigate to.
   * @param {string} activeTags The tags to maintain in the URL query parameters.
   * @return {string}
   */
  const buildPostUrl = (postId, activeTags) => {
    if (!activeTags) {
      return `/posts/${postId}`;
    }
    const urlParams = new URLSearchParams(window.location.search);
    const paramKey = urlParams.has('tags') ? 'tags' : 'q';
    return `/posts/${postId}?${paramKey}=${encodeURIComponent(activeTags)}`;
  };

  /**
   * Builds Danbooru's own random-post URL, used when the API request failed
   * or (as the link's href) has not finished yet.
   *
   * @param {string} activeTags The search tags.
   * @return {string}
   */
  const buildFallbackUrl = (activeTags) => (activeTags ?
      `/posts/random?tags=${encodeURIComponent(activeTags)}` :
      '/posts/random');

  /**
   * Returns the post the prefetch found for `query`, if it has finished and
   * found one.
   *
   * @param {string} query The search tags.
   * @return {number|undefined}
   */
  const getPrefetchedId = (query) => {
    const result =
        (prefetch && prefetch.query === query) ? prefetch.result : null;
    return (result && result.status === 'ok') ? result.id : undefined;
  };

  /**
   * Points the sidebar link at where it leads right now: the prefetched post
   * when it is ready for the current search, otherwise Danbooru's random URL.
   * A real `href` lets the browser open it in a new tab (middle click,
   * Ctrl/Cmd+click, context menu).
   */
  const syncLinkHref = () => {
    if (!nextLink) {
      return;
    }
    const query = getCurrentQuery();
    const postId = getPrefetchedId(query);
    nextLink.href = postId ?
        buildPostUrl(postId, query) :
        buildFallbackUrl(query);
  };

  /**
   * Handles the link being opened in another tab or window by the browser.
   * The post it led to counts as viewed in this tab, so the next prefetch
   * skips it and the next new tab gets a different post even in a small
   * search. Opening through the context menu cannot be detected.
   */
  const handleOpenedElsewhere = () => {
    const openedId = getPrefetchedId(getCurrentQuery());
    if (openedId) {
      const [currentId, ...rest] = getRecentPostIds();
      writeHistory([
        currentId,
        openedId,
        ...rest.filter((id) => id !== openedId),
      ].slice(0, HISTORY_SIZE));
    }
    // The new request settles asynchronously, after the browser has read
    // the current href.
    renewPrefetch();
  };

  /**
   * Shows a message through Danbooru's notice bar, or the console if the
   * page has none.
   *
   * @param {string} message
   */
  const notify = (message) => {
    const danbooru = window.Danbooru;
    if (danbooru && typeof danbooru.notice === 'function') {
      danbooru.notice(message);
    } else {
      console.warn(`NextRandomPost: ${message}`);
    }
  };

  /**
   * Leaves for `url`, keeping `isNavigating` set for `NAV_LOCK_MS` in case
   * the navigation is cancelled and this page stays.
   *
   * @param {string} url
   */
  const navigateTo = (url) => {
    window.location.href = url;
    clearTimeout(navLockTimer);
    navLockTimer = setTimeout(() => {
      isNavigating = false;
    }, NAV_LOCK_MS);
  };

  /**
   * Executes the navigation logic.
   *
   * Waits (at most `NAV_WAIT_MS`) for the random-post request of the current
   * search, starting one if the search box changed since the prefetch.
   * 1. `ok`: navigate to that post.
   * 2. `empty`: stay, and tell the user no other post matches.
   * 3. `error` or timeout: fall back to Danbooru's random URL.
   *
   * Sets `isNavigating` to true to prevent multiple triggers. It is cleared
   * right away when staying, and after `NAV_LOCK_MS` when leaving.
   *
   * @return {!Promise<void>}
   */
  const executeNavigation = async () => {
    if (isNavigating) {
      return;
    }
    isNavigating = true;

    const query = getCurrentQuery();
    const result = await withTimeout(
        requestRandom(query), NAV_WAIT_MS, {status: 'error'});

    if (result.status === 'ok') {
      navigateTo(buildPostUrl(result.id, query));
    } else if (result.status === 'empty') {
      notify(NO_MATCH_MESSAGE);
      isNavigating = false;
    } else {
      navigateTo(buildFallbackUrl(query));
    }
  };

  /**
   * Resets the script state.
   * Typically called when the page is restored from the back/forward cache (bfcache).
   */
  const resetState = () => {
    isNavigating = false;
    clearTimeout(navLockTimer);
    // Drop the cached request because the user might have already seen that
    // post, or the context might be stale upon return.
    renewPrefetch();
  };

  // --- Banned Post Handling ---

  /**
   * Determines whether the current post is hidden from this user (e.g.
   * removed by a takedown request, shown as a blank page). Approvers and
   * above see the normal post page, so they are excluded by the DOM check.
   *
   * Detection strategy:
   * 1. DOM: Normal post pages always render the image container and the
   *    sidebar options. If either exists, the post is visible.
   * 2. Page: The removed-page error (HTTP 451) has the title "Page Removed"
   *    and a takedown message. Either one is enough, with no request. This
   *    also covers posts hidden by `is_taken_down`, which is not `is_banned`.
   * 3. API: Only if neither marker is found (e.g. the wording changed),
   *    cross-check `is_banned` via the posts API.
   *
   * @param {number|undefined} postId The current post ID from the URL.
   * @return {!Promise<boolean>} True if the post is hidden for this user.
   */
  const detectHiddenPost = async (postId) => {
    if (document.querySelector('.image-container, #post-options')) {
      return false;
    }
    if (/^Page Removed\b/.test(document.title) ||
        /removed because of a takedown request/i
            .test(document.body.textContent)) {
      return true;
    }
    if (!postId) {
      return false;
    }

    try {
      const response = await fetch(`/posts/${postId}.json?only=id,is_banned`);
      if (response.ok) {
        const data = await response.json();
        return Boolean(data) && data.is_banned === true;
      }
    } catch (error) {
      console.warn('NextRandomPost: Banned check failed', error);
    }
    return false;
  };

  /**
   * Fits the double-tap zone between the parts of the site header and footer
   * that are currently on screen. A header or footer that is off screen
   * takes no room.
   *
   * @param {!HTMLElement} zone
   */
  const positionDoubleTapZone = (zone) => {
    // The layout viewport, which `position: fixed` and getBoundingClientRect
    // both use (`innerHeight` can differ on mobile).
    const viewportHeight = document.documentElement.clientHeight;
    const clamp = (value) => Math.min(Math.max(value, 0), viewportHeight);
    const header = document.querySelector('header');
    const footer = document.querySelector('footer');

    const top = header ? clamp(header.getBoundingClientRect().bottom) : 0;
    const bottom = footer ?
        clamp(viewportHeight - footer.getBoundingClientRect().top) : 0;
    zone.style.top = `${top}px`;
    zone.style.bottom = `${bottom}px`;
  };

  /**
   * Injects a double-tap zone with a subtle hint onto a banned post page,
   * so touch-only (mobile) users can still trigger random navigation.
   * A double tap (or double click) on the right side of the viewport
   * executes the same navigation as the sidebar link / keyboard shortcut.
   */
  const setupDoubleTapZone = () => {
    const style = document.createElement('style');
    style.textContent = GLOBAL_CSS;
    document.head.appendChild(style);

    const zone = document.createElement('div');
    zone.id = 'nrp-double-tap-zone';
    zone.title = 'Double-tap: next random post';

    const hintIcon = document.createElement('span');
    hintIcon.className = 'nrp-hint-icon';
    hintIcon.textContent = '»';

    const hintText = document.createElement('span');
    hintText.className = 'nrp-hint-text';
    hintText.textContent = 'Double-tap: next random';

    zone.appendChild(hintIcon);
    zone.appendChild(hintText);
    document.body.appendChild(zone);

    // Keep the zone clear of the site header and footer, also after the
    // screen is rotated or resized (the header can change height).
    positionDoubleTapZone(zone);
    window.addEventListener('resize', () => positionDoubleTapZone(zone));

    let lastTapTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;

    zone.addEventListener('pointerup', (event) => {
      // Ignore secondary pointers (e.g. the second finger of a pinch).
      if (!event.isPrimary) {
        return;
      }

      const distance = Math.hypot(
          event.clientX - lastTapX, event.clientY - lastTapY);
      const isDoubleTap = (event.timeStamp - lastTapTime) < DOUBLE_TAP_MS &&
          distance < DOUBLE_TAP_SLOP_PX;

      lastTapTime = event.timeStamp;
      lastTapX = event.clientX;
      lastTapY = event.clientY;

      if (isDoubleTap) {
        lastTapTime = 0;
        executeNavigation();
      }
    });
  };

  // --- Initialization ---

  /**
   * Initializes the script by setting up event listeners and triggering the initial prefetch.
   */
  const init = () => {
    // `@match` also covers sub-pages (`/posts/123/events`, `/posts/new`, ...).
    if (!getCurrentPostId()) {
      return;
    }

    writeHistory(getRecentPostIds());
    performPrefetch();

    // Enable double-tap navigation on banned (takedown) post pages where
    // the normal UI (and thus the sidebar link) is unavailable.
    detectHiddenPost(getCurrentPostId()).then((hidden) => {
      if (hidden) {
        setupDoubleTapZone();
      }
    });

    // Handle Browser Back/Forward Cache (bfcache) restoration, where the page
    // comes back with `isNavigating` still set and an already-used prefetch.
    // Only `persisted` counts: the page's first pageshow fires on load, which
    // can come while a click is still waiting for the prefetch (large images
    // on mobile); resetting then would unlock a second navigation.
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        resetState();
      }
    });

    // Add UI link to the sidebar options
    const optionsList = document.querySelector('#post-options > ul');
    if (optionsList) {
      const listItem = document.createElement('li');
      const link = document.createElement('a');
      nextLink = link;

      link.innerText = 'Next random post';
      link.title = 'Shortcut: Alt + Shift + →';
      syncLinkHref();

      // Refresh the target right before the browser reads it, in case the
      // search box changed since the prefetch.
      for (const type of ['mousedown', 'touchstart', 'focus', 'contextmenu']) {
        link.addEventListener(type, syncLinkHref, {passive: true});
      }

      link.addEventListener('click', (event) => {
        // Ctrl/Cmd/Shift/Alt+click: the browser opens the href elsewhere.
        // So does a non-primary button, on browsers that still send `click`
        // (not `auxclick`) for it. If one ever sends both, the second call
        // finds no prefetched post and records nothing.
        const opensElsewhere = event.button !== 0 || event.ctrlKey ||
            event.metaKey || event.shiftKey || event.altKey;
        if (opensElsewhere) {
          handleOpenedElsewhere();
          return;
        }
        event.preventDefault();
        executeNavigation();
      });
      // Middle click fires `auxclick`, not `click`.
      link.addEventListener('auxclick', (event) => {
        if (event.button === 1) {
          handleOpenedElsewhere();
        }
      });

      listItem.appendChild(link);
      optionsList.appendChild(listItem);
    }

    // Register Keyboard Shortcut
    document.addEventListener('keydown', (event) => {
      // Ignore combinations involving Ctrl/Meta to avoid clashing with
      // browser or OS level shortcuts.
      if (event.ctrlKey || event.metaKey) {
        return;
      }

      const target = /** @type {!HTMLElement} */ (event.target);
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
          target.isContentEditable;

      if (isInput) {
        return;
      }

      if (event.altKey && event.shiftKey && event.key === 'ArrowRight') {
        event.preventDefault();
        executeNavigation();
      }
    });
  };

  init();
})();
