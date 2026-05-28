// ==UserScript==
// @name         Danbooru Upload Bounty Helper
// @namespace    AkaringoP/JavaScripts
// @version      1.0.0
// @description  Bounty-artist marks on Danbooru upload + Pixiv/X, plus a Bounty Thread popover on forum_topics/24186
// @author       AkaringoP
// @match        https://danbooru.donmai.us/uploads/*
// @match        https://danbooru.donmai.us/forum_topics/24186*
// @match        https://www.pixiv.net/*
// @match        https://x.com/*
// @match        https://twitter.com/*
// @icon         https://danbooru.donmai.us/favicon.ico
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/AkaringoP/JavaScripts/main/UploadBountyHelper/UploadBountyHelper.user.js
// @downloadURL  https://raw.githubusercontent.com/AkaringoP/JavaScripts/main/UploadBountyHelper/UploadBountyHelper.user.js
// ==/UserScript==

(function() {
  'use strict';

  // ==========================================================================
  // === Shared layer =========================================================
  // ==========================================================================
  // Cache, fetch, mark asset, permalink/aria helpers — used by all site
  // modules (PLAN D13).

  // --- Shared constants -----------------------------------------------------
  // BOUNTY_DATA_URL points at main. The GitHub Actions workflow at
  // .github/workflows/update-bounty.yml runs `build-bounty.mjs` every 8h and
  // auto-commits a refreshed bounty.json to main (Resolved 22; switched from
  // the feature branch to main in v1.0.0 release / Phase v2.5.1).
  const BOUNTY_DATA_URL = 'https://raw.githubusercontent.com/AkaringoP/JavaScripts/main/UploadBountyHelper/data/bounty.json';
  const FORUM_POST_BASE = 'https://danbooru.donmai.us/forum_posts';
  const SCHEMA_VERSION = 1;
  // Bumped at v0.3 — v1 caches predate Resolved 36's strikethrough split and
  // Resolved 37's post_count_at_build, so a stale v1 cache would show "—" in
  // the popover's Posts column. v2 forces one refresh per user on upgrade.
  const CACHE_KEY = 'ubm_bounty_artists_v2';
  const CACHE_TTL_MS = 2 * 60 * 60 * 1000;  // 2h (PLAN D3)
  // v0.3.6 — fetcher hardening. FETCH_TIMEOUT_MS lets GM_xmlhttpRequest's
  // ontimeout handler actually fire (without the `timeout` option a stalled
  // response sits forever). FETCH_FAILURE_BACKOFF_MS suppresses repeat
  // fetches after a failure so a transient origin outage (or a 429 from
  // raw.githubusercontent.com) doesn't get retried on every page nav.
  const FETCH_TIMEOUT_MS = 30 * 1000;
  const FETCH_FAILURE_BACKOFF_MS = 5 * 60 * 1000;
  const LOG_PREFIX = '[UBM]';

  // --- Cache (stale-while-revalidate, PLAN D3) ------------------------------
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

  /**
   * Fetch bounty.json via GM_xmlhttpRequest to bypass X's strict CSP
   * (connect-src whitelist excludes raw.githubusercontent.com — discovered
   * during V_x_1 verification, Resolved 32). Tampermonkey runs this in
   * userscript runtime context, so CSP doesn't apply. Pixiv/Danbooru would
   * work with plain fetch too, but routing all sites through the same path
   * keeps the cache layer simple.
   * @return {!Promise<!Object>}
   */
  function fetchRemote() {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: BOUNTY_DATA_URL,
        responseType: 'json',
        headers: { 'Accept': 'application/json' },
        timeout: FETCH_TIMEOUT_MS,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`HTTP ${response.status}`));
            return;
          }
          // Some Tampermonkey builds return a string even when responseType
          // is 'json' — defensively parse if needed.
          let json = response.response;
          if (typeof json === 'string') {
            try { json = JSON.parse(json); }
            catch (e) { reject(new Error('JSON parse failed')); return; }
          }
          if (!json || json.schema_version !== SCHEMA_VERSION) {
            reject(new Error(`unsupported schema_version: ${json && json.schema_version}`));
            return;
          }
          resolve(json);
        },
        onerror: (response) => {
          reject(new Error(`network error: ${response.statusText || 'unknown'}`));
        },
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }

  let inFlight = null;
  let lastFailureTs = 0;

  /**
   * Dedupe + negative-cache wrapper around fetchRemote. Returns the
   * in-flight promise if one is already running — v0.3.6 fix: previously
   * getBountyData's first-load path bypassed this guard and could trigger
   * overlapping fetches when two modules initialized back-to-back (Turbo
   * nav race). Recent failures short-circuit to null until
   * FETCH_FAILURE_BACKOFF_MS has elapsed, preventing thundering-herd retry
   * across rapid page navigations.
   * @return {!Promise<?Object>}
   */
  function refreshBountyData() {
    if (inFlight) return inFlight;
    if (Date.now() - lastFailureTs < FETCH_FAILURE_BACKOFF_MS) {
      return Promise.resolve(null);
    }
    inFlight = (async () => {
      try {
        const data = await fetchRemote();
        saveCache(data);
        lastFailureTs = 0;
        return data;
      } catch (err) {
        lastFailureTs = Date.now();
        console.warn(LOG_PREFIX, 'fetch failed', err);
        return null;
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
      if (stale) refreshBountyData();
      return cached.data;
    }
    const data = await refreshBountyData();
    if (!data) {
      console.warn(LOG_PREFIX, 'initial fetch unavailable; no label this turn');
    }
    return data;
  }

  // --- Style injection ------------------------------------------------------
  /**
   * Insert a `<style id={id}>` block into <head>, idempotent. Each module
   * owns a distinct id so the inject is safe to call from any init() without
   * coordinating order. (PLAN D13 — shared utility, v0.3.6 dedup of three
   * inline copies that existed in v0.3.5 and earlier.)
   * @param {string} id — style tag id (acts as the idempotency key)
   * @param {string} css — full CSS body to insert
   */
  function injectStyles(id, css) {
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  }

  // --- SPA navigation hooks (Pixiv + X share this) --------------------------
  // Patch history.pushState / replaceState and listen for popstate so a
  // single-page navigation triggers the caller's `schedule()` (typically a
  // debounced re-mount). Used by Pixiv (initPixiv) and X (initX); Danbooru
  // does not need this because Turbo emits its own `turbo:load` event.
  //
  // Lifecycle: install once per page lifetime (idempotent via the module-
  // level `spaHooksInstalled` flag). The cleanup() functions intentionally
  // do NOT undo this patch — Pixiv/X SPAs only leave the userscript scope
  // by full page unload, so the patched references die naturally with the
  // window. Leaving the patch installed avoids a class of restore-order bugs
  // (e.g. another extension monkey-patching history after us would be wiped
  // out if we tried to restore the original here).
  let spaHooksInstalled = false;
  function installSpaNavHooks(schedule) {
    if (spaHooksInstalled) return;
    spaHooksInstalled = true;
    const origPush = history.pushState;
    history.pushState = function(...args) {
      const ret = origPush.apply(this, args);
      schedule();
      return ret;
    };
    const origReplace = history.replaceState;
    history.replaceState = function(...args) {
      const ret = origReplace.apply(this, args);
      schedule();
      return ret;
    };
    window.addEventListener('popstate', schedule);
  }

  // --- Mark asset + forum permalink helpers ---------------------------------
  // Synced manually from assets/bounty-mark.svg (PLAN D7, Resolved 31). Update
  // both files together when the design changes.
  const BOUNTY_MARK_SVG =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" role="img" aria-label="Danbooru upload bounty">' +
      '<title>Danbooru Upload Bounty</title>' +
      '<path fill="#4ade80" stroke="#15803d" stroke-width="0.7" stroke-linejoin="round" d="M12 2 L21 7 L12 12 L3 7 Z"/>' +
      '<path fill="#22c55e" stroke="#15803d" stroke-width="0.7" stroke-linejoin="round" d="M3 7 L3 17 L12 22 L12 12 Z"/>' +
      '<path fill="#16a34a" stroke="#15803d" stroke-width="0.7" stroke-linejoin="round" d="M21 7 L21 17 L12 22 L12 12 Z"/>' +
      '<path fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M7 12.7 L10.5 16.2 L17 9.2"/>' +
      '</svg>';

  // Synced manually from assets/scroll-icon.svg (Resolved 35). Forum thread
  // popover trigger — bounty-mark box body + magnifying glass overlay.
  const SCROLL_ICON_SVG =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" role="img" aria-label="Show bounty artist list">' +
      '<title>Bounty Artist List</title>' +
      '<path fill="#4ade80" stroke="#15803d" stroke-width="0.7" stroke-linejoin="round" d="M12 2 L21 7 L12 12 L3 7 Z"/>' +
      '<path fill="#22c55e" stroke="#15803d" stroke-width="0.7" stroke-linejoin="round" d="M3 7 L3 17 L12 22 L12 12 Z"/>' +
      '<path fill="#16a34a" stroke="#15803d" stroke-width="0.7" stroke-linejoin="round" d="M21 7 L21 17 L12 22 L12 12 Z"/>' +
      '<circle cx="10.5" cy="12" r="3" fill="none" stroke="#ffffff" stroke-width="2.2"/>' +
      '<line x1="12.6" y1="14.1" x2="17" y2="18.5" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>' +
      '</svg>';

  // 4-square grid icon for the popover row's "view posts" side button (D25
  // updated 2026-05-28, Resolved 41). currentColor inherits from the link so
  // it picks up theme colors automatically.
  const POSTS_ICON_SVG =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">' +
      '<rect x="1" y="1" width="6" height="6" rx="0.5"/>' +
      '<rect x="9" y="1" width="6" height="6" rx="0.5"/>' +
      '<rect x="1" y="9" width="6" height="6" rx="0.5"/>' +
      '<rect x="9" y="9" width="6" height="6" rx="0.5"/>' +
      '</svg>';

  /**
   * Forum permalink for an artist's most recent Approver recommendation
   * (PLAN D8). Returns null if no post_ids — caller must handle the disabled
   * case (e.g. render <span> instead of <a>).
   * @param {Array<number>} postIds
   * @return {?string}
   */
  function forumPermalink(postIds) {
    if (!postIds || !postIds.length) return null;
    return `${FORUM_POST_BASE}/${Math.max(...postIds)}`;
  }

  /**
   * Screen-reader label naming the Approver(s) who recommended a bounty
   * artist (PLAN D8). Used by all site modules for consistent accessibility.
   * @param {Array<string>} approvers
   * @return {string}
   */
  function buildAriaLabel(approvers) {
    const first = approvers[0] || 'an Approver';
    if (approvers.length <= 1) {
      return `Bounty recommended by ${first} — open forum comment`;
    }
    const others = approvers.length - 1;
    const plural = others > 1 ? 's' : '';
    return `Bounty recommended by ${first} and ${others} other${plural} — open forum comment`;
  }

  // --- External-site mark DOM (PLAN D16 / D18, Resolved 30/31) --------------
  // Shared between Pixiv (v2.2) and X (v2.3). Danbooru uses its own text
  // label (D4) — different visual treatment, same forum_post target.

  const MARK_BASE_CLASS = 'ubm-mark';
  const MARK_PIXIV_CLASS = 'ubm-mark-pixiv';
  const MARK_X_CLASS = 'ubm-mark-x';
  const MARK_DISABLED_CLASS = 'ubm-mark-disabled';
  const MARK_TAG_ATTR = 'data-ubm-marked';
  const MARK_HANDLE_ATTR = 'data-ubm-handle';  // X timeline recycle check (D17)
  const MARK_STYLE_TAG_ID = 'ubm-mark-styles';
  // PLAN D18 / Resolved 30 — confirmed text.
  const MARK_TITLE_TEXT = 'Danbooru upload bounty — click to open forum';
  const MARK_DISABLED_TITLE = 'Bounty (no forum link available)';

  const MARK_CSS = `
    .${MARK_BASE_CLASS} {
      display: inline-block;
      width: 18px;
      height: 18px;
      margin-left: 6px;
      vertical-align: middle;
      text-decoration: none;
      line-height: 0;
      /* "vertical-align: middle" centers on x-height, which sits below the
         optical center of bold heading text — the mark looks ~2px low.
         translateY is visual-only (no layout shift) so it's safe to nudge. */
      transform: translateY(-2px);
    }
    .${MARK_BASE_CLASS} svg {
      display: block;
      width: 100%;
      height: 100%;
    }
    a.${MARK_BASE_CLASS}:hover { opacity: 0.85; }
    a.${MARK_BASE_CLASS}:focus-visible {
      outline: 2px solid #22c55e;
      outline-offset: 2px;
      border-radius: 3px;
    }
    .${MARK_BASE_CLASS}.${MARK_DISABLED_CLASS} {
      cursor: default;
      opacity: 0.7;
    }
  `;

  /**
   * Build the external-site mark anchor (PLAN D16). Returns a <span> when
   * the bounty entry has no forum post — defensive, since cron only emits
   * entries with non-empty post_ids.
   * @param {string} tag — canonical Danbooru artist tag
   * @param {!Object} entry — bounty.json artists[tag] entry
   * @param {string} variantClass — site-specific (MARK_PIXIV_CLASS / MARK_X_CLASS)
   * @param {{handle: string}=} opts — optional X timeline handle (D17 recycle check)
   * @return {!HTMLElement}
   */
  function buildMark(tag, entry, variantClass, opts) {
    const postIds = entry.post_ids || [];
    const approvers = entry.approvers || [];
    const href = forumPermalink(postIds);
    const aria = buildAriaLabel(approvers);

    const el = href
        ? document.createElement('a')
        : document.createElement('span');
    el.className = href
        ? `${MARK_BASE_CLASS} ${variantClass}`
        : `${MARK_BASE_CLASS} ${variantClass} ${MARK_DISABLED_CLASS}`;
    el.setAttribute(MARK_TAG_ATTR, tag);
    if (opts && opts.handle) el.setAttribute(MARK_HANDLE_ATTR, opts.handle);
    if (href) {
      el.href = href;
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
      el.title = MARK_TITLE_TEXT;
    } else {
      el.title = MARK_DISABLED_TITLE;
    }
    el.setAttribute('aria-label', aria);
    el.innerHTML = BOUNTY_MARK_SVG;
    return el;
  }

  // ==========================================================================
  // === Danbooru upload module (v0.1, /uploads/*) ============================
  // ==========================================================================
  // Behaviour unchanged from v0.1.5. Only renamed init/cleanup → initDanbooru/
  // cleanupDanbooru and wrapped section so Pixiv/X can coexist (PLAN D13).

  // --- Danbooru constants ---------------------------------------------------
  // Selectors confirmed in Phase 0 Task 0.5 (Resolved 17).
  const ANCHOR_SELECTOR = 'div.upload-warning-badges';
  const ARTIST_TAG_SELECTOR =
      'ul.tag-list li.selected a.tag-type-1[data-tag-name]';
  const SOURCE_INPUT_SELECTOR = 'input#post_source';

  // v0.1.2 — Duplicate / PPD detection (PLAN D10 / D11).
  const DUP_BADGE_SELECTOR =
      'div.upload-warning-badges a.upload-duplicate-warning';
  const PPD_BADGE_SELECTOR =
      'div.upload-warning-badges a.upload-pixel-perfect-duplicate-warning';
  const POST_BUTTON_PRIMARY_SELECTOR =
      'form[action^="/uploads"] button[type="submit"]';
  const POST_BUTTON_TEXT = 'Post';

  // Fallback URL extraction (mirrors cron-side regex; same semantics).
  const PIXIV_USER_RE = /pixiv\.net\/(?:en\/)?users\/(\d+)/i;
  const X_HANDLE_RE =
      /(?:^|[^.\w])(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i;
  const X_INTERNAL_HANDLE = 'i';

  const LABEL_TEXT = 'BOUNTY';
  const LABEL_BASE_CLASS = 'ubm-label';
  const LABEL_BOUNTY_CLASS = 'ubm-label-bounty';
  const LABEL_DISABLED_CLASS = 'ubm-disabled';
  const LABEL_STATE_DUP_CLASS = 'ubm-state-dup';
  const LABEL_PENDING_CLASS = 'ubm-pending';
  // Hold the label hidden until the first dup signal arrives (fast-commit)
  // or until this many ms elapse from the moment the label is inserted —
  // whichever comes first. Danbooru's similar-image lookup is async and
  // can take 2s+, so this is a compromise: long enough to cover most dup
  // pages, short enough to keep the user from staring at an empty badge
  // area on a normal bounty page.
  const LABEL_COMMIT_DELAY_MS = 1500;
  const BUBBLE_BASE_CLASS = 'ubm-bubble';
  const TOAST_DUP_CLASS = 'ubm-bubble-dup';
  const CALLOUT_PPD_CLASS = 'ubm-bubble-ppd';
  const PPD_BUTTON_MARK_ATTR = 'data-ubm-ppd-disabled';
  const TOAST_DUP_MS = 5000;
  const TOAST_DUP_MESSAGE =
      "A post with this image already exists.\n" +
      "Check the 'Similar' tab before uploading.";
  const CALLOUT_PPD_MESSAGE =
      'An identical post already exists.\n' +
      'Upload is blocked.';
  const BADGE_WRAP_CLASS = 'ubm-badge-wrap';
  const DANBOORU_STYLE_TAG_ID = 'ubm-styles';

  const DANBOORU_CSS = `
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
    /* New labels start in pending state to avoid a brief green-to-amber
       color flicker. We commit (remove the class) after a short window
       once dup/PPD state is settled. */
    .ubm-label.ubm-pending {
      opacity: 0;
      pointer-events: none;
    }
    .ubm-label-bounty {
      /* Only opacity transitions. Background changes (green to amber when
         dup is detected) must be instant so the user never sees a flash of
         the wrong colour. */
      transition: opacity 0.15s ease-out;
    }
    /* When the upload page already shows a Duplicate badge, the label tones
       down to amber so the user reads it as "bounty, but proceed with care"
       rather than a clean "go" signal. CSS-variable override propagates to
       hover/focus automatically. */
    .ubm-label-bounty.ubm-state-dup {
      --ubm-bounty-bg: #f59e0b;
      --ubm-bounty-bg-hover: #d97706;
      --ubm-focus-outline: #f59e0b;
    }
    body[data-current-user-theme="dark"] .ubm-label-bounty.ubm-state-dup {
      --ubm-bounty-bg: #d97706;
      --ubm-bounty-bg-hover: #b45309;
      --ubm-focus-outline: #fbbf24;
    }

    /* v0.1.2 — Wrapper around the warning badge so the bubble can sit
       absolutely above it without disturbing the badge's own layout. */
    .ubm-badge-wrap {
      position: relative;
      display: inline-block;
    }
    .ubm-badge-wrap .ubm-bubble {
      position: absolute;
      bottom: calc(100% + 8px);
      left: 0;
      width: max-content;
      max-width: 280px;
      margin: 0;
      z-index: 10;
    }

    /* v0.1.2 — Shared bubble shell (D10 toast + D11 callout) */
    .ubm-bubble {
      --ubm-bubble-bg: #f59e0b;
      --ubm-bubble-fg: #ffffff;
      position: relative;
      display: block;
      padding: 6px 22px 6px 10px;
      background: var(--ubm-bubble-bg);
      color: var(--ubm-bubble-fg);
      border-radius: 5px;
      font-size: 11.5px;
      font-weight: 500;
      line-height: 1.4;
      white-space: pre-line;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
    }
    .ubm-bubble::after {
      content: '';
      position: absolute;
      bottom: -6px;
      left: 14px;
      border: 6px solid transparent;
      border-top-color: var(--ubm-bubble-bg);
    }
    .ubm-bubble-close {
      position: absolute;
      top: 2px;
      right: 6px;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      opacity: 0.85;
    }
    .ubm-bubble-close:hover { opacity: 1; }

    /* Duplicate — amber, transient */
    .ubm-bubble-dup {
      --ubm-bubble-bg: #f59e0b;
      animation: ubm-bubble-in 0.25s ease-out;
    }
    body[data-current-user-theme="dark"] .ubm-bubble-dup {
      --ubm-bubble-bg: #d97706;
    }
    .ubm-bubble-dup.ubm-bubble-out {
      animation: ubm-bubble-out 0.25s ease-in forwards;
    }
    @keyframes ubm-bubble-in {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes ubm-bubble-out {
      from { opacity: 1; transform: translateY(0); }
      to   { opacity: 0; transform: translateY(-6px); }
    }

    /* PPD — red, persistent */
    .ubm-bubble-ppd {
      --ubm-bubble-bg: #dc2626;
    }
    body[data-current-user-theme="dark"] .ubm-bubble-ppd {
      --ubm-bubble-bg: #b91c1c;
    }

    /* Disabled Post button when PPD detected */
    [${PPD_BUTTON_MARK_ATTR}] {
      opacity: 0.5;
      cursor: not-allowed !important;
      pointer-events: none;
    }
  `;

  // --- Danbooru artist identification (Resolved 17/18/19) -------------------
  function lookupArtist(data) {
    if (!data || !data.artists) return null;

    // Primary: DOM artist tag (li.selected, tag-type-1 = artist category).
    const tagEl = document.querySelector(ARTIST_TAG_SELECTOR);
    const tag = tagEl?.dataset?.tagName;
    if (tag && Object.prototype.hasOwnProperty.call(data.artists, tag)) {
      return { tag, entry: data.artists[tag] };
    }

    // Fallback: source URL (Pixiv user / X handle reverse-index).
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

  // --- Danbooru label DOM (PLAN D4 + D8) ------------------------------------
  function buildLabel(tag, entry) {
    const postIds = entry.post_ids || [];
    const approvers = entry.approvers || [];
    // Only the first label of a page visit needs the pending fade-in. Once
    // we've committed, mid-cycle re-renders should be visible immediately.
    const pendingClass = labelsCommitted ? '' : LABEL_PENDING_CLASS;
    // Pre-apply the dup-state class so the first paint is already in the
    // right colour. Without this the label briefly paints green and a later
    // syncBountyDupState() flips it to amber via background transition,
    // which the user sees as a flicker.
    const dupClass = detectDuplicate() ? LABEL_STATE_DUP_CLASS : '';
    if (postIds.length === 0) {
      console.warn(LOG_PREFIX, 'entry has empty post_ids, link disabled', { tag });
      const span = document.createElement('span');
      span.className = [
        LABEL_BASE_CLASS, LABEL_BOUNTY_CLASS, LABEL_DISABLED_CLASS,
        pendingClass, dupClass, 'button-xs',
      ].filter(Boolean).join(' ');
      span.textContent = LABEL_TEXT;
      span.title = 'Bounty (no forum link available)';
      return span;
    }
    const anchor = document.createElement('a');
    anchor.className = [
      LABEL_BASE_CLASS, LABEL_BOUNTY_CLASS, pendingClass, dupClass, 'button-xs',
    ].filter(Boolean).join(' ');
    anchor.href = forumPermalink(postIds);
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

  // --- Danbooru duplicate / PPD detection (PLAN D10 / D11, v0.1.2) ----------

  /**
   * Visibility test that catches `display:none`, zero-size, and detached
   * elements. Danbooru sometimes keeps warning badges in the DOM but hidden
   * (e.g. when a higher-priority badge supersedes them), and our naive
   * querySelector would otherwise treat those as "present".
   * @param {?Element} el
   * @return {boolean}
   */
  function isVisible(el) {
    if (!el) return false;
    if (typeof el.checkVisibility === 'function') return el.checkVisibility();
    return el.offsetParent !== null;
  }

  /**
   * Return the Duplicate badge anchor if Danbooru's upload form is warning
   * about a non-pixel-perfect duplicate AND it's actually visible, else null.
   * @return {?HTMLAnchorElement}
   */
  function detectDuplicate() {
    const el = document.querySelector(DUP_BADGE_SELECTOR);
    return isVisible(el) ? el : null;
  }

  /**
   * Return the Pixel-Perfect Duplicate badge anchor if present and visible,
   * else null. Its href is the existing post's `/posts/<id>` permalink.
   * @return {?HTMLAnchorElement}
   */
  function detectPpd() {
    const el = document.querySelector(PPD_BADGE_SELECTOR);
    return isVisible(el) ? el : null;
  }

  /**
   * Find the upload form's submit button. Try several structural selectors
   * before falling back to text matching, so a future class rename does not
   * break PPD blocking.
   * @return {?HTMLButtonElement}
   */
  function findPostButton() {
    const candidates = [
      POST_BUTTON_PRIMARY_SELECTOR,
      'form button[type="submit"]',
      'button[type="submit"]',
      'input[type="submit"]',
    ];
    for (const sel of candidates) {
      for (const btn of document.querySelectorAll(sel)) {
        const label = (btn.textContent || btn.value || '').trim();
        if (label === POST_BUTTON_TEXT) return btn;
      }
    }
    // Last resort: any submit if there is only one.
    const submits = document.querySelectorAll(
        'form button[type="submit"], form input[type="submit"]');
    return submits.length === 1 ? submits[0] : null;
  }

  /**
   * Wrap a badge in a positioning anchor so a bubble can sit above it. The
   * wrap is idempotent — re-wrapping just returns the existing wrap. We
   * unwrap during cleanup() to leave the DOM as we found it.
   * @param {!Element} badge
   * @return {!HTMLElement}
   */
  function wrapBadgeForBubble(badge) {
    const existing = badge.parentElement;
    if (existing && existing.classList.contains(BADGE_WRAP_CLASS)) {
      return existing;
    }
    const wrap = document.createElement('span');
    wrap.className = BADGE_WRAP_CLASS;
    existing.insertBefore(wrap, badge);
    wrap.appendChild(badge);
    return wrap;
  }

  function unwrapAllBadges() {
    document.querySelectorAll(`.${BADGE_WRAP_CLASS}`).forEach(wrap => {
      const badge = wrap.querySelector(
          `${DUP_BADGE_SELECTOR}, ${PPD_BADGE_SELECTOR}`);
      if (badge && wrap.parentElement) {
        wrap.parentElement.insertBefore(badge, wrap);
      }
      wrap.remove();
    });
  }

  function showDuplicateBubble() {
    if (document.querySelector(`.${TOAST_DUP_CLASS}`)) return;
    const badge = detectDuplicate();
    if (!badge) return;
    const wrap = wrapBadgeForBubble(badge);

    const bubble = document.createElement('div');
    bubble.className = `${BUBBLE_BASE_CLASS} ${TOAST_DUP_CLASS}`;
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-live', 'polite');
    bubble.textContent = TOAST_DUP_MESSAGE;
    const close = document.createElement('span');
    close.className = 'ubm-bubble-close';
    close.textContent = '×';
    close.setAttribute('aria-hidden', 'true');
    bubble.appendChild(close);

    function dismiss() {
      if (!bubble.isConnected) return;
      bubble.classList.add('ubm-bubble-out');
      setTimeout(() => bubble.remove(), 300);
    }
    bubble.addEventListener('click', dismiss);
    setTimeout(dismiss, TOAST_DUP_MS);
    wrap.appendChild(bubble);
    console.info(LOG_PREFIX, 'duplicate bubble shown');
  }

  function removeDuplicateToast() {
    document
        .querySelectorAll(`.${TOAST_DUP_CLASS}`)
        .forEach(el => el.remove());
  }

  /**
   * Block uploads when a Pixel-Perfect Duplicate is detected.
   * (a) disable the Post button, (b) place a persistent callout above the
   * PPD badge itself (the badge already links to the existing post, so the
   * callout doesn't repeat that link), (c) leave bounty hide to the init
   * flow.
   * @param {!HTMLAnchorElement} ppdBadge
   */
  function blockPpdUpload(ppdBadge) {
    const button = findPostButton();
    if (button && !button.hasAttribute(PPD_BUTTON_MARK_ATTR)) {
      button.setAttribute(PPD_BUTTON_MARK_ATTR, '');
      button.disabled = true;
    } else if (!button) {
      console.warn(LOG_PREFIX, 'PPD: post button not found, callout only');
    }

    if (document.querySelector(`.${CALLOUT_PPD_CLASS}`)) return;

    const wrap = wrapBadgeForBubble(ppdBadge);
    const callout = document.createElement('div');
    callout.className = `${BUBBLE_BASE_CLASS} ${CALLOUT_PPD_CLASS}`;
    callout.setAttribute('role', 'alert');
    callout.textContent = CALLOUT_PPD_MESSAGE;
    wrap.appendChild(callout);
    console.info(LOG_PREFIX, 'PPD block applied');
  }

  function clearPpdBlock() {
    document.querySelectorAll(`[${PPD_BUTTON_MARK_ATTR}]`).forEach(btn => {
      btn.removeAttribute(PPD_BUTTON_MARK_ATTR);
      btn.disabled = false;
    });
    document
        .querySelectorAll(`.${CALLOUT_PPD_CLASS}`)
        .forEach(el => el.remove());
  }

  // --- Danbooru lifecycle (PostTimeline / BUTR D5 pattern) ------------------
  // The tag-list is rendered behind Alpine.js `x-show`, which may not be
  // mounted by the time `turbo:load` fires. We try once now, then keep a
  // short-lived MutationObserver to retry on each DOM mutation until either
  // the label lands or a safety timeout cuts us off.
  const OBSERVER_TIMEOUT_MS = 5000;
  let activeObserver = null;
  let observerTimeoutId = null;
  let commitTimeoutId = null;
  // Sticky across mutations within a single page visit; reset in cleanup.
  // Labels inserted after the first commit skip pending so a re-render
  // mid-cycle doesn't make the label disappear again.
  let labelsCommitted = false;

  function tryInsertLabel(data) {
    const match = lookupArtist(data);
    if (!match) return false;
    const label = buildLabel(match.tag, match.entry);
    if (insertLabel(label)) {
      console.info(LOG_PREFIX, 'label inserted', { tag: match.tag });
      // Start the commit timer only after a label actually lands. The
      // earlier behaviour started it from init() and frequently fired
      // before any label existed, which set labelsCommitted=true and made
      // the first inserted label skip the pending fade-in.
      if (!labelsCommitted) scheduleCommit();
      return true;
    }
    return false;
  }

  function stopObserver() {
    if (activeObserver) {
      activeObserver.disconnect();
      activeObserver = null;
    }
    if (observerTimeoutId !== null) {
      clearTimeout(observerTimeoutId);
      observerTimeoutId = null;
    }
  }

  /**
   * Remove the `pending` class from every label, making them visible. Called
   * once per init() after Alpine.js has had a chance to mount dup/PPD badges
   * so the label fades in with its final colour rather than green-then-amber.
   */
  function commitLabel() {
    labelsCommitted = true;
    document
        .querySelectorAll(`.${LABEL_PENDING_CLASS}`)
        .forEach(el => el.classList.remove(LABEL_PENDING_CLASS));
  }

  function scheduleCommit() {
    if (commitTimeoutId !== null) return;
    commitTimeoutId = setTimeout(() => {
      commitTimeoutId = null;
      commitLabel();
    }, LABEL_COMMIT_DELAY_MS);
  }

  function cancelScheduledCommit() {
    if (commitTimeoutId !== null) {
      clearTimeout(commitTimeoutId);
      commitTimeoutId = null;
    }
  }

  /**
   * Sync the Bounty label's `ubm-state-dup` modifier to whether the page
   * currently shows a Duplicate badge. The modifier overrides the green
   * CSS-variable palette with amber so the user reads bounty + dup as
   * "proceed with care" instead of a clean "go".
   */
  function syncBountyDupState() {
    const label = document.querySelector(`.${LABEL_BOUNTY_CLASS}`);
    if (!label) return;
    label.classList.toggle(LABEL_STATE_DUP_CLASS, !!detectDuplicate());
  }

  /**
   * Per-tick orchestrator. Returns true once at least one terminal action has
   * happened (PPD block, or bounty+dup decisions made), so the observer can
   * stop. PPD is the highest-priority signal: if present, bounty is hidden
   * and dup toast is suppressed (PPD already states the strongest case).
   * @param {?Object} data
   * @return {boolean}
   */
  function runOnce(data) {
    const ppd = detectPpd();
    if (ppd) {
      // PPD is terminal: block uploads, hide bounty, suppress dup toast.
      // Once PPD is decided the page can't un-PPD itself, so we can stop.
      removeLabel();
      removeDuplicateToast();
      blockPpdUpload(ppd);
      return true;
    }

    if (data) tryInsertLabel(data);
    // Duplicate bubble fires only on bounty pages — the value is "try a
    // different image from the same bounty artist." On non-bounty pages
    // Danbooru's own Duplicate badge is sufficient and our bubble would be
    // redundant noise.
    const hasBountyLabel = !!document.querySelector(`.${LABEL_BOUNTY_CLASS}`);
    const dupActive = detectDuplicate();
    if (hasBountyLabel && dupActive) {
      showDuplicateBubble();
    } else {
      removeDuplicateToast();
    }
    syncBountyDupState();
    // Fast-commit: once a positive dup signal arrives we know the colour
    // is settled, so reveal the label immediately instead of waiting for
    // the 200ms safety timer. The negative case (no dup detected yet)
    // still waits for the timer because we can't tell whether dup is
    // truly absent or just hasn't mounted yet.
    if (dupActive && !labelsCommitted) {
      cancelScheduledCommit();
      commitLabel();
    }
    // Don't short-circuit on bounty alone — bounty label often mounts before
    // the Duplicate badge does. Returning true here would stop the observer
    // and any later-mounting dup badge would never be detected. Always let
    // the safety timeout end the observer.
    return false;
  }

  async function initDanbooru() {
    injectStyles(DANBOORU_STYLE_TAG_ID, DANBOORU_CSS);

    // Early synchronous pass — start blocking PPD before bounty.json fetch
    // completes (it may be slow or fail). Duplicate bubble is deferred to
    // runOnce because it depends on whether a bounty label will exist.
    const earlyPpd = detectPpd();
    if (earlyPpd) {
      removeLabel();
      blockPpdUpload(earlyPpd);
    }

    const data = await getBountyData();
    if (data && (!data.artists || Object.keys(data.artists).length === 0)) {
      console.info(LOG_PREFIX, 'bounty data has no artists yet');
    }

    if (runOnce(data)) {
      // PPD path — no label to commit.
      return;
    }

    // Note: scheduleCommit is now called from tryInsertLabel on first
    // successful insertion (not here), so the timer measures time-since-
    // label-exists rather than time-since-init.

    // Alpine.js may mount badges/tag-list after turbo:load — observe and
    // retry per mutation. PPD/dup detection also benefits from this.
    stopObserver();
    activeObserver = new MutationObserver(() => {
      if (runOnce(data)) stopObserver();
    });
    activeObserver.observe(document.body, { childList: true, subtree: true });
    observerTimeoutId = setTimeout(stopObserver, OBSERVER_TIMEOUT_MS);
  }

  function cleanupDanbooru() {
    removeLabel();
    removeDuplicateToast();
    clearPpdBlock();
    unwrapAllBadges();
    stopObserver();
    cancelScheduledCommit();
    labelsCommitted = false;
  }

  // ==========================================================================
  // === Pixiv module (v0.2, www.pixiv.net) ===================================
  // ==========================================================================
  // Selectors confirmed in Phase v2.0.2 (Resolved 27):
  //   Profile: URL /^\/(?:en\/)?users\/(\d+)/ + .gtm-profile-follow-button-follow
  //   Artwork: a[data-gtm-value][href^="/users/"] (sidebar + bottom)
  // SPA cleanup policy = (B) idempotent-only (Resolved 29, Pixiv) — React
  // unmounts marks automatically when mount roots are replaced.

  // --- Pixiv constants ------------------------------------------------------
  const PIXIV_PROFILE_URL_RE = /^\/(?:en\/)?users\/(\d+)/;
  const PIXIV_ARTWORK_URL_RE = /^\/(?:en\/)?artworks\/\d+/;
  const PIXIV_FOLLOW_BTN_SELECTOR = '.gtm-profile-follow-button-follow';
  const PIXIV_AUTHOR_LINK_SELECTOR = 'a[data-gtm-value][href^="/users/"]';
  const PIXIV_NAV_DEBOUNCE_MS = 300;  // Resolved 29 — pushState mutation settles in ~2s
  const PIXIV_RETRY_DELAY_MS = 500;  // safety retry for lazy mount

  // --- Pixiv module state ---------------------------------------------------
  let pixivData = null;
  let pixivNavTimer = null;

  // --- Pixiv mount logic ----------------------------------------------------

  /**
   * Profile page (`/users/<id>` or `/en/users/<id>` and sub-paths like
   * `/users/<id>/illustrations`). User ID from URL (DOM-independent, P4
   * logout-compatible). Mount anchor traversal: follow-button → grandparent
   * → first <h1> (hash class agnostic, Resolved 27).
   * @param {!Object} data
   * @return {boolean} — true if a mark was inserted OR already present
   */
  function mountPixivProfileMark(data) {
    const m = location.pathname.match(PIXIV_PROFILE_URL_RE);
    if (!m) return false;
    const userId = m[1];
    const tag = data.by_pixiv && data.by_pixiv[userId];
    if (!tag || !data.artists[tag]) return false;

    const followBtn = document.querySelector(PIXIV_FOLLOW_BTN_SELECTOR);
    const header = followBtn?.parentElement?.parentElement;
    const h1 = header?.querySelector('h1');
    if (!h1) return false;
    if (h1.querySelector(`.${MARK_BASE_CLASS}`)) return true;  // idempotent
    h1.appendChild(buildMark(tag, data.artists[tag], MARK_PIXIV_CLASS));
    console.info(LOG_PREFIX, '[pixiv] profile mark mounted', { userId, tag });
    return true;
  }

  /**
   * Artwork page (`/artworks/<id>`). User ID from `data-gtm-value` on each
   * author <a> (sidebar + bottom both match — natural multi-mount). Mount
   * slot is the inner username <div> (Resolved 27).
   * @param {!Object} data
   * @return {boolean}
   */
  function mountPixivArtworkMarks(data) {
    if (!PIXIV_ARTWORK_URL_RE.test(location.pathname)) return false;
    const links = document.querySelectorAll(PIXIV_AUTHOR_LINK_SELECTOR);
    if (!links.length) return false;
    let inserted = 0;
    for (const a of links) {
      const userId = a.dataset.gtmValue;
      if (!userId) continue;
      const tag = data.by_pixiv && data.by_pixiv[userId];
      if (!tag || !data.artists[tag]) continue;
      if (a.querySelector(`.${MARK_BASE_CLASS}`)) continue;  // idempotent
      const nameDiv = a.querySelector(':scope > div');
      if (!nameDiv) continue;
      nameDiv.appendChild(buildMark(tag, data.artists[tag], MARK_PIXIV_CLASS));
      inserted++;
    }
    if (inserted) {
      console.info(LOG_PREFIX, '[pixiv] artwork mark(s) mounted', { count: inserted });
    }
    return true;
  }

  function runPixiv() {
    if (!pixivData) return;
    mountPixivProfileMark(pixivData);
    mountPixivArtworkMarks(pixivData);
  }

  function schedulePixivRun() {
    if (pixivNavTimer !== null) clearTimeout(pixivNavTimer);
    pixivNavTimer = setTimeout(() => {
      pixivNavTimer = null;
      runPixiv();
    }, PIXIV_NAV_DEBOUNCE_MS);
  }

  async function initPixiv() {
    injectStyles(MARK_STYLE_TAG_ID, MARK_CSS);
    pixivData = await getBountyData();
    if (!pixivData) {
      console.info(LOG_PREFIX, '[pixiv] no bounty data, mark skipped');
      return;
    }
    // pushState/replaceState/popstate routing (Phase v2.0.4 spy measured
    // replaceState + popstate within 80ms of back-button). Hook survives
    // cleanup intentionally — see `installSpaNavHooks` for rationale.
    installSpaNavHooks(schedulePixivRun);
    runPixiv();
    // Lazy-mount safety retry. Idempotency makes this safe to call again.
    setTimeout(runPixiv, PIXIV_RETRY_DELAY_MS);
  }

  function cleanupPixiv() {
    // Idempotent strategy (Resolved 29 Pixiv = B): React unmounts marks
    // when mount roots are replaced. Defensive sweep clears any orphans.
    document.querySelectorAll(`.${MARK_PIXIV_CLASS}`).forEach(el => el.remove());
    if (pixivNavTimer !== null) {
      clearTimeout(pixivNavTimer);
      pixivNavTimer = null;
    }
  }

  // ==========================================================================
  // === X module (v0.2, x.com / twitter.com) =================================
  // ==========================================================================
  // Selectors confirmed in Phase v2.0.3 (Resolved 28):
  //   Profile: [data-testid="UserName"] + URL pathname[1] handle extraction
  //   Timeline: [data-testid="User-Name"] + a[href^="/"] handle extraction
  // SPA cleanup = (B) profile + (A) timeline with data-ubm-handle re-check
  // (Resolved 29, X) — timeline DOM elements recycle on virtual scroll, so
  // per-tweet stale check by handle is required.

  // --- X constants ----------------------------------------------------------
  // 25 reserved page-feature paths that look like handles but aren't users
  // (dry-run 11/11 PASS in Phase v2.0.3).
  const X_RESERVED_HANDLES = new Set([
    'i', 'home', 'explore', 'notifications', 'messages', 'compose',
    'settings', 'bookmarks', 'lists', 'search', 'topics', 'tos',
    'privacy', 'intent', 'share', 'account', 'login', 'signup',
    'following', 'followers', 'communities', 'jobs', 'verified-choose',
  ]);
  // Whitelist: X handles are 1-15 chars, ASCII alphanumeric + underscore.
  // Matches both `/<handle>` and `/<handle>/status/<id>` patterns.
  const X_HANDLE_PATH_RE = /^\/([A-Za-z0-9_]{1,15})(?:\/|$|\?)/;
  const X_PROFILE_TESTID = 'UserName';      // no dash
  const X_TIMELINE_TESTID = 'User-Name';    // dash — different from profile
  const X_TIMELINE_ROOT = '[role="main"]';
  const X_NAV_DEBOUNCE_MS = 250;
  const X_OBSERVER_DEBOUNCE_MS = 250;
  const X_RETRY_DELAY_MS = 500;

  // --- X module state -------------------------------------------------------
  let xData = null;
  let xNavTimer = null;
  let xObserverDebounceTimer = null;
  let xObserver = null;

  // --- X helpers ------------------------------------------------------------
  /**
   * Extract an X handle from a URL path or href. Returns null when the
   * segment is reserved (handle = page-feature) or syntactically invalid.
   * Whitelist (1-15 ASCII alphanumeric + underscore) + blacklist
   * (X_RESERVED_HANDLES) — both checks required to avoid false positives
   * on `/home`, `/i/lists/123`, etc. (Resolved 28).
   * @param {?string} pathOrHref
   * @return {?string}
   */
  function extractXHandle(pathOrHref) {
    if (!pathOrHref) return null;
    const m = pathOrHref.match(X_HANDLE_PATH_RE);
    if (!m) return null;
    const candidate = m[1];
    if (X_RESERVED_HANDLES.has(candidate)) return null;
    return candidate;
  }

  // --- X mount logic --------------------------------------------------------

  /**
   * Profile header mark. Handle comes from URL pathname; mount slot is the
   * first <div dir="ltr"> inside [data-testid="UserName"] (no dash). Also
   * fires on tweet detail pages (`/<handle>/status/<id>`) since the focused
   * tweet's author header uses the same testid.
   * @param {!Object} data
   * @return {boolean}
   */
  function mountXProfileMark(data) {
    const handle = extractXHandle(location.pathname);
    if (!handle) return false;
    const tag = data.by_x && data.by_x[handle.toLowerCase()];
    if (!tag || !data.artists[tag]) return false;

    const block = document.querySelector(`[data-testid="${X_PROFILE_TESTID}"]`);
    if (!block) return false;
    const row = block.querySelector('div[dir="ltr"]');
    if (!row) return false;
    if (row.querySelector(`.${MARK_BASE_CLASS}`)) return true;  // idempotent
    row.appendChild(buildMark(tag, data.artists[tag], MARK_X_CLASS, { handle }));
    console.info(LOG_PREFIX, '[x] profile mark mounted', { handle, tag });
    return true;
  }

  /**
   * Timeline tweet authors. Each tweet card holds [data-testid="User-Name"]
   * (with dash, different from profile UserName). Handle comes from the
   * first <a href="/..."> inside the block — `extractXHandle` reuses the
   * same reserved blacklist + whitelist as profile mode. Marks are sticky
   * to a specific handle via MARK_HANDLE_ATTR — when X recycles a card to
   * show a different tweet, the stale mark is dropped before re-evaluation
   * (D17 (A) policy, Resolved 29).
   * @param {!Object} data
   * @return {number}
   */
  function mountXTimelineMarks(data) {
    const blocks = document.querySelectorAll(`[data-testid="${X_TIMELINE_TESTID}"]`);
    if (!blocks.length) return 0;
    let inserted = 0;
    for (const block of blocks) {
      const link = block.querySelector('a[href^="/"]');
      if (!link) continue;
      const handle = extractXHandle(link.getAttribute('href'));
      if (!handle) continue;

      // Recycled-card stale check — if existing mark matches current
      // handle, nothing to do; otherwise drop the stale mark and re-evaluate.
      const existing = block.querySelector(`.${MARK_BASE_CLASS}`);
      if (existing) {
        if (existing.getAttribute(MARK_HANDLE_ATTR) === handle) continue;
        existing.remove();
      }

      const tag = data.by_x && data.by_x[handle.toLowerCase()];
      if (!tag || !data.artists[tag]) continue;
      const row = block.querySelector('div[dir="ltr"]');
      if (!row) continue;
      row.appendChild(buildMark(tag, data.artists[tag], MARK_X_CLASS, { handle }));
      inserted++;
    }
    if (inserted) {
      console.info(LOG_PREFIX, '[x] timeline mark(s) mounted', { count: inserted });
    }
    return inserted;
  }

  function runX() {
    if (!xData) return;
    mountXProfileMark(xData);
    mountXTimelineMarks(xData);
  }

  function scheduleXRun() {
    if (xNavTimer !== null) clearTimeout(xNavTimer);
    xNavTimer = setTimeout(() => {
      xNavTimer = null;
      runX();
    }, X_NAV_DEBOUNCE_MS);
  }

  /**
   * Observe the X timeline root ([role="main"]) for tweet mutations.
   * Throttled to one runX per 250ms — Phase v2.0.4 measured continuous
   * 15-30 mutations/sec, so a debounce would never fire. Throttle gives
   * us a steady scan rhythm regardless of mutation pressure.
   * Falls back to a delayed retry if the root isn't mounted yet.
   */
  function setupXTimelineObserver() {
    if (xObserver) return;
    const root = document.querySelector(X_TIMELINE_ROOT);
    if (!root) {
      setTimeout(setupXTimelineObserver, X_RETRY_DELAY_MS);
      return;
    }
    xObserver = new MutationObserver(() => {
      if (xObserverDebounceTimer !== null) return;  // already scheduled
      xObserverDebounceTimer = setTimeout(() => {
        xObserverDebounceTimer = null;
        runX();
      }, X_OBSERVER_DEBOUNCE_MS);
    });
    xObserver.observe(root, { childList: true, subtree: true });
  }

  async function initX() {
    injectStyles(MARK_STYLE_TAG_ID, MARK_CSS);
    xData = await getBountyData();
    if (!xData) {
      console.info(LOG_PREFIX, '[x] no bounty data, mark skipped');
      return;
    }
    // SPA routing hook (see `installSpaNavHooks` for cleanup-survives note).
    installSpaNavHooks(scheduleXRun);
    setupXTimelineObserver();
    runX();
    setTimeout(runX, X_RETRY_DELAY_MS);
  }

  function cleanupX() {
    document.querySelectorAll(`.${MARK_X_CLASS}`).forEach(el => el.remove());
    if (xObserver) {
      xObserver.disconnect();
      xObserver = null;
    }
    if (xNavTimer !== null) {
      clearTimeout(xNavTimer);
      xNavTimer = null;
    }
    if (xObserverDebounceTimer !== null) {
      clearTimeout(xObserverDebounceTimer);
      xObserverDebounceTimer = null;
    }
  }

  // ==========================================================================
  // === Forum module (v0.3, /forum_topics/24186*) ============================
  // ==========================================================================
  // Bounty Thread popover. A scroll-icon trigger sits next to the heading
  // <h1>; clicking it opens a popover with a sortable/paginated artist
  // list. Resolved 34 (mount selector), Resolved 35 (icon), Resolved 36
  // (completed flag source), PLAN D20-D27 + D29.
  //
  // UX choices:
  //   - Popover positioning: sub-popover anchored under heading trigger
  //     (Q_v3_5 = absolute, not viewport modal).
  //   - Approver column: hover-only via native title, no click action
  //     (Q_v3_4 = option c — keep simple).
  //   - Graceful degrade: missing v0.3 fields render as "—" / fallback
  //     defaults so a stale v0.2 bounty.json still opens the popover.

  // --- Forum constants ------------------------------------------------------
  const FORUM_PATH_PREFIX = '/forum_topics/24186';
  const FORUM_HEADING_SELECTOR = 'div#c-forum-topics div#a-show > h1';
  const FORUM_TRIGGER_CLASS = 'ubm-bt-trigger';
  const FORUM_POPOVER_CLASS = 'ubm-bt-popover';
  const FORUM_PAGE_SIZE = 20;
  const FORUM_STYLE_TAG_ID = 'ubm-bt-styles';
  const FORUM_MAX_RETRY_MS = 5000;  // mirrors Danbooru upload module (Resolved 23)
  // Default sort = date desc (most recently registered first). Better matches
  // the use case "what's new on the bounty list?" — users typically already
  // know about high-post-count artists, the value is finding fresh ones.
  const FORUM_DEFAULT_SORT_MODE = 'date';
  const FORUM_DEFAULT_SORT_DIR = 'desc';
  const FORUM_SORT_DEFAULT_DIR = {
    posts: 'desc', name: 'asc', date: 'desc', approver: 'asc',
  };
  // User preference persistence (Resolved 43, v0.3.3). Sort mode/dir +
  // hide-completed survive across page reloads + Turbo navigation. Page
  // number stays transient — meaningful state would shift anyway whenever
  // the filter changes, so resetting to 0 on each open is the saner default.
  const FORUM_PREFS_KEY = 'ubm_bt_prefs_v1';
  const FORUM_VALID_SORT_MODES = new Set(['name', 'posts', 'approver', 'date']);
  const FORUM_VALID_SORT_DIRS = new Set(['asc', 'desc']);
  // Display labels. Mode keys stay aligned to the underlying field they sort
  // on (`posts` = post_count_at_build); label "Count" is the user-facing
  // name chosen to read consistently with the rest of the UI (Resolved 42 f).
  const FORUM_SORT_LABELS = {
    name: 'Name', posts: 'Count', approver: 'Approver', date: 'Date',
  };
  // Tab order matches the visible column order: Name | Posts | Approver |
  // Registered. Keeps the user's mental model of "click the header you want
  // to sort by" even though sort buttons live in the popover header bar.
  const FORUM_SORT_TAB_ORDER = ['name', 'posts', 'approver', 'date'];

  const FORUM_CSS = `
    .${FORUM_TRIGGER_CLASS} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      margin-left: 10px;
      padding: 0;
      vertical-align: middle;
      /* vertical-align: middle centers on x-height; h1 bold text has its
         optical center slightly higher (closer to cap-center), so the icon
         looks a couple px low. Translate to compensate — same trick the
         external mark CSS uses for Pixiv/X headers. */
      transform: translateY(-2px);
      background: transparent;
      border: 1px solid transparent;
      border-radius: 5px;
      cursor: pointer;
      line-height: 0;
    }
    .${FORUM_TRIGGER_CLASS}:hover {
      background: rgba(34,197,94,0.1);
      border-color: rgba(34,197,94,0.3);
    }
    .${FORUM_TRIGGER_CLASS}:focus-visible {
      outline: 2px solid #22c55e;
      outline-offset: 2px;
    }
    .${FORUM_TRIGGER_CLASS}[aria-expanded="true"] {
      background: rgba(34,197,94,0.15);
      border-color: #22c55e;
    }
    .${FORUM_TRIGGER_CLASS} svg { width: 32px; height: 32px; }

    .${FORUM_POPOVER_CLASS} {
      --ubm-bt-bg: #ffffff;
      --ubm-bt-text: #1f2937;
      --ubm-bt-text-muted: #6b7280;
      --ubm-bt-border: #d1d5db;
      --ubm-bt-row-hover: #f3f4f6;
      --ubm-bt-link: #2563eb;
      --ubm-bt-badge-active-bg: #22c55e;
      --ubm-bt-badge-active-fg: #ffffff;
      --ubm-bt-badge-completed-bg: #e5e7eb;
      --ubm-bt-badge-completed-fg: #6b7280;
      --ubm-bt-btn-bg: #f9fafb;
      --ubm-bt-btn-bg-hover: #f3f4f6;
      --ubm-bt-btn-active-bg: #22c55e;
      --ubm-bt-btn-active-fg: #ffffff;
      position: absolute;
      z-index: 9999;
      /* 765px tuned so the auto-width Name column lands at ~250px under
         fixed table layout (table 750 minus 100 Posts + 180 Approver +
         110 Date + 110 State = 250). Shrinks responsively under narrow
         viewports via the min() cap. */
      width: min(765px, calc(100vw - 32px));
      max-height: min(70vh, 600px);
      background: var(--ubm-bt-bg);
      color: var(--ubm-bt-text);
      border: 1px solid var(--ubm-bt-border);
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      display: flex;
      flex-direction: column;
      font-size: 13px;
      line-height: 1.4;
    }
    body[data-current-user-theme="dark"] .${FORUM_POPOVER_CLASS} {
      --ubm-bt-bg: #1f2937;
      --ubm-bt-text: #e5e7eb;
      --ubm-bt-text-muted: #9ca3af;
      --ubm-bt-border: #374151;
      --ubm-bt-row-hover: #2d3748;
      --ubm-bt-link: #60a5fa;
      --ubm-bt-badge-active-bg: #16a34a;
      --ubm-bt-badge-completed-bg: #374151;
      --ubm-bt-badge-completed-fg: #9ca3af;
      --ubm-bt-btn-bg: #374151;
      --ubm-bt-btn-bg-hover: #4b5563;
      --ubm-bt-btn-active-bg: #16a34a;
    }

    .ubm-bt-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--ubm-bt-border);
    }
    .ubm-bt-title { font-weight: 600; margin-right: auto; }
    .${FORUM_POPOVER_CLASS} .ubm-bt-sort-group {
      display: inline-flex;
      gap: 0;
      border: 1px solid var(--ubm-bt-border);
      border-radius: 4px;
      overflow: hidden;
    }
    /* All sort-button rules are prefixed with .ubm-bt-popover so external
       page CSS (Danbooru forum_topics defines its own button:hover and
       button:focus rules) can't outweigh ours by equal-specificity cascade.
       v0.3.6 fix: previously the bare ".ubm-bt-sort-btn:hover" selector
       (0,2,0) tied with Danbooru's "form button:focus" (0,2,1) and lost
       cascade — Safari then repainted the focused tab to a near-white
       background, leaving the white "active" tab text unreadable. */
    .${FORUM_POPOVER_CLASS} .ubm-bt-sort-btn {
      padding: 4px 10px;
      background: var(--ubm-bt-btn-bg);
      color: var(--ubm-bt-text);
      border: none;
      font-size: 12px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      /* Reset native <button> chrome so Safari/Chrome don't repaint the
         background to the user-agent "buttonface" colour during mousedown. */
      appearance: none;
      -webkit-appearance: none;
    }
    .${FORUM_POPOVER_CLASS} .ubm-bt-sort-btn + .ubm-bt-sort-btn {
      border-left: 1px solid var(--ubm-bt-border);
    }
    .${FORUM_POPOVER_CLASS} .ubm-bt-sort-btn:hover,
    .${FORUM_POPOVER_CLASS} .ubm-bt-sort-btn:focus,
    .${FORUM_POPOVER_CLASS} .ubm-bt-sort-btn:active {
      background: var(--ubm-bt-btn-bg-hover);
      color: var(--ubm-bt-text);
    }
    .${FORUM_POPOVER_CLASS} .ubm-bt-sort-btn.active,
    .${FORUM_POPOVER_CLASS} .ubm-bt-sort-btn.active:hover,
    .${FORUM_POPOVER_CLASS} .ubm-bt-sort-btn.active:focus,
    .${FORUM_POPOVER_CLASS} .ubm-bt-sort-btn.active:active {
      background: var(--ubm-bt-btn-active-bg);
      color: var(--ubm-bt-btn-active-fg);
    }
    .${FORUM_POPOVER_CLASS} .ubm-bt-sort-btn:focus-visible {
      outline: 2px solid #22c55e;
      outline-offset: -2px;
    }

    .ubm-bt-hide-completed {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      cursor: pointer;
      user-select: none;
    }
    .ubm-bt-close {
      width: 28px;
      height: 28px;
      padding: 0;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px;
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      color: var(--ubm-bt-text-muted);
    }
    .ubm-bt-close:hover { color: var(--ubm-bt-text); border-color: var(--ubm-bt-border); }
    .ubm-bt-close:focus-visible { outline: 2px solid #22c55e; outline-offset: 2px; }

    .ubm-bt-body {
      flex: 1;
      overflow: auto;
      /* Reserve a stable gutter so the row content does not jump left/right
         when the scrollbar appears or disappears between filter states.
         Modern Safari/Chromium/Firefox all honour this; older browsers
         fall back to the default scrollbar-on-overflow behaviour. */
      scrollbar-gutter: stable;
    }
    .ubm-bt-table {
      width: 100%;
      border-collapse: collapse;
      /* Lock column widths to the layout instead of the per-row content,
         otherwise toggling Hide completed (or paginating) shifts every
         auto-width column horizontally as the visible names change.
         Fixed columns sum to 500px (Posts 100 + Approver 180 + Date 110 +
         State 110); the Name column absorbs the rest (~250px at 765px
         popover width). */
      table-layout: fixed;
    }
    .ubm-bt-table th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--ubm-bt-bg);
      text-align: left;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--ubm-bt-text-muted);
      padding: 8px 12px;
      border-bottom: 1px solid var(--ubm-bt-border);
    }
    .ubm-bt-table td {
      padding: 8px 12px;
      border-bottom: 1px solid var(--ubm-bt-border);
      vertical-align: middle;
    }
    .ubm-bt-table tr:last-child td { border-bottom: none; }
    .ubm-bt-table tbody tr:hover { background: var(--ubm-bt-row-hover); }
    /* Bumped specificity so the header th wins against the generic
       ".ubm-bt-table th" text-align:left rule. Without this, the POSTS
       header sat left-aligned while the cells below were right-aligned,
       leaving the column visually misaligned. */
    .ubm-bt-table .ubm-bt-col-posts {
      text-align: right;
      font-variant-numeric: tabular-nums;
      /* 100px is the minimum width that keeps every current "<count>
         (+<delta>)" combination on a single line — the largest count
         seen in the bounty list is 18672 (dairi) with delta 16, and a
         high-delta entry is 802 (+487) (rizu_(rizunm)). Both fit in the
         76px content area with margin to spare. */
      width: 100px;
      white-space: nowrap;
    }
    /* (+N) growth suffix — muted small font so the main count stays
       prominent. Only rendered when delta > 0 (Resolved 45). */
    .ubm-bt-delta {
      color: var(--ubm-bt-text-muted);
      font-size: 11px;
      margin-left: 2px;
      cursor: help;
    }
    .ubm-bt-col-date { width: 110px; color: var(--ubm-bt-text-muted); font-size: 12px; }
    /* 180px sized to fit the longest single approver name with a small
       multi-approver suffix (e.g. "CommentaryRequest" ≈ 145px). Anything
       longer is ellipsised by the .ubm-bt-approvers rule below; hover
       title still surfaces the full name. */
    .ubm-bt-col-approver { width: 180px; }
    /* 110px (matches Posts/Date) gives the badge breathing room from the
       popover right edge and pads "✓ Completed" (the widest badge) on
       both sides. */
    .ubm-bt-col-state { width: 110px; }
    /* Inline-flex wrapper aligns the tag link and grid button on the same
       baseline without per-element vertical-align fudge. */
    .ubm-bt-tag-cell {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .ubm-bt-tag-link {
      color: var(--ubm-bt-link);
      text-decoration: none;
      font-weight: 500;
    }
    .ubm-bt-tag-link:hover { text-decoration: underline; }

    /* Side button (grid icon) → /posts?tags=<tag> gallery (D25 updated) */
    .ubm-bt-posts-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      padding: 0;
      color: var(--ubm-bt-text-muted);
      border: 1px solid transparent;
      border-radius: 3px;
      text-decoration: none;
      line-height: 0;
    }
    .ubm-bt-posts-btn:hover {
      background: var(--ubm-bt-row-hover);
      color: var(--ubm-bt-text);
      border-color: var(--ubm-bt-border);
    }
    .ubm-bt-posts-btn:focus-visible {
      outline: 2px solid #22c55e;
      outline-offset: 1px;
    }
    .ubm-bt-row-completed .ubm-bt-posts-btn { opacity: 0.5; }
    .ubm-bt-approvers {
      color: var(--ubm-bt-text-muted);
      font-size: 12px;
      text-decoration: none;
      /* inline-block + max-width:100% lets the ellipsis kick in on names
         that would overflow the 180px Approver column. The hover title
         (set per-row in JS) still surfaces the full name. */
      display: inline-block;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      vertical-align: middle;
    }
    a.ubm-bt-approvers { cursor: pointer; }
    a.ubm-bt-approvers:hover {
      color: var(--ubm-bt-text);
      text-decoration: underline;
    }
    a.ubm-bt-approvers:focus-visible {
      outline: 2px solid #22c55e;
      outline-offset: 1px;
      border-radius: 2px;
    }

    /* Date cell — when registered_at + post_ids are present it renders as
       a link to the originating forum post. Inherit the muted column color. */
    .ubm-bt-col-date a {
      color: inherit;
      text-decoration: none;
      cursor: pointer;
    }
    .ubm-bt-col-date a:hover {
      color: var(--ubm-bt-text);
      text-decoration: underline;
    }
    .ubm-bt-col-date a:focus-visible {
      outline: 2px solid #22c55e;
      outline-offset: 1px;
      border-radius: 2px;
    }

    .ubm-bt-badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }
    .ubm-bt-badge-active {
      background: var(--ubm-bt-badge-active-bg);
      color: var(--ubm-bt-badge-active-fg);
    }
    .ubm-bt-badge-completed {
      background: var(--ubm-bt-badge-completed-bg);
      color: var(--ubm-bt-badge-completed-fg);
    }
    /* Completed row: strikethrough scoped to the tag name only (Resolved 42 c).
       Approver / date / posts-count keep readable plain text — they are still
       meaningful even after the bounty is closed (e.g. seeing who recommended
       a now-uploaded artist, or when it was originally posted). */
    .ubm-bt-row-completed td { color: var(--ubm-bt-text-muted); }
    .ubm-bt-row-completed .ubm-bt-tag-link {
      text-decoration: line-through;
      color: var(--ubm-bt-text-muted);
    }

    .ubm-bt-pagination {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 4px;
      padding: 8px 12px;
      border-top: 1px solid var(--ubm-bt-border);
      flex-wrap: wrap;
    }
    .ubm-bt-page-btn {
      min-width: 28px;
      height: 28px;
      padding: 0 8px;
      background: var(--ubm-bt-btn-bg);
      color: var(--ubm-bt-text);
      border: 1px solid var(--ubm-bt-border);
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    .ubm-bt-page-btn:hover:not(:disabled) { background: var(--ubm-bt-btn-bg-hover); }
    .ubm-bt-page-btn.active {
      background: var(--ubm-bt-btn-active-bg);
      color: var(--ubm-bt-btn-active-fg);
      border-color: var(--ubm-bt-btn-active-bg);
    }
    .ubm-bt-page-btn:focus-visible { outline: 2px solid #22c55e; outline-offset: 2px; }
    .ubm-bt-page-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .ubm-bt-empty {
      padding: 24px;
      text-align: center;
      color: var(--ubm-bt-text-muted);
    }
  `;

  // --- Forum module state ---------------------------------------------------
  let forumData = null;
  let forumMountObserver = null;
  let forumMountTimeoutId = null;
  let forumPopoverEl = null;
  let forumOpen = false;
  let forumSortMode = FORUM_DEFAULT_SORT_MODE;
  let forumSortDir = FORUM_DEFAULT_SORT_DIR;
  let forumHideCompleted = false;
  let forumCurrentPage = 0;
  let forumDocKeyHandler = null;
  let forumDocClickHandler = null;
  let forumFocusReturn = null;
  // Persistent anchor for Hide-completed toggling. Captured lazily on the
  // first toggle since the last manual navigation, and reused for every
  // subsequent toggle so repeated on/off keeps the same artist in view
  // instead of drifting one page per cycle. Cleared whenever the user
  // takes an explicit navigation action (sort, pagination, popover close).
  let forumAnchorTag = null;

  // --- Preference persistence (Resolved 43) ---------------------------------
  /**
   * Read persisted sort/filter prefs into module state. Each field is
   * individually validated — a corrupt stored value (e.g. an out-of-range
   * sort mode after a hypothetical key rename) gets ignored instead of
   * crashing the load, and the in-memory defaults stand.
   */
  function loadForumPrefs() {
    let raw;
    try {
      raw = localStorage.getItem(FORUM_PREFS_KEY);
    } catch (err) {
      console.warn(LOG_PREFIX, '[forum] prefs read failed', err);
      return;
    }
    if (!raw) return;
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch (err) {
      console.warn(LOG_PREFIX, '[forum] prefs corrupt, dropping', err);
      try { localStorage.removeItem(FORUM_PREFS_KEY); } catch (_) {}
      return;
    }
    if (!obj || typeof obj !== 'object') return;
    if (typeof obj.sortMode === 'string' && FORUM_VALID_SORT_MODES.has(obj.sortMode)) {
      forumSortMode = obj.sortMode;
    }
    if (typeof obj.sortDir === 'string' && FORUM_VALID_SORT_DIRS.has(obj.sortDir)) {
      forumSortDir = obj.sortDir;
    }
    if (typeof obj.hideCompleted === 'boolean') {
      forumHideCompleted = obj.hideCompleted;
    }
  }

  /**
   * Write current sort/filter prefs to localStorage. Called eagerly on every
   * sort-button click and hide-completed toggle so storage stays in sync
   * with the popover. Quota/SecurityError silently ignored — persistence is
   * a nice-to-have, not a correctness invariant.
   */
  function saveForumPrefs() {
    try {
      localStorage.setItem(FORUM_PREFS_KEY, JSON.stringify({
        sortMode: forumSortMode,
        sortDir: forumSortDir,
        hideCompleted: forumHideCompleted,
      }));
    } catch (err) {
      console.warn(LOG_PREFIX, '[forum] prefs write failed', err);
    }
  }

  // --- Forum data normalization (graceful degrade for v0.2 fetch) -----------
  /**
   * Project bounty.json artists map → uniform array. Missing v0.3+ fields
   * (registered_at_utc / completed / post_count_at_build / post_count_30d_delta)
   * degrade to safe defaults so the popover opens even against a pre-v0.3
   * cache. post_count_30d_delta missing → 0 means "no growth indicator",
   * indistinguishable from a stable tag (acceptable, Resolved 45).
   * @param {?Object} data
   * @return {!Array<!Object>}
   */
  function projectForumArtists(data) {
    if (!data || !data.artists) return [];
    const out = [];
    for (const tag of Object.keys(data.artists)) {
      const e = data.artists[tag];
      if (!e || typeof e !== 'object') continue;
      out.push({
        tag,
        post_ids: Array.isArray(e.post_ids) ? e.post_ids : [],
        approvers: Array.isArray(e.approvers) ? e.approvers : [],
        completed: e.completed === true,
        registered_at_utc:
            typeof e.registered_at_utc === 'string' ? e.registered_at_utc : null,
        post_count_at_build:
            typeof e.post_count_at_build === 'number' ? e.post_count_at_build : null,
        post_count_30d_delta:
            typeof e.post_count_30d_delta === 'number' ? e.post_count_30d_delta : 0,
      });
    }
    return out;
  }

  function formatRegisteredDate(iso) {
    if (!iso) return '—';
    // ISO 8601 → YYYY-MM-DD (UTC). Avoids Intl locale variation across users.
    return iso.slice(0, 10);
  }

  function sortForumArtists(arr, mode, dir) {
    const mult = dir === 'asc' ? 1 : -1;
    const cmpByMode = {
      posts: (a, b) => {
        // null treated as -1 so unknown counts sink to bottom on desc / top on asc.
        const av = a.post_count_at_build ?? -1;
        const bv = b.post_count_at_build ?? -1;
        return av - bv;
      },
      name: (a, b) => a.tag.localeCompare(b.tag),
      date: (a, b) => {
        const av = a.registered_at_utc || '';
        const bv = b.registered_at_utc || '';
        return av < bv ? -1 : av > bv ? 1 : 0;
      },
      approver: (a, b) => {
        const av = (a.approvers[0] || '').toLowerCase();
        const bv = (b.approvers[0] || '').toLowerCase();
        return av.localeCompare(bv);
      },
    };
    const cmp = cmpByMode[mode] || cmpByMode.posts;
    return [...arr].sort((a, b) => {
      const r = cmp(a, b);
      // Stable tie-breaker by tag so two consecutive renders match exactly.
      return r !== 0 ? r * mult : a.tag.localeCompare(b.tag);
    });
  }

  function filteredForumArtists() {
    const all = projectForumArtists(forumData);
    return forumHideCompleted ? all.filter(a => !a.completed) : all;
  }

  // --- Trigger button -------------------------------------------------------
  function buildForumTrigger() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = FORUM_TRIGGER_CLASS;
    btn.setAttribute('aria-label', 'Show bounty artist list');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = SCROLL_ICON_SVG;
    btn.addEventListener('click', onForumTriggerClick);
    return btn;
  }

  function mountForumTrigger() {
    const h1 = document.querySelector(FORUM_HEADING_SELECTOR);
    if (!h1) return false;
    // Idempotent — observer / safety retry may call this repeatedly.
    if (h1.querySelector(`.${FORUM_TRIGGER_CLASS}`)) return true;
    h1.appendChild(buildForumTrigger());
    console.info(LOG_PREFIX, '[forum] trigger mounted');
    return true;
  }

  function onForumTriggerClick(e) {
    e.preventDefault();
    if (forumOpen) closeForumPopover();
    else openForumPopover(e.currentTarget);
  }

  // --- Popover lifecycle ----------------------------------------------------
  function openForumPopover(triggerEl) {
    if (forumOpen) return;
    if (!forumData) {
      console.warn(LOG_PREFIX, '[forum] no bounty data — popover skipped');
      return;
    }
    forumFocusReturn = triggerEl;
    triggerEl.setAttribute('aria-expanded', 'true');
    forumPopoverEl = buildForumPopover();
    document.body.appendChild(forumPopoverEl);
    positionForumPopover(triggerEl, forumPopoverEl);
    forumOpen = true;
    installForumCloseHandlers();
    // Focus first interactive control so keyboard users land inside.
    const firstBtn = forumPopoverEl.querySelector(
        'button, input, [tabindex]:not([tabindex="-1"])');
    if (firstBtn) firstBtn.focus();
  }

  function closeForumPopover() {
    if (!forumOpen) return;
    removeForumCloseHandlers();
    if (forumPopoverEl) {
      forumPopoverEl.remove();
      forumPopoverEl = null;
    }
    const trigger = document.querySelector(`.${FORUM_TRIGGER_CLASS}`);
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    forumOpen = false;
    if (forumFocusReturn && document.contains(forumFocusReturn)) {
      forumFocusReturn.focus();
    }
    forumFocusReturn = null;
  }

  function positionForumPopover(triggerEl, popoverEl) {
    const r = triggerEl.getBoundingClientRect();
    const popW = popoverEl.offsetWidth;
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;
    const viewW = window.innerWidth;
    let top = r.bottom + scrollY + 6;
    let left = r.left + scrollX;
    // Right edge overflow → shift left to fit, leaving a 16px gutter.
    if (left + popW > scrollX + viewW - 16) {
      left = scrollX + viewW - popW - 16;
    }
    if (left < scrollX + 16) left = scrollX + 16;
    popoverEl.style.top = `${top}px`;
    popoverEl.style.left = `${left}px`;
  }

  const FORUM_FOCUSABLE_SELECTOR =
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"]), a[href]';

  function forumFocusableElements() {
    if (!forumPopoverEl) return [];
    return Array.from(forumPopoverEl.querySelectorAll(FORUM_FOCUSABLE_SELECTOR));
  }

  function installForumCloseHandlers() {
    forumDocKeyHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeForumPopover();
        return;
      }
      // Tab cycling — keep focus inside the popover (focus trap, PLAN D27).
      // Capture only when focus is at the boundary so users can still Tab
      // freely between buttons / inputs inside.
      if (e.key !== 'Tab' || !forumPopoverEl) return;
      const focusables = forumFocusableElements();
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const insidePopover = forumPopoverEl.contains(active);
      if (!insidePopover) {
        // Focus slipped outside (e.g. user clicked an underlying page link
        // that didn't close us). Pull it back in to the first control.
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    forumDocClickHandler = (e) => {
      if (!forumPopoverEl) return;
      if (forumPopoverEl.contains(e.target)) return;
      const trigger = document.querySelector(`.${FORUM_TRIGGER_CLASS}`);
      if (trigger && trigger.contains(e.target)) return;
      closeForumPopover();
    };
    document.addEventListener('keydown', forumDocKeyHandler);
    // Defer click listener install by one tick — the click that opened the
    // popover would otherwise bubble to this handler and close it instantly.
    setTimeout(() => {
      if (forumOpen) document.addEventListener('click', forumDocClickHandler);
    }, 0);
  }

  function removeForumCloseHandlers() {
    if (forumDocKeyHandler) {
      document.removeEventListener('keydown', forumDocKeyHandler);
      forumDocKeyHandler = null;
    }
    if (forumDocClickHandler) {
      document.removeEventListener('click', forumDocClickHandler);
      forumDocClickHandler = null;
    }
  }

  // --- Popover DOM ----------------------------------------------------------
  /**
   * Build the popover root. Computes the sorted+filtered artist list once
   * and passes it to header/body/pagination — previously each of those
   * helpers re-projected and re-filtered (and body also re-sorted) the full
   * artist map on every render, three to four times per click.
   * @return {!HTMLElement}
   */
  function buildForumPopover() {
    const el = document.createElement('div');
    el.className = FORUM_POPOVER_CLASS;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Bounty artist list');
    // Stop popover-internal clicks from bubbling to the document-level
    // outside-click handler. Without this, a sort/page button click would
    // (a) replace the popover DOM via rerenderForum, (b) bubble the now-
    // detached click target up to document, (c) trip the close handler
    // because `popoverEl.contains(detachedTarget)` returns false.
    el.addEventListener('click', e => e.stopPropagation());
    const sorted = sortForumArtists(
        filteredForumArtists(), forumSortMode, forumSortDir);
    el.appendChild(buildForumHeader(sorted));
    el.appendChild(buildForumBody(sorted));
    el.appendChild(buildForumPagination(sorted));
    return el;
  }

  function buildForumHeader(sorted) {
    const header = document.createElement('div');
    header.className = 'ubm-bt-header';

    const total = sorted.length;
    const title = document.createElement('div');
    title.className = 'ubm-bt-title';
    title.textContent = `Bounty Artist List (${total})`;
    header.appendChild(title);

    const lbl = document.createElement('label');
    lbl.className = 'ubm-bt-hide-completed';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = forumHideCompleted;
    cb.addEventListener('change', () => {
      // Anchor-preserving page navigation. Uses a persistent forumAnchorTag
      // so repeated on/off toggling keeps the same artist as the anchor —
      // without persistence each toggle would re-pick "current top of page"
      // and drift one page per cycle (the picked top is not the same
      // artist that was the anchor a moment ago, because the new visible
      // page boundary lands a few rows earlier than the previous anchor).
      const beforeList = sortForumArtists(
          filteredForumArtists(), forumSortMode, forumSortDir);
      const beforeStart = forumCurrentPage * FORUM_PAGE_SIZE;
      const visibleBefore = beforeList.slice(
          beforeStart, beforeStart + FORUM_PAGE_SIZE);

      // Lazy-initialise the anchor on the first toggle since the last
      // manual navigation. Subsequent toggles reuse this same tag.
      if (forumAnchorTag === null && visibleBefore.length > 0) {
        forumAnchorTag = visibleBefore[0].tag;
      }

      forumHideCompleted = cb.checked;
      saveForumPrefs();

      const afterList = sortForumArtists(
          filteredForumArtists(), forumSortMode, forumSortDir);
      let newPage = 0;
      let anchorIdx = -1;
      if (forumAnchorTag !== null) {
        anchorIdx = afterList.findIndex(a => a.tag === forumAnchorTag);
      }
      if (anchorIdx >= 0) {
        newPage = Math.floor(anchorIdx / FORUM_PAGE_SIZE);
      } else {
        // Persistent anchor was filtered out (it was completed and the
        // user just hid completed entries, or vice-versa). Fall through
        // the previously visible rows to find the closest survivor and
        // adopt it as the new persistent anchor so the next toggle stays
        // put. If every visible row got filtered out, drop the anchor so
        // the next manual navigation reseeds cleanly.
        let fallbackTag = null;
        for (const candidate of visibleBefore) {
          const idx = afterList.findIndex(a => a.tag === candidate.tag);
          if (idx >= 0) {
            newPage = Math.floor(idx / FORUM_PAGE_SIZE);
            fallbackTag = candidate.tag;
            break;
          }
        }
        forumAnchorTag = fallbackTag;
      }
      forumCurrentPage = newPage;

      rerenderForum();
    });
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode('Hide completed'));
    header.appendChild(lbl);

    // Sort tabs sit to the right of the Hide-completed checkbox (v0.3.6
    // layout swap, per user request — previously Sort | Hide | Close, now
    // Hide | Sort | Close). Title keeps its `margin-right: auto` so it
    // anchors the row at the left edge.
    const sortGroup = document.createElement('div');
    sortGroup.className = 'ubm-bt-sort-group';
    sortGroup.setAttribute('role', 'group');
    sortGroup.setAttribute('aria-label', 'Sort by');
    for (const mode of FORUM_SORT_TAB_ORDER) {
      sortGroup.appendChild(buildForumSortButton(mode));
    }
    header.appendChild(sortGroup);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ubm-bt-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', closeForumPopover);
    header.appendChild(close);

    return header;
  }

  function buildForumSortButton(mode) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ubm-bt-sort-btn';
    btn.dataset.mode = mode;
    const isActive = forumSortMode === mode;
    if (isActive) {
      btn.classList.add('active');
      btn.textContent = `${FORUM_SORT_LABELS[mode]} ${forumSortDir === 'asc' ? '▲' : '▼'}`;
    } else {
      btn.textContent = FORUM_SORT_LABELS[mode];
    }
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    btn.addEventListener('click', () => {
      if (forumSortMode === mode) {
        forumSortDir = forumSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        forumSortMode = mode;
        forumSortDir = FORUM_SORT_DEFAULT_DIR[mode];
      }
      forumCurrentPage = 0;
      // Sort changes the meaning of "where am I" entirely; drop the
      // toggle anchor so the next Hide-completed click reseeds from the
      // new top of page.
      forumAnchorTag = null;
      saveForumPrefs();
      rerenderForum();
    });
    return btn;
  }

  function buildForumBody(sorted) {
    const body = document.createElement('div');
    body.className = 'ubm-bt-body';

    const start = forumCurrentPage * FORUM_PAGE_SIZE;
    const page = sorted.slice(start, start + FORUM_PAGE_SIZE);

    if (page.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ubm-bt-empty';
      empty.textContent = forumHideCompleted
          ? 'No active bounty artists.'
          : 'No bounty artists.';
      body.appendChild(empty);
      return body;
    }

    const table = document.createElement('table');
    table.className = 'ubm-bt-table';
    const thead = document.createElement('thead');
    thead.innerHTML =
        '<tr>' +
        '<th>Name</th>' +
        '<th class="ubm-bt-col-posts">Posts</th>' +
        '<th class="ubm-bt-col-approver">Approver</th>' +
        '<th class="ubm-bt-col-date">Registered</th>' +
        '<th class="ubm-bt-col-state">State</th>' +
        '</tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const a of page) tbody.appendChild(buildForumRow(a));
    table.appendChild(tbody);
    body.appendChild(table);
    return body;
  }

  function buildForumRow(a) {
    const tr = document.createElement('tr');
    if (a.completed) tr.classList.add('ubm-bt-row-completed');

    // Tag cell (PLAN D25 updated 2026-05-28 / Resolved 41+42) — two links
    // in an inline-flex wrapper for clean baseline alignment:
    //   1. Tag text → /artists/show_or_new?name=<tag> (artist wiki).
    //   2. Grid icon button → /posts?tags=<tag> (gallery view).
    // Both open in a new tab so the forum thread context is preserved.
    const tdTag = document.createElement('td');
    const tagCell = document.createElement('span');
    tagCell.className = 'ubm-bt-tag-cell';

    const tagLink = document.createElement('a');
    tagLink.className = 'ubm-bt-tag-link';
    tagLink.href = `/artists/show_or_new?name=${encodeURIComponent(a.tag)}`;
    tagLink.target = '_blank';
    tagLink.rel = 'noopener noreferrer';
    tagLink.textContent = a.tag.replace(/_/g, ' ');
    tagCell.appendChild(tagLink);

    const postsBtn = document.createElement('a');
    postsBtn.className = 'ubm-bt-posts-btn';
    postsBtn.href = `/posts?tags=${encodeURIComponent(a.tag)}`;
    postsBtn.target = '_blank';
    postsBtn.rel = 'noopener noreferrer';
    postsBtn.title = `View ${a.tag.replace(/_/g, ' ')} posts`;
    postsBtn.setAttribute('aria-label', postsBtn.title);
    postsBtn.innerHTML = POSTS_ICON_SVG;
    tagCell.appendChild(postsBtn);
    tdTag.appendChild(tagCell);
    tr.appendChild(tdTag);

    // Posts cell — current count + optional (+N) growth suffix (Resolved 45).
    // Suffix appears only for tags that grew in the last 30 days (per user
    // spec — shrinkage stays hidden). Number formatting is space-separated
    // so a sub-span can carry muted color independently of the main number.
    const tdPosts = document.createElement('td');
    tdPosts.className = 'ubm-bt-col-posts';
    if (a.post_count_at_build === null) {
      tdPosts.textContent = '—';
    } else {
      tdPosts.appendChild(document.createTextNode(String(a.post_count_at_build)));
      if (a.post_count_30d_delta > 0) {
        const delta = document.createElement('span');
        delta.className = 'ubm-bt-delta';
        delta.textContent = ` (+${a.post_count_30d_delta})`;
        delta.title = `+${a.post_count_30d_delta} posts in the last 30 days`;
        tdPosts.appendChild(delta);
      }
    }
    tr.appendChild(tdPosts);

    // Approver cell (D24 updated, Resolved 42 d) — first approver becomes a
    // link to their Danbooru profile (`/users?name=` auto-redirects to
    // `/users/<id>` on exact match). Hover title still surfaces the full
    // list for multi-approver entries. Click on the "+N" suffix area also
    // routes to first approver — accepted simplification (per-approver
    // sub-popover would be a future enhancement).
    const tdApprover = document.createElement('td');
    if (a.approvers.length === 0) {
      const span = document.createElement('span');
      span.className = 'ubm-bt-approvers';
      span.textContent = '—';
      tdApprover.appendChild(span);
    } else {
      const apprLink = document.createElement('a');
      apprLink.className = 'ubm-bt-approvers';
      apprLink.href = `/users?name=${encodeURIComponent(a.approvers[0])}`;
      apprLink.target = '_blank';
      apprLink.rel = 'noopener noreferrer';
      if (a.approvers.length === 1) {
        apprLink.textContent = a.approvers[0];
        apprLink.title = a.approvers[0];
      } else {
        apprLink.textContent = `${a.approvers[0]} +${a.approvers.length - 1}`;
        apprLink.title = a.approvers.join(', ');
      }
      tdApprover.appendChild(apprLink);
    }
    tr.appendChild(tdApprover);

    // Date cell (Resolved 42 e) — links to the originating forum post when
    // both registered_at and post_ids are present. The forum permalink
    // resolves to the latest Approver mention (D8 pattern reuse).
    const tdDate = document.createElement('td');
    tdDate.className = 'ubm-bt-col-date';
    const dateHref = forumPermalink(a.post_ids);
    if (dateHref && a.registered_at_utc) {
      const dateLink = document.createElement('a');
      dateLink.href = dateHref;
      dateLink.target = '_blank';
      dateLink.rel = 'noopener noreferrer';
      dateLink.title = 'Open the originating forum post in a new tab';
      dateLink.textContent = formatRegisteredDate(a.registered_at_utc);
      tdDate.appendChild(dateLink);
    } else {
      tdDate.textContent = formatRegisteredDate(a.registered_at_utc);
    }
    tr.appendChild(tdDate);

    const tdState = document.createElement('td');
    tdState.className = 'ubm-bt-col-state';
    const badge = document.createElement('span');
    badge.className = 'ubm-bt-badge';
    if (a.completed) {
      badge.classList.add('ubm-bt-badge-completed');
      badge.textContent = '✓ Completed';
    } else {
      badge.classList.add('ubm-bt-badge-active');
      badge.textContent = '● Active';
    }
    tdState.appendChild(badge);
    tr.appendChild(tdState);

    return tr;
  }

  function buildForumPagination(sorted) {
    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / FORUM_PAGE_SIZE));
    const nav = document.createElement('nav');
    nav.className = 'ubm-bt-pagination';
    nav.setAttribute('aria-label', 'Pagination');
    if (totalPages <= 1) {
      // Render an empty hidden node so the popover layout has a consistent
      // 3-child structure (header / body / footer). Cheaper than DOM null-check.
      nav.style.display = 'none';
      return nav;
    }

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'ubm-bt-page-btn';
    prev.setAttribute('aria-label', 'Previous page');
    prev.textContent = '‹';
    prev.disabled = forumCurrentPage === 0;
    prev.addEventListener('click', () => {
      if (forumCurrentPage > 0) {
        forumCurrentPage -= 1;
        forumAnchorTag = null;
        rerenderForum();
      }
    });
    nav.appendChild(prev);

    for (let i = 0; i < totalPages; i += 1) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ubm-bt-page-btn';
      if (i === forumCurrentPage) {
        btn.classList.add('active');
        btn.setAttribute('aria-current', 'page');
      }
      btn.textContent = String(i + 1);
      const page = i;
      btn.addEventListener('click', () => {
        forumCurrentPage = page;
        forumAnchorTag = null;
        rerenderForum();
      });
      nav.appendChild(btn);
    }

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'ubm-bt-page-btn';
    next.setAttribute('aria-label', 'Next page');
    next.textContent = '›';
    next.disabled = forumCurrentPage === totalPages - 1;
    next.addEventListener('click', () => {
      if (forumCurrentPage < totalPages - 1) {
        forumCurrentPage += 1;
        forumAnchorTag = null;
        rerenderForum();
      }
    });
    nav.appendChild(next);
    return nav;
  }

  function rerenderForum() {
    if (!forumPopoverEl) return;
    const replacement = buildForumPopover();
    // Preserve viewport position across re-render (sort / page / filter).
    replacement.style.top = forumPopoverEl.style.top;
    replacement.style.left = forumPopoverEl.style.left;
    forumPopoverEl.replaceWith(replacement);
    forumPopoverEl = replacement;
  }

  // --- Forum lifecycle ------------------------------------------------------
  function stopForumMountWatch() {
    if (forumMountObserver) {
      forumMountObserver.disconnect();
      forumMountObserver = null;
    }
    if (forumMountTimeoutId !== null) {
      clearTimeout(forumMountTimeoutId);
      forumMountTimeoutId = null;
    }
  }

  async function initForum() {
    // Defensive — @match is path-scoped but Turbo navigation can deliver us
    // here from a /uploads/* visit, then immediately re-fire on a non-forum
    // path during back-button. Path check keeps mount attempts confined.
    if (!location.pathname.startsWith(FORUM_PATH_PREFIX)) return;
    injectStyles(FORUM_STYLE_TAG_ID, FORUM_CSS);
    // Apply persisted sort/filter prefs before any popover render so the
    // first open reflects the user's last choice (Resolved 43).
    loadForumPrefs();

    forumData = await getBountyData();
    if (!forumData) {
      console.info(LOG_PREFIX, '[forum] no bounty data, trigger skipped');
      return;
    }

    if (mountForumTrigger()) return;

    // Heading not present yet (Turbo partial render race). Watch body until
    // it appears, with a hard 5s timeout to release the observer (Resolved 23
    // pattern — mirrors Danbooru upload module).
    forumMountObserver = new MutationObserver(() => {
      if (mountForumTrigger()) stopForumMountWatch();
    });
    forumMountObserver.observe(document.body, { childList: true, subtree: true });
    forumMountTimeoutId = setTimeout(stopForumMountWatch, FORUM_MAX_RETRY_MS);
  }

  function cleanupForum() {
    stopForumMountWatch();
    closeForumPopover();
    const trigger = document.querySelector(`.${FORUM_TRIGGER_CLASS}`);
    if (trigger) trigger.remove();
    forumData = null;
    forumCurrentPage = 0;
    forumAnchorTag = null;
  }

  // ==========================================================================
  // === Top-level dispatcher =================================================
  // ==========================================================================
  // Tampermonkey lacks per-@match entry-point dispatch, so we route by
  // hostname + path (PLAN D13 + D29). Danbooru splits into upload vs. forum
  // sub-modules; Turbo navigation can switch between them, so the dispatcher
  // tracks which one is currently active and cleans up only that one before
  // routing the new path on `turbo:load`.

  /**
   * Pick the site module matching the current hostname + path, or null if
   * this userscript shouldn't run here. Danbooru returns one of two
   * sub-modules; other hostnames are single-module.
   * @return {?{name: string, init: !Function, cleanup: !Function, turbo: boolean}}
   */
  function getActiveModule() {
    const host = location.hostname;
    const path = location.pathname;
    if (host === 'danbooru.donmai.us') {
      if (path.startsWith('/uploads/')) {
        return { name: 'danbooru-upload', init: initDanbooru, cleanup: cleanupDanbooru, turbo: true };
      }
      if (path.startsWith(FORUM_PATH_PREFIX)) {
        return { name: 'danbooru-forum', init: initForum, cleanup: cleanupForum, turbo: true };
      }
      return null;  // other Danbooru pages — no-op
    }
    if (host === 'www.pixiv.net') {
      return { name: 'pixiv', init: initPixiv, cleanup: cleanupPixiv, turbo: false };
    }
    if (host === 'x.com' || host === 'twitter.com') {
      return { name: 'x', init: initX, cleanup: cleanupX, turbo: false };
    }
    return null;
  }

  // Tracks the currently active Turbo-based module so `turbo:before-visit`
  // cleans up only that one even when the next page would route to a
  // different module (upload → forum or vice versa).
  let danbooruActiveModule = null;

  function danbooruTurboLoadHandler() {
    const m = getActiveModule();
    if (!m || !m.turbo) {
      danbooruActiveModule = null;
      return;
    }
    danbooruActiveModule = m;
    m.init();
  }

  function danbooruTurboBeforeVisitHandler() {
    if (danbooruActiveModule) {
      danbooruActiveModule.cleanup();
      danbooruActiveModule = null;
    }
  }

  const initial = getActiveModule();
  if (!initial) {
    console.info(LOG_PREFIX, 'no module for', location.hostname + location.pathname);
    return;
  }

  // Attach Danbooru-wide Turbo listeners once. They handle in-app navigation
  // between /uploads/* and /forum_topics/24186*. Pixiv/X handle SPA nav with
  // their own pushState hooks installed by their init functions.
  if (location.hostname === 'danbooru.donmai.us') {
    document.addEventListener('turbo:load', danbooruTurboLoadHandler);
    document.addEventListener('turbo:before-visit', danbooruTurboBeforeVisitHandler);
  }

  // First-load safety net — Turbo may have already fired before this script
  // attached, and Pixiv/X run this as their only entry point.
  if (initial.turbo) danbooruActiveModule = initial;
  initial.init();
})();
