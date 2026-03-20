// ==UserScript==
// @name         Danbooru Post Timeline
// @namespace    https://github.com/AkaringoP
// @version      1.1
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

  /** @const {string} CSS for custom tooltip component and delta color classes. */
  const GLOBAL_CSS = `
.pt-tooltip { position: relative; }
.pt-tip {
  display: none;
  position: absolute; bottom: calc(100% + 6px); left: 0;
  background: #333; color: #fff; padding: 4px 8px;
  border-radius: 4px; font-size: 12px;
  white-space: nowrap; z-index: 1000; pointer-events: none;
}
.pt-tooltip:hover .pt-tip { display: block; }
.pt-tip-delta { margin-left: 0.4em; }
.pt-tip-delta--red { color: #ff6b6b; }
.pt-tip-delta--green { color: #51cf66; }
`;

  /**
   * Injects the global CSS into the document head.
   * Skips injection if already present (duplicate-guard via #pt-global-css).
   */
  function injectStyles() {
    if (document.getElementById('pt-global-css')) return;
    const style = document.createElement('style');
    style.id = 'pt-global-css';
    style.textContent = GLOBAL_CSS;
    document.head.appendChild(style);
  }

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
    if (diffYear < 1) return `about ${diffMonth} month${diffMonth !== 1 ? 's' : ''} ago`;
    return `about ${diffYear} year${diffYear !== 1 ? 's' : ''} ago`;
  }

  /**
   * Formats the duration between two dates as an abbreviated delta string for tooltips.
   * e.g. "12y", "3mo", "5d", "2h", "30m", "10s"
   * The direction qualifier ("before"/"after") is added by the caller.
   * @param {string} fromDateString - The reference date.
   * @param {string} toDateString - The target date.
   * @return {string}
   */
  function formatDeltaAbbrev(fromDateString, toDateString) {
    const diffMs = Math.abs(
      new Date(toDateString).getTime() - new Date(fromDateString).getTime()
    );
    const absSec = Math.floor(diffMs / 1000);
    const absMin = Math.floor(absSec / 60);
    const absHour = Math.floor(absMin / 60);
    const absDay = Math.floor(absHour / 24);
    const absYear = Math.floor(absDay / 365);
    const absMonth = Math.floor(absDay / 30);

    if (absYear >= 1) return `${absYear}y`;
    if (absMonth >= 1) return `${absMonth}mo`;
    if (absDay >= 1) return `${absDay}d`;
    if (absHour >= 1) return `${absHour}h`;
    if (absMin >= 1) return `${absMin}m`;
    return `${absSec}s`;
  }

  /**
   * Determines tooltip delta colors for the Source and Asset rows.
   * RED rule (combined):  Source→Asset < 60s AND Asset→Post < 15s → both red.
   * GREEN rule (independent): Source→Asset ≥ 30 days → source green only.
   * Otherwise no color is applied.
   * @param {string} sourceDate - ISO 8601 source publication date.
   * @param {string} assetDate  - ISO 8601 media asset creation date.
   * @param {string} postDate   - ISO 8601 Danbooru post creation date.
   * @return {{sourceColor: string|null, assetColor: string|null}}
   */
  function determineDeltaColors(sourceDate, assetDate, postDate) {
    const srcToAssetMs =
      new Date(assetDate).getTime() - new Date(sourceDate).getTime();
    const assetToPostMs =
      new Date(postDate).getTime() - new Date(assetDate).getTime();

    const MS_60S = 60 * 1000;
    const MS_30D = 30 * 24 * 60 * 60 * 1000;

    if (srcToAssetMs < MS_60S && assetToPostMs < 15 * 1000) {
      return {sourceColor: 'red', assetColor: 'red'};
    }
    if (srcToAssetMs >= MS_30D) {
      return {sourceColor: 'green', assetColor: null};
    }
    return {sourceColor: null, assetColor: null};
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
   * Creates a custom tooltip wrapper span for a timeline date entry.
   * The visible text is set as a text node on the wrapper so it can be updated
   * in place by reassigning `wrapper.firstChild.textContent`.
   * The tooltip itself is a child `.pt-tip` span containing the absolute time
   * and an optional colored delta span. The native `title` attribute is NOT used
   * so that the tooltip can display colored text.
   * @param {string} text - Visible label text (e.g. "3 years ago").
   * @param {string} absTime - Absolute datetime string for the tooltip body.
   * @param {string|null} deltaText - Abbreviated delta string (e.g. "12y before Asset"), or null.
   * @param {'red'|'green'|null} color - Color class for the delta span, or null.
   * @return {HTMLSpanElement} The `.pt-tooltip` wrapper element.
   */
  function createTooltipSpan(text, absTime, deltaText, color) {
    const wrapper = document.createElement('span');
    wrapper.className = 'pt-tooltip';
    wrapper.style.cursor = CLOCK_CURSOR;

    // Visible text as a raw text node so callers can update it via firstChild.
    wrapper.appendChild(document.createTextNode(text));

    const tip = document.createElement('span');
    tip.className = 'pt-tip';
    tip.textContent = absTime;

    if (deltaText) {
      const deltaSpan = document.createElement('span');
      deltaSpan.className = 'pt-tip-delta' +
        (color === 'red' ? ' pt-tip-delta--red' :
         color === 'green' ? ' pt-tip-delta--green' : '');
      deltaSpan.textContent = `(${deltaText})`;
      tip.appendChild(deltaSpan);
    }

    wrapper.appendChild(tip);
    return wrapper;
  }

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
   * Creates the source platform row showing absolute relative time from now.
   * A custom tooltip shows the absolute datetime and an optional colored delta.
   * @param {string} label - Platform name (Pixiv, X, Bluesky).
   * @param {'loading'|null|string} dateString
   * @param {{deltaText: string|null, color: 'red'|'green'|null}} [tooltipOpts]
   * @return {HTMLLIElement}
   */
  function createSourceRow(label, dateString, tooltipOpts = {deltaText: null, color: null}) {
    const li = document.createElement('li');
    li.id = 'pt-source-row';

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

    const wrapper = createTooltipSpan(
      formatRelativeTime(dateString),
      formatAbsoluteTime(dateString),
      tooltipOpts.deltaText,
      tooltipOpts.color
    );
    li.appendChild(wrapper);
    return li;
  }

  /**
   * Creates the Asset row showing absolute relative time from now.
   * A custom tooltip shows the absolute datetime and an optional colored delta.
   * @param {'loading'|null|string} assetDate
   * @param {{deltaText: string|null, color: 'red'|'green'|null}} [tooltipOpts]
   * @return {HTMLLIElement}
   */
  function createAssetRow(assetDate, tooltipOpts = {deltaText: null, color: null}) {
    const li = document.createElement('li');
    li.id = 'pt-asset-row';

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

    const wrapper = createTooltipSpan(
      formatRelativeTime(assetDate),
      formatAbsoluteTime(assetDate),
      tooltipOpts.deltaText,
      tooltipOpts.color
    );
    li.appendChild(wrapper);
    return li;
  }

  /**
   * Annotates Danbooru's existing Date row: renames the label to "Post:" and
   * replaces Danbooru's relative time with our own formatRelativeTime for
   * consistency with the Source and Asset rows.
   * @param {HTMLLIElement} dateRow
   * @param {string} postDate - ISO 8601 post creation date.
   * @return {HTMLSpanElement|null} The tooltip wrapper, or null if annotation failed.
   */
  function annotateDateRow(dateRow, postDate) {
    const postTimeEl = dateRow.querySelector('time[datetime]');
    if (!postTimeEl) return null;

    // Rename Danbooru's "Date:" label to "Post:".
    for (const node of dateRow.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.includes('Date:')) {
        node.textContent = node.textContent.replace('Date:', 'Post:');
        break;
      }
    }

    // Hide Danbooru's <time> to prevent inconsistent relative time display.
    postTimeEl.style.display = 'none';
    postTimeEl.removeAttribute('title');

    // Insert our own tooltip span with consistent formatRelativeTime.
    const wrapper = createTooltipSpan(
      formatRelativeTime(postDate),
      formatAbsoluteTime(postDate),
      null,  // no delta (Post is the reference point)
      null
    );
    wrapper.style.cursor = 'pointer';
    postTimeEl.after(wrapper);

    return wrapper;
  }

  // ---------------------------------------------------------------------------
  // Main
  // ---------------------------------------------------------------------------

  /** @type {number|null} */
  let refreshIntervalId = null;

  /** @type {number} Generation counter to discard stale async results. */
  let initGeneration = 0;

  /** Clears the periodic refresh interval set by init(). */
  function cleanup() {
    if (refreshIntervalId !== null) {
      clearInterval(refreshIntervalId);
      refreshIntervalId = null;
    }
  }

  async function init() {
    cleanup();

    // Guard against duplicate execution (e.g. turbo:load + direct call).
    if (document.querySelector('#pt-source-row')) return;

    injectStyles();

    const source = detectSource();
    if (!source) return;

    const mediaAssetId = getMediaAssetId();

    const dateRow = findDateRow();
    if (!dateRow) {
      console.warn('[PostTimeline] Date row not found in Information section.');
      return;
    }

    const gen = ++initGeneration;

    // Insert loading placeholders BEFORE the Date row to establish chronological order:
    // Source (oldest) -> Asset -> Date (newest, Danbooru's own row)
    const sourceLoadingRow = createSourceRow(source.label, 'loading');
    const assetLoadingRow = createAssetRow('loading');
    dateRow.before(sourceLoadingRow, assetLoadingRow);

    // Fetch both dates in parallel.
    const [assetDate, sourceDate] = await Promise.all([
      mediaAssetId ? fetchMediaAssetDate(mediaAssetId) : Promise.resolve(null),
      fetchSourceDate(source),
    ]);

    // Discard results if a newer init() has started (Turbo navigation during fetch).
    if (gen !== initGeneration) return;

    // Get post date for tooltip delta calculations.
    const postTimeEl = dateRow.querySelector('time[datetime]');
    const postTitleStr = postTimeEl?.getAttribute('title') ?? null;
    const postDate = parseDanbooruTimeTitle(postTitleStr);

    // Calculate tooltip deltas and colors.
    /** @type {{deltaText: string|null, color: string|null}} */
    const sourceTooltipOpts = {deltaText: null, color: null};
    /** @type {{deltaText: string|null, color: string|null}} */
    const assetTooltipOpts = {deltaText: null, color: null};

    if (sourceDate && assetDate) {
      sourceTooltipOpts.deltaText =
        `${formatDeltaAbbrev(sourceDate, assetDate)} before Asset`;
    }
    if (assetDate && postDate) {
      assetTooltipOpts.deltaText =
        `${formatDeltaAbbrev(assetDate, postDate)} before Post`;
    }
    if (sourceDate && assetDate && postDate) {
      const colors = determineDeltaColors(sourceDate, assetDate, postDate);
      sourceTooltipOpts.color = colors.sourceColor;
      assetTooltipOpts.color = colors.assetColor;
    }

    // Replace loading placeholders with real data.
    const newSourceRow = createSourceRow(source.label, sourceDate, sourceTooltipOpts);
    const newAssetRow = createAssetRow(assetDate, assetTooltipOpts);
    sourceLoadingRow.replaceWith(newSourceRow);
    assetLoadingRow.replaceWith(newAssetRow);

    // Annotate Danbooru's Date row (rename label + consistent relative time).
    const postWrapper = postDate ? annotateDateRow(dateRow, postDate) : null;

    // Keep all three rows' relative times in sync (all display "ago" in v1.1).
    const sourceTooltipEl = newSourceRow.querySelector('.pt-tooltip');
    const assetTooltipEl = newAssetRow.querySelector('.pt-tooltip');

    if ((sourceTooltipEl && sourceDate) || (assetTooltipEl && assetDate) ||
        (postWrapper && postDate)) {
      refreshIntervalId = setInterval(() => {
        if (sourceTooltipEl && sourceDate) {
          sourceTooltipEl.firstChild.textContent = formatRelativeTime(sourceDate);
        }
        if (assetTooltipEl && assetDate) {
          assetTooltipEl.firstChild.textContent = formatRelativeTime(assetDate);
        }
        if (postWrapper && postDate) {
          postWrapper.firstChild.textContent = formatRelativeTime(postDate);
        }
      }, 60_000);
    }
  }

  // Turbo lifecycle: clean up interval on navigation, re-init on load.
  document.addEventListener('turbo:before-visit', cleanup);
  document.addEventListener('turbo:load', init);

  // Initial execution (direct page load without Turbo).
  init();
})();
