// ==UserScript==
// @name         Danbooru Bottom-Up Tag Removal
// @namespace    https://github.com/AkaringoP
// @version      1.1.3
// @description  When you remove a tag on submit, also offer to remove its implied parent tags via a confirmation dialog.
// @author       AkaringoP
// @license      MIT
// @match        *://danbooru.donmai.us/posts/*
// @icon         https://danbooru.donmai.us/favicon.ico
// @updateURL    https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/BottomUpTagRemoval/BottomUpTagRemoval.user.js
// @downloadURL  https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/BottomUpTagRemoval/BottomUpTagRemoval.user.js
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // --- CONSTANTS ---

  /**
   * @const {string} CSS for the confirmation popover.
   *
   * This dialog is a floating popover, not a full-screen modal — it
   * positions itself near the Edit-tags Submit button, with viewport-edge
   * clamping handled in JS. No backdrop overlay; clicks outside the
   * popover dismiss it via document-level mousedown listener.
   *
   * Theming: light values are inline fallbacks in each var() call; dark
   * overrides are scoped to the popover element carrying the
   * data-butr-theme="dark" attribute (set on the dialog in showDialog
   * when Danbooru is in dark mode). Container-scoped overrides avoid
   * triggering a full-page style recalc on Danbooru's large DOM.
   */
  const GLOBAL_CSS = `
    /* Dark-mode CSS variables (scoped to our popover container) */
    [data-butr-theme="dark"] {
      --butr-bg:              #1a1a2e;
      --butr-bg-hover:        rgba(255, 255, 255, 0.08);
      --butr-text:            #e0e0e0;
      --butr-text-muted:      #888888;
      --butr-border:          #3a3a55;
      --butr-link:            #58a6ff;
      --butr-shadow:          rgba(0, 0, 0, 0.5);
      --butr-spinner-track:   #2a2a44;
      --butr-spinner-accent:  #58a6ff;
    }

    #butr-dialog {
      position: fixed;
      /* top/left set by positionPopover(); start off-screen so the initial
         frame doesn't flash at (0,0) before positioning. */
      top: -9999px;
      left: -9999px;
      background: var(--butr-bg, #ffffff);
      color: var(--butr-text, #333333);
      border: 1px solid var(--butr-border, #e1e4e8);
      border-radius: 6px;
      padding: 10px 14px;
      min-width: 240px;
      max-width: 380px;
      max-height: 60vh;
      overflow-y: auto;
      font-family: inherit;
      font-size: 13px;
      line-height: 1.4;
      box-shadow: 0 4px 16px var(--butr-shadow, rgba(0, 0, 0, 0.2));
      z-index: 9999;
    }
    #butr-dialog h2 {
      margin: 0 0 8px;
      font-size: 14px;
      font-weight: 600;
      color: var(--butr-text, #333333);
    }
    .butr-master {
      padding: 4px 2px;
      border-bottom: 1px solid var(--butr-border, #e1e4e8);
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }
    .butr-section {
      margin: 0 0 10px;
    }
    .butr-section:last-of-type {
      margin-bottom: 0;
    }
    .butr-row {
      padding: 2px 4px;
      border-radius: 3px;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }
    .butr-row:hover {
      background: var(--butr-bg-hover, rgba(0, 0, 0, 0.06));
    }
    .butr-row input[type="checkbox"] {
      margin: 0;
    }
    .butr-keyhint {
      display: inline-block;
      min-width: 10px;
      text-align: right;
      color: var(--butr-text-muted, #888888);
      font-size: 11px;
      user-select: none;
      pointer-events: none;
    }
    .butr-section-footer {
      text-align: center;
      color: var(--butr-text-muted, #888888);
      font-size: 11px;
      font-style: italic;
      padding: 3px 0;
      margin-top: 4px;
    }
    .butr-restore {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 2px;
      margin-top: 8px;
      font-size: 12px;
      color: var(--butr-text-muted, #888888);
      cursor: pointer;
      user-select: none;
    }
    .butr-restore input[type="checkbox"] {
      margin: 0;
    }
    .butr-buttons {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--butr-border, #e1e4e8);
    }
    .butr-buttons button {
      padding: 4px 12px;
      font-size: 13px;
      cursor: pointer;
      border-radius: 4px;
      font-family: inherit;
    }
    .butr-buttons .butr-primary {
      background: var(--butr-link, #0969da);
      color: #ffffff;
      border: 1px solid var(--butr-link, #0969da);
    }
    .butr-buttons .butr-secondary {
      background: transparent;
      color: var(--butr-text, #333333);
      border: 1px solid var(--butr-border, #d0d7de);
    }
    .butr-spinner-wrap {
      text-align: center;
      padding: 16px 0;
      color: var(--butr-text-muted, #888888);
      font-size: 12px;
    }
    .butr-spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid var(--butr-spinner-track, #f3f3f3);
      border-top-color: var(--butr-spinner-accent, #0969da);
      border-radius: 50%;
      animation: butr-spin 0.8s linear infinite;
      vertical-align: middle;
      margin-right: 8px;
    }
    @keyframes butr-spin {
      to { transform: rotate(360deg); }
    }
  `;

  /** @const {string} CSS selector for the post tag input. Same on /posts/{id} and /posts/{id}/edit. */
  const TAG_INPUT_SELECTOR = 'textarea[name="post[tag_string]"]';

  /** @const {string} DOM id used to id-guard injected <style>. */
  const STYLE_ELEMENT_ID = 'butr-styles';

  /**
   * @const {number} Debounce window for typing-style edits before kicking
   * off a prefetch (Task 4.9). Multi-character edits (block delete, paste,
   * autocomplete completion, Ctrl+Backspace word delete) bypass this and
   * trigger immediately — they're identified by length-delta > 1.
   */
  const PREFETCH_DEBOUNCE_MS = 300;

  /**
   * @const {string} localStorage key for the "Restore removed tags on
   * Cancel" preference (Task 4.11). Persistent across popovers and tabs.
   * Stored as the literal string `'1'` when enabled; absent otherwise.
   */
  const STORAGE_KEY_RESTORE_ON_CANCEL = 'butr_restore_on_cancel';

  // --- STATE ---

  /**
   * Tag tokens captured at page load. Used to compute removed = original − current.
   * Lowercase-normalized. Populated in Task 1.2.
   * @type {?Set<string>}
   */
  let originalTags = null;

  /**
   * Tag input textarea bound on init. Null when not present on the current page.
   * @type {?HTMLTextAreaElement}
   */
  let tagInput = null;

  /**
   * Form containing the tag input. Submit handler is attached here in Task 1.4.
   * @type {?HTMLFormElement}
   */
  let tagForm = null;

  /**
   * AbortController for the in-flight implication BFS. Aborted on Cancel
   * or page navigation. Populated in Phase 4.
   * @type {?AbortController}
   */
  let abortCtrl = null;

  /**
   * Re-entry guard for the submit flow (BFS / dialog open). Prevents double
   * processing from rapid double-click or Enter+click.
   * @type {boolean}
   */
  let isProcessing = false;

  /**
   * Generation counter for discarding stale async results across re-inits
   * (Turbo navigation during in-flight BFS).
   * @type {number}
   */
  let initGeneration = 0;

  /**
   * References to the currently mounted popover DOM, or null when not shown.
   * `root` IS the popover (no backdrop overlay) and the element that carries
   * the `data-butr-theme="dark"` attribute. Populated by buildDialog() /
   * showDialog(); cleared by hideDialog().
   * @type {?{
   *   root: !HTMLElement,
   *   masterCheckbox: !HTMLInputElement,
   *   sectionsContainer: !HTMLElement,
   *   restoreCheckbox: !HTMLInputElement,
   *   submitBtn: !HTMLButtonElement,
   *   cancelBtn: !HTMLButtonElement,
   * }}
   */
  let dialogRefs = null;

  /**
   * Bound keyboard-shortcut listener while the popover is shown — handles
   * Esc (cancel), Ctrl/Cmd+Enter (submit), `0` (toggle master), and
   * `1`–`9` (toggle Nth candidate row). Null when popover is not shown.
   * @type {?(event: KeyboardEvent) => void}
   */
  let keydownListener = null;

  /**
   * Document-level mousedown listener that dismisses the popover on any
   * click outside its bounds. Null when the popover is not shown.
   * @type {?(event: MouseEvent) => void}
   */
  let outsideClickListener = null;

  /**
   * Bound scroll/resize handler that re-runs positionPopover() — kept as
   * a single reference so it can be detached symmetrically.
   * @type {?(event: Event) => void}
   */
  let positionListener = null;

  /**
   * requestAnimationFrame id for throttled repositioning. Coalesces bursts
   * of scroll/resize events into one position recalc per frame.
   * @type {?number}
   */
  let positionRaf = null;

  /**
   * Edit-tags Submit button that we have disabled while the popover is
   * shown — prevents the user from accidentally double-clicking the
   * original Submit while interacting with the popover. Cleared when the
   * popover hides.
   * @type {?(HTMLInputElement|HTMLButtonElement)}
   */
  let anchorButton = null;

  /**
   * Active handler for the popover's Submit button. Switched between
   * `applyAndSubmit` (normal flow) and `submitWithoutModification`
   * (BFS-failure fallback). Set when the dialog body is rendered;
   * cleared on hide.
   * @type {?() => void}
   */
  let submitHandler = null;

  /**
   * Single-shot flag that lets our own form.requestSubmit() pass through
   * the capture handler without re-entering the dialog flow. Set to true
   * just before requestSubmit; the capture handler clears it on the very
   * next event and proceeds to native submission (Turbo / Rails UJS).
   * @type {boolean}
   */
  let bypassNextSubmit = false;

  /**
   * Reverse implication index built once per dialog flow: child tag → set
   * of consequents that directly imply via it. Powers the cascade-uncheck
   * lookup in `onCandidateChange` — when the user unchecks a candidate
   * T, every transitive parent of T is also unchecked. Lives only while
   * the popover is shown: set in runDialogFlow, cleared in
   * detachClosingTriggers (which fires from hideDialog / cancel).
   * @type {?Map<string, !Set<string>>}
   */
  let currentChildToParents = null;

  /**
   * Seed list captured at the moment the popover mounts. Used by the
   * optional "Restore removed tags on Cancel" checkbox (Task 4.11) to put
   * the originally-removed tags back into the textarea when the user
   * dismisses the popover with that option enabled. Lives only while the
   * popover is shown: set in handleSubmit before any popover-mounting
   * branch, cleared in detachClosingTriggers. Null for the bypass paths
   * (no popover means no cancel possible).
   * @type {?Array<string>}
   */
  let currentRemoved = null;

  // --- PREFETCH STATE (Task 4.9) ---
  // The popover's BFS + smart-default work runs on every relevant textarea
  // edit, ahead of Submit. handleSubmit then consumes whatever's already
  // cached (or in-flight) for the current input, eliminating the spinner
  // phase in the common case. A length-delta heuristic on the `input`
  // event distinguishes deliberate multi-char edits (immediate trigger)
  // from in-progress typing (debounced).

  /**
   * Cache key that identifies the current prefetched input state. Computed
   * by `makeCacheKey(removed, currentTokens)`. Same key → cache hit.
   * @type {?string}
   */
  let prefetchKey = null;

  /**
   * Latest prefetch outcome, or null while one is in flight without a prior
   * result. `status: 'bypass'` means handleSubmit can skip the popover and
   * native-submit. `status: 'render'` means handleSubmit can mount the
   * popover and immediately renderSections without a spinner phase.
   * `status: 'error'` is treated as a cache miss.
   * @type {?{
   *   status: ('bypass'|'render'|'error'),
   *   filteredGroups: ?Map<string, !Array<{tag: string, depth: number}>>,
   *   meta: ?Map<string, {antecedents: !Set<string>, seedRootDepths: !Map<string, number>}>,
   * }}
   */
  let prefetchResult = null;

  /**
   * Resolves when the in-flight prefetch finishes (success or error).
   * handleSubmit awaits this when key matches but result isn't ready yet.
   * Null when no prefetch is in flight.
   * @type {?Promise<void>}
   */
  let prefetchPromise = null;

  /**
   * AbortController for the in-flight prefetch. Aborted when a new edit
   * invalidates the current cache entry, or on cleanup.
   * @type {?AbortController}
   */
  let prefetchCtrl = null;

  /**
   * setTimeout id for the debounced prefetch trigger. Cleared on each new
   * input event (so consecutive keystrokes coalesce into one prefetch
   * after the user pauses).
   * @type {?number}
   */
  let prefetchDebounceTimer = null;

  /**
   * Reference to the bound `input` listener so it can be removed
   * symmetrically in cleanup().
   * @type {?(event: Event) => void}
   */
  let inputListener = null;

  /**
   * Length of the textarea value at the previous `input` event. Used to
   * compute the current event's delta and choose between immediate vs
   * debounced prefetch trigger. Reset to current length on init.
   * @type {number}
   */
  let prevInputLength = 0;

  // --- STYLE INJECTION ---

  /**
   * Injects GLOBAL_CSS into the document head. Idempotent via id-guarded
   * <style>. No-op when GLOBAL_CSS is empty (Phases 1-2).
   */
  function injectStyles() {
    if (!GLOBAL_CSS || document.getElementById(STYLE_ELEMENT_ID)) {
      return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = GLOBAL_CSS;
    document.head.appendChild(style);
  }

  // --- TAG TOKEN UTILITIES ---

  /**
   * Splits a tag string into a normalized Set of tokens. Whitespace-split,
   * lowercased, empty strings dropped. Null/undefined input returns an
   * empty Set.
   *
   * @param {?string|undefined} str
   * @return {!Set<string>}
   */
  function tokenize(str) {
    return new Set(String(str ?? '').toLowerCase().split(/\s+/).filter(Boolean));
  }

  /**
   * Reduces a raw token Set to the tag set that will actually exist on the
   * post after the server parses Danbooru's add/subtract syntax. Drops:
   *   - `-tag` directives themselves (they are instructions, not tags).
   *   - Any `tag` whose `-tag` directive is also present (server resolves
   *     `tag -tag` to "tag is removed").
   *
   * This is the single source of truth for "what tags are effectively
   * present" — used by `computeRemoved` (diff vs originalTags) and by
   * `computeDialogPlan` (candidate filtering + Policy B+ stable tokens).
   * Without this, `-tag` syntax leaks through as a still-present token,
   * tricking Policy B+ into treating the soon-to-be-removed seed as a
   * stable parent and filtering its implied parents out as "phantom".
   *
   * @param {!Set<string>} rawTokens
   * @return {!Set<string>}
   */
  function finalTokens(rawTokens) {
    const result = new Set();
    for (const t of rawTokens) {
      if (t.startsWith('-')) continue;
      if (rawTokens.has('-' + t)) continue;
      result.add(t);
    }
    return result;
  }

  /**
   * Computes the list of original tag tokens that the user is removing in
   * this submit. A tag counts as removed when it is absent from the
   * post-submission tag set (`finalTokens`) — covers both implicit deletion
   * (the literal token is gone) and explicit `-tag` subtraction (server
   * will strip it).
   *
   * Returns an empty array when the snapshot has not been taken yet (e.g.
   * init() did not bind to a tag input on this page).
   *
   * @param {string} currentValue
   * @return {!Array<string>}
   */
  function computeRemoved(currentValue) {
    if (!originalTags) {
      return [];
    }
    const final = finalTokens(tokenize(currentValue));
    return Array.from(originalTags).filter((tag) => !final.has(tag));
  }

  // --- IMPLICATION QUERIES ---

  /** @const {string} Same-origin API path for tag implications. */
  const IMPLICATION_API_PATH = '/tag_implications.json';

  /** @const {number} Max antecedents per HTTP request. Conservative for URL length. */
  const IMPLICATION_CHUNK_SIZE = 100;

  /** @const {number} `limit` parameter — max rows per page from the API. */
  const IMPLICATION_PAGE_LIMIT = 1000;

  /** @const {number} Delay between chunks within a BFS level (rate-limit cushion). */
  const IMPLICATION_CHUNK_DELAY_MS = 100;

  /**
   * @const {!Array<number>} Pre-retry delays (ms) for `fetchImplicationsPage`
   * — Task 4.13. Exponential backoff: 1s, 2s, 4s for 3 retries (4 attempts
   * total, ~7s worst-case wait before final throw). Tuned to absorb most
   * transient 5xx/429 blips without blocking the user too long.
   */
  const RETRY_BACKOFFS_MS = [1000, 2000, 4000];

  /** @const {string} Search key for batch fetch by antecedent (child) names. */
  const SEARCH_KEY_ANTECEDENT = 'search[antecedent_name_array][]';

  /** @const {string} Search key for batch fetch by consequent (parent) names. */
  const SEARCH_KEY_CONSEQUENT = 'search[consequent_name_array][]';

  /**
   * Promise-based sleep that honors an AbortSignal — rejects immediately with
   * AbortError on abort instead of waiting out the timer.
   *
   * @param {number} ms
   * @param {AbortSignal=} signal
   * @return {!Promise<void>}
   */
  function delayWithSignal(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      let timer;
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, {once: true});
    });
  }

  /**
   * Yields successive `size`-sized chunks of `arr`. Empty input produces no
   * yields.
   *
   * @template T
   * @param {!Array<T>} arr
   * @param {number} size
   * @return {!Generator<!Array<T>>}
   */
  function* chunked(arr, size) {
    for (let i = 0; i < arr.length; i += size) {
      yield arr.slice(i, i + size);
    }
  }

  /**
   * Fetches one page of active tag implications keyed on either antecedent
   * (child) or consequent (parent) names. The server may return up to
   * IMPLICATION_PAGE_LIMIT rows; if the page is full, the caller follows
   * the returned `nextPage` cursor.
   *
   * Retries up to `RETRY_BACKOFFS_MS.length` times (Task 4.13) on transient
   * failure (network error, 5xx, 429), with exponential backoff between
   * attempts (1s / 2s / 4s — total ~7s worst-case wait before final
   * throw). Other 4xx fail fast; AbortError propagates immediately,
   * including from inside a retry-delay sleep.
   *
   * @param {string} searchKey  SEARCH_KEY_ANTECEDENT or SEARCH_KEY_CONSEQUENT.
   * @param {!Array<string>} names
   * @param {?string} page  Cursor like `b<id>`, or null for the first page.
   * @param {AbortSignal=} signal
   * @return {!Promise<{items: !Array<!Object>, nextPage: ?string}>}
   */
  async function fetchImplicationsPage(searchKey, names, page, signal) {
    const params = new URLSearchParams();
    for (const n of names) {
      params.append(searchKey, n);
    }
    params.set('search[status]', 'active');
    params.set('limit', String(IMPLICATION_PAGE_LIMIT));
    if (page) {
      params.set('page', page);
    }

    const url = `${IMPLICATION_API_PATH}?${params}`;
    const totalAttempts = RETRY_BACKOFFS_MS.length + 1;

    let lastErr = null;
    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      // Wait before retry attempts (not before the first try). delayWithSignal
      // rejects with AbortError if the signal fires during the sleep, so a
      // user cancel mid-backoff propagates immediately.
      if (attempt > 0) {
        const backoffMs = RETRY_BACKOFFS_MS[attempt - 1];
        console.warn(
            `[BUTR] retry ${attempt}/${RETRY_BACKOFFS_MS.length} ` +
            `after ${backoffMs}ms (${lastErr?.message ?? 'unknown'})`);
        await delayWithSignal(backoffMs, signal);
      }

      try {
        const res = await fetch(url, {signal});
        if (res.ok) {
          const items = await res.json();
          const nextPage = items.length === IMPLICATION_PAGE_LIMIT
              ? `b${Math.min(...items.map(it => it.id))}`
              : null;
          return {items, nextPage};
        }
        if (res.status >= 500 || res.status === 429) {
          lastErr = new Error(`HTTP ${res.status}`);
          continue;
        }
        // 4xx (other than 429) — non-retryable. `break` (not `throw`) so
        // the surrounding catch doesn't intercept and treat it as a
        // transient error that should be retried.
        lastErr = new Error(`HTTP ${res.status}`);
        break;
      } catch (err) {
        if (err.name === 'AbortError') {
          throw err;
        }
        // Network error / unexpected throw — treat as transient, retry.
        lastErr = err;
      }
    }
    throw lastErr ?? new Error('fetchImplicationsPage: unknown failure');
  }

  /**
   * Resolves every active implication matching `names` under the given
   * `searchKey` — chunks the input by IMPLICATION_CHUNK_SIZE, paginates
   * within each chunk, and inserts a small delay between chunks to ease
   * rate-limit pressure. Returns a flat array of implication rows.
   *
   * @param {string} searchKey  SEARCH_KEY_ANTECEDENT or SEARCH_KEY_CONSEQUENT.
   * @param {!Array<string>} names
   * @param {AbortSignal=} signal
   * @return {!Promise<!Array<!Object>>}
   */
  async function fetchAllImplicationsByKey(searchKey, names, signal) {
    const results = [];
    let isFirstChunk = true;
    for (const chunk of chunked(names, IMPLICATION_CHUNK_SIZE)) {
      if (!isFirstChunk) {
        await delayWithSignal(IMPLICATION_CHUNK_DELAY_MS, signal);
      }
      isFirstChunk = false;

      let page = null;
      do {
        const {items, nextPage} = await fetchImplicationsPage(
            searchKey, chunk, page, signal);
        results.push(...items);
        page = nextPage;
      } while (page);
    }
    return results;
  }

  /**
   * Convenience: fetches all active implications WHERE antecedent ∈ names.
   * Used by upwardClosure() for BFS expansion.
   *
   * @param {!Array<string>} antecedents
   * @param {AbortSignal=} signal
   * @return {!Promise<!Array<!Object>>}
   */
  function fetchAllImplications(antecedents, signal) {
    return fetchAllImplicationsByKey(SEARCH_KEY_ANTECEDENT, antecedents, signal);
  }

  /**
   * Identifies tags whose deletion would be undone by the server's
   * implication system — both **phantom seeds** (seeds that some stable
   * token still implies, so they're re-added after removal) and
   * **still-implied candidates** (parent tags that, even if removed, would
   * be re-implied by some surviving tag). Together these form policy B+:
   * the popover should hide phantom seed sections entirely and drop
   * still-implied candidate rows from the remaining sections.
   *
   * Algorithm — single batch query + in-memory fixed-point iteration:
   *   1. One API call: `consequent_name_array=[...seeds, ...candidates]`.
   *      Returns every implication where the consequent is a seed or a
   *      candidate. The antecedent can be any tag.
   *   2. Build per-target antecedent map.
   *   3. Iterate `surviving = stableTokens` until fixed point: a target
   *      joins `surviving` if any of its antecedents is in `surviving`.
   *      This propagates phantom-restoration through chains: stable X
   *      implies seed S₁ → S₁ surviving → S₁ implies candidate C → C
   *      surviving (and so on). Fixed-point handles deeper chains too
   *      (S₁ phantom → S₂ phantom because S₁ implies S₂, etc.).
   *
   * Cheaper than full transitive policy C (which would require a second
   * BFS from stableTokens). Same API cost as the previous direct-only
   * check (one batch query), with seeds added to the consequent list.
   *
   * @param {!Array<string>} seeds  Tags the user is removing.
   * @param {!Array<string>} candidates  Parent tags (deduped across sections).
   * @param {!Set<string>} stableTokens  Current input tokens minus candidates.
   * @param {AbortSignal=} signal
   * @return {!Promise<{phantomSeeds: !Set<string>, stillImplied: !Set<string>}>}
   */
  async function findStillImpliedTargets(seeds, candidates, stableTokens, signal) {
    const phantomSeeds = new Set();
    const stillImplied = new Set();
    const targets = [...new Set([...seeds, ...candidates])];
    if (targets.length === 0 || stableTokens.size === 0) {
      return {phantomSeeds, stillImplied};
    }

    const items = await fetchAllImplicationsByKey(
        SEARCH_KEY_CONSEQUENT, targets, signal);

    // Build target → set of antecedent names. Antecedents can be any tag —
    // we need the full set (not just stable-filtered) because the iteration
    // promotes targets into `surviving` as their phantom status propagates.
    /** @type {!Map<string, !Set<string>>} */
    const antecedentMap = new Map();
    for (const t of targets) {
      antecedentMap.set(t, new Set());
    }
    for (const imp of items) {
      const ants = antecedentMap.get(imp.consequent_name);
      if (ants) {
        ants.add(imp.antecedent_name);
      }
    }

    // Fixed-point: a target joins `surviving` if any of its antecedents is
    // already in `surviving`. Bounded by chain depth — typically converges
    // in 1–3 iterations.
    const surviving = new Set(stableTokens);
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of targets) {
        if (surviving.has(t)) {
          continue;
        }
        const ants = antecedentMap.get(t);
        if (!ants) {
          continue;
        }
        for (const a of ants) {
          if (surviving.has(a)) {
            surviving.add(t);
            changed = true;
            break;
          }
        }
      }
    }

    const seedSet = new Set(seeds);
    const candidateSet = new Set(candidates);
    for (const t of surviving) {
      if (seedSet.has(t)) {
        phantomSeeds.add(t);
      }
      if (candidateSet.has(t)) {
        stillImplied.add(t);
      }
    }
    return {phantomSeeds, stillImplied};
  }

  /**
   * Computes the transitive upward closure of the given seed tags — every
   * consequent that any seed tag implies, directly or via further chained
   * implications. Each entry records the full set of immediate antecedents
   * (every tag that directly implies it within the closure) and the
   * shortest distance from each reachable seed (`seedRootDepths`). Seeds
   * themselves are excluded.
   *
   * Multi-parent handling (Task 4.7): a consequent reachable from two or
   * more seed chains is recorded once but its `antecedents` accumulates
   * every direct child found across the BFS, and `seedRootDepths` records
   * the per-seed shortest path. groupBySeedRoot uses these to emit the
   * candidate into every applicable section with the section-relative
   * depth.
   *
   * Satisfies PLAN.md §D3 accuracy requirements 1–8: transitive completeness,
   * multi-parent handling, exact-match search, status=active filter, visited
   * set / cycle defense, URL-length-aware chunking, pagination, and retry on
   * transient failure.
   *
   * @param {!Iterable<string>} seedTags
   * @param {AbortSignal=} signal
   * @return {!Promise<!Map<string, {antecedents: !Set<string>, seedRootDepths: !Map<string, number>}>>}
   */
  async function upwardClosure(seedTags, signal) {
    const seeds = new Set(seedTags);
    /** @type {!Map<string, {antecedents: !Set<string>}>} */
    const intermediate = new Map();
    let frontier = Array.from(seeds);

    while (frontier.length > 0) {
      const items = await fetchAllImplications(frontier, signal);
      const next = [];
      for (const imp of items) {
        const c = imp.consequent_name;
        const a = imp.antecedent_name;
        if (seeds.has(c)) {
          continue;
        }
        let entry = intermediate.get(c);
        if (!entry) {
          entry = {antecedents: new Set()};
          intermediate.set(c, entry);
          // First discovery → expand from c next iteration. Re-discoveries
          // only append to antecedents (no duplicate frontier insertions).
          next.push(c);
        }
        entry.antecedents.add(a);
      }
      frontier = next;
    }

    // Post-process: per-target backward BFS to compute exact shortest
    // distance to each reachable seed. Done after BFS so every antecedent
    // edge has been collected — incremental propagation during forward BFS
    // would miss late-discovered edges that shorten an earlier estimate.
    /** @type {!Map<string, {antecedents: !Set<string>, seedRootDepths: !Map<string, number>}>} */
    const result = new Map();
    for (const [tag, info] of intermediate) {
      result.set(tag, {
        antecedents: info.antecedents,
        seedRootDepths: computeSeedRootDepths(tag, intermediate, seeds),
      });
    }
    return result;
  }

  /**
   * Backward BFS from `target` along `antecedents` edges. For each seed
   * reachable from `target`, records the shortest path length. The
   * traversal stops at seed nodes (they aren't keys in `intermediate`
   * anyway) and uses a visited Set to defend against any cycle in the
   * implication graph.
   *
   * @param {string} target
   * @param {!Map<string, {antecedents: !Set<string>}>} intermediate
   * @param {!Set<string>} seeds
   * @return {!Map<string, number>}  seedRoot → shortest depth from seed.
   */
  function computeSeedRootDepths(target, intermediate, seeds) {
    /** @type {!Map<string, number>} */
    const result = new Map();
    const visited = new Set([target]);
    let frontier = [target];
    let depth = 0;
    while (frontier.length > 0) {
      depth++;
      const next = [];
      for (const node of frontier) {
        const entry = intermediate.get(node);
        if (!entry) {
          continue;
        }
        for (const a of entry.antecedents) {
          if (visited.has(a)) {
            continue;
          }
          visited.add(a);
          if (seeds.has(a)) {
            // Seeds are leaves of the backward walk — record and stop.
            // First visit at this level is the shortest by BFS invariant.
            result.set(a, depth);
          } else {
            next.push(a);
          }
        }
      }
      frontier = next;
    }
    return result;
  }

  // --- DIALOG ---

  /**
   * Builds the popover DOM and returns refs for the caller to populate /
   * attach handlers. Does not mount the DOM (caller does via showDialog).
   * Initial body shows a spinner; renderSections() replaces it.
   *
   * The returned `root` is the popover itself — there is no backdrop
   * overlay. positionPopover() handles placement.
   *
   * @return {!{
   *   root: !HTMLElement,
   *   masterCheckbox: !HTMLInputElement,
   *   sectionsContainer: !HTMLElement,
   *   submitBtn: !HTMLButtonElement,
   *   cancelBtn: !HTMLButtonElement,
   * }}
   */
  function buildDialog() {
    const root = document.createElement('div');
    root.id = 'butr-dialog';

    const title = document.createElement('h2');
    title.textContent = 'Remove their implied parents?';
    root.appendChild(title);

    const masterRow = document.createElement('label');
    masterRow.className = 'butr-master';
    const masterCheckbox = document.createElement('input');
    masterCheckbox.type = 'checkbox';
    masterCheckbox.checked = true;
    masterRow.append(
        createKeyHint('0'), masterCheckbox, document.createTextNode('Delete all'));
    root.appendChild(masterRow);

    const sectionsContainer = document.createElement('div');
    sectionsContainer.className = 'butr-sections';
    root.appendChild(sectionsContainer);

    // Initial spinner placeholder; renderSections() replaces this.
    const spinnerWrap = document.createElement('div');
    spinnerWrap.className = 'butr-spinner-wrap';
    const spinnerIcon = document.createElement('span');
    spinnerIcon.className = 'butr-spinner';
    spinnerWrap.append(
        spinnerIcon, document.createTextNode('Checking implications...'));
    sectionsContainer.appendChild(spinnerWrap);

    const restoreRow = document.createElement('label');
    restoreRow.className = 'butr-restore';
    const restoreCheckbox = document.createElement('input');
    restoreCheckbox.type = 'checkbox';
    // Hydrate from localStorage so the user's prior choice persists across
    // popovers (Task 4.11 amendment, 2026-04-26).
    restoreCheckbox.checked = readRestorePref();
    // Persist only on user-driven toggles. Programmatic .checked = ...
    // (such as the line above) doesn't dispatch 'change', so this listener
    // won't fire from our hydration step or any future hydration path.
    restoreCheckbox.addEventListener('change', () => {
      writeRestorePref(restoreCheckbox.checked);
    });
    restoreRow.append(
        restoreCheckbox,
        document.createTextNode('Restore removed tags on Cancel'));
    root.appendChild(restoreRow);

    const buttons = document.createElement('div');
    buttons.className = 'butr-buttons';
    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'butr-primary';
    submitBtn.textContent = 'Submit';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'butr-secondary';
    cancelBtn.textContent = 'Cancel';
    buttons.append(submitBtn, cancelBtn);
    root.appendChild(buttons);

    return {
      root, masterCheckbox, sectionsContainer, restoreCheckbox,
      submitBtn, cancelBtn,
    };
  }

  /**
   * Returns true when Danbooru is currently rendering in dark mode. Reads
   * the `data-current-user-theme` attribute on `<body>` — Danbooru sets it
   * to `dark` for the dark theme (and resolves auto-mode against the OS
   * preference for us, so we don't have to handle prefers-color-scheme).
   *
   * @return {boolean}
   */
  function isDarkMode() {
    return document.body?.getAttribute('data-current-user-theme') === 'dark';
  }

  /**
   * Mounts a fresh popover into the document body and positions it near the
   * Edit-tags Submit button. If one is already shown, it's torn down first.
   *
   * The popover is tagged with `data-butr-theme="dark"` when Danbooru is in
   * dark mode — that container-scoped attribute flips the GLOBAL_CSS
   * variables to dark values without affecting the rest of the page.
   *
   * Closing triggers (Esc, click outside, Cancel button) are wired up
   * automatically and all invoke `cancel()`. positionPopover() runs once
   * here on initial size; renderSections() reschedules it after the spinner
   * is replaced by candidate rows.
   */
  function showDialog() {
    if (dialogRefs) {
      hideDialog();
    }
    dialogRefs = buildDialog();
    if (isDarkMode()) {
      dialogRefs.root.setAttribute('data-butr-theme', 'dark');
    }
    document.body.appendChild(dialogRefs.root);
    closeAutocomplete();
    disableAnchorButton();
    positionPopover();
    attachClosingTriggers();

    // Move focus into the popover. When the user triggered submit via
    // Ctrl+Enter on the tag textarea, focus stayed there by default —
    // pressing "0" / "1"–"9" / "a"–"z" would then route the keystroke to
    // the textarea (isEditingText guard kicks in) instead of toggling a
    // checkbox. Putting focus on Submit makes the keyboard shortcuts work
    // out of the box and keeps Enter (without Ctrl) submitting too.
    // preventScroll avoids any viewport jump when the popover is far from
    // the previous focus location.
    dialogRefs.submitBtn.focus({preventScroll: true});
  }

  /**
   * Tears down the popover DOM and closing-trigger listeners, and
   * re-enables the original Edit-tags Submit button. Idempotent.
   */
  function hideDialog() {
    detachClosingTriggers();
    restoreAnchorButton();
    if (!dialogRefs) {
      return;
    }
    dialogRefs.root.remove();
    dialogRefs = null;
  }

  /**
   * Positions the popover near the Edit-tags Submit button:
   *   - default: just below the Submit button, left-aligned with it
   *   - if not enough room below: flip above
   *   - if right edge would overflow: shift left to fit
   *   - clamps to a small margin from each viewport edge
   *
   * If the anchor element is gone from the DOM (Edit-tags popup closed),
   * the popover is dismissed — there's nothing left to anchor to.
   */
  function positionPopover() {
    if (!dialogRefs) {
      return;
    }
    const popover = dialogRefs.root;

    const anchor = tagForm?.querySelector(
        'input[type="submit"], button[type="submit"]') ?? tagForm;
    if (!anchor || !document.body.contains(anchor)) {
      cancel();
      return;
    }

    const aRect = anchor.getBoundingClientRect();
    const pRect = popover.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Default: just below the anchor, left-aligned.
    let top = aRect.bottom + margin;
    let left = aRect.left;

    // Flip above if the popover would overflow the bottom edge.
    if (top + pRect.height > vh - margin) {
      top = aRect.top - pRect.height - margin;
    }

    // Clamp horizontally to viewport.
    if (left + pRect.width > vw - margin) {
      left = vw - pRect.width - margin;
    }
    if (left < margin) {
      left = margin;
    }

    // Clamp vertically (last-resort: small popover fits even when both edges
    // are tight; large popover gets cut from bottom rather than the top).
    if (top < margin) {
      top = margin;
    }

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }

  /**
   * Throttles positionPopover() to one call per animation frame — used by
   * the scroll/resize listeners which can fire dozens of events per frame.
   */
  function schedulePosition() {
    if (positionRaf !== null) {
      return;
    }
    positionRaf = requestAnimationFrame(() => {
      positionRaf = null;
      positionPopover();
    });
  }

  /**
   * Disables the Edit-tags Submit button so the user can't accidentally
   * double-click it while interacting with our popover. The reference is
   * stashed for symmetric restoration in restoreAnchorButton().
   */
  function disableAnchorButton() {
    anchorButton = /** @type {?(HTMLInputElement|HTMLButtonElement)} */ (
        tagForm?.querySelector('input[type="submit"], button[type="submit"]')
        ?? null);
    if (anchorButton) {
      anchorButton.disabled = true;
    }
  }

  /**
   * Re-enables the previously disabled Edit-tags Submit button. Idempotent.
   */
  function restoreAnchorButton() {
    if (anchorButton) {
      anchorButton.disabled = false;
      anchorButton = null;
    }
  }

  /**
   * Closes Danbooru's tag-autocomplete dropdown when our popover opens —
   * the autocomplete `<ul>` would otherwise overlap the popover (see
   * `autocomplete.js` — jQuery UI Autocomplete instance is attached to the
   * tag textarea). Uses the page's jQuery directly (`@grant none`, so we
   * share the page's main world). Silently no-ops when jQuery or the
   * autocomplete instance is unavailable — script must remain functional
   * in any future Danbooru variant that drops the dependency.
   */
  function closeAutocomplete() {
    try {
      const $ = /** @type {?Function} */ (window['$']);
      if (!$ || !tagInput) {
        return;
      }
      const $input = $(tagInput);
      // .autocomplete('instance') returns undefined when not initialized.
      if ($input.autocomplete && $input.autocomplete('instance')) {
        $input.autocomplete('close');
      }
    } catch (_) {
      // jQuery / autocomplete plugin missing — leave the menu alone.
    }
  }

  /**
   * Builds a small muted-text keyboard-shortcut indicator span. Used in the
   * master row ("0") and candidate rows ("1"–"9", "a"–"z", or empty
   * placeholder for the 36th+ candidate).
   *
   * @param {string} text
   * @return {!HTMLSpanElement}
   */
  function createKeyHint(text) {
    const hint = document.createElement('span');
    hint.className = 'butr-keyhint';
    hint.textContent = text;
    return hint;
  }

  /**
   * Maps a 0-based candidate row index to its keyboard-shortcut label.
   *   0–8   → "1"…"9"
   *   9–34  → "a"…"z"
   *   35+   → ""  (empty — click only; placeholder span keeps row alignment)
   *
   * @param {number} index
   * @return {string}
   */
  function candidateKeyHint(index) {
    if (index < 9) {
      return String(index + 1);
    }
    if (index < 35) {
      return String.fromCharCode(97 + (index - 9));
    }
    return '';
  }

  /**
   * Filters the BFS meta map down to candidates that will still be present
   * after submission (so removing them does something), then emits each
   * candidate into every section reachable from a different seed (Task 4.7
   * multi-parent visibility). Each section is sorted by `(depth desc, name
   * asc)` — more general parent at top, less general at bottom (BottomUp
   * visual).
   *
   * Same tag may appear in multiple sections with section-relative depth
   * (e.g. `dress` from `pinafore_dress` chain at depth 2, and from
   * `blue_dress` chain at depth 1).
   *
   * @param {!Map<string, {antecedents: !Set<string>, seedRootDepths: !Map<string, number>}>} meta
   * @param {!Set<string>} presentTokens  Post-submission token set (`finalTokens`).
   * @return {!Map<string, !Array<{tag: string, depth: number}>>}
   */
  function groupBySeedRoot(meta, presentTokens) {
    const groups = new Map();
    for (const [tag, info] of meta) {
      if (!presentTokens.has(tag)) {
        continue;
      }
      for (const [seedRoot, depth] of info.seedRootDepths) {
        if (!groups.has(seedRoot)) {
          groups.set(seedRoot, []);
        }
        groups.get(seedRoot).push({tag, depth});
      }
    }
    for (const arr of groups.values()) {
      arr.sort((a, b) => b.depth - a.depth || a.tag.localeCompare(b.tag));
    }
    return groups;
  }

  /**
   * Replaces the spinner with the candidate sections. Each section renders
   * its rows top-down by descending depth and indents rows whose depth is
   * lower (i.e. closer to the seed) so that the BottomUp visual matches an
   * implication tree — more general parents flush left, more specific
   * children indented one tab per depth step. Each section ends with a
   * "── from <seedRoot> ──" footer.
   *
   * Default check state: each row is checked unless its tag is in
   * `stillImplied` — those are pre-unchecked because some non-candidate
   * tag still in the input implies them, so the server would auto-re-add
   * them anyway. Wires `onCandidateChange` (cross-section sync + cascade
   * uncheck — Task 4.7) and the master-checkbox sync.
   *
   * @param {!Map<string, !Array<{tag: string, depth: number}>>} groups
   * @param {!Set<string>=} stillImplied  Tags to render with checkbox unchecked.
   */
  function renderSections(groups, stillImplied) {
    if (!dialogRefs) {
      return;
    }
    const implied = stillImplied ?? new Set();
    const container = dialogRefs.sectionsContainer;
    container.replaceChildren();

    // Global candidate index across all sections — matches the order
    // returned by getCandidateCheckboxes() (DOM order via querySelectorAll),
    // which is the order the keyboard shortcut handler indexes into.
    let candidateIndex = 0;
    for (const [seedRoot, rows] of groups) {
      const section = document.createElement('div');
      section.className = 'butr-section';

      // Per-section max depth → indent step is (maxDepth - depth). Top
      // (most general) rows sit flush against the keyhint column; each
      // step toward the seed pushes the checkbox + label one tab right.
      let sectionMaxDepth = 0;
      for (const {depth} of rows) {
        if (depth > sectionMaxDepth) sectionMaxDepth = depth;
      }

      for (const {tag, depth} of rows) {
        const row = document.createElement('label');
        row.className = 'butr-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !implied.has(tag);
        cb.dataset.butrTag = tag;
        cb.addEventListener('change', onCandidateChange);
        const indentLevel = sectionMaxDepth - depth;
        if (indentLevel > 0) {
          cb.style.marginLeft = `${indentLevel * 4}ch`;
        }
        row.append(
            createKeyHint(candidateKeyHint(candidateIndex)),
            cb,
            document.createTextNode(tag));
        section.appendChild(row);
        candidateIndex++;
      }

      const footer = document.createElement('div');
      footer.className = 'butr-section-footer';
      footer.textContent = `── from ${seedRoot} ──`;
      section.appendChild(footer);

      container.appendChild(section);
    }

    dialogRefs.masterCheckbox.addEventListener('change', applyMasterToChildren);
    updateMasterFromChildren();

    // Content size changed (spinner → rows). Reposition.
    schedulePosition();
  }

  /**
   * Returns the live NodeList of candidate (non-master) checkboxes.
   * @return {!NodeListOf<!HTMLInputElement>}
   */
  function getCandidateCheckboxes() {
    return dialogRefs?.sectionsContainer.querySelectorAll('input[data-butr-tag]')
        ?? /** @type {!NodeListOf<!HTMLInputElement>} */ ([]);
  }

  /**
   * Master-checkbox click handler — pushes its checked state to every
   * candidate checkbox. Clears any indeterminate state.
   */
  function applyMasterToChildren() {
    if (!dialogRefs) {
      return;
    }
    const master = dialogRefs.masterCheckbox;
    master.indeterminate = false;
    for (const cb of getCandidateCheckboxes()) {
      cb.checked = master.checked;
    }
  }

  /**
   * Recomputes the master checkbox state based on the current set of
   * candidate checkboxes. Indeterminate state is intentionally NOT used —
   * the master appears unchecked whenever any candidate is unchecked, so
   * its visual matches the simple semantic "all candidates queued for
   * deletion". A click on the master in this state then re-checks every
   * candidate (handled by applyMasterToChildren).
   */
  function updateMasterFromChildren() {
    if (!dialogRefs) {
      return;
    }
    const cbs = Array.from(getCandidateCheckboxes());
    if (cbs.length === 0) {
      return;
    }
    const allChecked = cbs.every(cb => cb.checked);
    const master = dialogRefs.masterCheckbox;
    master.indeterminate = false;
    master.checked = allChecked;
  }

  /**
   * Toggles the master "Delete all" checkbox and propagates to every
   * candidate. Mirrors a user click on the master row (Task 4.10 keyboard).
   */
  function toggleMasterCheckbox() {
    if (!dialogRefs) {
      return;
    }
    const master = dialogRefs.masterCheckbox;
    master.checked = !master.checked;
    applyMasterToChildren();
  }

  /**
   * Toggles the Nth candidate checkbox (0-indexed; rendered top-to-bottom
   * by `renderSections` — depth desc, name asc). Out-of-range indices are
   * a no-op. Dispatches a `change` event so `onCandidateChange` fires —
   * this preserves Task 4.7's cross-section sync and cascade-uncheck even
   * when the toggle came from a keyboard shortcut.
   *
   * @param {number} index  0-based row index.
   */
  function toggleCandidateAt(index) {
    if (!dialogRefs) {
      return;
    }
    const cbs = Array.from(getCandidateCheckboxes());
    const cb = cbs[index];
    if (!cb) {
      return;
    }
    cb.checked = !cb.checked;
    cb.dispatchEvent(new Event('change', {bubbles: true}));
  }

  /**
   * Capture-phase document keydown handler installed while the popover is
   * shown. Routes keys to the appropriate popover action:
   *
   *   Esc                    → cancel()
   *   Ctrl+Enter             → invokeSubmitHandler() (matches Edit-tags
   *                            shortcut convention — Danbooru uses Ctrl
   *                            on macOS too, NOT Cmd)
   *   0                      → toggleMasterCheckbox()
   *   1–9                    → toggleCandidateAt(N − 1)   (rows 1–9)
   *   a–z (Shift agnostic)   → toggleCandidateAt(9 + idx) (rows 10–35)
   *
   * Letter / digit shortcuts are guarded by `isEditingText()` (don't
   * capture digits the user is typing into the textarea) and by a
   * modifier check (don't capture Ctrl+1 / Cmd+a / Alt+x — leave browser
   * shortcuts intact). Esc and Ctrl+Enter ignore both guards so the user
   * can always confirm or dismiss.
   *
   * @param {KeyboardEvent} e
   */
  function onPopoverKeydown(e) {
    if (!dialogRefs) {
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }

    // Ctrl+Enter on all platforms (Danbooru convention — verified on macOS
    // 2026-04-26: Cmd+Enter is NOT mapped, only Ctrl+Enter). Matches
    // Danbooru's Edit-tags shortcut. stopImmediatePropagation prevents
    // Danbooru's keydown handler from also firing on the (now-disabled)
    // anchor button.
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      e.stopImmediatePropagation();
      invokeSubmitHandler();
      return;
    }

    if (isEditingText()) {
      return;
    }

    // Modifier-held keys belong to the browser / OS (Ctrl+1 switch tab,
    // Cmd+a select all, Alt+letter on Mac produces special chars, ...).
    // Shift is excluded from the guard because case-insensitive letter
    // matching naturally accepts Shift+a as `A` → lowercased.
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }

    if (e.key === '0') {
      e.preventDefault();
      toggleMasterCheckbox();
      return;
    }

    if (/^[1-9]$/.test(e.key)) {
      e.preventDefault();
      toggleCandidateAt(parseInt(e.key, 10) - 1);
      return;
    }

    // Letters a–z (and A–Z via Shift / Caps Lock) map to candidates 10–35.
    const lower = e.key.length === 1 ? e.key.toLowerCase() : '';
    if (lower >= 'a' && lower <= 'z') {
      e.preventDefault();
      toggleCandidateAt(9 + (lower.charCodeAt(0) - 97));
    }
  }

  /**
   * Returns true when the user is currently typing into a focused text
   * field — textarea, single-line input, or contentEditable element. Used
   * to gate digit-key shortcuts so they don't capture user input meant
   * for the textarea while the popover is shown.
   *
   * @return {boolean}
   */
  function isEditingText() {
    const ae = document.activeElement;
    if (!ae) {
      return false;
    }
    const tag = ae.tagName;
    return tag === 'TEXTAREA' || tag === 'INPUT' ||
        /** @type {!HTMLElement} */ (ae).isContentEditable;
  }

  /**
   * Builds the reverse implication index from the BFS meta map: for each
   * antecedent A, the set of candidates X for which A is a direct child
   * (i.e. A ∈ X.antecedents). The DFS in findAllParentTags walks this
   * index transitively — given a tag T, it finds every consequent that T
   * implies (directly or via chained implications) within the closure.
   *
   * @param {!Map<string, {antecedents: !Set<string>, seedRootDepths: !Map<string, number>}>} meta
   * @return {!Map<string, !Set<string>>}  childTag → set of consequents.
   */
  function buildChildToParents(meta) {
    /** @type {!Map<string, !Set<string>>} */
    const map = new Map();
    for (const [c, info] of meta) {
      for (const a of info.antecedents) {
        if (!map.has(a)) {
          map.set(a, new Set());
        }
        map.get(a).add(c);
      }
    }
    return map;
  }

  /**
   * DFS along the child→parents reverse index to collect every tag
   * transitively implied by `tag` within the BFS closure. The starting
   * tag is excluded from the result. A visited Set defends against any
   * cycle in the underlying implication graph.
   *
   * @param {string} tag
   * @param {!Map<string, !Set<string>>} childToParents
   * @return {!Set<string>}
   */
  function findAllParentTags(tag, childToParents) {
    /** @type {!Set<string>} */
    const found = new Set();
    const stack = [tag];
    while (stack.length > 0) {
      const cur = stack.pop();
      const parents = childToParents.get(cur);
      if (!parents) {
        continue;
      }
      for (const p of parents) {
        if (!found.has(p)) {
          found.add(p);
          stack.push(p);
        }
      }
    }
    return found;
  }

  /**
   * Change handler attached to every candidate checkbox. Layers two
   * UX behaviors on top of the master-state recompute (Task 4.7):
   *
   * (a) Cross-section sync — when the same tag appears in multiple seed
   *     sections (because BFS reached it from more than one seed chain),
   *     toggling one copy toggles every copy. Without this the user
   *     would have to find and toggle each instance separately, and the
   *     dialog could end up in a state that doesn't actually delete the
   *     tag (one section checked, another unchecked).
   *
   * (b) Cascade uncheck (uncheck direction only) — unchecking candidate
   *     T also unchecks every transitive parent of T, because if T
   *     stays in the post, the server will re-imply T's parents from
   *     T regardless of whether we tried to delete them. Asymmetric:
   *     re-checking does NOT cascade upward — the user must explicitly
   *     re-check parents they want re-included.
   *
   * Master-checkbox clicks bypass this handler entirely (they go to
   * applyMasterToChildren), so "Delete all" toggles every candidate
   * without cascading. Programmatic `cb.checked = ...` mutations don't
   * dispatch 'change', so the in-loop assignments below cannot recurse
   * into onCandidateChange — no extra reentrancy guard needed.
   *
   * @param {Event} ev
   */
  function onCandidateChange(ev) {
    const cb = /** @type {!HTMLInputElement} */ (ev.target);
    const tag = cb.dataset.butrTag;
    if (!tag) {
      return;
    }
    const newChecked = cb.checked;

    // (a) Cross-section sync: propagate to every other copy of `tag`.
    for (const otherCb of getCandidateCheckboxes()) {
      if (otherCb !== cb && otherCb.dataset.butrTag === tag) {
        otherCb.checked = newChecked;
      }
    }

    // (b) Cascade uncheck: only on the uncheck transition.
    if (!newChecked && currentChildToParents) {
      const parents = findAllParentTags(tag, currentChildToParents);
      if (parents.size > 0) {
        for (const otherCb of getCandidateCheckboxes()) {
          if (parents.has(otherCb.dataset.butrTag)) {
            otherCb.checked = false;
          }
        }
      }
    }

    updateMasterFromChildren();
  }

  /**
   * Replaces the dialog body with a "Failed to fetch tag implications.
   * Submit anyway?" message and switches the Submit button into "submit
   * without modification" mode. Used when upwardClosure or
   * findStillImpliedCandidates fails (network error, 4xx after retry).
   * The user can either Submit anyway (their input as-is) or Cancel.
   */
  function showFallbackDialog() {
    if (!dialogRefs) {
      showDialog();
      if (!dialogRefs) {
        return;
      }
    }
    const container = dialogRefs.sectionsContainer;
    container.replaceChildren();

    const msg = document.createElement('div');
    msg.className = 'butr-spinner-wrap';
    msg.style.fontStyle = 'normal';
    msg.textContent = 'Failed to fetch tag implications. Submit anyway?';
    container.appendChild(msg);

    dialogRefs.submitBtn.textContent = 'Submit anyway';
    submitHandler = submitWithoutModification;

    schedulePosition();
  }

  /**
   * Cancel routine — invoked by Esc, outside click, Cancel button, or
   * `positionPopover()` when the anchor disappears. Aborts any in-flight
   * BFS and hides the dialog. The user remains on the edit page; their
   * input is preserved (Pattern B1, PLAN §D1) — except when they have
   * opted into the "Restore removed tags on Cancel" toggle (Task 4.11),
   * in which case the original seed tags are restored (Pattern B2 —
   * `restoreSeedsToInput`).
   *
   * After teardown, focus is moved back to the tag textarea so the user
   * can resume editing without a click.
   */
  function cancel() {
    // Snapshot before hideDialog tears down dialogRefs / detachClosingTriggers
    // nulls currentRemoved.
    const shouldRestore = !!dialogRefs?.restoreCheckbox?.checked;
    const seedsToRestore = currentRemoved;
    const willRestore = shouldRestore && seedsToRestore !== null &&
        seedsToRestore.length > 0;

    if (abortCtrl) {
      abortCtrl.abort();
      abortCtrl = null;
    }
    hideDialog();
    isProcessing = false;

    if (willRestore && tagInput) {
      tagInput.value = restoreSeedsToInput(tagInput.value, seedsToRestore);
      // Browser behavior on programmatic `.value =` varies — some keep the
      // pre-existing caret offset, others jump to the end. Force the caret
      // to the very end (after the trailing space restoreSeedsToInput
      // emitted) so the user can start typing the next tag immediately.
      const len = tagInput.value.length;
      tagInput.setSelectionRange(len, len);
      // Same `input` event signal as applyAndSubmit — keeps Danbooru's
      // own derived UI (character counter, autocomplete) and our prefetch
      // listener in sync with the new value.
      tagInput.dispatchEvent(new Event('input', {bubbles: true}));
    }

    if (tagInput && document.body.contains(tagInput)) {
      tagInput.focus({preventScroll: true});
      if (willRestore) {
        // Scroll the textarea's own viewport to the bottom — the caret is
        // at the end of the value after restore, but the textarea keeps
        // its prior internal scroll position by default, leaving the
        // restored tags (and the caret) below the fold. Done after focus
        // so the browser's default focus behavior doesn't override us.
        tagInput.scrollTop = tagInput.scrollHeight;
      }
    }
  }

  /**
   * Wires Esc / outside-click / Cancel-button → `cancel()`, plus
   * scroll/resize → reposition. Called from showDialog().
   *
   * The outside-click listener uses `mousedown` (capture) and is attached
   * via setTimeout(0) so the click that triggered the popover (form
   * submit) doesn't immediately close it.
   */
  function attachClosingTriggers() {
    if (!dialogRefs) {
      return;
    }

    dialogRefs.cancelBtn.addEventListener('click', cancel);
    dialogRefs.submitBtn.addEventListener('click', invokeSubmitHandler);

    keydownListener = onPopoverKeydown;
    document.addEventListener('keydown', keydownListener, true);

    outsideClickListener = (e) => {
      if (!dialogRefs?.root.contains(/** @type {!Node} */ (e.target))) {
        cancel();
      }
    };
    setTimeout(() => {
      // Re-check because the dialog could have been closed in the same tick.
      if (dialogRefs && outsideClickListener) {
        document.addEventListener('mousedown', outsideClickListener, true);
      }
    }, 0);

    positionListener = schedulePosition;
    // Capture mode catches scroll events on any descendant (scroll doesn't
    // bubble in normal flow); also catches scrolls inside Danbooru's own
    // Edit-tags popup container.
    window.addEventListener('scroll', positionListener, true);
    window.addEventListener('resize', positionListener);
  }

  /**
   * Removes all listeners installed by attachClosingTriggers() and cancels
   * any pending rAF. The cancel-button click listener dies with the DOM.
   */
  function detachClosingTriggers() {
    if (keydownListener) {
      document.removeEventListener('keydown', keydownListener, true);
      keydownListener = null;
    }
    if (outsideClickListener) {
      document.removeEventListener('mousedown', outsideClickListener, true);
      outsideClickListener = null;
    }
    if (positionListener) {
      window.removeEventListener('scroll', positionListener, true);
      window.removeEventListener('resize', positionListener);
      positionListener = null;
    }
    if (positionRaf !== null) {
      cancelAnimationFrame(positionRaf);
      positionRaf = null;
    }
    submitHandler = null;
    currentChildToParents = null;
    currentRemoved = null;
  }

  /**
   * Click delegate for the popover's Submit button. Dispatches to whichever
   * handler is currently active (applyAndSubmit for normal flow, or
   * submitWithoutModification for the BFS-failure fallback).
   */
  function invokeSubmitHandler() {
    if (submitHandler) {
      submitHandler();
    }
  }

  // --- INIT / CLEANUP ---

  /**
   * Entry point. Resolves the tag input + enclosing form, then snapshots the
   * original tag tokens for later diff. Idempotent across re-runs (cleanup()
   * first).
   *
   * Silently exits when the page has no editable tag input (e.g. logged out,
   * unsupported variant). Subsequent re-inits will retry on turbo:load.
   */
  function init() {
    cleanup();
    initGeneration++;

    tagInput = document.querySelector(TAG_INPUT_SELECTOR);
    if (!tagInput) {
      return;
    }

    tagForm = tagInput.closest('form');
    if (!tagForm) {
      tagInput = null;
      return;
    }

    originalTags = tokenize(tagInput.value);
    prevInputLength = tagInput.value.length;

    tagForm.addEventListener('submit', handleSubmit, true);

    // Task 4.9: prefetch the popover plan whenever the textarea changes,
    // so handleSubmit can skip the spinner phase on cache hit. The listener
    // ref is kept for symmetric removal in cleanup().
    inputListener = onTextareaInput;
    tagInput.addEventListener('input', inputListener);
  }

  /**
   * Tear-down. Aborts in-flight BFS, removes listeners, hides any open dialog,
   * resets module state. Called on turbo:before-visit and at the start of
   * init() to ensure clean re-binding.
   */
  function cleanup() {
    if (abortCtrl) {
      abortCtrl.abort();
      abortCtrl = null;
    }
    cleanupPrefetch();

    if (tagInput && inputListener) {
      tagInput.removeEventListener('input', inputListener);
    }
    inputListener = null;

    if (tagForm) {
      tagForm.removeEventListener('submit', handleSubmit, true);
    }
    hideDialog();

    originalTags = null;
    tagInput = null;
    tagForm = null;
    isProcessing = false;
    prevInputLength = 0;
  }

  // --- PREFETCH (Task 4.9) ---

  /**
   * Builds a deterministic cache key from the current diff state. Two
   * textarea states with the same removed set AND same currentTokens
   * produce the same key — the smart-default outcome depends on both
   * (different stable tokens may shift the phantom-seed/still-implied
   * sets even with identical removed). Sorted joins ensure determinism
   * regardless of token insertion order.
   *
   * @param {!Array<string>} removed
   * @param {!Set<string>} currentTokens
   * @return {string}
   */
  function makeCacheKey(removed, currentTokens) {
    const r = [...removed].sort().join(' ');
    const c = [...currentTokens].sort().join(' ');
    return `${r}|${c}`;
  }

  /**
   * Aborts any in-flight prefetch, clears the debounce timer, and resets
   * the cache slots. Called from cleanup() on Turbo navigation and re-init.
   */
  function cleanupPrefetch() {
    if (prefetchCtrl) {
      prefetchCtrl.abort();
      prefetchCtrl = null;
    }
    if (prefetchDebounceTimer !== null) {
      clearTimeout(prefetchDebounceTimer);
      prefetchDebounceTimer = null;
    }
    prefetchKey = null;
    prefetchResult = null;
    prefetchPromise = null;
  }

  /**
   * `input` listener on the tag textarea. Routes to either an immediate
   * prefetch (multi-character change — block delete, paste, autocomplete
   * completion via `autocomplete.js:222`, Ctrl+Backspace word delete) or a
   * debounced prefetch (single-character typing/backspace). The length
   * delta is the only signal — `event.inputType` is unreliable here
   * because Danbooru's autocomplete fires synthetic jQuery events that
   * lack inputType.
   *
   * @param {Event} _ev
   */
  function onTextareaInput(_ev) {
    if (!tagInput) {
      return;
    }
    const newLength = tagInput.value.length;
    const delta = Math.abs(newLength - prevInputLength);
    prevInputLength = newLength;

    // Skip prefetch while we're already in a submission flow. applyAndSubmit
    // rewrites tagInput.value and dispatches a synthetic 'input' event so
    // Danbooru's own UI updates — but that's our own change, not a user
    // edit, and the form is about to submit anyway.
    if (isProcessing) {
      return;
    }

    if (prefetchDebounceTimer !== null) {
      clearTimeout(prefetchDebounceTimer);
      prefetchDebounceTimer = null;
    }

    if (delta > 1) {
      runPrefetch();
    } else {
      prefetchDebounceTimer = setTimeout(() => {
        prefetchDebounceTimer = null;
        runPrefetch();
      }, PREFETCH_DEBOUNCE_MS);
    }
  }

  /**
   * Computes the dialog plan for the current textarea state and caches it
   * for handleSubmit to consume. No-ops when the cache key already matches
   * the current state (we already have a result or one is in flight). On a
   * stale cache miss, aborts the previous prefetch before starting fresh.
   *
   * Errors are swallowed (with a console warning) and recorded as
   * `{status: 'error'}` so handleSubmit treats them as cache misses and
   * falls back to its native flow.
   */
  function runPrefetch() {
    if (!tagInput) {
      return;
    }

    const removed = computeRemoved(tagInput.value);
    const currentValue = tagInput.value;
    const currentTokens = tokenize(currentValue);
    const newKey = makeCacheKey(removed, currentTokens);

    // Already cached / in-flight for this exact state.
    if (newKey === prefetchKey) {
      return;
    }

    // Invalidate any previous in-flight prefetch — its result wouldn't match
    // the current state anyway.
    if (prefetchCtrl) {
      prefetchCtrl.abort();
      prefetchCtrl = null;
    }

    const ctrl = new AbortController();
    const myGen = initGeneration;
    prefetchCtrl = ctrl;
    prefetchKey = newKey;
    prefetchResult = null;
    prefetchPromise = null;

    // Trivial bypass — no API calls needed when the user hasn't removed
    // anything. computeDialogPlan would do the same, but short-circuiting
    // here avoids creating a Promise just to resolve immediately.
    if (removed.length === 0) {
      prefetchResult = {status: 'bypass', filteredGroups: null, meta: null};
      prefetchCtrl = null;
      return;
    }

    prefetchPromise = (async () => {
      try {
        const plan = await computeDialogPlan(removed, currentValue, ctrl.signal);
        // Discard if invalidated mid-flight (cleanup ran, or a newer
        // prefetch superseded us).
        if (ctrl.signal.aborted || myGen !== initGeneration ||
            prefetchCtrl !== ctrl) {
          return;
        }
        prefetchResult = {
          status: plan.status,
          filteredGroups: plan.filteredGroups,
          meta: plan.meta,
        };
      } catch (err) {
        if (err && err.name === 'AbortError') {
          return;
        }
        console.warn('[BUTR] prefetch failed:', err);
        if (prefetchCtrl === ctrl && myGen === initGeneration) {
          prefetchResult = {status: 'error', filteredGroups: null, meta: null};
        }
      } finally {
        if (prefetchCtrl === ctrl) {
          prefetchCtrl = null;
          prefetchPromise = null;
        }
      }
    })();
  }

  // --- SUBMIT HANDLER ---

  /**
   * Form submit handler (capture phase). Decides whether to intercept the
   * submission and show our confirmation popover, or let the form proceed
   * naturally.
   *
   * Bypass cases (no preventDefault, native flow continues — Turbo / Rails
   * UJS handlers downstream still receive the event):
   *   - bypassNextSubmit flag set (we triggered this submit ourselves via
   *     requestSubmit after the user accepted the popover)
   *   - tagInput / tagForm not bound (script silently inactive on this page)
   *   - removed.length === 0 (user added or did nothing — nothing to ask about)
   *
   * Intercept cases (preventDefault + stopImmediatePropagation, popover
   * shown):
   *   - removed tags detected and we haven't already entered the flow
   *
   * Re-entry guard: if isProcessing is already true, the click is ignored
   * (stops the second click from spawning a duplicate flow). Cancellation
   * is via the popover's Esc / outside click / Cancel button — all of
   * which clear isProcessing.
   *
   * Re-entry prevention pattern (revised from Task 1.4, 2026-04-25):
   *   When the user accepts the popover, applyAndSubmit() rewrites the
   *   textarea and calls submitFormViaNativeFlow(), which sets
   *   bypassNextSubmit=true and triggers form.requestSubmit(). The submit
   *   event fires again, this handler sees the bypass flag, clears it,
   *   and returns without preventDefault — letting Turbo / Rails UJS
   *   handle the actual submission. This preserves Danbooru's normal
   *   AJAX flow instead of forcing a full-page reload (which the older
   *   form.submit() approach would have caused).
   *
   * @param {Event} event
   */
  function handleSubmit(event) {
    if (bypassNextSubmit) {
      bypassNextSubmit = false;
      return;
    }

    if (isProcessing) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    if (!tagInput || !tagForm) {
      return;
    }

    const removed = computeRemoved(tagInput.value);
    if (removed.length === 0) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    // Task 4.9: try the prefetch cache before falling back to the native
    // flow. The current key recomputed here MUST match the key under which
    // the prefetch was stored — otherwise the textarea moved on after the
    // prefetch was started and the cached result is stale.
    const currentTokens = tokenize(tagInput.value);
    const currentKey = makeCacheKey(removed, currentTokens);

    // Fast bypass — popover never shows, so no cancel restore is possible.
    // Skipping currentRemoved bookkeeping here keeps the bypass path zero-
    // overhead (no module state to clean up if the user never sees the
    // popover).
    if (prefetchKey === currentKey && prefetchResult &&
        prefetchResult.status === 'bypass') {
      submitFormViaNativeFlow();
      return;
    }

    // Every remaining branch mounts the popover. Stash the seed list so
    // cancel() can restore it if the user has opted into "Restore removed
    // tags on Cancel" (Task 4.11). detachClosingTriggers (which fires from
    // hideDialog) clears this when the popover closes.
    currentRemoved = removed;

    if (prefetchKey === currentKey && prefetchResult &&
        prefetchResult.status === 'render') {
      // Skip the spinner phase — render the popover synchronously.
      isProcessing = true;
      abortCtrl = new AbortController();
      showDialog();
      currentChildToParents = buildChildToParents(prefetchResult.meta);
      renderSections(prefetchResult.filteredGroups);
      submitHandler = applyAndSubmit;
      return;
    }

    if (prefetchKey === currentKey && prefetchPromise && !prefetchResult) {
      // In flight — show the spinner and wait. We attach to the same
      // promise rather than starting fresh so we don't duplicate API work.
      isProcessing = true;
      abortCtrl = new AbortController();
      showDialog();
      prefetchPromise.then(() => onPrefetchSettled(removed, currentKey));
      return;
    }

    // Cache miss / stale / errored — original flow.
    isProcessing = true;
    abortCtrl = new AbortController();
    showDialog();

    runDialogFlow(removed).catch((err) => {
      if (err && err.name === 'AbortError') {
        return;
      }
      console.error('[BUTR] dialog flow failed:', err);
      showFallbackDialog();
    });
  }

  /**
   * Continuation called when handleSubmit was awaiting an in-flight
   * prefetch. Re-checks invariants: the user might have hit Esc / clicked
   * outside (cleared isProcessing/dialogRefs), or made a fresh edit that
   * invalidated `expectedKey`. In both cases we bail or fall back.
   *
   * @param {!Array<string>} removed
   * @param {string} expectedKey  The key handleSubmit observed on entry.
   */
  function onPrefetchSettled(removed, expectedKey) {
    if (!isProcessing || !dialogRefs) {
      return;
    }

    if (prefetchKey !== expectedKey) {
      // A newer edit superseded the prefetch we were waiting for. Run a
      // fresh fetch for the current state — uses the existing dialog
      // (spinner already shown) and continues into renderSections /
      // submitWithoutModification just like a cache miss.
      runDialogFlow(removed).catch((err) => {
        if (err && err.name === 'AbortError') {
          return;
        }
        console.error('[BUTR] dialog flow failed:', err);
        showFallbackDialog();
      });
      return;
    }

    if (prefetchResult && prefetchResult.status === 'bypass') {
      hideDialog();
      isProcessing = false;
      submitFormViaNativeFlow();
    } else if (prefetchResult && prefetchResult.status === 'render') {
      currentChildToParents = buildChildToParents(prefetchResult.meta);
      renderSections(prefetchResult.filteredGroups);
      submitHandler = applyAndSubmit;
    } else {
      // Errored — fall back to fresh fetch.
      runDialogFlow(removed).catch((err) => {
        if (err && err.name === 'AbortError') {
          return;
        }
        console.error('[BUTR] dialog flow failed:', err);
        showFallbackDialog();
      });
    }
  }

  /**
   * Pure async computation shared by the live submit flow (`runDialogFlow`)
   * and the prefetch path (`runPrefetch`, Task 4.9). Runs BFS → group →
   * Policy B+ filter and returns a plan describing what the popover should
   * do, with no DOM side-effects. Throws AbortError if the signal aborts
   * between steps; transient HTTP errors propagate up to the caller.
   *
   * @param {!Array<string>} removed
   * @param {string} currentValue  tagInput.value snapshot at planning time.
   * @param {!AbortSignal} signal
   * @return {!Promise<{
   *   status: ('bypass'|'render'),
   *   filteredGroups: ?Map<string, !Array<{tag: string, depth: number}>>,
   *   meta: ?Map<string, {antecedents: !Set<string>, seedRootDepths: !Map<string, number>}>,
   * }>}
   */
  async function computeDialogPlan(removed, currentValue, signal) {
    if (removed.length === 0) {
      return {status: 'bypass', filteredGroups: null, meta: null};
    }

    const meta = await upwardClosure(removed, signal);
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    // Use post-submission tag set (finalTokens) so candidate filtering and
    // Policy B+ stable tokens reflect what the server will actually see.
    // Critical for `-tag` syntax: without this, a seed being negated would
    // remain in the "stable" set and prop up its implied parents as phantom.
    const final = finalTokens(tokenize(currentValue));
    const groups = groupBySeedRoot(meta, final);

    if (groups.size === 0) {
      return {status: 'bypass', filteredGroups: null, meta};
    }

    // Same tag may appear in multiple sections after Task 4.7 multi-parent
    // emit; dedupe by tag identity for the smart-default lookup, which
    // operates on tag strings, not (tag, section) pairs.
    const candidatesArr = [...new Set(
        [...groups.values()].flat().map((x) => x.tag))];
    const candidatesSet = new Set(candidatesArr);
    const stableTokens = new Set(
        [...final].filter((t) => !candidatesSet.has(t)));

    // Policy B+ (Task 4.8): identify phantom seeds and still-implied
    // candidates via fixed-point iteration on the antecedent graph. Phantom
    // seeds will be re-implied by stable tokens and thus survive
    // submission; still-implied candidates will likewise be re-implied (by
    // a stable token, by a phantom seed, or by a phantom candidate's
    // restoration). Both are futile to delete, so we exclude them from
    // the popover before rendering.
    const {phantomSeeds, stillImplied} = await findStillImpliedTargets(
        removed, candidatesArr, stableTokens, signal);
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    // Drop phantom seed sections entirely; from each remaining section,
    // drop rows whose tag is still-implied; drop sections that become
    // empty as a result.
    /** @type {!Map<string, !Array<{tag: string, depth: number}>>} */
    const filteredGroups = new Map();
    for (const [seedRoot, rows] of groups) {
      if (phantomSeeds.has(seedRoot)) {
        continue;
      }
      const remaining = rows.filter((r) => !stillImplied.has(r.tag));
      if (remaining.length > 0) {
        filteredGroups.set(seedRoot, remaining);
      }
    }

    // If every candidate is futile to delete, the popover would only ask
    // the user to confirm doing nothing. Bypass and proceed with the user's
    // input as-is — the server will reconcile implications and the only
    // tags that actually leave are the seeds whose chain isn't propped up
    // by any stable token.
    if (filteredGroups.size === 0) {
      return {status: 'bypass', filteredGroups: null, meta};
    }

    return {status: 'render', filteredGroups, meta};
  }

  /**
   * Async orchestration after Submit when no usable prefetch is available:
   * computes the dialog plan, then either bypasses or renders sections.
   * Bails out via signal.aborted between steps so that user cancellation
   * during a long fetch stops cleanly without rendering stale results.
   *
   * @param {!Array<string>} removed
   * @return {!Promise<void>}
   */
  async function runDialogFlow(removed) {
    const signal = abortCtrl.signal;
    const plan = await computeDialogPlan(removed, tagInput.value, signal);
    if (signal.aborted) {
      return;
    }

    if (plan.status === 'bypass') {
      submitWithoutModification();
      return;
    }

    currentChildToParents = buildChildToParents(plan.meta);
    renderSections(plan.filteredGroups);
    submitHandler = applyAndSubmit;
  }

  /**
   * Popover's Submit-button handler for the normal flow. Removes every
   * checked candidate from the tag input (preserving the surrounding
   * whitespace where possible), tears down the popover, and re-submits
   * the form via the native flow (Turbo / Rails UJS).
   */
  function applyAndSubmit() {
    if (!tagInput || !tagForm) {
      return;
    }

    const toRemove = new Set();
    for (const cb of getCandidateCheckboxes()) {
      if (cb.checked) {
        toRemove.add(cb.dataset.butrTag);
      }
    }

    if (toRemove.size > 0) {
      tagInput.value = removeTagsFromInput(tagInput.value, toRemove);
      // Some Danbooru widgets listen for 'input' to update derived UI
      // (character counters, etc.) — replicate the user-typing signal.
      tagInput.dispatchEvent(new Event('input', {bubbles: true}));
    }

    hideDialog();
    isProcessing = false;
    submitFormViaNativeFlow();
  }

  /**
   * Popover's Submit-button handler for the BFS-failure fallback (and the
   * "no actionable candidates" bypass path). Submits the user's input
   * exactly as typed — the script does not modify the textarea.
   */
  function submitWithoutModification() {
    hideDialog();
    isProcessing = false;
    submitFormViaNativeFlow();
  }

  /**
   * Re-submits the tag form through the native event flow so that
   * Danbooru's Turbo / Rails UJS listeners handle the request (avoiding
   * the full-page reload that form.submit() would force).
   *
   * Sets `bypassNextSubmit` so our own capture handler skips on the
   * resulting event. Falls back to form.submit() on the rare browser
   * that lacks form.requestSubmit (Safari < 16); in that case the bypass
   * flag is cleared because no submit event is dispatched.
   */
  function submitFormViaNativeFlow() {
    if (!tagForm) {
      return;
    }
    if (typeof tagForm.requestSubmit === 'function') {
      bypassNextSubmit = true;
      tagForm.requestSubmit();
      bypassNextSubmit = false;
    } else {
      bypassNextSubmit = false;
      tagForm.submit();
    }
  }

  /**
   * Removes the given tags (case-insensitive) from a tag-string while
   * preserving the surrounding whitespace structure. For each removed
   * token, exactly one adjacent whitespace run is also removed so the
   * result doesn't accumulate double-spaces or stranded line breaks.
   *
   * Heuristic when both sides have whitespace: prefer eating the run
   * WITHOUT a newline (i.e. eat the intra-line space, keep the line
   * break). This preserves the user's line structure when removing a
   * mid-line tag — e.g. removing `idolmaster_shiny_colors` from a line
   * `idolmaster idolmaster_shiny_colors` followed by a newline leaves
   * `idolmaster\n…`, not `idolmaster …` joined into the next line.
   *
   * @param {string} input
   * @param {!Set<string>} toRemove  Lowercase tag tokens to remove.
   * @return {string}
   */
  function removeTagsFromInput(input, toRemove) {
    const parts = input.split(/(\s+)/);
    const skip = new Set();
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p || /^\s+$/.test(p)) {
        continue;
      }
      if (!toRemove.has(p.toLowerCase())) {
        continue;
      }

      skip.add(i);

      const hasTrailing =
          i + 1 < parts.length && /^\s+$/.test(parts[i + 1]);
      const hasLeading =
          i - 1 >= 0 && /^\s+$/.test(parts[i - 1]) && !skip.has(i - 1);

      if (hasTrailing && hasLeading) {
        // Both sides; prefer eating the run that lacks a newline.
        const leadingHasNewline = /\n/.test(parts[i - 1]);
        const trailingHasNewline = /\n/.test(parts[i + 1]);
        if (leadingHasNewline && !trailingHasNewline) {
          skip.add(i + 1);
        } else if (trailingHasNewline && !leadingHasNewline) {
          skip.add(i - 1);
        } else {
          // Both newline or both space — pick trailing arbitrarily.
          skip.add(i + 1);
        }
      } else if (hasTrailing) {
        skip.add(i + 1);
      } else if (hasLeading) {
        skip.add(i - 1);
      }
    }
    return parts.filter((_, idx) => !skip.has(idx)).join('');
  }

  /**
   * Restores seed tags into the textarea — used by the optional
   * "Restore removed tags on Cancel" toggle (Task 4.11). Each seed is
   * classified by what removal style currently represents it in the
   * input:
   *
   *   • Implicit deletion (seed not in current tokens): append the seed
   *     at the end of the input, with a leading space when needed so it
   *     doesn't fuse to the preceding token.
   *   • `-tag` syntax (seed AND `-seed` both in current tokens): the
   *     server interprets `-seed` as "remove this tag", so dropping the
   *     `-seed` directive restores the tag effectively. Reuses
   *     `removeTagsFromInput` for whitespace-preserving deletion.
   *   • Already restored manually (seed in current, no `-seed`): no-op,
   *     keeping the operation idempotent.
   *
   * @param {string} input
   * @param {!Array<string>} seeds  Lowercase tag tokens originally removed.
   * @return {string}
   */
  function restoreSeedsToInput(input, seeds) {
    const current = tokenize(input);
    /** @type {!Set<string>} */
    const minusToRemove = new Set();
    /** @type {!Array<string>} */
    const toAppend = [];
    for (const seed of seeds) {
      if (current.has(seed) && current.has('-' + seed)) {
        minusToRemove.add('-' + seed);
      } else if (!current.has(seed)) {
        toAppend.push(seed);
      }
      // Else: seed is already present without a -tag directive (user
      // manually restored or never actually removed). No-op.
    }

    const modified = minusToRemove.size > 0 || toAppend.length > 0;
    let result = input;
    if (minusToRemove.size > 0) {
      result = removeTagsFromInput(result, minusToRemove);
    }
    if (toAppend.length > 0) {
      if (result.length > 0 && !/\s$/.test(result)) {
        result += ' ';
      }
      result += toAppend.join(' ');
    }
    // Ensure a single trailing space when we actually changed the input,
    // so the cursor lands ready for the next tag — without this the user
    // would have to manually press space before typing the next token.
    // No-op when the input was idempotent (nothing to restore) or already
    // whitespace-terminated.
    if (modified && result.length > 0 && !/\s$/.test(result)) {
      result += ' ';
    }
    return result;
  }

  /**
   * Reads the persisted "Restore removed tags on Cancel" preference
   * (Task 4.11). Falls back to false (default behavior, B1) when the
   * pref is unset, holds anything other than `'1'`, or when localStorage
   * itself is unavailable (private mode, disabled storage, etc).
   *
   * @return {boolean}
   */
  function readRestorePref() {
    try {
      return localStorage.getItem(STORAGE_KEY_RESTORE_ON_CANCEL) === '1';
    } catch (_) {
      return false;
    }
  }

  /**
   * Persists the "Restore removed tags on Cancel" preference. Stores `'1'`
   * when enabled, removes the key when disabled (so the storage stays
   * clean between toggles). Silently no-ops if localStorage is unavailable
   * — the preference then lives only for the current popover.
   *
   * @param {boolean} value
   */
  function writeRestorePref(value) {
    try {
      if (value) {
        localStorage.setItem(STORAGE_KEY_RESTORE_ON_CANCEL, '1');
      } else {
        localStorage.removeItem(STORAGE_KEY_RESTORE_ON_CANCEL);
      }
    } catch (_) {
      // localStorage unavailable; preference stays in-memory.
    }
  }

  // --- ENTRY POINTS ---

  injectStyles();
  document.addEventListener('turbo:before-visit', cleanup);
  document.addEventListener('turbo:load', init);

  // Initial execution (direct page load without Turbo navigation).
  init();

  // Debug exposure (Phase 3-4 dev). Opt-in via `localStorage.butr_debug = '1'`
  // (set once in DevTools console; persists across reloads). To disable:
  // `delete localStorage.butr_debug`. Commented out for release; re-enable
  // by uncommenting this block when running future debug sessions.
  // try {
  //   if (localStorage.getItem('butr_debug') === '1') {
  //     window.BUTR = {
  //       // BFS / API
  //       upwardClosure, fetchAllImplications, findStillImpliedTargets,
  //       computeSeedRootDepths,
  //       // Dialog
  //       showDialog, hideDialog, renderSections, groupBySeedRoot,
  //       computeDialogPlan,
  //       // Cascade (Task 4.7)
  //       buildChildToParents, findAllParentTags, onCandidateChange,
  //       // Prefetch (Task 4.9)
  //       runPrefetch, makeCacheKey,
  //       get prefetchKey() { return prefetchKey; },
  //       get prefetchResult() { return prefetchResult; },
  //       // Keyboard / autocomplete (Task 4.10)
  //       toggleMasterCheckbox, toggleCandidateAt, closeAutocomplete,
  //       // Cancel UX (Task 4.11)
  //       restoreSeedsToInput, readRestorePref, writeRestorePref,
  //       get currentRemoved() { return currentRemoved; },
  //       // Utilities
  //       tokenize, computeRemoved,
  //     };
  //     console.log('[BUTR] debug exposure enabled (window.BUTR)');
  //   }
  // } catch (_) {
  //   // localStorage unavailable; skip silently.
  // }
})();
