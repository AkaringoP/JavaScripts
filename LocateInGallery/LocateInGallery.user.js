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

  /** @const {number} Max items per API request (/posts.json limit cap). */
  const MAX_SCAN_LIMIT = 200;

  /** @const {number} Delay in milliseconds between batches to respect rate limits. */
  const REQUEST_DELAY_MS = 600;

  const HISTORY_STORAGE_KEY = 'danbooru_locate_visit_history';
  const HISTORY_LIMIT = 10;
  const HISTORY_EXPIRATION_MS = 60 * 60 * 1000;
  const STORAGE_KEY = 'danbooru_locate_restore_query';

  /**
   * Maps sort order names to their post JSON key and Danbooru search qualifier.
   * Used to extend the O(1) count strategy beyond ID-based sorts.
   * Secondary tie-breaking is always id_desc on Danbooru.
   * @const {Object<string, {key: string, qualifier: string}>}
   */
  const ATTR_SORT_MAP = {
    score: {key: 'score', qualifier: 'score'},
    score_asc: {key: 'score', qualifier: 'score'},
    favcount: {key: 'fav_count', qualifier: 'favcount'},
    favcount_asc: {key: 'fav_count', qualifier: 'favcount'},
    filesize: {key: 'file_size', qualifier: 'filesize'},
    filesize_asc: {key: 'file_size', qualifier: 'filesize'},
    tagcount: {key: 'tag_count', qualifier: 'tagcount'},
    tagcount_asc: {key: 'tag_count', qualifier: 'tagcount'},
    mpixels: {key: null, qualifier: 'mpixels'},
    mpixels_asc: {key: null, qualifier: 'mpixels'},
  };

  let isSearching = false;
  let abortController = null;

  /**
   * Pauses execution for a specified duration.
   * @param {number} ms - The number of milliseconds to sleep.
   * @return {Promise<void>}
   */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Fetches a URL with automatic retry on 429 rate limit responses.
   * @param {string} url - The URL to fetch.
   * @param {RequestInit} options - Fetch options (e.g. signal).
   * @param {number} maxRetries - Maximum number of retries after a 429.
   * @return {Promise<Response>} The successful or final response.
   */
  const fetchWithRetry = async (url, options = {}, maxRetries = 2) => {
    let response;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      response = await fetch(url, options);
      if (response.status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt(response.headers.get('Retry-After'), 10);
        await sleep((retryAfter || 1) * 1000);
        continue;
      }
      return response;
    }
    return response;
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
      const response = await fetchWithRetry(probeUrl);
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
   * @param {'asc'|'desc'} sortDirection - The sort direction for ID-based ordering.
   * @param {number} limit - The effective posts-per-page limit.
   * @param {AbortSignal} signal - Signal to abort the request.
   * @return {Promise<{page: number, limit: number}|{page: null, limit: null}>} Result.
   */
  const performCountCalculation = async (uiElement, searchQuery, currentId, sortDirection, limit, signal) => {
    if (signal.aborted) {
      return {page: null, limit: null};
    }

    uiElement.innerText = 'Calculating...';
    const idOperator = sortDirection === 'asc' ? '<' : '>';
    const countQuery = `${searchQuery} id:${idOperator}${currentId}`;
    const countUrl = `/counts/posts.json?tags=${encodeURIComponent(countQuery)}`;

    const response = await fetchWithRetry(countUrl, {signal});
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
   * Calculates the page number using the count API for attribute-based sorts.
   * Fetches the post's attribute value, then counts preceding posts using
   * Danbooru search qualifiers. Tie-breaking is always id_desc.
   * @param {HTMLElement} uiElement - The link element to update status.
   * @param {string} searchQuery - The current search tags.
   * @param {number} currentId - The ID of the current post.
   * @param {string} orderType - The sort order type (e.g. 'score', 'favcount_asc').
   * @param {number} limit - The effective posts-per-page limit.
   * @param {AbortSignal} signal - Signal to abort the request.
   * @return {Promise<{page: number, limit: number}|{page: null, limit: null}>} Result.
   */
  const performAttrCountCalculation = async (uiElement, searchQuery, currentId, orderType, limit, signal) => {
    if (signal.aborted) {
      return {page: null, limit: null};
    }

    const mapping = ATTR_SORT_MAP[orderType];
    const isAsc = orderType.endsWith('_asc');

    // 1. Fetch current post's metadata
    uiElement.innerText = 'Fetching post data...';
    const postRes = await fetchWithRetry(`/posts/${currentId}.json`, {signal});
    if (!postRes.ok) {
      throw new Error(`Post API Error: ${postRes.status}`);
    }
    const post = await postRes.json();

    if (signal.aborted) {
      return {page: null, limit: null};
    }

    // 2. Extract the attribute value used for sorting
    let attrValue;
    if (mapping.key) {
      attrValue = post[mapping.key];
    } else if (mapping.qualifier === 'mpixels') {
      attrValue = (post.image_width * post.image_height) / 1000000;
    }

    // 3. Count preceding posts in parallel:
    //    a) Posts strictly ahead in the primary sort
    //    b) Posts tied on the attribute but ahead in secondary sort (id_desc)
    uiElement.innerText = 'Calculating...';
    const attrOp = isAsc ? '<' : '>';
    const strictQuery = `${searchQuery} ${mapping.qualifier}:${attrOp}${attrValue}`;
    const tieQuery = `${searchQuery} ${mapping.qualifier}:${attrValue} id:>${currentId}`;

    const [strictRes, tieRes] = await Promise.all([
      fetchWithRetry(`/counts/posts.json?tags=${encodeURIComponent(strictQuery)}`, {signal}),
      fetchWithRetry(`/counts/posts.json?tags=${encodeURIComponent(tieQuery)}`, {signal}),
    ]);

    if (!strictRes.ok || !tieRes.ok) {
      throw new Error(`Count API Error: ${strictRes.status || tieRes.status}`);
    }

    const [strictData, tieData] = await Promise.all([
      strictRes.json(),
      tieRes.json(),
    ]);

    let precedingCount = 0;
    if (strictData && strictData.counts &&
        typeof strictData.counts.posts === 'number') {
      precedingCount += strictData.counts.posts;
    }
    if (tieData && tieData.counts &&
        typeof tieData.counts.posts === 'number') {
      precedingCount += tieData.counts.posts;
    }

    const page = Math.floor(precedingCount / limit) + 1;
    return {page, limit};
  };

  /**
   * Searches using parallel batch requests (Strategy 2).
   * @param {HTMLElement} uiElement - The link element.
   * @param {string} searchQuery - The search tags.
   * @param {number} currentId - The current post ID.
   * @param {number} userLimit - The effective posts-per-page limit.
   * @param {AbortSignal} signal - Signal to abort.
   * @return {Promise<{page: number, limit: number}|null>} Result.
   */
  const performBatchSearch = async (uiElement, searchQuery, currentId, userLimit, signal) => {
    let scanPage = 1;

    uiElement.innerText = 'Initializing Warp Drive...';

    // Fetch total result count to set scan upper bound
    const countRes = await fetchWithRetry(
        `/counts/posts.json?tags=${encodeURIComponent(searchQuery)}`, {signal});
    if (!countRes.ok) {
      throw new Error(`Count API Error: ${countRes.status}`);
    }
    const countData = await countRes.json();
    const totalPosts = (countData && countData.counts &&
        typeof countData.counts.posts === 'number') ? countData.counts.posts : 0;

    if (totalPosts === 0) {
      return null;
    }

    const maxScanPage = Math.ceil(totalPosts / MAX_SCAN_LIMIT);

    const fetchScanPage = async (tags, page, signal) => {
      const apiUrl = `/posts.json?tags=${encodeURIComponent(tags)}&page=${page}&limit=${MAX_SCAN_LIMIT}&only=id`;
      const res = await fetchWithRetry(apiUrl, {signal});
      if (!res.ok) {
        throw new Error(res.status);
      }
      return await res.json();
    };

    for (;;) {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      // Update UI
      const startPost = (scanPage - 1) * MAX_SCAN_LIMIT * BATCH_SIZE + 1;
      const endPost = scanPage * MAX_SCAN_LIMIT * BATCH_SIZE;
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

        const localIndex = res.data.findIndex((p) => p.id === currentId);

        if (localIndex !== -1) {
          // Found! Calculate global index.
          const postsBeforeThisPage = (res.scanPage - 1) * MAX_SCAN_LIMIT;
          const globalIndex = postsBeforeThisPage + localIndex;

          // Convert to user's page number
          const targetUserPage = Math.floor(globalIndex / userLimit) + 1;

          return {page: targetUserPage, limit: userLimit};
        }
      }

      if (emptyResponseCount === BATCH_SIZE) {
        return null; // End of results
      }

      // Check if we've scanned beyond the total result set
      const lastScannedPage = (scanPage - 1) * BATCH_SIZE + BATCH_SIZE;
      if (lastScannedPage >= maxScanPage) {
        return null;
      }

      scanPage++;
      await sleep(REQUEST_DELAY_MS);
    }
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
        const res = await fetchWithRetry(checkUrl, {signal});

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

        // 2. Extended Check (1 previous + 3 next pages) - Parallel
        const promises = [];
        for (const offset of [-1, 1, 2, 3]) {
          if (offset === -1 && entry.page <= 1) {
            continue;
          }
          const nextPage = entry.page + offset;
          const nextUrl = `/posts.json?tags=${encodeURIComponent(entry.tags)}&page=${nextPage}&limit=${entry.limit}&only=id`;

          promises.push(
              fetchWithRetry(nextUrl, {signal})
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
      let sortDirection = 'desc';

      let attrOrderType = null;

      if (!orderMatch) {
        strategy = 'calculation';
      } else {
        const orderType = orderMatch[1].toLowerCase();
        if (['id_desc'].includes(orderType)) {
          strategy = 'calculation';
        } else if (['id', 'id_asc'].includes(orderType)) {
          strategy = 'calculation';
          sortDirection = 'asc';
        } else if (ATTR_SORT_MAP[orderType]) {
          strategy = 'attr_calculation';
          attrOrderType = orderType;
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
        const limit = await getEffectiveLimit(cleanQuery);
        if (signal.aborted) {
          return;
        }

        if (strategy === 'calculation') {
          result = await performCountCalculation(uiElement, cleanQuery, currentPostId, sortDirection, limit, signal);
        } else if (strategy === 'attr_calculation') {
          result = await performAttrCountCalculation(uiElement, cleanQuery, currentPostId, attrOrderType, limit, signal);
        } else {
          result = await performBatchSearch(uiElement, cleanQuery, currentPostId, limit, signal);
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
