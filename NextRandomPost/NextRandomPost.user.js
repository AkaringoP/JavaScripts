// ==UserScript==
// @name         Danbooru Next Random Post
// @namespace    https://github.com/AkaringoP
// @version      2.0
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
  const TOAST_DURATION_MS = 2500;

  // --- State Management ---
  let cachedNextId = null;
  let cachedQuerySource = '';
  let isNavigating = false;
  let isFetching = false;
  let toastElement = null;
  let toastTimeout = null;

  // --- UI Utilities (Toast) ---

  /**
   * Creates and appends the toast element to the DOM.
   * @return {!HTMLElement} The created toast element.
   */
  const createToast = () => {
    const toast = document.createElement('div');
    const style = toast.style;

    style.position = 'fixed';
    style.top = '20px';
    style.left = '50%';
    style.transform = 'translateX(-50%)';

    style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    style.color = '#fff';
    style.padding = '10px 24px';
    style.borderRadius = '8px';
    style.fontFamily = 'Arial, sans-serif';
    style.fontSize = '14px';
    style.fontWeight = 'normal';
    style.whiteSpace = 'nowrap';

    style.zIndex = '10000';
    style.opacity = '0';
    style.transition = 'opacity 0.4s ease';
    style.pointerEvents = 'none';
    style.boxShadow = '0 4px 6px rgba(0,0,0,0.15)';

    document.body.appendChild(toast);
    return toast;
  };

  /**
   * Displays a toast message to the user.
   * @param {string} message The message to display.
   * @param {string=} type The type of message ('info' or 'error'). Defaults to 'info'.
   */
  const showToast = (message, type = 'info') => {
    if (!toastElement) {
      toastElement = createToast();
    }

    if (toastTimeout) {
      clearTimeout(toastTimeout);
      toastTimeout = null;
    }

    toastElement.style.color = type === 'error' ? '#ff8e8e' : '#fff';
    toastElement.innerText = message;

    // Trigger reflow to restart animation.
    void toastElement.offsetWidth;

    toastElement.style.opacity = '1';

    toastTimeout = setTimeout(() => {
      if (toastElement) {
        toastElement.style.opacity = '0';
      }
    }, TOAST_DURATION_MS);
  };

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
   * @param {boolean=} force Whether to force a fetch even if one is in progress.
   * @return {!Promise<?number>} The random post ID, or null if none found.
   */
  const fetchRandomId = async (tags, force = false) => {
    if (isFetching && !force) return null;
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
      const id = await fetchRandomId(currentTags, false);
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
   * Executes the navigation logic, using cached ID or fetching a new one.
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
    showToast('Query changed. Searching...', 'info');

    try {
      const freshId = await fetchRandomId(currentTags, true);

      if (freshId) {
        navigateToPost(freshId, currentTags);
      } else {
        showToast('No random post found.', 'error');
        isNavigating = false;
      }
    } catch (error) {
      // Fallback to server-side random redirect if API fails.
      console.error('API Error, falling back to server redirect', error);
      const fallbackUrl = `/posts/random${currentTags ? '?tags=' + encodeURIComponent(currentTags) : ''}`;
      window.location.href = fallbackUrl;
    }
  };

  // --- Init ---

  /**
   * Initializes the script, setting up event listeners and prefetching.
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
