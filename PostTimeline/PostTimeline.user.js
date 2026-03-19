// ==UserScript==
// @name         Danbooru Post Timeline
// @namespace    https://github.com/AkaringoP
// @version      1.0
// @description  Shows when an illustration was published on its source platform (Pixiv, X/Twitter, Bluesky) and when it was first uploaded to Danbooru as a media asset.
// @author       AkaringoP
// @license      MIT
// @match        *://danbooru.donmai.us/posts/*
// @icon         https://danbooru.donmai.us/favicon.ico
// @updateURL    https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/PostTimeline/PostTimeline.user.js
// @downloadURL  https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/PostTimeline/PostTimeline.user.js
// @grant        GM_xmlhttpRequest
// @connect      pixiv.net
// @connect      public.api.bsky.app
// @run-at       document-end
// ==/UserScript==

(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  /** @const {string} CSS cursor value for a clock icon, used on all date elements. */
  const CLOCK_CURSOR = (() => {
    // r=8 (20% smaller than original r=10). Hands scaled proportionally from center (12,12).
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">` +
      `<circle cx="12" cy="12" r="8" stroke="#333" stroke-width="2" fill="white"/>` +
      `<polyline points="12 7.2 12 12 15.2 13.6" stroke="#333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` +
      `</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 10 10, auto`;
  })();

  /** @const {bigint} Twitter Snowflake epoch (2010-11-04T01:42:54.657Z). */
  const TWITTER_EPOCH = 1288834974657n;

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /**
   * Formats a date string as a relative time string (from now).
   * @param {string} dateString - ISO 8601 date string.
   * @return {string}
   */
  function formatRelativeTime(dateString) {
    const diffMs = Date.now() - new Date(dateString).getTime();
    const diffSec = Math.max(0, Math.floor(diffMs / 1000));
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    const diffMonth = Math.floor(diffDay / 30);
    const diffYear = Math.floor(diffDay / 365);

    if (diffSec < 60) return `${diffSec} second${diffSec !== 1 ? 's' : ''} ago`;
    if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
    if (diffHour < 24) return `about ${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`;
    if (diffDay < 30) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
    if (diffMonth < 12) return `about ${diffMonth} month${diffMonth !== 1 ? 's' : ''} ago`;
    return `about ${diffYear} year${diffYear !== 1 ? 's' : ''} ago`;
  }

  /**
   * Formats the duration between two dates as a delta string.
   * e.g. "1 minute later", "3 hours earlier", "at the same time"
   * @param {string} fromDateString - The reference (earlier) date.
   * @param {string} toDateString - The target (later) date.
   * @return {string}
   */
  function formatDelta(fromDateString, toDateString) {
    const diffMs = new Date(toDateString).getTime() - new Date(fromDateString).getTime();
    const absSec = Math.floor(Math.abs(diffMs) / 1000);
    const absMin = Math.floor(absSec / 60);
    const absHour = Math.floor(absMin / 60);
    const absDay = Math.floor(absHour / 24);
    const absMonth = Math.floor(absDay / 30);
    const absYear = Math.floor(absDay / 365);
    const dir = diffMs >= 0 ? 'later' : 'earlier';

    if (absSec < 1) return 'at the same time';
    if (absSec < 60) return `${absSec} second${absSec !== 1 ? 's' : ''} ${dir}`;
    if (absMin < 60) return `${absMin} minute${absMin !== 1 ? 's' : ''} ${dir}`;
    if (absHour < 24) return `about ${absHour} hour${absHour !== 1 ? 's' : ''} ${dir}`;
    if (absDay < 30) return `${absDay} day${absDay !== 1 ? 's' : ''} ${dir}`;
    if (absMonth < 12) return `about ${absMonth} month${absMonth !== 1 ? 's' : ''} ${dir}`;
    return `about ${absYear} year${absYear !== 1 ? 's' : ''} ${dir}`;
  }

  /**
   * Formats a date string as an absolute datetime string in the local timezone.
   * Output format: "2026-03-19 18:30:17 +0900"
   * @param {string} dateString - ISO 8601 date string.
   * @return {string}
   */
  function formatAbsoluteTime(dateString) {
    const d = new Date(dateString);
    const pad = (n) => String(n).padStart(2, '0');

    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    const ss = pad(d.getSeconds());

    const tzOffsetMin = -d.getTimezoneOffset();
    const tzSign = tzOffsetMin >= 0 ? '+' : '-';
    const tzHH = pad(Math.floor(Math.abs(tzOffsetMin) / 60));
    const tzMM = pad(Math.abs(tzOffsetMin) % 60);

    return `${year}-${month}-${day} ${hh}:${mm}:${ss} ${tzSign}${tzHH}${tzMM}`;
  }

  /**
   * Parses Danbooru's <time title> format into an ISO 8601 string.
   * Input:  "2026-03-19 18:57:58 +0900"
   * Output: "2026-03-19T18:57:58+09:00"
   * @param {string|null} titleStr
   * @return {string|null}
   */
  function parseDanbooruTimeTitle(titleStr) {
    if (!titleStr) return null;
    const m = titleStr.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/);
    if (!m) return null;
    return `${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}`;
  }

  // ---------------------------------------------------------------------------
  // Source Detection
  // ---------------------------------------------------------------------------

  /**
   * Returns the source URL from the Information section.
   * @return {string|null}
   */
  function getSourceUrl() {
    const specificLink = document.querySelector('#post-info-source a');
    if (specificLink) return specificLink.href;

    for (const li of document.querySelectorAll('#post-information li')) {
      if (li.textContent.trim().startsWith('Source:')) {
        const a = li.querySelector('a');
        return a ? a.href : null;
      }
    }
    return null;
  }

  /**
   * Extracts the Pixiv artwork ID from a URL.
   * @param {string} url
   * @return {string|null}
   */
  function extractPixivArtworkId(url) {
    const artworksMatch = url.match(/pixiv\.net(?:\/[a-z]{2})?\/artworks\/(\d+)/i);
    if (artworksMatch) return artworksMatch[1];

    const pximgMatch = url.match(/\/(\d+)_p\d+/);
    if (pximgMatch) return pximgMatch[1];

    return null;
  }

  /**
   * Detects the source platform and extracts relevant identifiers.
   * Supported platforms: Pixiv, X/Twitter, Bluesky.
   * @return {{type: string, label: string, [key: string]: string}|null}
   */
  function detectSource() {
    const sourceUrl = getSourceUrl();
    if (!sourceUrl) return null;

    // Pixiv
    if (/pixiv\.net|pximg\.net/.test(sourceUrl)) {
      const artworkId = extractPixivArtworkId(sourceUrl);
      if (artworkId) return {type: 'pixiv', label: 'Pixiv', id: artworkId};
    }

    // X/Twitter (status URL only; pbs.twimg.com image URLs lack tweet IDs)
    const twitterMatch = sourceUrl.match(
      /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/i
    );
    if (twitterMatch) return {type: 'twitter', label: 'X', id: twitterMatch[1]};

    // Bluesky
    const bskyMatch = sourceUrl.match(
      /bsky\.app\/profile\/([^/]+)\/post\/([a-z0-9]+)/i
    );
    if (bskyMatch) {
      return {
        type: 'bluesky', label: 'Bluesky',
        handle: bskyMatch[1], rkey: bskyMatch[2],
      };
    }

    return null;
  }

  /**
   * Extracts the media asset ID from the ">>" link in the Size row.
   * @return {string|null}
   */
  function getMediaAssetId() {
    const link =
      document.querySelector('#post-info-size a[href^="/media_assets/"]') ||
      document.querySelector('a[href^="/media_assets/"]');
    if (!link) return null;

    const match = link.pathname.match(/\/media_assets\/(\d+)/);
    return match ? match[1] : null;
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------

  /**
   * Fetches the media asset's created_at date from Danbooru's API.
   * @param {string} mediaAssetId
   * @return {Promise<string|null>}
   */
  async function fetchMediaAssetDate(mediaAssetId) {
    try {
      const res = await fetch(`/media_assets/${mediaAssetId}.json`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.created_at ?? null;
    } catch (e) {
      console.warn('[PostTimeline] media_asset fetch failed:', e);
      return null;
    }
  }

  /**
   * Fetches the Pixiv illustration's createDate via GM_xmlhttpRequest.
   * @param {string} artworkId
   * @return {Promise<string|null>}
   */
  function fetchPixivDate(artworkId) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: `https://www.pixiv.net/ajax/illust/${artworkId}`,
        headers: {'Referer': 'https://www.pixiv.net/'},
        timeout: 10000,
        onload(res) {
          try {
            const data = JSON.parse(res.responseText);
            resolve(!data.error && data.body ? (data.body.createDate ?? null) : null);
          } catch {
            resolve(null);
          }
        },
        onerror() {
          console.warn('[PostTimeline] Pixiv API request failed.');
          resolve(null);
        },
        ontimeout() {
          console.warn('[PostTimeline] Pixiv API request timed out.');
          resolve(null);
        },
      });
    });
  }

  /**
   * Extracts the creation timestamp from a Twitter/X Snowflake ID.
   * No network request needed — pure bitwise calculation.
   * @param {string} tweetId
   * @return {string} ISO 8601 date string
   */
  function getTwitterTimestamp(tweetId) {
    const timestampMs = Number((BigInt(tweetId) >> 22n) + TWITTER_EPOCH);
    return new Date(timestampMs).toISOString();
  }

  /**
   * Fetches a Bluesky post's creation date via the public AppView API.
   * Two-step process: resolve handle to DID, then fetch post thread.
   * @param {string} handle - Bluesky handle or DID
   * @param {string} rkey - Post record key
   * @return {Promise<string|null>}
   */
  function fetchBlueskyDate(handle, rkey) {
    return new Promise((resolve) => {
      const fetchPost = (did) => {
        const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
        GM_xmlhttpRequest({
          method: 'GET',
          url: `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0&parentHeight=0`,
          timeout: 10000,
          onload(res) {
            try {
              const data = JSON.parse(res.responseText);
              resolve(data?.thread?.post?.record?.createdAt ?? null);
            } catch {
              resolve(null);
            }
          },
          onerror() {
            console.warn('[PostTimeline] Bluesky post fetch failed.');
            resolve(null);
          },
          ontimeout() {
            console.warn('[PostTimeline] Bluesky post fetch timed out.');
            resolve(null);
          },
        });
      };

      // If handle is already a DID, skip resolution.
      if (handle.startsWith('did:')) {
        fetchPost(handle);
        return;
      }

      // Resolve handle to DID first.
      GM_xmlhttpRequest({
        method: 'GET',
        url: `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
        timeout: 10000,
        onload(res) {
          try {
            const data = JSON.parse(res.responseText);
            if (data.did) {
              fetchPost(data.did);
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        },
        onerror() {
          console.warn('[PostTimeline] Bluesky handle resolution failed.');
          resolve(null);
        },
        ontimeout() {
          console.warn('[PostTimeline] Bluesky handle resolution timed out.');
          resolve(null);
        },
      });
    });
  }

  /**
   * Dispatches to the appropriate source date fetcher based on source type.
   * @param {{type: string, [key: string]: string}} source
   * @return {Promise<string|null>}
   */
  function fetchSourceDate(source) {
    switch (source.type) {
      case 'pixiv':
        return fetchPixivDate(source.id);
      case 'twitter':
        return Promise.resolve(getTwitterTimestamp(source.id));
      case 'bluesky':
        return fetchBlueskyDate(source.handle, source.rkey);
      default:
        return Promise.resolve(null);
    }
  }

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------

  /**
   * Finds the "Date:" list item in the Information section.
   * @return {HTMLLIElement|null}
   */
  function findDateRow() {
    const el = document.querySelector('#post-info-date');
    if (el) return el;

    for (const li of document.querySelectorAll('#post-information li')) {
      if (li.textContent.trim().startsWith('Date:')) return li;
    }
    return null;
  }

  /**
   * Creates the source platform row showing absolute relative time.
   * This is the timeline's starting point, so no delta is needed.
   * @param {string} label - Platform name (Pixiv, X, Bluesky).
   * @param {'loading'|null|string} dateString
   * @return {HTMLLIElement}
   */
  function createSourceRow(label, dateString) {
    const li = document.createElement('li');

    if (dateString === 'loading') {
      li.textContent = `${label}: loading...`;
      return li;
    }

    li.textContent = `${label}: `;

    if (dateString === null) {
      const span = document.createElement('span');
      span.textContent = 'unavailable';
      span.style.opacity = '0.5';
      li.appendChild(span);
      return li;
    }

    const time = document.createElement('time');
    time.textContent = formatRelativeTime(dateString);
    time.title = formatAbsoluteTime(dateString);
    time.style.cursor = CLOCK_CURSOR;
    li.appendChild(time);
    return li;
  }

  /**
   * Creates the Asset row showing delta from the source date.
   * Falls back to absolute relative time if sourceDate is unavailable.
   * @param {'loading'|null|string} assetDate
   * @param {string|null} sourceDate - Reference point for delta calculation.
   * @return {HTMLLIElement}
   */
  function createAssetRow(assetDate, sourceDate) {
    const li = document.createElement('li');

    if (assetDate === 'loading') {
      li.textContent = 'Asset: loading...';
      return li;
    }

    li.textContent = 'Asset: ';

    if (assetDate === null) {
      const span = document.createElement('span');
      span.textContent = 'unavailable';
      span.style.opacity = '0.5';
      li.appendChild(span);
      return li;
    }

    const time = document.createElement('time');
    time.title = formatAbsoluteTime(assetDate);
    time.style.cursor = CLOCK_CURSOR;

    if (sourceDate) {
      // Show how long after (or before) source publication the asset was uploaded.
      time.textContent = `\u21B3 ${formatDelta(sourceDate, assetDate)}`;
    } else {
      // Source date unavailable: fall back to absolute relative time.
      time.textContent = formatRelativeTime(assetDate);
    }

    li.appendChild(time);
    return li;
  }

  /**
   * Appends a delta annotation to Danbooru's existing Date row.
   * Shows how long after the asset upload the post was created.
   * Uses the <time title> attribute for the precise timestamp, since
   * the <time datetime> attribute may be truncated to the minute.
   * @param {HTMLLIElement} dateRow
   * @param {string} assetDate
   */
  function annotateDateRow(dateRow, assetDate) {
    const postTimeEl = dateRow.querySelector('time[datetime]');
    if (!postTimeEl) return;

    const titleStr = postTimeEl.getAttribute('title');
    const postDate = parseDanbooruTimeTitle(titleStr);
    if (!postDate) return;

    // Rename Danbooru's "Date:" label to "Post:".
    for (const node of dateRow.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.includes('Date:')) {
        node.textContent = node.textContent.replace('Date:', 'Post:');
        break;
      }
    }

    // Hide Danbooru's "about X hours ago" text; show tree-indented delta.
    postTimeEl.style.display = 'none';

    const deltaSpan = document.createElement('span');
    deltaSpan.textContent = `\u21B3 ${formatDelta(assetDate, postDate)}`;
    deltaSpan.title = titleStr ?? '';
    deltaSpan.style.cursor = CLOCK_CURSOR;
    deltaSpan.style.marginLeft = '1.5em';
    postTimeEl.after(deltaSpan);
  }

  // ---------------------------------------------------------------------------
  // Main
  // ---------------------------------------------------------------------------

  async function init() {
    const source = detectSource();
    if (!source) return;

    const mediaAssetId = getMediaAssetId();

    const dateRow = findDateRow();
    if (!dateRow) {
      console.warn('[PostTimeline] Date row not found in Information section.');
      return;
    }

    // Insert loading placeholders BEFORE the Date row to establish chronological order:
    // Source (oldest) -> Asset -> Date (newest, Danbooru's own row)
    const sourceLoadingRow = createSourceRow(source.label, 'loading');
    const assetLoadingRow = createAssetRow('loading', null);
    dateRow.before(sourceLoadingRow, assetLoadingRow);

    // Fetch both dates in parallel.
    const [assetDate, sourceDate] = await Promise.all([
      mediaAssetId ? fetchMediaAssetDate(mediaAssetId) : Promise.resolve(null),
      fetchSourceDate(source),
    ]);

    // Replace loading placeholders with real data.
    const newSourceRow = createSourceRow(source.label, sourceDate);
    const newAssetRow = createAssetRow(assetDate, sourceDate);
    sourceLoadingRow.replaceWith(newSourceRow);
    assetLoadingRow.replaceWith(newAssetRow);

    // Append delta annotation to Danbooru's Date row (delta from asset upload).
    if (assetDate) {
      annotateDateRow(dateRow, assetDate);
    }

    // Keep source row's relative time in sync with Danbooru's live-updating Date field.
    // Asset and Date deltas are fixed durations and do not need periodic refresh.
    const sourceTimeEl = newSourceRow.querySelector('time');
    if (sourceTimeEl && sourceDate) {
      setInterval(() => {
        sourceTimeEl.textContent = formatRelativeTime(sourceDate);
      }, 60_000);
    }
  }

  init();
})();
