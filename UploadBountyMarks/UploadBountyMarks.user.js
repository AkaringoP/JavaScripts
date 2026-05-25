// ==UserScript==
// @name         UploadBountyMarks
// @namespace    AkaringoP/JavaScripts
// @version      0.1.0
// @description  Mark bounty artists (forum_topics/24186) on the Danbooru upload page
// @author       AkaringoP
// @match        https://danbooru.donmai.us/uploads/*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/AkaringoP/JavaScripts/feature/upload-bounty-marks/UploadBountyMarks/UploadBountyMarks.user.js
// @downloadURL  https://raw.githubusercontent.com/AkaringoP/JavaScripts/feature/upload-bounty-marks/UploadBountyMarks/UploadBountyMarks.user.js
// ==/UserScript==

(function() {
  'use strict';

  // --- Constants -------------------------------------------------------------
  // v0.1 BOUNTY_DATA_URL points at the feature branch (Resolved 22). Switch to
  // `main` in Task 4.1 alongside the @updateURL/@downloadURL above.
  const BOUNTY_DATA_URL = 'https://raw.githubusercontent.com/AkaringoP/JavaScripts/feature/upload-bounty-marks/UploadBountyMarks/data/bounty.json';
  const FORUM_POST_BASE = 'https://danbooru.donmai.us/forum_posts';
  const SCHEMA_VERSION = 1;

  const CACHE_KEY = 'ubm_bounty_artists_v1';
  const CACHE_TTL_MS = 2 * 60 * 60 * 1000;  // 2h (Resolved 6 / PLAN D3)

  // Selectors confirmed in Phase 0 Task 0.5 (Resolved 17).
  const ANCHOR_SELECTOR = 'div.upload-warning-badges';
  const ARTIST_TAG_SELECTOR =
      'ul.tag-list li.selected a.tag-type-1[data-tag-name]';
  const SOURCE_INPUT_SELECTOR = 'input#post_source';

  // Fallback URL extraction (mirrors cron-side regex; same semantics).
  const PIXIV_USER_RE = /pixiv\.net\/(?:en\/)?users\/(\d+)/i;
  const X_HANDLE_RE =
      /(?:^|[^.\w])(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i;
  const X_INTERNAL_HANDLE = 'i';

  const LABEL_TEXT = 'BOUNTY';
  const LABEL_BASE_CLASS = 'ubm-label';
  const LABEL_BOUNTY_CLASS = 'ubm-label-bounty';
  const LABEL_DISABLED_CLASS = 'ubm-disabled';
  const STYLE_TAG_ID = 'ubm-styles';
  const LOG_PREFIX = '[UBM]';

  const GLOBAL_CSS = `
    .ubm-label {
      --ubm-bounty-bg: #22c55e;
      --ubm-bounty-bg-hover: #16a34a;
      --ubm-bounty-fg: #ffffff;
      --ubm-focus-outline: #22c55e;
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.4;
      vertical-align: middle;
    }
    body[data-current-user-theme="dark"] .ubm-label {
      --ubm-bounty-bg: #16a34a;
      --ubm-bounty-bg-hover: #15803d;
      --ubm-focus-outline: #4ade80;
    }
    a.ubm-label-bounty,
    a.ubm-label-bounty:visited {
      background: var(--ubm-bounty-bg);
      color: var(--ubm-bounty-fg);
      text-decoration: none;
      cursor: pointer;
    }
    a.ubm-label-bounty:hover {
      background: var(--ubm-bounty-bg-hover);
      color: var(--ubm-bounty-fg);
      text-decoration: none;
    }
    a.ubm-label-bounty:focus-visible {
      outline: 2px solid var(--ubm-focus-outline);
      outline-offset: 2px;
    }
    .ubm-label-bounty.ubm-disabled {
      background: var(--ubm-bounty-bg);
      color: var(--ubm-bounty-fg);
      cursor: default;
      opacity: 0.7;
    }
  `;

  // --- Styles ----------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById(STYLE_TAG_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_TAG_ID;
    style.textContent = GLOBAL_CSS;
    document.head.appendChild(style);
  }

  // --- Cache (stale-while-revalidate, PLAN D3) -------------------------------
  function loadCache() {
    let raw;
    try {
      raw = localStorage.getItem(CACHE_KEY);
    } catch (err) {
      console.warn(LOG_PREFIX, 'localStorage read failed', err);
      return null;
    }
    if (!raw) return null;
    try {
      const obj = JSON.parse(raw);
      if (!obj || typeof obj.ts !== 'number' ||
          !obj.data || typeof obj.data !== 'object') {
        throw new Error('shape mismatch');
      }
      return obj;
    } catch (err) {
      console.warn(LOG_PREFIX, 'cache corrupt, dropping', err);
      try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
      return null;
    }
  }

  function saveCache(data) {
    try {
      localStorage.setItem(
          CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch (err) {
      console.warn(LOG_PREFIX, 'cache write failed', err);
    }
  }

  async function fetchRemote() {
    const res = await fetch(BOUNTY_DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.schema_version !== SCHEMA_VERSION) {
      throw new Error(`unsupported schema_version: ${json.schema_version}`);
    }
    return json;
  }

  let inFlight = null;
  function backgroundRefresh() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const data = await fetchRemote();
        saveCache(data);
      } catch (err) {
        console.warn(LOG_PREFIX, 'background refresh failed', err);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  async function getBountyData() {
    const cached = loadCache();
    if (cached) {
      const stale = Date.now() - cached.ts > CACHE_TTL_MS;
      if (stale) backgroundRefresh();
      return cached.data;
    }
    try {
      const data = await fetchRemote();
      saveCache(data);
      return data;
    } catch (err) {
      console.warn(LOG_PREFIX, 'initial fetch failed; no label this turn', err);
      return null;
    }
  }

  // --- Artist identification (Resolved 17/18/19) -----------------------------
  function lookupArtist(data) {
    if (!data || !data.artists) return null;

    // 1차: DOM artist tag (li.selected, tag-type-1 = artist category).
    const tagEl = document.querySelector(ARTIST_TAG_SELECTOR);
    const tag = tagEl?.dataset?.tagName;
    if (tag && Object.prototype.hasOwnProperty.call(data.artists, tag)) {
      return { tag, entry: data.artists[tag] };
    }

    // 2차: source URL fallback (Pixiv user / X handle reverse-index).
    const sourceEl = document.querySelector(SOURCE_INPUT_SELECTOR);
    const sourceUrl = sourceEl?.value;
    if (!sourceUrl) return null;

    const pm = sourceUrl.match(PIXIV_USER_RE);
    if (pm && data.by_pixiv) {
      const pTag = data.by_pixiv[pm[1]];
      if (pTag && data.artists[pTag]) return { tag: pTag, entry: data.artists[pTag] };
    }

    const xm = sourceUrl.match(X_HANDLE_RE);
    if (xm && data.by_x) {
      const handle = xm[1].toLowerCase();
      if (handle !== X_INTERNAL_HANDLE) {
        const xTag = data.by_x[handle];
        if (xTag && data.artists[xTag]) return { tag: xTag, entry: data.artists[xTag] };
      }
    }
    return null;
  }

  // --- Label DOM (PLAN D4 + D8) ----------------------------------------------
  function buildAriaLabel(approvers) {
    const first = approvers[0] || 'an Approver';
    if (approvers.length <= 1) {
      return `Bounty recommended by ${first} — open forum comment`;
    }
    const others = approvers.length - 1;
    const plural = others > 1 ? 's' : '';
    return `Bounty recommended by ${first} and ${others} other${plural} — open forum comment`;
  }

  function buildLabel(tag, entry) {
    const postIds = entry.post_ids || [];
    const approvers = entry.approvers || [];
    if (postIds.length === 0) {
      console.warn(LOG_PREFIX, 'entry has empty post_ids, link disabled', { tag });
      const span = document.createElement('span');
      span.className = [
        LABEL_BASE_CLASS, LABEL_BOUNTY_CLASS, LABEL_DISABLED_CLASS, 'button-xs',
      ].join(' ');
      span.textContent = LABEL_TEXT;
      span.title = 'Bounty (no forum link available)';
      return span;
    }
    const latestPostId = Math.max(...postIds);
    const anchor = document.createElement('a');
    anchor.className = [
      LABEL_BASE_CLASS, LABEL_BOUNTY_CLASS, 'button-xs',
    ].join(' ');
    anchor.href = `${FORUM_POST_BASE}/${latestPostId}`;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.setAttribute('aria-label', buildAriaLabel(approvers));
    anchor.textContent = LABEL_TEXT;
    return anchor;
  }

  function insertLabel(labelEl) {
    const anchor = document.querySelector(ANCHOR_SELECTOR);
    if (!anchor) {
      console.warn(LOG_PREFIX, 'anchor container not found', ANCHOR_SELECTOR);
      return false;
    }
    if (anchor.querySelector(`.${LABEL_BOUNTY_CLASS}`)) return false;
    anchor.appendChild(labelEl);
    return true;
  }

  function removeLabel() {
    document
        .querySelectorAll(`.${LABEL_BOUNTY_CLASS}`)
        .forEach(el => el.remove());
  }

  // --- Lifecycle (PostTimeline / BUTR D5 pattern) ----------------------------
  async function init() {
    injectStyles();
    const data = await getBountyData();
    if (!data) return;
    if (!data.artists || Object.keys(data.artists).length === 0) {
      console.info(LOG_PREFIX, 'bounty data has no artists yet');
      return;
    }
    const match = lookupArtist(data);
    if (!match) return;
    const label = buildLabel(match.tag, match.entry);
    if (insertLabel(label)) {
      console.info(LOG_PREFIX, 'label inserted', { tag: match.tag });
    }
  }

  function cleanup() {
    removeLabel();
  }

  document.addEventListener('turbo:load', init);
  document.addEventListener('turbo:before-visit', cleanup);
  // First-load safety net (PostTimeline / BUTR pattern).
  init();
})();
