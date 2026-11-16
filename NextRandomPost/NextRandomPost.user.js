// ==UserScript==
// @name         Danbooru Next Random Post
// @namespace    https://github.com/AkaringoP
// @version      2.3
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
   * Injected only when such a page is detected.
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
   * Null until the first request, and after a reset.
   * @type {?{query: string, promise: !Promise<!RandomResult>}}
   */
  let prefetch = null;

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
   * Retrieves the current search query from the input box or URL parameters.
   * Priority is given to the input box value, falling back to URL 'q' or 'tags'.
   *
   * @return {string} The current search tags as a trimmed string.
   */
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
   * Builds the API search query for a random post.
   *
   * Drops `order:` metatags, which conflict with random ordering. Only whole
   * tokens that start with `order:` are dropped, so tags that merely contain
   * it (e.g. `fate/grand_order:_first_order`) are kept.
   *
   * @param {string} tags The user's search tags.
   * @param {number=} excludeId Post ID to exclude from results (typically the
   *     current post to avoid navigating to the same page).
   * @return {string} The query to send to the API.
   */
  const buildApiQuery = (tags, excludeId) => {
    const terms = tags.split(/\s+/)
        .filter((term) => term && !/^order:/i.test(term));
    if (excludeId) {
      terms.push(`-id:${excludeId}`);
    }
    return terms.join(' ');
  };

  /**
   * Fetches a random post from the API. Never rejects: every failure is
   * reported as a result.
   *
   * @param {string} tags The search tags to use for filtering the random post.
   * @param {number=} excludeId Post ID to exclude from results (typically the
   *     current post to avoid navigating to the same page).
   * @return {!Promise<!RandomResult>}
   */
  const fetchRandom = async (tags, excludeId) => {
    const apiQuery = buildApiQuery(tags, excludeId);
    // `/posts/random.json` answers directly with one post object. The
    // `/posts.json?random=true` form redirects and appends `random:1`,
    // which counts against the user's tag limit.
    const apiUrl = `/posts/random.json?tags=${encodeURIComponent(apiQuery)}&only=id`;

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
    prefetch = {query, promise: fetchRandom(query, getCurrentPostId())};
    return prefetch.promise;
  };

  /**
   * Starts fetching a random post for the current search, so a later click
   * can navigate without waiting.
   */
  const performPrefetch = () => {
    requestRandom(getCurrentQuery());
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
   * Builds Danbooru's own random-post URL, used when the API request failed.
   *
   * @param {string} activeTags The search tags.
   * @return {string}
   */
  const buildFallbackUrl = (activeTags) =>
    `/posts/random${activeTags ? '?tags=' + encodeURIComponent(activeTags) : ''}`;

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
    prefetch = null;
    performPrefetch();
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

    // Keep the zone clear of the site header and footer when present.
    const header = document.querySelector('header');
    if (header) {
      zone.style.top = `${header.getBoundingClientRect().bottom}px`;
    }
    const footer = document.querySelector('footer');
    if (footer) {
      zone.style.bottom = `${footer.getBoundingClientRect().height}px`;
    }

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

      link.href = '#';
      link.innerText = 'Next random post';
      link.style.cursor = 'pointer';
      link.title = 'Shortcut: Alt + Shift + →';

      link.addEventListener('click', (event) => {
        event.preventDefault();
        executeNavigation();
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
