// ==UserScript==
// @name         Danbooru Upload Bounty Marks
// @namespace    AkaringoP/JavaScripts
// @version      0.1.5
// @description  Mark bounty artists (forum_topics/24186) on the Danbooru upload page
// @author       AkaringoP
// @match        https://danbooru.donmai.us/uploads/*
// @icon         https://danbooru.donmai.us/favicon.ico
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
    const latestPostId = Math.max(...postIds);
    const anchor = document.createElement('a');
    anchor.className = [
      LABEL_BASE_CLASS, LABEL_BOUNTY_CLASS, pendingClass, dupClass, 'button-xs',
    ].filter(Boolean).join(' ');
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

  // --- Duplicate / PPD detection (PLAN D10 / D11, v0.1.2) --------------------

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

  // --- Lifecycle (PostTimeline / BUTR D5 pattern) ----------------------------
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
   * Per-tick orchestrator. Returns true once at least one terminal action has
   * happened (PPD block, or bounty+dup decisions made), so the observer can
   * stop. PPD is the highest-priority signal: if present, bounty is hidden
   * and dup toast is suppressed (PPD already states the strongest case).
   * @param {?Object} data
   * @return {boolean}
   */
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

  async function init() {
    injectStyles();

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

  function cleanup() {
    removeLabel();
    removeDuplicateToast();
    clearPpdBlock();
    unwrapAllBadges();
    stopObserver();
    cancelScheduledCommit();
    labelsCommitted = false;
  }

  document.addEventListener('turbo:load', init);
  document.addEventListener('turbo:before-visit', cleanup);
  // First-load safety net (PostTimeline / BUTR pattern).
  init();
})();
