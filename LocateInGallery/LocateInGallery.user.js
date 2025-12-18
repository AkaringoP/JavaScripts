// ==UserScript==
// @name         Danbooru Locate in Gallery
// @namespace    https://github.com/AkaringoP
// @version      1.3
// @description  Finds the post's gallery page using efficient counting logic (O(1)) for ID sorts, and batch search for others. Restores query context.
// @author       AkaringoP
// @license      MIT
// @match        *://danbooru.donmai.us/posts*
// @icon         https://danbooru.donmai.us/favicon.ico
// @updateURL    https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/LocateInGallery/LocateInGallery.user.js
// @downloadURL  https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/LocateInGallery/LocateInGallery.user.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(() => {
  'use strict';

  // --- CONFIGURATION ---
  /** @const {number} Number of parallel requests per batch. */
  const BATCH_SIZE = 5;

  /** @const {number} Max items per request (Try 1000 for Gold, fallback to 200 for Basic). */
  const MAX_SCAN_LIMIT = 1000;

  /** @const {number} Delay in milliseconds between batches to respect rate limits. */
  const REQUEST_DELAY_MS = 600;

  const HISTORY_STORAGE_KEY = 'danbooru_locate_visit_history';
  const HISTORY_LIMIT = 10;
  const HISTORY_EXPIRATION_MS = 60 * 60 * 1000;
  const STORAGE_KEY = 'danbooru_locate_restore_query';

  let isSearching = false;
  let abortController = null;

  /**
   * Pauses execution for a specified duration.
   * @param {number} ms - The number of milliseconds to sleep.
   * @return {Promise<void>}
   */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Waits for an element to appear in the DOM.
   * @param {string} selector - The CSS selector to wait for.
   * @param {number} [timeout=10000] - Timeout in milliseconds.
   * @return {Promise<Element|null>} The element or null if timed out.
   */
  const waitForElement = (selector, timeout = 10000) => {
    return new Promise((resolve) => {
      if (document.querySelector(selector)) {
        return resolve(document.querySelector(selector));
      }

      const observer = new MutationObserver((mutations, obs) => {
        const element = document.querySelector(selector);
        if (element) {
          resolve(element);
          obs.disconnect();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  };

  /**
   * Determines the effective 'limit' (posts per page) for calculation.
   * @param {string} searchQuery - The current search query tags.
   * @return {Promise<number>} The number of posts per page.
   */
  const getEffectiveLimit = async (searchQuery) => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlLimit = parseInt(urlParams.get('limit'), 10);

    if (urlLimit && !isNaN(urlLimit)) {
      return urlLimit;
    }

    const cleanQuery = searchQuery.replace(/order:random/gi, '').trim();
    const probeUrl = `/posts.json?tags=${encodeURIComponent(cleanQuery)}&only=id`;

    try {
      const response = await fetch(probeUrl);
      if (!response.ok) {
        return 20;
      }
      const data = await response.json();
      return data.length > 0 ? data.length : 20;
    } catch (error) {
      return 20;
    }
  };

  /**
   * Calculates the page number using the count API (Strategy 1).
   * @param {HTMLElement} uiElement - The link element to update status.
   * @param {string} searchQuery - The current search tags.
   * @param {number} currentId - The ID of the current post.
   * @param {AbortSignal} signal - Signal to abort the request.
   * @return {Promise<{page: number, limit: number}|{page: null, limit: null}>} Result.
   */
  const performCountCalculation = async (uiElement, searchQuery, currentId, signal) => {
    uiElement.innerText = 'Checking settings...';
    const calcQueryBase = searchQuery.replace(/order:random/gi, '').trim();
    const limit = await getEffectiveLimit(calcQueryBase);

    if (signal.aborted) {
      return {page: null, limit: null};
    }

    uiElement.innerText = 'Calculating...';
    const countQuery = `${calcQueryBase} id:>${currentId}`;
    const countUrl = `/counts/posts.json?tags=${encodeURIComponent(countQuery)}`;

    const response = await fetch(countUrl, {signal});
    if (!response.ok) {
      throw new Error(`Count API Error: ${response.status}`);
    }
    const data = await response.json();

    let precedingPostsCount = 0;
    if (data && data.counts && typeof data.counts.posts === 'number') {
      precedingPostsCount = data.counts.posts;
    }

    const page = Math.floor(precedingPostsCount / limit) + 1;
    return {page, limit};
  };

  /**
   * Searches using parallel batch requests with adaptive limits (Strategy 2).
   * @param {HTMLElement} uiElement - The link element.
   * @param {string} searchQuery - The search tags.
   * @param {number} currentId - The current post ID.
   * @param {AbortSignal} signal - Signal to abort.
   * @return {Promise<{page: number, limit: number}|null>} Result.
   */
  const performBatchSearch = async (uiElement, searchQuery, currentId, signal) => {
    const userLimit = await getEffectiveLimit(searchQuery);

    let scanPage = 1;
    let found = false;

    // Start assuming max capability, but adapt if server returns less.
    let detectedScanLimit = MAX_SCAN_LIMIT;
    let limitDetected = false;

    uiElement.innerText = 'Initializing Warp Drive...';

    const fetchScanPage = async (tags, page, signal) => {
      const apiUrl = `/posts.json?tags=${encodeURIComponent(tags)}&page=${page}&limit=${MAX_SCAN_LIMIT}&only=id`;
      const res = await fetch(apiUrl, {signal});
      if (!res.ok) {
        throw new Error(res.status);
      }
      return await res.json();
    };

    while (!found) {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      // Update UI
      const currentAssumeLimit = limitDetected ? detectedScanLimit : 200;
      const startPost = (scanPage - 1) * currentAssumeLimit * BATCH_SIZE + 1;
      const endPost = scanPage * currentAssumeLimit * BATCH_SIZE;
      uiElement.innerText = `Scanning posts ~${startPost} - ${endPost}...`;

      // Parallel Requests
      const promises = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        const currentScanPage = (scanPage - 1) * BATCH_SIZE + (i + 1);
        promises.push(
            fetchScanPage(searchQuery, currentScanPage, signal)
                .then((data) => ({scanPage: currentScanPage, data}))
                .catch(() => ({scanPage: currentScanPage, data: []})),
        );
      }

      const results = await Promise.all(promises);
      results.sort((a, b) => a.scanPage - b.scanPage);

      let emptyResponseCount = 0;

      for (const res of results) {
        if (res.data.length === 0) {
          emptyResponseCount++;
        }

        // Adaptive Limit Detection (Run on first valid response)
        if (!limitDetected && res.data.length > 0) {
          if (res.data.length > 200) {
            detectedScanLimit = 1000; // Gold User confirmed
          } else {
            // Either Basic user (capped at 200) or end of list.
            // Safest to assume 200 for calculation alignment.
            detectedScanLimit = 200;
          }
          limitDetected = true;
        }

        const localIndex = res.data.findIndex((p) => p.id === currentId);

        if (localIndex !== -1) {
          // Found! Calculate global index.
          const postsBeforeThisPage = (res.scanPage - 1) * detectedScanLimit;
          const globalIndex = postsBeforeThisPage + localIndex;

          // Convert to user's page number
          const targetUserPage = Math.floor(globalIndex / userLimit) + 1;

          return {page: targetUserPage, limit: userLimit};
        }
      }

      if (emptyResponseCount === BATCH_SIZE) {
        return null; // End of results
      }

      scanPage++;
      await sleep(REQUEST_DELAY_MS);
    }
    return null;
  };

  /**
   * Logs the current page visit to localStorage for fast-path lookups.
   */
  const logCurrentPage = () => {
    if (window.location.pathname !== '/posts') {
      return;
    }

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const tags = (urlParams.get('tags') || '').trim();
      const page = parseInt(urlParams.get('page'), 10) || 1;
      const limit = parseInt(urlParams.get('limit'), 10) || 20;

      const entry = {tags, page, limit, timestamp: Date.now()};
      let history = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
      const now = Date.now();

      history = history.filter((h) => now - h.timestamp < HISTORY_EXPIRATION_MS);

      if (history.length > 0) {
        const last = history[0];
        if (last.tags === tags && last.page === page && last.limit === limit) {
          last.timestamp = now;
          localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
          return;
        }
      }

      history.unshift(entry);
      if (history.length > HISTORY_LIMIT) {
        history = history.slice(0, HISTORY_LIMIT);
      }

      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch (e) {
      console.warn('LocateInGallery: Failed to log history', e);
    }
  };

  /**
   * Checks history for an immediate match.
   * @param {number} currentId - The post ID.
   * @param {string} targetTags - The search query.
   * @param {AbortSignal} signal - Abort signal.
   * @return {Promise<{page: number, limit: number}|null>} Result.
   */
  const checkHistory = async (currentId, targetTags, signal) => {
    try {
      let history = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
      if (history.length === 0) {
        return null;
      }

      const now = Date.now();
      history = history.filter((h) => now - h.timestamp < HISTORY_EXPIRATION_MS);
      const candidates = history.filter((h) => h.tags === targetTags);

      for (const entry of candidates) {
        if (signal.aborted) {
          return null;
        }

        // 1. Primary Check (Exact Page)
        const checkUrl = `/posts.json?tags=${encodeURIComponent(entry.tags)}&page=${entry.page}&limit=${entry.limit}&only=id`;
        const res = await fetch(checkUrl, {signal});

        if (!res.ok) {
          continue;
        }

        const data = await res.json();
        if (data.find((p) => p.id === currentId)) {
          return {page: entry.page, limit: entry.limit};
        }

        if (signal.aborted) {
          return null;
        }

        // 2. Extended Check (Next 3 pages) - Parallel
        const promises = [];
        for (let offset = 1; offset <= 3; offset++) {
          const nextPage = entry.page + offset;
          const nextUrl = `/posts.json?tags=${encodeURIComponent(entry.tags)}&page=${nextPage}&limit=${entry.limit}&only=id`;

          promises.push(
              fetch(nextUrl, {signal})
                  .then((r) => r.ok ? r.json() : [])
                  .then((d) => ({page: nextPage, data: d}))
                  .catch(() => ({page: nextPage, data: []})),
          );
        }

        const results = await Promise.all(promises);
        results.sort((a, b) => a.page - b.page);

        for (const r of results) {
          if (r.data.find((p) => p.id === currentId)) {
            return {page: r.page, limit: entry.limit};
          }
        }
      }
    } catch (e) {
      console.warn('LocateInGallery: History check error', e);
    }
    return null;
  };

  /**
   * Main execution logic.
   * @param {HTMLElement} uiElement - The UI link element.
   */
  const executeLocate = async (uiElement) => {
    let originalText = uiElement.innerText;
    if (originalText === 'Cancelled.' || originalText === 'Cancelling...') {
      originalText = 'Locate in gallery';
    }

    if (isSearching) {
      return;
    }
    isSearching = true;
    abortController = new AbortController();
    const signal = abortController.signal;

    uiElement.style.pointerEvents = 'none';

    try {
      const currentPostId = parseInt(document.body.dataset.id ||
          document.querySelector('meta[name="post-id"]')?.content, 10);

      const searchInput = document.querySelector('#tags') ||
          document.querySelector('input[name="tags"]');
      const originalQuery = searchInput ? searchInput.value.trim() : '';

      if (!currentPostId) {
        alert('Missing post ID.');
        return;
      }

      // 1. Prepare Clean Query (Strip order:random for URL navigation)
      let cleanQuery = originalQuery;
      let needsRestore = false;

      if (/order:random/i.test(originalQuery)) {
        cleanQuery = originalQuery.replace(/order:random/gi, '').trim();
        needsRestore = true;
      }

      // 2. Determine Strategy
      const orderMatch = cleanQuery.match(/order:([^\s]+)/);
      let strategy = 'batch';

      if (!orderMatch) {
        strategy = 'calculation';
      } else {
        const orderType = orderMatch[1].toLowerCase();
        if (['id', 'id_desc'].includes(orderType)) {
          strategy = 'calculation';
        }
      }

      // 3. Execute Strategy
      let result = null;

      // 3.0. Try Fast Path (History Log) first
      uiElement.innerText = 'Checking history...';
      const historyResult = await checkHistory(currentPostId, cleanQuery, signal);
      if (historyResult) {
        result = historyResult;
      } else {
        if (strategy === 'calculation') {
          result = await performCountCalculation(uiElement, cleanQuery, currentPostId, signal);
        } else {
          result = await performBatchSearch(uiElement, cleanQuery, currentPostId, signal);
        }
      }

      if (signal.aborted) {
        return;
      }

      // 4. Redirect
      if (result && result.page) {
        uiElement.innerText = `Found (Pg ${result.page})! Redirecting...`;

        if (needsRestore) {
          sessionStorage.setItem(STORAGE_KEY, originalQuery);
        }

        const targetUrl = `/posts?tags=${encodeURIComponent(cleanQuery)}&page=${result.page}&limit=${result.limit}#post_${currentPostId}`;
        window.location.href = targetUrl;
      } else {
        alert('Could not find this post in the provided search query.');
        uiElement.innerText = originalText;
      }

    } catch (error) {
      if (error.name === 'AbortError') {
        uiElement.innerText = 'Cancelled.';
        setTimeout(() => {
          if (!isSearching && uiElement.innerText === 'Cancelled.') {
            uiElement.innerText = originalText;
          }
        }, 2000);
      } else {
        console.error('Locate Script Error:', error);
        alert('An error occurred. Check console.');
        uiElement.innerText = originalText;
      }
    } finally {
      isSearching = false;
      abortController = null;
      uiElement.style.pointerEvents = 'auto';
    }
  };

  /**
   * Restores search context if coming from a random search.
   */
  const restoreQueryContext = () => {
    const storedQuery = sessionStorage.getItem(STORAGE_KEY);
    if (!storedQuery) {
      return;
    }

    if (window.location.pathname === '/posts') {
      const searchInput = document.querySelector('#tags') || document.querySelector('input[name="tags"]');
      if (searchInput) {
        searchInput.value = storedQuery;
      }
      sessionStorage.removeItem(STORAGE_KEY);
    }
  };

  /**
   * Initializes the script.
   */
  const init = async () => {
    restoreQueryContext();
    logCurrentPage();

    const optionsList = document.querySelector('#post-options > ul');
    if (!optionsList) {
      return;
    }

    const listItem = document.createElement('li');
    const link = document.createElement('a');

    link.href = '#';
    link.innerText = 'Locate in gallery';
    link.style.cursor = 'pointer';
    link.title = 'Find the page number of this post in the current search query';

    listItem.appendChild(link);
    optionsList.appendChild(listItem);

    link.addEventListener('click', (event) => {
      event.preventDefault();
      executeLocate(link);
    });

    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && e.code === 'ArrowLeft') {
        const tag = document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
          return;
        }

        e.preventDefault();
        executeLocate(link);
      } else if (e.code === 'Escape' && isSearching && abortController) {
        e.preventDefault();
        link.innerText = 'Cancelling...';
        abortController.abort();
      }
    });
  };

  init();
})();
