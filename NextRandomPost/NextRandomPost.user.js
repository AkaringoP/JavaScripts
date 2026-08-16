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
   * The ID of the pre-fetched random post. Null if not yet fetched or invalidated.
   * @type {?number}
   */
  let cachedNextId = null;

  /**
   * The search tags used to fetch the cached ID. Used to validate cache relevance.
   * @type {string}
   */
  let cachedQuerySource = '';

  /**
   * Flag indicating if a navigation event is currently in progress.
   * Used to prevent double-submissions or race conditions.
   * @type {boolean}
   */
  let isNavigating = false;

  /**
   * Flag indicating if an API fetch operation is currently in progress.
   * @type {boolean}
   */
  let isFetching = false;

  // --- Core Logic ---

  /**
   * Retrieves the current search query from the input box or URL parameters.
   * Priority is given to the input box value, falling back to URL 'q' or 'tags'.
   *
   * @return {string} The current search tags as a trimmed string.
   */
  /**
   * Extracts the current post ID from the URL path.
   *
   * @return {number|undefined} The post ID, or undefined when the path does
   *     not contain one.
   */
  const getCurrentPostId = () => {
    const match = window.location.pathname.match(/\/posts\/(\d+)/);
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
   * Fetches a random post ID from the API based on the provided tags.
   * Handles API errors gracefully and ensures only one fetch runs at a time.
   *
   * @param {string} tags The search tags to use for filtering the random post.
   * @param {number=} excludeId Post ID to exclude from results (typically the
   *     current post to avoid navigating to the same page).
   * @return {!Promise<?number>} A promise that resolves to the random post ID,
   * or null if no post is found or an error occurs.
   */
  const fetchRandomId = async (tags, excludeId) => {
    if (isFetching) {
      return null;
    }
    isFetching = true;

    try {
      // Strip existing 'order:...' tags to avoid conflicts with 'random' sorting.
      let apiQuery =
          tags.replace(/order:[^\s]+/gi, '').replace(/\s+/g, ' ').trim();

      // Exclude the specified post ID from results.
      if (excludeId) {
        apiQuery = apiQuery ? `${apiQuery} -id:${excludeId}` : `-id:${excludeId}`;
      }

      const apiUrl = `/posts.json?tags=${encodeURIComponent(apiQuery)}&random=true&limit=1&only=id`;
      const response = await fetch(apiUrl);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      // Only accept a well-formed integer ID from the API response.
      const id = (data && data.length > 0) ? data[0].id : null;
      return Number.isInteger(id) ? id : null;
    } catch (error) {
      console.warn('NextRandomPost: Fetch failed', error);
      return null;
    } finally {
      isFetching = false;
    }
  };

  /**
   * Prefetches a random post ID and stores it in the cache for later use.
   * If a fetch is successful, updates `cachedNextId` and `cachedQuerySource`.
   *
   * @return {!Promise<void>} A promise that resolves when the prefetch is complete.
   */
  const performPrefetch = async () => {
    const currentTags = getCurrentQuery();
    const currentId = getCurrentPostId();
    const id = await fetchRandomId(currentTags, currentId);
    if (id) {
      cachedNextId = id;
      cachedQuerySource = currentTags;
    }
  };

  /**
   * Navigates the browser to the specified post ID while maintaining search tags.
   *
   * @param {number} postId The ID of the post to navigate to.
   * @param {string} activeTags The tags to maintain in the URL query parameters.
   */
  const navigateToPost = (postId, activeTags) => {
    if (!activeTags) {
      window.location.href = `/posts/${postId}`;
      return;
    }
    const urlParams = new URLSearchParams(window.location.search);
    const paramKey = urlParams.has('tags') ? 'tags' : 'q';
    window.location.href = `/posts/${postId}?${paramKey}=${encodeURIComponent(activeTags)}`;
  };

  /**
   * Executes the navigation logic.
   *
   * Strategy:
   * 1. If a valid cached ID exists for the current tags, navigate to it.
   * 2. If no cache exists, fallback to the standard Danbooru random URL.
   *
   * Sets `isNavigating` to true to prevent multiple triggers.
   *
   * @return {!Promise<void>}
   */
  const executeNavigation = async () => {
    if (isNavigating) {
      return;
    }
    isNavigating = true;

    const currentTags = getCurrentQuery();

    // Strategy 1: Cache Hit
    if (cachedNextId && currentTags === cachedQuerySource) {
      navigateToPost(cachedNextId, currentTags);
      return;
    }

    // Strategy 2: Cache Miss (Fallback)
    // Directly navigate to the random post URL provided by the backend.
    const fallbackUrl = `/posts/random${currentTags ? '?tags=' + encodeURIComponent(currentTags) : ''}`;
    window.location.href = fallbackUrl;
  };

  /**
   * Resets the script state.
   * Typically called when the page is restored from the back/forward cache (bfcache).
   */
  const resetState = () => {
    isNavigating = false;
    isFetching = false;
    // Clear the cache because the user might have already seen the cached post
    // or the context might be stale upon return.
    cachedNextId = null;
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
   * 2. API: Cross-check `is_banned` via the posts API.
   * 3. Fallback: If the API is unavailable for this post, look for the
   *    takedown message in the page body.
   *
   * @param {number|undefined} postId The current post ID from the URL.
   * @return {!Promise<boolean>} True if the post is hidden for this user.
   */
  const detectHiddenPost = async (postId) => {
    if (document.querySelector('#image-container, #post-options')) {
      return false;
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
    return /removed because of a takedown request/i
        .test(document.body.innerText);
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
    performPrefetch();

    // Enable double-tap navigation on banned (takedown) post pages where
    // the normal UI (and thus the sidebar link) is unavailable.
    detectHiddenPost(getCurrentPostId()).then((hidden) => {
      if (hidden) {
        setupDoubleTapZone();
      }
    });

    // Handle Browser Back/Forward Cache (bfcache) restoration.
    // This fixes the issue where 'isNavigating' remains true after clicking 'Back'.
    window.addEventListener('pageshow', (event) => {
      if (event.persisted || isNavigating) {
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
