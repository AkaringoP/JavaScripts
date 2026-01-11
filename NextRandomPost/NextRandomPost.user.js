// ==UserScript==
// @name         Danbooru Next Random Post
// @namespace    https://github.com/AkaringoP
// @version      2.1
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

  // --- State Management ---
  /** @type {?number} */
  let cachedNextId = null;
  /** @type {string} */
  let cachedQuerySource = '';
  /** @type {boolean} */
  let isNavigating = false;
  /** @type {boolean} */
  let isFetching = false;


  // --- Core Logic ---

  /**
   * Retrieves the current search query from the input box or URL.
   * @return {string} The current search tags.
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
   * Fetches a random post ID based on the given tags.
   * @param {string} tags The search tags to use.
   * @return {!Promise<?number>} The random post ID, or null if none found.
   */
  const fetchRandomId = async (tags) => {
    if (isFetching) return null;
    isFetching = true;

    try {
      // Strip existing order tags to avoid conflicts.
      const apiQuery = tags.replace(/order:[^\s]+/, '').trim();

      const apiUrl = `/posts.json?tags=${encodeURIComponent(apiQuery)}&random=true&limit=1&only=id`;
      const response = await fetch(apiUrl);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return (data && data.length > 0) ? data[0].id : null;
    } catch (error) {
      console.warn('NextRandomPost: Fetch failed', error);
      throw error;
    } finally {
      isFetching = false;
    }
  };

  /**
   * Prefetches a random post ID to cache for later use.
   * @return {!Promise<void>}
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
      // Ignore prefetch errors.
    }
  };

  /**
   * Navigates to a specific post with the active tags.
   * @param {number} postId The ID of the post to navigate to.
   * @param {string} activeTags The tags to maintain in the URL.
   * @return {void}
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
   * Executes the navigation logic, using cached ID or directly navigating to random URL.
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

    // Strategy 2: Cache Miss
    // Directly navigate to the random post URL.
    const fallbackUrl = `/posts/random${currentTags ? '?tags=' + encodeURIComponent(currentTags) : ''}`;
    window.location.href = fallbackUrl;
  };

  // --- Init ---

  /**
   * Initializes the script, setting up event listeners and prefetching.
   * @return {void}
   */
  const init = () => {
    performPrefetch();

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
