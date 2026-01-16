// ==UserScript==
// @name         Danbooru Next Random Post
// @namespace    https://github.com/AkaringoP
// @version      2.1.1
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
   * @return {!Promise<?number>} A promise that resolves to the random post ID,
   * or null if no post is found or an error occurs.
   */
  const fetchRandomId = async (tags) => {
    if (isFetching) return null;
    isFetching = true;

    try {
      // Strip existing 'order:...' tags to avoid conflicts with 'random' sorting.
      const apiQuery = tags.replace(/order:[^\s]+/, '').trim();

      const apiUrl = `/posts.json?tags=${encodeURIComponent(apiQuery)}&random=true&limit=1&only=id`;
      const response = await fetch(apiUrl);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return (data && data.length > 0) ? data[0].id : null;
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
    try {
      const id = await fetchRandomId(currentTags);
      if (id) {
        cachedNextId = id;
        cachedQuerySource = currentTags;
      }
    } catch (e) {
      // Silently ignore prefetch errors to avoid disrupting user experience.
    }
  };

  /**
   * Navigates the browser to the specified post ID while maintaining active tags.
   *
   * @param {number} postId The ID of the post to navigate to.
   * @param {string} activeTags The tags to maintain in the URL query parameters.
   */
  const navigateToPost = (postId, activeTags) => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('tags')) {
      urlParams.set('tags', activeTags);
    } else {
      urlParams.set('q', activeTags);
    }
    window.location.href = `/posts/${postId}?${urlParams.toString()}`;
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
    if (isNavigating) return;
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


  // --- Initialization ---

  /**
   * Initializes the script by setting up event listeners and triggering the initial prefetch.
   */
  const init = () => {
    performPrefetch();

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
      const target = /** @type {!HTMLElement} */ (event.target);
      const isInput = ['INPUT', 'TEXTAREA'].includes(target.tagName) ||
          target.isContentEditable;

      if (isInput) return;

      if (event.altKey && event.shiftKey && event.key === 'ArrowRight') {
        event.preventDefault();
        executeNavigation();
      }
    });
  };

  init();
})();
