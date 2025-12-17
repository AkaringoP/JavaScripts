// ==UserScript==
// @name         Danbooru Locate in Gallery
// @namespace    https://github.com/AkaringoP
// @version      1.0
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

  // Config: Balanced settings for speed and stability
  const BATCH_SIZE = 5;
  const REQUEST_DELAY_MS = 500;
  const STORAGE_KEY = 'danbooru_locate_restore_query';

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
   * Determines the effective 'limit' (posts per page).
   * @param {string} searchQuery - The current search query tags.
   * @return {Promise<number>} The number of posts per page.
   */
  const getEffectiveLimit = async (searchQuery) => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlLimit = parseInt(urlParams.get('limit'), 10);

    if (urlLimit && !isNaN(urlLimit)) {
      return urlLimit;
    }

    // When probing limit, strip 'order:random' to avoid confusion
    const cleanQuery = searchQuery.replace(/order:random/gi, '').trim();
    const probeUrl = `/posts.json?tags=${encodeURIComponent(cleanQuery)}&only=id`;
    const response = await fetch(probeUrl);

    if (!response.ok) {
      throw new Error(`Limit Probe Error: ${response.status}`);
    }

    const data = await response.json();
    return data.length > 0 ? data.length : 20;
  };

  const performCountCalculation = async (uiElement, searchQuery, currentId) => {
    uiElement.innerText = 'Checking settings...';
    // Base calculation on the cleaned query
    const calcQueryBase = searchQuery.replace(/order:random/gi, '').trim();
    const limit = await getEffectiveLimit(calcQueryBase);

    uiElement.innerText = 'Calculating...';
    const countQuery = `${calcQueryBase} id:>${currentId}`;
    const countUrl = `/counts/posts.json?tags=${encodeURIComponent(countQuery)}`;

    const response = await fetch(countUrl);
    if (!response.ok) {
      throw new Error(`Count API Error: ${response.status}`);
    }

    const data = await response.json();

    let precedingPostsCount = 0;
    if (data && data.counts && typeof data.counts.posts === 'number') {
      precedingPostsCount = data.counts.posts;
    } else {
      console.warn('Unexpected JSON structure from counts API:', data);
    }

    const page = Math.floor(precedingPostsCount / limit) + 1;
    return {page, limit};
  };

  const performBatchSearch = async (uiElement, searchQuery, currentId) => {
    const limit = await getEffectiveLimit(searchQuery);
    let startPage = 1;
    let found = false;

    const fetchPage = async (tags, page, limit) => {
      const apiUrl = `/posts.json?tags=${encodeURIComponent(tags)}&page=${page}&limit=${limit}&only=id`;
      const res = await fetch(apiUrl);
      if (!res.ok) {
        throw new Error(res.status);
      }
      return await res.json();
    };

    while (!found) {
      const endPage = startPage + BATCH_SIZE - 1;
      uiElement.innerText = `Scanning Pages ${startPage} - ${endPage}...`;

      const promises = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        const page = startPage + i;
        promises.push(
            fetchPage(searchQuery, page, limit)
                .then((data) => ({page, data}))
                .catch(() => ({page, data: []})),
        );
      }

      const results = await Promise.all(promises);
      results.sort((a, b) => a.page - b.page);

      let isEmptyBatch = true;
      for (const res of results) {
        if (res.data.length > 0) {
          isEmptyBatch = false;
        }
        if (res.data.find((p) => p.id === currentId)) {
          return {page: res.page, limit};
        }
      }

      if (isEmptyBatch) {
        break;
      }
      startPage += BATCH_SIZE;
      await sleep(REQUEST_DELAY_MS);
    }
    return null;
  };

  const executeLocate = async (uiElement) => {
    const originalText = uiElement.innerText;

    try {
      const currentPostId = parseInt(document.body.dataset.id ||
          document.querySelector('meta[name="post-id"]')?.content, 10);

      const searchInput = document.querySelector('#tags') ||
          document.querySelector('input[name="tags"]');
      const originalQuery = searchInput ? searchInput.value.trim() : '';

      if (!currentPostId || !originalQuery) {
        alert('Missing post ID or search query.');
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
      if (strategy === 'calculation') {
        result = await performCountCalculation(uiElement, cleanQuery, currentPostId);
      } else {
        result = await performBatchSearch(uiElement, cleanQuery, currentPostId);
      }

      // 4. Redirect
      if (result && result.page) {
        uiElement.innerText = `Found (Pg ${result.page})! Redirecting...`;

        // If we stripped order:random, save the ORIGINAL query to restore it later
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
      console.error('Locate Script Error:', error);
      alert('An error occurred. Check console.');
      uiElement.innerText = originalText;
    }
  };

  /**
   * Feature: Restore Query Context on Gallery Page
   * Checks if we just arrived from a Locate action and restores the search box.
   */
  const restoreQueryContext = () => {
    const storedQuery = sessionStorage.getItem(STORAGE_KEY);
    if (!storedQuery) return;

    // We are on a gallery page if the URL path is /posts (and not /posts/123)
    // Checking strict path helps avoid running on the post page itself immediately after redirect (though href change handles that)
    if (window.location.pathname === '/posts') {
      const searchInput = document.querySelector('#tags') || document.querySelector('input[name="tags"]');
      if (searchInput) {
        searchInput.value = storedQuery;
        // Optional: Provide visual feedback? (e.g., flash border)
        // searchInput.style.transition = 'background-color 0.5s';
        // searchInput.style.backgroundColor = '#e8f5e9'; // Light green hint
      }
      // Clear storage so it doesn't persist on future reloads
      sessionStorage.removeItem(STORAGE_KEY);
    }
  };

  const init = async () => {
    // A. Check if we need to restore context (Runs on Gallery Page)
    restoreQueryContext();

    // B. Initialize Locate Button (Runs on Post Page)
    // We check for the options menu to decide if we are on a Post page
    const optionsList = document.querySelector('#post-options > ul');
    if (!optionsList) {
      // If no options list, we are likely on the gallery page or elsewhere, so stop here.
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
      }
    });
  };

  init();
})();
