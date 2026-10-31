// ==UserScript==
// @name         Danbooru Personal Favorite Pages
// @namespace    https://github.com/AkaringoP
// @version      0.3.0
// @description  Save frequently used Danbooru pages per account, with memos, a custom order and quick navigation.
// @author       AkaringoP
// @license      MIT
// @match        *://danbooru.donmai.us/*
// @icon         https://danbooru.donmai.us/favicon.ico
// @updateURL    https://github.com/AkaringoP/JavaScripts/raw/refs/heads/feature/personal-favorite-pages/PersonalFavoritePages/PersonalFavoritePages.user.js
// @downloadURL  https://github.com/AkaringoP/JavaScripts/raw/refs/heads/feature/personal-favorite-pages/PersonalFavoritePages/PersonalFavoritePages.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // ==========================================================================
  // === Constants ============================================================
  // ==========================================================================

  const LOG_PREFIX = '[PFP]';
  const SITE_HOST = 'danbooru.donmai.us';
  const SITE_ORIGIN = `https://${SITE_HOST}`;
  /** Virtual list page, rendered over Danbooru's 404 page (PLAN D5). */
  const LIST_PATH = '/favorite_pages';

  const DB_NAME = 'PersonalFavoritePagesDB';
  // The IndexedDB version doubles as the record schema version (PLAN D1-5).
  const DB_VERSION = 1;
  const STORE_PAGES = 'pages';
  const STORE_SETTINGS = 'settings';
  const SETTINGS_KEY = 'global';

  const TITLE_MAX = 200;
  const MEMO_MAX = 2000;
  /** Gap between neighbouring sortOrder values (PLAN D8). */
  const SORT_STEP = 1000;
  /** Tombstones older than this are purged (PLAN D1-6). */
  const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  const DEFAULT_SETTINGS = Object.freeze({
    hotkeySave: Object.freeze({code: 'KeyB', shiftKey: true}),
    hotkeyList: Object.freeze({code: 'KeyL', shiftKey: true}),
    defaultSort: 'custom',
    // Ignored by the custom order, which has a single direction (PLAN D8).
    defaultSortDir: 'desc',
  });

  // --- Save-scope rules (PLAN D13, Resolved 11) -----------------------------
  // Removed from every saved URL. api_key / login authenticate a request on
  // their own (session_loader.rb), so keeping them would leak the key through
  // Share exports. commit=Search is noise added by every search form's
  // submit button, and z=1/2/5 only records where a search was started from
  // (tag list links, search box); the server ignores it (Resolved 26).
  const STRIPPED_PARAMS = new Set(['api_key', 'login', 'commit', 'z']);
  // URLs carrying these are one-time links and are refused outright.
  const TOKEN_PARAMS = Object.freeze(['email_verification_key']);
  // Post links opened from a search keep the search as ?q=...; dropping it
  // gives one canonical URL per post (Resolved 15).
  const POST_DETAIL_PATTERN = /^\/posts\/\d+$/;
  const DATA_EXTENSION_PATTERN = /\.(?:json|xml|atom)$/;
  const ACCOUNT_SUBPAGES =
      'email|password|totp|backup_codes|api_keys|change_name';
  // Form pages that stay savable: the upload page and the message composer,
  // often kept with a prefilled query such as ?url= or ?dmail[to_name]=
  // (Resolved 19).
  const SAVABLE_FORM_PATTERN = /^\/(?:uploads|dmails)\/new$/;
  // Matched against the pathname with any data extension removed, so the
  // .json form of a denied page is denied too.
  const DENY_RULES = Object.freeze([
    {reason: 'token', pattern: /^\/password_reset(?:\/|$)/},
    {reason: 'auth', pattern: /^\/(?:login|logout|session)(?:\/|$)/},
    {
      reason: 'account',
      pattern: new RegExp(`^/users/\\d+/(?:${ACCOUNT_SUBPAGES})(?:/|$)`),
    },
    {reason: 'account', pattern: /^\/(?:api_keys|password)(?:\/|$)/},
    {reason: 'account', pattern: /^\/users\/(?:\d+\/)?deactivate$/},
    // Writing and editing forms: Rails' new / edit routes plus the personal
    // settings page (Resolved 17), except the two that work as tools.
    {reason: 'form', pattern: /\/(?:new|edit)$/, except: SAVABLE_FORM_PATTERN},
    {reason: 'form', pattern: /^\/settings$/},
    {reason: 'self', pattern: new RegExp(`^${LIST_PATH}/?$`)},
  ]);
  // body[data-action] values of Danbooru's static error pages (Resolved 15).
  const ERROR_ACTIONS = new Set(['not-found', 'error']);
  // body[data-action] values of a form page. create / update show up when a
  // failed submit re-renders the form at the collection URL (Resolved 17).
  const FORM_ACTIONS = new Set(['new', 'edit', 'create', 'update']);

  /** User-facing text for every rejection reason. */
  const REJECT_MESSAGES = Object.freeze({
    invalid: 'Not a valid URL.',
    external: 'Only danbooru.donmai.us pages can be saved.',
    token: 'This page carries a one-time token.',
    auth: 'Login and logout pages are not saved.',
    account: 'Account security pages are not saved.',
    form: 'Writing and editing forms are not saved.',
    self: 'This is the Favorite Pages list itself.',
    errorPage: 'This is an error page.',
    notHtml: 'Open Favorite Pages and use Add URL to save API addresses.',
    loggedOut: 'Log in to use Favorite Pages.',
  });

  // Page types (PLAN D3, Resolved 24). Danbooru's API help: an index (list)
  // is a plural collection path without an id, a show (single record) adds
  // the id, and searches go in search[...] parameters.
  /** Single records; first match wins. */
  const ITEM_TYPES = Object.freeze([
    ['post', /^\/posts\/\d+$/],
    ['pool', /^\/pools\/\d+$/],
    ['wiki', /^\/wiki_pages\/[^/]+$/],
    ['artist', /^\/artists\/\d+$/],
    ['forum', /^\/forum_(?:topics|posts)\/\d+$/],
    ['user', /^\/(?:users\/\d+|profile)$/],
    ['comment', /^\/comments\/\d+$/],
  ]);
  /** The post search, kept apart from other lists as the most saved one. */
  const POST_SEARCH_PATTERN = /^\/(?:posts)?$/;
  /** Index routes end in a plural collection name. */
  const PLURAL_PATH_PATTERN = /\/[a-z_]+s$/;
  /** Lists whose collection name is not plural. */
  const SINGULAR_LIST_PATHS = new Set(['/pools/gallery', '/modqueue']);
  /** Plural-looking paths that are not lists. */
  const NOT_LIST_PATTERN = /^\/(?:static\/|statistics$)/;

  const TITLE_SUFFIX_PATTERN = /\s*\|\s*Danbooru\s*$/;

  // Characters that must stay percent-encoded when a URL part is shown
  // decoded, because they would change how the text parses back.
  const PATH_KEEP_ENCODED = /[/?#%\s]/g;
  const QUERY_KEEP_ENCODED = /[&=#+%\s]/g;

  const STYLE_ID = 'pfp-style';
  const LIST_CLOAK_ID = 'pfp-list-cloak';
  // Injected at document-start on LIST_PATH only: hides the 404 page's own
  // content (heading, random post image) until the list replaces it, so it
  // never flashes. Keyed to Danbooru's 404 container, so it hides nothing if
  // the route ever becomes a real Danbooru page (Resolved 25).
  const LIST_CLOAK_CSS =
      '#a-not-found:not(.pfp-ready) > * { display: none; }';
  const DIALOG_ID = 'pfp-dialog';
  const TOAST_ID = 'pfp-toast';
  const TOAST_MS = 1500;
  const TOAST_ERROR_MS = 3000;
  /** Pause after typing before an edited URL is checked against the list. */
  const URL_CHECK_DELAY_MS = 150;

  // Colours always come from Danbooru's semantic variables (PLAN D5), so the
  // UI follows the light / dark / auto themes without detection code. Only
  // layout tokens live here. Never put backticks inside this literal.
  const GLOBAL_CSS = `
    :root {
      --pfp-radius: 4px;
      --pfp-gap: 8px;
      --pfp-z-overlay: 10000;
    }

    /* Save dialog. Only ever on a Danbooru HTML page: no fallbacks. */
    .pfp-overlay {
      position: fixed;
      inset: 0;
      z-index: var(--pfp-z-overlay);
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 16px;
      padding-top: min(12vh, 96px);
      overflow-y: auto;
      /* Washes the page out like Danbooru's own dialog overlay. */
      background: color-mix(
        in srgb, var(--body-background-color) 50%, transparent);
    }

    .pfp-dialog {
      display: flex;
      flex-direction: column;
      gap: var(--pfp-gap);
      box-sizing: border-box;
      width: min(480px, 100%);
      max-height: calc(100vh - min(12vh, 96px) - 16px);
      max-height: calc(100dvh - min(12vh, 96px) - 16px);
      margin: 0;
      padding: 16px;
      overflow-y: auto;
      border: 1px solid var(--default-border-color);
      border-radius: var(--pfp-radius);
      background: var(--card-background-color);
      color: var(--text-color);
      box-shadow: var(--shadow-lg);
    }

    .pfp-dialog-heading {
      margin: 0;
      color: var(--header-color);
      font-size: 1.15em;
      font-weight: bold;
      line-height: 1.3;
    }

    .pfp-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0;
    }

    .pfp-field-label {
      font-size: 0.85em;
      font-weight: bold;
    }

    .pfp-dialog input[type="text"],
    .pfp-dialog textarea {
      box-sizing: border-box;
      width: 100%;
      margin: 0;
    }

    .pfp-dialog textarea {
      resize: vertical;
    }

    .pfp-dialog input[aria-invalid="true"] {
      border-color: var(--form-input-validation-error-border-color);
    }

    .pfp-url-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .pfp-dialog .pfp-url-row input[type="text"] {
      flex: 1 1 0%;
      min-width: 0;
    }

    /* Fixed URL: wraps instead of scrolling, still selectable. */
    .pfp-url-text {
      flex: 1 1 0%;
      min-width: 0;
      color: var(--muted-text-color);
      overflow-wrap: anywhere;
      user-select: text;
    }

    .pfp-chip {
      flex: none;
      padding: 0 0.6em;
      border: 1px solid var(--chip-blue-border-color);
      border-radius: 999px;
      background: var(--chip-blue-background-color);
      color: var(--text-color);
      font-size: 0.8em;
      line-height: 1.6;
      white-space: nowrap;
    }

    .pfp-field-error,
    .pfp-form-error {
      margin: 0;
      color: var(--error-color);
      font-size: 0.85em;
      overflow-wrap: anywhere;
    }

    .pfp-dialog [hidden] {
      display: none !important;
    }

    .pfp-dialog-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: var(--pfp-gap);
      margin-top: var(--pfp-gap);
    }

    .pfp-dialog .pfp-dialog-buttons button {
      margin: 0;
    }

    /* Danbooru already draws a global :focus-visible ring; this scoped copy
       keeps it from being out-cascaded by form-level button rules. */
    .pfp-dialog :focus-visible {
      outline: 2px solid var(--focus-ring-color);
      outline-offset: -2px;
    }

    /* Toast. Also shown on JSON documents, where Danbooru's stylesheet and
       variables are absent, so every colour has a system-colour fallback. */
    .pfp-toast {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: calc(var(--pfp-z-overlay) + 1);
      box-sizing: border-box;
      max-width: min(360px, calc(100vw - 32px));
      margin: 0;
      padding: 8px 12px;
      border: 1px solid var(--default-border-color, GrayText);
      border-radius: var(--pfp-radius);
      background: var(--card-background-color, Canvas);
      color: var(--text-color, CanvasText);
      box-shadow: var(
        --shadow-lg,
        0 4px 12px color-mix(in srgb, CanvasText 25%, transparent));
      font-family: var(--body-font, system-ui, sans-serif);
      font-size: 14px;
      line-height: 1.4;
      overflow-wrap: anywhere;
      cursor: pointer;
    }

    .pfp-toast-error {
      border-color: var(--error-color, ActiveText);
      background: var(--error-background-color, Canvas);
      color: var(--error-color, ActiveText);
    }

    @media (prefers-reduced-motion: no-preference) {
      .pfp-toast {
        animation: pfp-toast-in 160ms ease-out;
      }

      @keyframes pfp-toast-in {
        from {
          opacity: 0;
          transform: translateY(-8px);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }

      /* Row moves: neighbours slide aside, the lifted row follows the
         pointer without lag, then slides into its gap when released. */
      .pfp-table-sorting .pfp-row {
        transition: transform 150ms ease;
      }

      .pfp-table-sorting .pfp-row.pfp-row-dragging {
        transition: none;
      }

      .pfp-table-sorting .pfp-row.pfp-row-settling {
        transition: transform 150ms ease;
      }
    }

    /* List page. It sits inside Danbooru's 404 page, so button, select,
       input, a, h1 and table.striped keep Danbooru's look; these rules add
       layout only. Rules are scoped under .pfp-page so Danbooru's form
       rules cannot out-cascade them. */
    .pfp-page h1 {
      margin: 0 0 4px;
    }

    .pfp-page .pfp-page-owner,
    .pfp-page .pfp-summary {
      margin: 0 0 var(--pfp-gap);
      color: var(--muted-text-color);
      font-size: 0.85em;
    }

    .pfp-page .pfp-page-message,
    .pfp-list .pfp-page-message {
      margin: var(--pfp-gap) 0;
      color: var(--muted-text-color);
    }

    .pfp-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--pfp-gap);
      margin: 0 0 var(--pfp-gap);
    }

    .pfp-page .pfp-sort,
    .pfp-page .pfp-sort-dir,
    .pfp-page .pfp-filter,
    .pfp-page .pfp-add-url {
      box-sizing: border-box;
      margin: 0;
    }

    .pfp-page .pfp-filter {
      flex: 1 1 12em;
      min-width: 12em;
    }

    .pfp-page .pfp-add-url {
      margin-left: auto;
    }

    .pfp-table {
      width: 100%;
    }

    .pfp-table.striped th,
    .pfp-table.striped td {
      vertical-align: middle;
    }

    .pfp-table .pfp-col-handle,
    .pfp-table .pfp-col-actions {
      width: 1%;
      white-space: nowrap;
    }

    .pfp-table .pfp-col-type,
    .pfp-table .pfp-col-added {
      white-space: nowrap;
    }

    .pfp-table .pfp-col-title,
    .pfp-table .pfp-col-memo {
      overflow-wrap: anywhere;
    }

    /* Memo keeps its newlines and shows at most 3 lines. The clamp is on
       the inner span: a table cell loses its table layout under
       -webkit-box, and line-clamp is ignored on table cells. */
    .pfp-table td.pfp-col-memo {
      white-space: pre-wrap;
    }

    .pfp-table .pfp-memo-text {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      overflow: hidden;
    }

    .pfp-table .pfp-col-added {
      color: var(--muted-text-color);
    }

    /* The internal link goes on its own line under the title. */
    .pfp-table .pfp-row-url {
      display: block;
      color: var(--muted-text-color);
      font-size: 0.85em;
      overflow-wrap: anywhere;
    }

    /* Icons are drawn with currentColor; Danbooru's global button style
       would otherwise leave them as empty grey pills. */
    .pfp-page .pfp-icon {
      display: block;
      width: 18px;
      height: 18px;
      flex: none;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .pfp-page .pfp-icon-grip {
      fill: currentColor;
      stroke: none;
    }

    .pfp-page .pfp-handle,
    .pfp-page .pfp-icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: var(--pfp-radius);
      background: transparent;
      box-shadow: none;
      font: inherit;
      line-height: 1;
      vertical-align: middle;
    }

    .pfp-page .pfp-handle:hover,
    .pfp-page .pfp-handle:active,
    .pfp-page .pfp-icon-button:hover,
    .pfp-page .pfp-icon-button:active {
      background: transparent;
      box-shadow: none;
    }

    .pfp-page .pfp-handle {
      min-width: 44px;
      min-height: 44px;
      color: var(--muted-text-color);
      cursor: grab;
      touch-action: none;
    }

    .pfp-table-draggable .pfp-row-dragging .pfp-handle {
      cursor: grabbing;
    }

    .pfp-page .pfp-icon-button {
      min-width: 32px;
      min-height: 32px;
      color: var(--link-color);
      cursor: pointer;
    }

    .pfp-page .pfp-icon-button:hover {
      color: var(--link-hover-color);
    }

    .pfp-page .pfp-icon-button.pfp-remove:hover {
      color: var(--error-color);
    }

    .pfp-page .pfp-handle:focus-visible,
    .pfp-page .pfp-icon-button:focus-visible {
      outline: 2px solid var(--focus-ring-color);
      outline-offset: -2px;
    }

    .pfp-table-sorting .pfp-row {
      will-change: transform;
    }

    /* The lifted row. Beats Danbooru's row stripe and hover rules by
       specificity. */
    .pfp-table.striped .pfp-row.pfp-row-dragging {
      position: relative;
      z-index: 1;
      background: var(--table-row-hover-background);
      box-shadow: var(--shadow-lg);
      user-select: none;
    }

    /* Danbooru's mobile breakpoint. */
    @media (max-width: 660px) {
      .pfp-dialog .pfp-dialog-buttons button {
        flex: 1 1 auto;
        box-sizing: border-box;
        min-height: 44px;
      }

      .pfp-toast {
        left: 16px;
        right: 16px;
        max-width: none;
      }

      .pfp-page .pfp-filter {
        flex-basis: 100%;
      }

      .pfp-table .pfp-col-added {
        display: none;
      }

      .pfp-table .pfp-memo-text {
        -webkit-line-clamp: 2;
      }

      .pfp-page .pfp-handle {
        min-width: 44px;
        min-height: 44px;
      }

      .pfp-page .pfp-icon-button {
        min-width: 44px;
        min-height: 44px;
      }
    }
  `;

  // ==========================================================================
  // === Storage (IndexedDB, PLAN D1) =========================================
  // ==========================================================================
  // Every public function takes the account id explicitly and reads through
  // a per-user index, so no code path can see another account's records
  // (PLAN D2-3). Deletions are tombstones (deletedAt) so they can travel
  // through Sync exports (PLAN D1-6, Resolved 9).

  /** @type {?Promise<!IDBDatabase>} */
  let dbPromise = null;

  /**
   * Opens the database once per page and reuses the connection.
   * @return {!Promise<!IDBDatabase>}
   */
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_PAGES)) {
          const pages = db.createObjectStore(STORE_PAGES, {keyPath: 'id'});
          pages.createIndex('by_user', 'userId');
          pages.createIndex('by_user_url', ['userId', 'url'], {unique: true});
          pages.createIndex('by_user_created', ['userId', 'createdAt']);
          pages.createIndex('by_user_order', ['userId', 'sortOrder']);
        }
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS, {keyPath: 'key'});
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // A newer version of the script is upgrading the schema in another
        // tab: let go so that tab is not blocked.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        db.onclose = () => {
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
      request.onblocked = () => {
        console.warn(LOG_PREFIX, 'database upgrade blocked by another tab');
      };
    });
    return dbPromise;
  }

  /**
   * @param {!IDBRequest} request
   * @return {!Promise<*>} Settles with the request's result or error.
   */
  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Runs `work` in a single transaction and resolves with its return value
   * once the transaction has committed. If `work` throws, the transaction is
   * aborted so partial writes roll back. `work` may await IndexedDB requests
   * but nothing else, or the transaction auto-commits early.
   * @param {string} storeName
   * @param {string} mode 'readonly' or 'readwrite'.
   * @param {function(!IDBObjectStore): *} work
   * @return {!Promise<*>}
   */
  async function withStore(storeName, mode, work) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      let result;
      let failed = false;
      tx.oncomplete = () => {
        if (!failed) resolve(result);
      };
      tx.onabort = () => {
        if (!failed) reject(tx.error || new Error('transaction aborted'));
      };
      Promise.resolve()
          .then(() => work(tx.objectStore(storeName)))
          .then((value) => {
            result = value;
          }, (err) => {
            failed = true;
            try {
              tx.abort();
            } catch (abortErr) {
              // Already finished; nothing left to roll back.
            }
            reject(err);
          });
    });
  }

  /** @return {string} A random record id, stable across devices. */
  function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  /**
   * @param {!Object} record
   * @return {boolean} Whether the record is not a tombstone.
   */
  function isActive(record) {
    return record.deletedAt === null;
  }

  /**
   * @param {!IDBObjectStore} store
   * @param {number} userId
   * @return {!Promise<!Array<!Object>>} All records of the account.
   */
  function getAllForUser(store, userId) {
    return requestToPromise(
        store.index('by_user').getAll(IDBKeyRange.only(userId)));
  }

  /**
   * @param {!IDBObjectStore} store
   * @param {number} userId
   * @param {string} url
   * @return {!Promise<?Object>} The record saved under `url`, tombstone or not.
   */
  async function getRecordByUrl(store, userId, url) {
    const record = await requestToPromise(
        store.index('by_user_url').get([userId, url]));
    return record || null;
  }

  /**
   * The sortOrder that puts an entry above everything else (PLAN D8: new
   * entries go to the top, Resolved 7).
   * @param {!IDBObjectStore} store
   * @param {number} userId
   * @return {!Promise<number>}
   */
  async function topSortOrder(store, userId) {
    const range = IDBKeyRange.bound([userId, -Infinity], [userId, Infinity]);
    const cursor = await requestToPromise(
        store.index('by_user_order').openCursor(range));
    return cursor ? cursor.value.sortOrder - SORT_STEP : 0;
  }

  /**
   * Validates a URL through the single save gate (PLAN D13).
   * @param {string} url
   * @return {string} The sanitized URL.
   */
  function requireSavableUrl(url) {
    const checked = sanitizeUrl(url);
    if (!checked.ok) throw new Error(`url rejected: ${checked.reason}`);
    return checked.url;
  }

  /**
   * @param {number} userId
   * @return {!Promise<!Array<!Object>>} Active pages, in no particular order.
   */
  function listPages(userId) {
    return withStore(STORE_PAGES, 'readonly', async (store) =>
      (await getAllForUser(store, userId)).filter(isActive));
  }

  /**
   * Every record including tombstones, for Sync export and import (D10).
   * @param {number} userId
   * @return {!Promise<!Array<!Object>>}
   */
  function listAllRecords(userId) {
    return withStore(
        STORE_PAGES, 'readonly', (store) => getAllForUser(store, userId));
  }

  /**
   * @param {number} userId
   * @param {string} url A sanitized URL.
   * @return {!Promise<?Object>} The active page saved under `url`, or null.
   */
  function getPageByUrl(userId, url) {
    return withStore(STORE_PAGES, 'readonly', async (store) => {
      const record = await getRecordByUrl(store, userId, url);
      return record && isActive(record) ? record : null;
    });
  }

  /**
   * @param {number} userId
   * @return {!Promise<number>} Number of active pages.
   */
  async function countPages(userId) {
    return (await listPages(userId)).length;
  }

  /**
   * Saves `url` for the account. Creates a record, revives the URL's
   * tombstone (keeping its id so other devices merge it), or, when another
   * tab saved the same URL first, updates that record instead of failing on
   * the unique index. New and revived entries go to the top (Resolved 7).
   * @param {number} userId
   * @param {{url: string, title: string, memo: (string|undefined)}} fields
   * @return {!Promise<!Object>} The stored record.
   */
  async function savePage(userId, {url, title, memo = ''}) {
    const cleanUrl = requireSavableUrl(url);
    const now = Date.now();
    const values = {
      url: cleanUrl,
      title: clampText(title, TITLE_MAX) || fallbackTitle(cleanUrl),
      memo: clampText(memo, MEMO_MAX),
      type: classify(cleanUrl),
    };
    return withStore(STORE_PAGES, 'readwrite', async (store) => {
      const existing = await getRecordByUrl(store, userId, cleanUrl);
      let record;
      if (existing && isActive(existing)) {
        record = {...existing, ...values, updatedAt: now};
      } else {
        const placement = {
          sortOrder: await topSortOrder(store, userId),
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        record = existing ?
            {...existing, ...values, ...placement} :
            {id: newId(), userId, ...values, ...placement};
      }
      await requestToPromise(store.put(record));
      return record;
    });
  }

  /**
   * Edits an active page. A new URL goes through the save gate; if another
   * active page already uses it the edit is refused, and if a tombstone holds
   * it the tombstone is dropped so the unique index stays satisfied.
   * @param {number} userId
   * @param {string} id
   * @param {{url: (string|undefined), title: (string|undefined),
   *     memo: (string|undefined)}} changes
   * @return {!Promise<!Object>} The stored record.
   */
  async function updatePage(userId, id, changes) {
    const newUrl =
        changes.url === undefined ? null : requireSavableUrl(changes.url);
    return withStore(STORE_PAGES, 'readwrite', async (store) => {
      const record = await requestToPromise(store.get(id));
      if (!record || record.userId !== userId || !isActive(record)) {
        throw new Error('page not found');
      }
      const next = {...record, updatedAt: Date.now()};
      if (newUrl !== null && newUrl !== record.url) {
        const holder = await getRecordByUrl(store, userId, newUrl);
        if (holder && isActive(holder)) throw new Error('url already saved');
        if (holder) await requestToPromise(store.delete(holder.id));
        next.url = newUrl;
        next.type = classify(newUrl);
      }
      if (changes.title !== undefined) {
        next.title = clampText(changes.title, TITLE_MAX) ||
            fallbackTitle(next.url);
      }
      if (changes.memo !== undefined) {
        next.memo = clampText(changes.memo, MEMO_MAX);
      }
      await requestToPromise(store.put(next));
      return next;
    });
  }

  /**
   * Deletes a page by turning it into a tombstone (PLAN D1-6).
   * @param {number} userId
   * @param {string} id
   * @return {!Promise<void>}
   */
  function deletePage(userId, id) {
    return withStore(STORE_PAGES, 'readwrite', async (store) => {
      const record = await requestToPromise(store.get(id));
      if (!record || record.userId !== userId || !isActive(record)) return;
      const now = Date.now();
      await requestToPromise(
          store.put({...record, deletedAt: now, updatedAt: now}));
    });
  }

  /**
   * Hard-deletes tombstones older than `olderThanMs`.
   * @param {number} userId
   * @param {number=} olderThanMs
   * @return {!Promise<number>} How many tombstones were removed.
   */
  function purgeTombstones(userId, olderThanMs = TOMBSTONE_TTL_MS) {
    const cutoff = Date.now() - olderThanMs;
    return withStore(STORE_PAGES, 'readwrite', async (store) => {
      const expired = (await getAllForUser(store, userId)).filter(
          (record) => !isActive(record) && record.deletedAt <= cutoff);
      await Promise.all(
          expired.map((record) => requestToPromise(store.delete(record.id))));
      return expired.length;
    });
  }

  /**
   * Moves one page in the custom order (PLAN D8-4).
   * @param {number} userId
   * @param {string} id
   * @param {number} sortOrder
   * @return {!Promise<!Object>} The stored record.
   */
  function reorderPage(userId, id, sortOrder) {
    return withStore(STORE_PAGES, 'readwrite', async (store) => {
      const record = await requestToPromise(store.get(id));
      if (!record || record.userId !== userId || !isActive(record)) {
        throw new Error('page not found');
      }
      const next = {...record, sortOrder, updatedAt: Date.now()};
      await requestToPromise(store.put(next));
      return next;
    });
  }

  /**
   * Re-spaces the custom order SORT_STEP apart once midpoint inserts run out
   * of room (PLAN D8-4). Every moved record gets a new updatedAt so the order
   * wins in a later Sync merge.
   * @param {number} userId
   * @return {!Promise<!Array<!Object>>} Active pages in their new order.
   */
  function renumberAll(userId) {
    return withStore(STORE_PAGES, 'readwrite', async (store) => {
      const now = Date.now();
      const ordered = (await getAllForUser(store, userId))
          .filter(isActive)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((record, i) => ({
            ...record,
            sortOrder: i * SORT_STEP,
            updatedAt: now,
          }));
      await Promise.all(
          ordered.map((record) => requestToPromise(store.put(record))));
      return ordered;
    });
  }

  /**
   * Settings are per browser, not per account (PLAN D1-3).
   * @return {!Promise<!Object>} Stored settings over the defaults.
   */
  async function getSettings() {
    const row = await withStore(STORE_SETTINGS, 'readonly', (store) =>
      requestToPromise(store.get(SETTINGS_KEY)));
    return {...DEFAULT_SETTINGS, ...(row ? row.value : {})};
  }

  /**
   * @param {!Object} partial Settings to change.
   * @return {!Promise<!Object>} The full stored settings.
   */
  function saveSettings(partial) {
    return withStore(STORE_SETTINGS, 'readwrite', async (store) => {
      const row = await requestToPromise(store.get(SETTINGS_KEY));
      const value = {
        ...DEFAULT_SETTINGS,
        ...(row ? row.value : {}),
        ...partial,
      };
      await requestToPromise(store.put({key: SETTINGS_KEY, value}));
      return value;
    });
  }

  // ==========================================================================
  // === Model (PLAN D2, D3, D13) =============================================
  // ==========================================================================

  /**
   * Result of the save gate: `url` is set when ok, otherwise `reason` holds a
   * REJECT_MESSAGES key.
   * @typedef {{
   *   ok: boolean,
   *   url: (string|undefined),
   *   reason: (string|undefined),
   * }} UrlCheck
   */

  /**
   * Reads the logged-in account from Danbooru's body attributes. Logged-out
   * pages carry the string "null" (Resolved 1, 15).
   * @return {?{id: number, name: string}}
   */
  function getCurrentUser() {
    const data = document.body ? document.body.dataset : null;
    const id = Number(data && data.currentUserId);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    return {id, name: data.currentUserName || ''};
  }

  /**
   * The single gate every saved URL passes through (PLAN D13): same-site
   * check, deny rules, and clean-up into one canonical form. Query strings
   * are always re-serialized so equal searches compare equal.
   * @param {*} input An absolute URL or a site-relative path.
   * @return {!UrlCheck}
   */
  function sanitizeUrl(input) {
    const text = String(input == null ? '' : input).trim();
    if (!text) return {ok: false, reason: 'invalid'};
    let url;
    try {
      url = new URL(text, SITE_ORIGIN);
    } catch (err) {
      return {ok: false, reason: 'invalid'};
    }
    if (url.protocol === 'http:' && url.host === SITE_HOST) {
      url.protocol = 'https:';
    }
    if (url.origin !== SITE_ORIGIN) return {ok: false, reason: 'external'};
    if (TOKEN_PARAMS.some((name) => url.searchParams.has(name))) {
      return {ok: false, reason: 'token'};
    }
    // One canonical path for '/wiki_pages/help:home' and
    // '/wiki_pages/help%3Ahome' (the setter re-encodes what it must).
    url.pathname = decodeReadable(url.pathname, PATH_KEEP_ENCODED);
    const path = url.pathname.replace(DATA_EXTENSION_PATTERN, '');
    const rule = DENY_RULES.find(({pattern, except}) =>
      pattern.test(path) && !(except && except.test(path)));
    if (rule) return {ok: false, reason: rule.reason};

    const isPostDetail = POST_DETAIL_PATTERN.test(url.pathname);
    const kept = [...url.searchParams].filter(([name, value]) =>
      !STRIPPED_PARAMS.has(name) &&
      !(isPostDetail && name === 'q') &&
      !(name.startsWith('search[') && value.trim() === ''));
    url.search = new URLSearchParams(kept).toString();
    url.hash = '';
    url.username = '';
    url.password = '';
    return {ok: true, url: url.href};
  }

  /**
   * Decodes percent-escapes so a URL part reads naturally, except the
   * characters in `keepEncoded`.
   * @param {string} text
   * @param {!RegExp} keepEncoded A global character-class pattern.
   * @return {string}
   */
  function decodeReadable(text, keepEncoded) {
    return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
      try {
        return decodeURIComponent(run)
            .replace(keepEncoded, (char) => encodeURIComponent(char));
      } catch (err) {
        return run;  // Not valid UTF-8: leave it as it was.
      }
    });
  }

  /**
   * The site-relative "internal link" form of a saved URL, as shown in the
   * UI (e.g. /posts?tags=user:AkaringoP). Feeding it back to sanitizeUrl
   * gives the same saved URL.
   * @param {string} url An absolute same-site URL.
   * @return {string}
   */
  function toSitePath(url) {
    const {pathname, search} = new URL(url, SITE_ORIGIN);
    return decodeReadable(pathname, PATH_KEEP_ENCODED) +
        decodeReadable(search, QUERY_KEEP_ENCODED);
  }

  /**
   * Whether the page being viewed can be saved, and its URL if so. Adds the
   * checks that only make sense for an open page (PLAN D13-5).
   * @return {!UrlCheck}
   */
  function checkCurrentPage() {
    // JSON / XML documents have no Danbooru body attributes, so the account
    // cannot be confirmed there (PLAN D13). Tampermonkey on Whale does run
    // on them (measured), so this reason does reach the user.
    if (!isHtmlDocument()) {
      return {ok: false, reason: 'notHtml'};
    }
    if (!getCurrentUser()) return {ok: false, reason: 'loggedOut'};
    const checked = sanitizeUrl(location.href);
    if (!checked.ok) return checked;
    const {controller, action} = document.body.dataset;
    if (controller === 'static' && ERROR_ACTIONS.has(action)) {
      return {ok: false, reason: 'errorPage'};
    }
    if (FORM_ACTIONS.has(action) &&
        !SAVABLE_FORM_PATTERN.test(new URL(checked.url).pathname)) {
      return {ok: false, reason: 'form'};
    }
    return checked;
  }

  /**
   * Type of a saved URL: 'api', a single-record type (ITEM_TYPES),
   * 'post-search', 'list' (search results and other index pages) or
   * 'other' (PLAN D3, Resolved 24).
   * @param {string} url An absolute or site-relative URL.
   * @return {string}
   */
  function classify(url) {
    const {pathname, searchParams} = new URL(url, SITE_ORIGIN);
    if (DATA_EXTENSION_PATTERN.test(pathname)) return 'api';
    const path = pathname.replace(/\/+$/, '') || '/';
    const item = ITEM_TYPES.find(([, pattern]) => pattern.test(path));
    if (item) return item[0];
    if (POST_SEARCH_PATTERN.test(path)) return 'post-search';
    const hasSearch =
        [...searchParams.keys()].some((name) => name.startsWith('search['));
    const isIndex = SINGULAR_LIST_PATHS.has(path) ||
        (PLURAL_PATH_PATTERN.test(path) && !NOT_LIST_PATTERN.test(path));
    return hasSearch || isIndex ? 'list' : 'other';
  }

  /**
   * Trims and cuts text to `max` characters without splitting surrogate
   * pairs.
   * @param {*} value
   * @param {number} max
   * @return {string}
   */
  function clampText(value, max) {
    const chars = Array.from(String(value == null ? '' : value).trim());
    return chars.slice(0, max).join('');
  }

  /**
   * Readable title built from the URL itself, for pages without a usable
   * document title (Add URL, API addresses).
   * @param {string} url
   * @return {string}
   */
  function fallbackTitle(url) {
    const {pathname, search} = new URL(url, SITE_ORIGIN);
    const decode = (text) => {
      try {
        return decodeURIComponent(text);
      } catch (err) {
        return text;
      }
    };
    return clampText(
        decode(pathname) + decode(search.replace(/\+/g, ' ')), TITLE_MAX);
  }

  /**
   * Title of the open page without Danbooru's " | Danbooru" suffix
   * (Resolved 15).
   * @param {string} url The page's sanitized URL, used as the fallback.
   * @return {string}
   */
  function extractTitle(url) {
    const title = clampText(
        document.title.replace(TITLE_SUFFIX_PATTERN, ''), TITLE_MAX);
    return title && !/^https?:\/\//.test(title) ? title : fallbackTitle(url);
  }

  /**
   * The page's own search form: a GET form from Danbooru's search_form_for
   * with a submit button, whose action is this page. That skips the subnav
   * quick search, which has no submit button (Resolved 15, 16).
   * @return {?HTMLFormElement}
   */
  function findSearchForm() {
    return [...document.querySelectorAll('form.search-form')].find(
        (form) => form.method.toLowerCase() === 'get' &&
            form.querySelector('[type="submit"]') !== null &&
            new URL(form.action, SITE_ORIGIN).pathname === location.pathname) ||
        null;
  }

  /**
   * The main condition of a search page: the first text field of its search
   * form (Name, Tag, Tags, ...) that has a value. Read from the saved URL,
   * not the field, so an edited but unsubmitted field cannot leak in.
   * @param {string} url The page's sanitized URL.
   * @return {string} Empty when there is no such form or value.
   */
  function searchSummary(url) {
    const form = findSearchForm();
    if (!form) return '';
    const params = new URL(url).searchParams;
    const fields = form.querySelectorAll(
        'input[type="text"][name], input[type="search"][name]');
    for (const field of fields) {
      const value = (params.get(field.name) || '').trim();
      if (value) return value;
    }
    return '';
  }

  /**
   * Suggested title for the open page: its document title, plus the main
   * search condition on search pages, so the same page saved with other
   * conditions stays distinguishable, e.g. "Related tags | user:AkaringoP"
   * (Resolved 23).
   * @param {string} url The page's sanitized URL.
   * @return {string}
   */
  function suggestTitle(url) {
    const base = extractTitle(url);
    const summary = searchSummary(url);
    if (!summary || base.toLowerCase().includes(summary.toLowerCase())) {
      return base;
    }
    return clampText(`${base} | ${summary}`, TITLE_MAX);
  }

  // ==========================================================================
  // === UI primitives ========================================================
  // ==========================================================================

  /** @return {boolean} False on JSON / XML responses (PLAN D13). */
  function isHtmlDocument() {
    return document.contentType.includes('html');
  }

  /**
   * @param {string} id
   * @param {string} css
   */
  function injectStyles(id, css) {
    if (document.getElementById(id)) return;
    // At document-start even <html> may not exist yet in some managers.
    const parent = document.head || document.documentElement;
    if (!parent) {
      document.addEventListener(
          'DOMContentLoaded', () => injectStyles(id, css), {once: true});
      return;
    }
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    parent.appendChild(style);
  }

  function ensureStyles() {
    injectStyles(STYLE_ID, GLOBAL_CSS);
  }

  /**
   * Builds an element without innerHTML, so saved titles and memos (which
   * may come from another user's file, PLAN D10) always render as text.
   * @param {string} tag
   * @param {!Object=} props `className`, `text`, `on<event>` listeners, or
   *     attributes (true sets an empty attribute; false and null are skipped).
   * @param {!Array<?(!Node|string)>=} children Null entries are skipped.
   * @return {!HTMLElement}
   */
  function makeElement(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === false || value == null) continue;
      if (key === 'className') {
        node.className = value;
      } else if (key === 'text') {
        node.textContent = value;
      } else if (key.startsWith('on')) {
        node.addEventListener(key.slice(2), value);
      } else {
        node.setAttribute(key, value === true ? '' : String(value));
      }
    }
    node.append(...children.filter((child) => child != null));
    return node;
  }

  /** @return {boolean} Whether the viewer asked the OS for less motion. */
  function prefersReducedMotion() {
    return Boolean(window.matchMedia) &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** @return {boolean} Whether a dialog or popover of ours is open. */
  function isOverlayOpen() {
    return document.querySelector('.pfp-overlay') !== null;
  }

  /**
   * Keeps Tab inside `container` while a modal is open.
   * @param {!KeyboardEvent} event
   * @param {!Element} container
   */
  function trapFocus(event, container) {
    const focusable = [...container.querySelectorAll('input, textarea, button')]
        .filter((node) => !node.disabled);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  let toastTimer = 0;

  /**
   * Shows a short message at the top right; a new one replaces the last.
   * Works on JSON documents too, where Danbooru's styles are absent.
   * @param {string} message
   * @param {{error: (boolean|undefined)}=} options
   */
  function showToast(message, {error = false} = {}) {
    ensureStyles();
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = makeElement('div', {
        'id': TOAST_ID,
        'className': 'pfp-toast',
        'role': 'status',
        'aria-live': 'polite',
        'onclick': hideToast,
      });
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.toggle('pfp-toast-error', error);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, error ? TOAST_ERROR_MS : TOAST_MS);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    const toast = document.getElementById(TOAST_ID);
    if (toast) toast.remove();
  }

  /**
   * @param {*} err A storage error.
   * @return {string} What to tell the user about it.
   */
  function describeError(err) {
    const message = String((err && err.message) || '');
    const rejected = /^url rejected: (\w+)$/.exec(message);
    if (rejected) return REJECT_MESSAGES[rejected[1]] || message;
    if (message === 'url already saved') {
      return 'Another saved page already uses this URL.';
    }
    if (message === 'page not found') return 'This page was already removed.';
    if (err && err.name === 'QuotaExceededError') {
      return 'Browser storage is full.';
    }
    return 'Could not access browser storage.';
  }

  // ==========================================================================
  // === Save dialog (PLAN D4) ================================================
  // ==========================================================================

  /** Set while a dialog is being prepared, so a double press opens one. */
  let saveDialogPending = false;
  /** @type {?function()} Tears down the open save dialog. */
  let activeDialogClose = null;

  function closeSaveDialog() {
    if (activeDialogClose) activeDialogClose();
  }

  /**
   * Opens the save dialog for `url`: edit mode when the account already has
   * it, otherwise a new entry. The URL is fixed by default, because every
   * entry point (hotkey, buttons, menus) is about one specific page; only the
   * list page's Add URL and edit actions pass `editable` (Resolved 20). An
   * empty `url` with `editable` gives the Add URL form (D5).
   * @param {{url: (string|undefined), title: (string|undefined),
   *     editable: (boolean|undefined)}=} options `url` must already be
   *     sanitized; `title` is the suggested title.
   * @return {!Promise<void>}
   */
  async function openSaveDialog({url = '', title = '', editable = false} = {}) {
    const user = getCurrentUser();
    if (!user || saveDialogPending || isOverlayOpen()) return;
    if (!url && !editable) return;
    saveDialogPending = true;
    try {
      const existing = url ? await getPageByUrl(user.id, url) : null;
      if (!isOverlayOpen()) {
        renderSaveDialog(user, {url, title, existing, editable});
      }
    } catch (err) {
      console.error(LOG_PREFIX, err);
      showToast(describeError(err), {error: true});
    } finally {
      saveDialogPending = false;
    }
  }

  /**
   * @param {string} tag 'label' around a form control, 'div' around text.
   * @param {string} label
   * @param {...?Node} controls
   * @return {!HTMLElement}
   */
  function makeField(tag, label, ...controls) {
    return makeElement(tag, {className: 'pfp-field'}, [
      makeElement('span', {className: 'pfp-field-label', text: label}),
      ...controls,
    ]);
  }

  /**
   * Builds and shows the dialog. Buttons follow Danbooru's order: primary,
   * then Remove, then Cancel.
   * @param {{id: number}} user
   * @param {{url: string, title: string, existing: ?Object,
   *     editable: boolean}} options
   */
  function renderSaveDialog(user, {url, title, existing, editable}) {
    ensureStyles();
    const isEdit = existing !== null;
    const returnFocus = document.activeElement;

    const titleInput = makeElement('input', {
      type: 'text', name: 'title', maxlength: TITLE_MAX, autocomplete: 'off',
    });
    titleInput.value = isEdit ? existing.title : title;
    const memoInput = makeElement('textarea', {
      name: 'memo', rows: 3, maxlength: MEMO_MAX,
    });
    memoInput.value = isEdit ? existing.memo : '';
    const shownUrl = isEdit ? existing.url : url;
    const shownPath = shownUrl ? toSitePath(shownUrl) : '';
    // A fixed URL is plain wrapped text rather than a disabled input, so a
    // long link stays fully visible and can still be selected and copied.
    const urlInput = editable ?
        makeElement('input', {
          type: 'text', name: 'url', autocomplete: 'off', spellcheck: 'false',
          inputmode: 'url', placeholder: '/posts?tags=...',
          oninput: () => scheduleUrlCheck(),
        }) :
        null;
    if (urlInput) urlInput.value = shownPath;
    const urlView = urlInput ||
        makeElement('span', {className: 'pfp-url-text', text: shownPath});
    const typeChip = makeElement('span', {className: 'pfp-chip'});
    const urlError = makeElement('p', {className: 'pfp-field-error'});
    const formError = makeElement('p', {
      className: 'pfp-form-error', role: 'alert',
    });
    const primary = makeElement('button', {
      type: 'submit',
      className: 'button-primary',
      text: isEdit ? 'Update' : 'Save',
    });
    const removeButton = isEdit ?
        makeElement('button', {
          type: 'button',
          className: 'button-outline-danger',
          text: 'Remove',
          onclick: onRemove,
        }) :
        null;

    const form = makeElement('form', {
      'className': 'pfp-dialog',
      'role': 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'pfp-dialog-heading',
      'novalidate': true,
      'onsubmit': onSubmit,
      'onkeydown': onKeydown,
    }, [
      makeElement('h2', {
        id: 'pfp-dialog-heading',
        className: 'pfp-dialog-heading',
        text: isEdit ? 'Edit favorite page' : 'Save to Favorite Pages',
      }),
      makeField('label', 'Title', titleInput),
      makeField('label', 'Memo', memoInput),
      makeField(
          urlInput ? 'label' : 'div',
          'URL',
          makeElement('span', {className: 'pfp-url-row'}, [urlView, typeChip]),
          urlError),
      formError,
      makeElement('div', {className: 'pfp-dialog-buttons'}, [
        primary,
        removeButton,
        makeElement('button', {type: 'button', text: 'Cancel', onclick: close}),
      ]),
    ]);
    // Close only when a press both starts and ends on the backdrop, so a drag
    // that leaves the form, or a touch scroll, does not dismiss it.
    let pressedBackdrop = false;
    const overlay = makeElement('div', {
      id: DIALOG_ID,
      className: 'pfp-overlay',
      onpointerdown: (event) => {
        pressedBackdrop = event.target === overlay;
      },
      onclick: (event) => {
        if (pressedBackdrop && event.target === overlay) close();
      },
    }, [form]);

    // The URL is only savable once it passed the gate and no other saved
    // page holds it. The opening URL is known to qualify (it is the edited
    // page's own URL, or openSaveDialog found nothing saved under it).
    let checkedUrl = null;
    let checkSeq = 0;
    let checkTimer = 0;
    let busy = false;

    function setMessage(node, message) {
      node.textContent = message;
      node.hidden = !message;
    }

    function updateButtons() {
      primary.disabled = busy || checkedUrl === null;
      if (removeButton) removeButton.disabled = busy;
    }

    /** @return {?string} The sanitized URL, or null with the reason shown. */
    function applyGate() {
      const raw = urlInput ? urlInput.value : shownUrl;
      const checked = sanitizeUrl(raw);
      if (!checked.ok) {
        typeChip.textContent = '?';
        // An empty Add URL form waits for input before complaining.
        setMessage(
            urlError, raw.trim() ? REJECT_MESSAGES[checked.reason] : '');
        if (urlInput) urlInput.setAttribute('aria-invalid', 'true');
        return null;
      }
      typeChip.textContent = classify(checked.url);
      setMessage(urlError, '');
      if (urlInput) urlInput.removeAttribute('aria-invalid');
      return checked.url;
    }

    function scheduleUrlCheck() {
      clearTimeout(checkTimer);
      const seq = ++checkSeq;
      checkedUrl = null;
      const candidate = applyGate();
      updateButtons();
      if (candidate === null) return;
      checkTimer = setTimeout(async () => {
        let message = '';
        try {
          const holder = await getPageByUrl(user.id, candidate);
          if (holder && (!isEdit || holder.id !== existing.id)) {
            message = `Already saved as "${holder.title}".`;
          }
        } catch (err) {
          message = describeError(err);
        }
        if (seq !== checkSeq) return;
        setMessage(urlError, message);
        if (!message) checkedUrl = candidate;
        updateButtons();
      }, URL_CHECK_DELAY_MS);
    }

    function setBusy(value) {
      busy = value;
      updateButtons();
    }

    async function onSubmit(event) {
      event.preventDefault();
      if (busy || checkedUrl === null) return;
      setBusy(true);
      const fields = {
        url: checkedUrl,
        title: titleInput.value,
        memo: memoInput.value,
      };
      try {
        if (isEdit) {
          await updatePage(user.id, existing.id, fields);
        } else {
          await savePage(user.id, fields);
        }
        close();
        showToast(isEdit ? 'Updated.' : 'Saved to Favorite Pages.');
        notifyPagesChanged();
      } catch (err) {
        console.error(LOG_PREFIX, err);
        setMessage(formError, describeError(err));
        setBusy(false);
      }
    }

    async function onRemove() {
      if (busy) return;
      setBusy(true);
      try {
        await deletePage(user.id, existing.id);
        close();
        showToast('Removed from Favorite Pages.');
        notifyPagesChanged();
      } catch (err) {
        console.error(LOG_PREFIX, err);
        setMessage(formError, describeError(err));
        setBusy(false);
      }
    }

    function onKeydown(event) {
      // Keep Danbooru's shortcuts (and other scripts) out of the dialog.
      // This also stops Danbooru's own Ctrl+Enter handler from submitting a
      // second time.
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        form.requestSubmit();
      } else if (event.key === 'Tab') {
        trapFocus(event, form);
      }
    }

    function close() {
      clearTimeout(checkTimer);
      checkSeq++;
      overlay.remove();
      activeDialogClose = null;
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) {
        returnFocus.focus({preventScroll: true});
      }
    }

    checkedUrl = applyGate();
    setMessage(urlError, urlError.textContent);
    setMessage(formError, '');
    updateButtons();
    activeDialogClose = close;
    document.body.appendChild(overlay);
    titleInput.focus();
    titleInput.select();
  }

  // ==========================================================================
  // === Hotkeys (PLAN D7) ====================================================
  // ==========================================================================

  /** Settings in effect; replaced once the stored ones have loaded. */
  let settings = DEFAULT_SETTINGS;
  /** Settles once `settings` holds the stored values (or the defaults). */
  let settingsReady = Promise.resolve();

  /** Which setting holds each hotkey, and what it does. */
  const HOTKEY_ACTIONS = Object.freeze([
    {settingKey: 'hotkeySave', run: saveCurrentPage},
  ]);

  /**
   * Matches by physical key (`code`) so the Korean IME, which reports ㅠ for
   * Shift+B, still triggers it (Resolved 16).
   * @param {!KeyboardEvent} event
   * @param {?{code: string, shiftKey: boolean}} hotkey
   * @return {boolean}
   */
  function matchesHotkey(event, hotkey) {
    return Boolean(hotkey) && event.code === hotkey.code &&
        event.shiftKey === hotkey.shiftKey && !event.ctrlKey &&
        !event.altKey && !event.metaKey;
  }

  /**
   * @param {?EventTarget} target
   * @return {boolean} Whether keys typed there are text input.
   */
  function isTypingTarget(target) {
    return target instanceof Element &&
        (target.isContentEditable ||
         target.closest('input, textarea, select') !== null);
  }

  /** @param {!KeyboardEvent} event */
  function onGlobalKeydown(event) {
    if (event.repeat || event.isComposing || event.defaultPrevented) return;
    if (isTypingTarget(event.target) || isOverlayOpen()) return;
    const action = HOTKEY_ACTIONS.find(
        ({settingKey}) => matchesHotkey(event, settings[settingKey]));
    if (!action) return;
    event.preventDefault();
    action.run();
  }

  /** The save hotkey: opens the dialog for the page being viewed. */
  function saveCurrentPage() {
    const checked = checkCurrentPage();
    if (checked.ok) {
      openSaveDialog({url: checked.url, title: suggestTitle(checked.url)});
    } else if (checked.reason !== 'loggedOut') {
      // Logged-out visitors get no reaction at all (PLAN D2-2).
      showToast(REJECT_MESSAGES[checked.reason], {error: true});
    }
  }

  async function loadSettings() {
    try {
      settings = await getSettings();
    } catch (err) {
      console.warn(LOG_PREFIX, 'settings unavailable, using defaults', err);
    }
  }

  /**
   * @param {{code: string, shiftKey: boolean}} hotkey
   * @return {string} E.g. "Shift+B".
   */
  function formatHotkey(hotkey) {
    const key = hotkey.code.replace(/^(?:Key|Digit)/, '');
    return hotkey.shiftKey ? `Shift+${key}` : key;
  }

  // ==========================================================================
  // === Icons ================================================================
  // ==========================================================================
  // Inline SVG so no glyph depends on the viewer's fonts; strokes and fills
  // use currentColor to follow the theme.

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICON_SHAPES = Object.freeze({
    grip: [
      ['circle', {cx: 9, cy: 6, r: 1.6}], ['circle', {cx: 15, cy: 6, r: 1.6}],
      ['circle', {cx: 9, cy: 12, r: 1.6}], ['circle', {cx: 15, cy: 12, r: 1.6}],
      ['circle', {cx: 9, cy: 18, r: 1.6}], ['circle', {cx: 15, cy: 18, r: 1.6}],
    ],
    edit: [['path', {d: 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4'}]],
    remove: [['path', {d: 'M6 6l12 12M18 6L6 18'}]],
  });

  /**
   * @param {string} name A key of ICON_SHAPES.
   * @return {!SVGElement}
   */
  function makeIcon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', `pfp-icon pfp-icon-${name}`);
    svg.setAttribute('aria-hidden', 'true');
    for (const [tag, attrs] of ICON_SHAPES[name]) {
      const shape = document.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(attrs)) {
        shape.setAttribute(key, String(value));
      }
      svg.appendChild(shape);
    }
    return svg;
  }

  // ==========================================================================
  // === List page (PLAN D5, D8) ==============================================
  // ==========================================================================

  /** Sort modes; `dir` is the natural direction a mode starts in. */
  const SORT_MODES = Object.freeze([
    {value: 'custom', label: 'Custom order', dir: 'asc'},
    {value: 'created', label: 'Date added', dir: 'desc'},
    {value: 'title', label: 'Title', dir: 'asc'},
    {value: 'type', label: 'Type', dir: 'asc'},
  ]);
  /** Distance from the viewport edge that scrolls the page while dragging. */
  const DRAG_EDGE_PX = 48;
  const DRAG_SCROLL_PX = 12;
  /** A little longer than the 150ms slide transition in GLOBAL_CSS. */
  const SETTLE_MS = 170;
  const collator =
      new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});

  /**
   * Orders pages for display. The custom order has a single direction: a
   * reversed view of an order you arrange by hand only confuses (PLAN D8).
   * @param {!Array<!Object>} pages
   * @param {string} mode A SORT_MODES value.
   * @param {string} dir 'asc' or 'desc'.
   * @return {!Array<!Object>} A new array.
   */
  function sortPages(pages, mode, dir) {
    const sign = dir === 'desc' ? -1 : 1;
    const comparators = {
      custom: (a, b) => a.sortOrder - b.sortOrder || b.createdAt - a.createdAt,
      created: (a, b) => sign * (a.createdAt - b.createdAt),
      title: (a, b) => sign * collator.compare(a.title, b.title),
      type: (a, b) =>
        sign * collator.compare(classify(a.url), classify(b.url)) ||
          collator.compare(a.title, b.title),
    };
    return [...pages].sort(comparators[mode] || comparators.custom);
  }

  /**
   * @param {!Array<!Object>} pages
   * @param {string} query Matched against title, memo and internal link.
   * @return {!Array<!Object>}
   */
  function filterPages(pages, query) {
    const needle = query.trim().toLowerCase();
    if (!needle) return pages;
    return pages.filter((page) => [page.title, page.memo, toSitePath(page.url)]
        .some((text) => text.toLowerCase().includes(needle)));
  }

  /**
   * sortOrder for a page dropped between two neighbours (either may be null
   * at an end), or null when the gap has run out and the list must be
   * renumbered first (PLAN D8-4).
   * @param {?Object} before
   * @param {?Object} after
   * @return {?number}
   */
  function sortOrderBetween(before, after) {
    if (!before && !after) return 0;
    if (!before) return after.sortOrder - SORT_STEP;
    if (!after) return before.sortOrder + SORT_STEP;
    const gap = after.sortOrder - before.sortOrder;
    return gap >= 1 ? before.sortOrder + gap / 2 : null;
  }

  /**
   * Moves the page at `from` to position `to` of the custom order.
   * @param {number} userId
   * @param {!Array<!Object>} ordered Active pages in custom order.
   * @param {number} from
   * @param {number} to Index in the order after the move.
   * @return {!Promise<void>}
   */
  async function movePage(userId, ordered, from, to) {
    if (from === to) return;
    const moved = ordered[from];
    const neighbours = (list) => {
      const rest = list.filter((page) => page.id !== moved.id);
      return [rest[to - 1] || null, rest[to] || null];
    };
    let sortOrder = sortOrderBetween(...neighbours(ordered));
    if (sortOrder === null) {
      sortOrder = sortOrderBetween(...neighbours(await renumberAll(userId)));
    }
    await reorderPage(userId, moved.id, sortOrder);
  }

  /**
   * @param {number} ms
   * @return {!HTMLElement} A <time> showing the date, full time on hover.
   */
  function makeDate(ms) {
    const date = new Date(ms);
    return makeElement('time', {
      datetime: date.toISOString(),
      title: date.toLocaleString(),
      text: date.toLocaleDateString(),
    });
  }

  /**
   * Takes over Danbooru's 404 page at LIST_PATH (PLAN D5). Steps aside if
   * the page is no longer a 404, i.e. Danbooru now owns the route.
   * @param {?{id: number, name: string}} user
   * @return {!Promise<void>}
   */
  async function initListPage(user) {
    const root = document.getElementById('a-not-found');
    if (!root) {
      console.warn(LOG_PREFIX, `${LIST_PATH} is not a 404 page any more;`,
          'the list page is disabled');
      return;
    }
    document.title = 'Favorite Pages | Danbooru';
    try {
      if (!user) {
        root.replaceChildren(makeElement('p', {
          className: 'pfp-page-message', text: REJECT_MESSAGES.loggedOut,
        }));
        return;
      }
      await settingsReady;
      const view = createListView(user);
      root.replaceChildren(view.element);
      stateRefreshers.add(view.reload);
      purgeTombstones(user.id).catch(
          (err) => console.warn(LOG_PREFIX, 'tombstone purge failed', err));
      await view.reload();
    } finally {
      // Lifts LIST_CLOAK_CSS once the list (or a message) is in place.
      root.classList.add('pfp-ready');
    }
  }

  /**
   * Builds the list page: toolbar, table and the drag-to-reorder logic.
   * @param {{id: number, name: string}} user
   * @return {{element: !HTMLElement, reload: function(): !Promise<void>}}
   */
  function createListView(user) {
    const initial = SORT_MODES.find(({value}) => value === settings.defaultSort)
        || SORT_MODES[0];
    let pages = [];
    let mode = initial.value;
    let dir = initial.value === 'custom' ? 'asc' : settings.defaultSortDir;
    let query = '';
    /** Row move in progress (pointer drag or arrow key); null when none. */
    let move = null;

    const sortSelect = makeElement('select', {
      'className': 'pfp-sort',
      'aria-label': 'Sort by',
      'onchange': () => {
        mode = sortSelect.value;
        dir = SORT_MODES.find(({value}) => value === mode).dir;
        render();
      },
    }, SORT_MODES.map(({value, label}) =>
      makeElement('option', {value, text: label})));
    sortSelect.value = mode;
    const dirButton = makeElement('button', {
      type: 'button',
      className: 'pfp-sort-dir',
      onclick: () => {
        dir = dir === 'asc' ? 'desc' : 'asc';
        render();
      },
    });
    const filterInput = makeElement('input', {
      'type': 'search',
      'className': 'pfp-filter',
      'placeholder': 'Filter by title, memo or URL',
      'aria-label': 'Filter',
      'oninput': () => {
        query = filterInput.value;
        render();
      },
    });
    const summary = makeElement('p', {className: 'pfp-summary'});
    const content = makeElement('div', {className: 'pfp-list'});

    const element = makeElement('div', {className: 'pfp-page'}, [
      makeElement('h1', {text: 'Favorite Pages'}),
      makeElement('p', {
        className: 'pfp-page-owner', text: `Saved by ${user.name}`,
      }),
      makeElement('div', {className: 'pfp-toolbar'}, [
        sortSelect,
        dirButton,
        filterInput,
        makeElement('button', {
          type: 'button',
          className: 'pfp-add-url',
          text: 'Add URL',
          onclick: () => openSaveDialog({editable: true}),
        }),
      ]),
      summary,
      content,
    ]);

    async function reload() {
      try {
        pages = await listPages(user.id);
      } catch (err) {
        console.error(LOG_PREFIX, err);
        content.replaceChildren(makeElement('p', {
          className: 'pfp-page-message', text: describeError(err),
        }));
        return;
      }
      if (!move) render();
    }

    function render() {
      const draggable = mode === 'custom' && !query.trim();
      const shown = filterPages(sortPages(pages, mode, dir), query);
      dirButton.disabled = mode === 'custom';
      dirButton.textContent = dir === 'asc' ? '↑' : '↓';
      dirButton.setAttribute('aria-label',
          dir === 'asc' ? 'Ascending order' : 'Descending order');
      const total = `${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`;
      summary.textContent =
          shown.length === pages.length ? total : `${shown.length} of ${total}`;

      if (!pages.length) {
        content.replaceChildren(makeElement('p', {
          className: 'pfp-page-message',
          text: 'No favorite pages yet. Press ' +
              `${formatHotkey(settings.hotkeySave)} on any page to save it.`,
        }));
        return;
      }
      if (!shown.length) {
        content.replaceChildren(makeElement('p', {
          className: 'pfp-page-message', text: 'No pages match the filter.',
        }));
        return;
      }
      const tbody = makeElement('tbody', {},
          shown.map((page) => makeRow(page, draggable)));
      const tableClass = draggable ? 'pfp-table pfp-table-draggable' :
          'pfp-table';
      content.replaceChildren(makeElement('table', {
        className: `striped ${tableClass}`,
      }, [
        makeElement('thead', {}, [makeElement('tr', {}, [
          draggable ?
              makeElement('th', {'className': 'pfp-col-handle',
                'aria-label': 'Reorder'}) :
              null,
          makeElement('th', {className: 'pfp-col-title', text: 'Title'}),
          makeElement('th', {className: 'pfp-col-type', text: 'Type'}),
          makeElement('th', {className: 'pfp-col-memo', text: 'Memo'}),
          makeElement('th', {className: 'pfp-col-added', text: 'Added'}),
          makeElement('th', {'className': 'pfp-col-actions',
            'aria-label': 'Actions'}),
        ])]),
        tbody,
      ]));
    }

    /**
     * @param {!Object} page
     * @param {boolean} draggable
     * @return {!HTMLElement}
     */
    function makeRow(page, draggable) {
      const row = makeElement('tr', {'className': 'pfp-row',
        'data-id': page.id});
      const handle = draggable ?
          makeElement('button', {
            'type': 'button',
            'className': 'pfp-handle',
            'aria-label': `Move "${page.title}" (arrow keys)`,
            'onpointerdown': (event) => startDrag(event, row),
            'onkeydown': (event) => onHandleKeydown(event, page.id),
          }, [makeIcon('grip')]) :
          null;
      row.append(
          draggable ?
              makeElement('td', {className: 'pfp-col-handle'}, [handle]) :
              '',
          makeElement('td', {className: 'pfp-col-title'}, [
            makeElement('a', {href: page.url, text: page.title}),
            makeElement('span', {
              className: 'pfp-row-url', text: toSitePath(page.url),
            }),
          ]),
          makeElement('td', {className: 'pfp-col-type'}, [
            // Computed, not stored: records saved under older type rules
            // still show the current type (Resolved 24).
            makeElement('span', {
              className: 'pfp-chip', text: classify(page.url),
            }),
          ]),
          makeElement('td', {className: 'pfp-col-memo'}, [
            // The line clamp has to sit on an inner element: table cells
            // ignore it. The tooltip shows a clamped memo in full.
            makeElement('span', {
              className: 'pfp-memo-text', title: page.memo || null,
              text: page.memo,
            }),
          ]),
          makeElement('td', {className: 'pfp-col-added'},
              [makeDate(page.createdAt)]),
          makeElement('td', {className: 'pfp-col-actions'}, [
            makeElement('button', {
              'type': 'button',
              'className': 'pfp-icon-button pfp-edit',
              'title': 'Edit',
              'aria-label': `Edit "${page.title}"`,
              'onclick': () => openSaveDialog({url: page.url, editable: true}),
            }, [makeIcon('edit')]),
            makeElement('button', {
              'type': 'button',
              'className': 'pfp-icon-button pfp-remove',
              'title': 'Remove',
              'aria-label': `Remove "${page.title}"`,
              'onclick': () => removePage(page),
            }, [makeIcon('remove')]),
          ]));
      return row;
    }

    async function removePage(page) {
      if (!window.confirm(`Remove "${page.title}" from Favorite Pages?`)) {
        return;
      }
      try {
        await deletePage(user.id, page.id);
        showToast('Removed from Favorite Pages.');
      } catch (err) {
        console.error(LOG_PREFIX, err);
        showToast(describeError(err), {error: true});
      }
      notifyPagesChanged();
    }

    /**
     * Saves a new position, then re-reads the list (also on failure, which
     * puts the rows back where the stored order has them).
     * @param {number} from
     * @param {number} to
     * @param {?string=} focusId Row whose handle gets focus afterwards.
     */
    async function commitMove(from, to, focusId = null) {
      try {
        await movePage(user.id, sortPages(pages, 'custom', 'asc'), from, to);
      } catch (err) {
        console.error(LOG_PREFIX, err);
        showToast(describeError(err), {error: true});
      }
      await reload();
      const row = focusId &&
          tableRows().find((candidate) => candidate.dataset.id === focusId);
      if (row) row.querySelector('.pfp-handle').focus();
    }

    // --- Moving rows (PLAN D8-2, D8-3, Resolved 22) ---
    // A move lifts the row and slides it with transforms only; the DOM
    // order stays put until the row has settled into its gap, and then
    // changes in the same frame the transforms are cleared, so nothing
    // jumps. Row positions are taken once, in page coordinates, so they
    // stay valid while the page auto-scrolls.

    function tableRows() {
      return [...content.querySelectorAll('tbody > tr.pfp-row')];
    }

    /**
     * Lifts `row` and records where every row sits.
     * @param {!HTMLElement} row
     * @return {!Object} The move: row, slots, from, to.
     */
    function beginMove(row) {
      const rows = tableRows();
      const scrollTop = window.scrollY;
      const slots = rows.map((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return {row: candidate, top: rect.top + scrollTop, height: rect.height};
      });
      const table = content.querySelector('table');
      if (table) table.classList.add('pfp-table-sorting');
      row.classList.add('pfp-row-dragging');
      const from = rows.indexOf(row);
      return {row, slots, from, to: from};
    }

    /**
     * Slides the neighbours to open a gap at `move.to`.
     * @param {!Object} move
     * @return {number} Offset that puts the moved row into the gap.
     */
    function layoutMove(move) {
      const self = move.slots[move.from];
      move.slots.forEach((slot, i) => {
        let shift = 0;
        if (move.from < i && i <= move.to) shift = -self.height;
        if (move.to <= i && i < move.from) shift = self.height;
        if (i !== move.from) {
          slot.row.style.transform = shift ? `translateY(${shift}px)` : '';
        }
      });
      const target = move.slots[move.to];
      const top = move.to > move.from ?
          target.top + target.height - self.height :
          target.top;
      return top - self.top;
    }

    /**
     * Animates the moved row into its gap (or home, when `to` equals
     * `from`), then commits the DOM order.
     * @param {!Object} move
     * @param {function()} onDone
     */
    function settleMove(move, onDone) {
      const offset = layoutMove(move);
      move.row.classList.add('pfp-row-settling');
      move.row.style.transform = offset ? `translateY(${offset}px)` : '';
      setTimeout(() => {
        finishMove(move);
        onDone();
      }, prefersReducedMotion() ? 0 : SETTLE_MS);
    }

    function finishMove(move) {
      // Dropping the transition class first means clearing the transforms
      // below cannot animate.
      const table = content.querySelector('table');
      if (table) table.classList.remove('pfp-table-sorting');
      for (const {row} of move.slots) row.style.transform = '';
      move.row.classList.remove('pfp-row-dragging', 'pfp-row-settling');
      if (move.to !== move.from && move.row.isConnected) {
        const rows = move.slots.map(({row}) => row);
        rows.splice(move.from, 1);
        rows.splice(move.to, 0, move.row);
        move.row.parentNode.append(...rows);
      }
    }

    /** Arrow keys on a focused handle move the row one place (D8-5). */
    function onHandleKeydown(event, id) {
      const step = {ArrowUp: -1, ArrowDown: 1}[event.key];
      if (!step || move) return;
      event.preventDefault();
      event.stopPropagation();
      const rows = tableRows();
      const from = rows.findIndex((row) => row.dataset.id === id);
      const to = from + step;
      if (from < 0 || to < 0 || to >= rows.length) return;
      move = beginMove(rows[from]);
      move.to = to;
      settleMove(move, () => {
        // Re-inserting the row in finishMove drops focus; give it straight
        // back so keyboard users never lose their place.
        rows[from].querySelector('.pfp-handle').focus({preventScroll: true});
        move = null;
        commitMove(from, to, id);
      });
    }

    // Pointer Events cover mouse, touch and pen with one code path; the
    // handle alone has touch-action: none, so the rest of a row still
    // scrolls the page. The lifted row follows the pointer; the gap opens
    // where its centre has passed a neighbour's midpoint.

    function startDrag(event, row) {
      if (move || event.button !== 0) return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch (err) {
        // Not supported: the document listeners below still see the moves.
      }
      move = beginMove(row);
      Object.assign(move, {
        dragging: true,
        pointerId: event.pointerId,
        startY: event.clientY + window.scrollY,
        y: event.clientY,
        frame: 0,
      });
      document.addEventListener('pointermove', onDragMove);
      document.addEventListener('pointerup', onDragEnd);
      document.addEventListener('pointercancel', cancelDrag);
      document.addEventListener('keydown', onDragKeydown, true);
      move.frame = requestAnimationFrame(autoScroll);
    }

    function trackPointer() {
      const self = move.slots[move.from];
      const offset = move.y + window.scrollY - move.startY;
      const centre = self.top + self.height / 2 + offset;
      let to = move.from;
      move.slots.forEach((slot, i) => {
        const middle = slot.top + slot.height / 2;
        if (i > move.from && middle < centre) to = Math.max(to, i);
        if (i < move.from && middle > centre) to = Math.min(to, i);
      });
      move.to = to;
      layoutMove(move);
      move.row.style.transform = `translateY(${offset}px)`;
    }

    function isDragEvent(event) {
      return move !== null && move.dragging &&
          event.pointerId === move.pointerId;
    }

    function onDragMove(event) {
      if (!isDragEvent(event)) return;
      move.y = event.clientY;
      trackPointer();
    }

    function autoScroll() {
      if (!move || !move.dragging) return;
      if (move.y < DRAG_EDGE_PX) {
        window.scrollBy(0, -DRAG_SCROLL_PX);
        trackPointer();
      } else if (move.y > window.innerHeight - DRAG_EDGE_PX) {
        window.scrollBy(0, DRAG_SCROLL_PX);
        trackPointer();
      }
      move.frame = requestAnimationFrame(autoScroll);
    }

    function releasePointer() {
      document.removeEventListener('pointermove', onDragMove);
      document.removeEventListener('pointerup', onDragEnd);
      document.removeEventListener('pointercancel', cancelDrag);
      document.removeEventListener('keydown', onDragKeydown, true);
      cancelAnimationFrame(move.frame);
      move.dragging = false;
    }

    function onDragEnd(event) {
      if (!isDragEvent(event)) return;
      releasePointer();
      const {from, to} = move;
      settleMove(move, () => {
        move = null;
        if (from !== to) commitMove(from, to);
      });
    }

    /** Pointer cancelled or Esc: every row slides back home. */
    function cancelDrag() {
      if (!move || !move.dragging) return;
      releasePointer();
      move.to = move.from;
      settleMove(move, () => {
        move = null;
      });
    }

    function onDragKeydown(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancelDrag();
    }

    render();
    return {element, reload};
  }

  // ==========================================================================
  // === Profile row (PLAN D6) ================================================
  // ==========================================================================

  /**
   * /profile renders the same page as /users/<own id> without redirecting
   * (Resolved 8).
   * @param {{id: number}} user
   * @return {boolean}
   */
  function isOwnProfile(user) {
    if (location.pathname === '/profile') return true;
    const match = /^\/users\/(\d+)$/.exec(location.pathname);
    return match !== null && Number(match[1]) === user.id;
  }

  /**
   * Adds "Favorite Pages: N" under Favorite Groups in the statistics table.
   * @param {{id: number}} user
   * @return {!Promise<void>}
   */
  async function initProfileRow(user) {
    if (!isOwnProfile(user)) return;
    const table = document.querySelector('table.user-statistics');
    if (!table) {
      console.warn(LOG_PREFIX, 'profile statistics table not found');
      return;
    }
    let row = table.querySelector('tr.pfp-profile-row');
    if (!row) {
      const labelled = (label) => [...table.querySelectorAll('tr')].find(
          (tr) => tr.querySelector('th')?.textContent.trim() === label);
      const anchor = labelled('Favorite Groups') || labelled('Favorites');
      row = makeElement('tr', {className: 'pfp-profile-row'}, [
        makeElement('th', {text: 'Favorite Pages'}),
        makeElement('td', {}, [
          makeElement('a', {href: LIST_PATH, text: '…'}),
        ]),
      ]);
      if (anchor) {
        anchor.after(row);
      } else {
        console.warn(LOG_PREFIX, 'Favorite Groups row not found');
        (table.tBodies[0] || table).appendChild(row);
      }
    }
    const link = row.querySelector('a');
    const update = async () => {
      try {
        link.textContent = String(await countPages(user.id));
      } catch (err) {
        console.error(LOG_PREFIX, err);
      }
    };
    stateRefreshers.add(update);
    await update();
  }

  // ==========================================================================
  // === Site map link (PLAN D9-E) ============================================
  // ==========================================================================

  /**
   * Lists the page in the site map's Profile section (/static/site_map, the
   * navbar's "More »"), right under "Favorite groups" (Resolved 21).
   */
  function initSiteMapLink() {
    if (location.pathname !== '/static/site_map') return;
    if (document.querySelector('.pfp-sitemap-link')) return;
    const heading = [...document.querySelectorAll('ul > li > h2')]
        .find((h2) => h2.textContent.trim() === 'Profile');
    const list = heading && heading.closest('ul');
    if (!list) {
      console.warn(LOG_PREFIX, 'site map Profile section not found');
      return;
    }
    const item = makeElement('li', {className: 'pfp-sitemap-link'}, [
      makeElement('a', {href: LIST_PATH, text: 'Favorite pages'}),
    ]);
    const groups = list.querySelector('a[href="/favorite_groups"]');
    if (groups) {
      groups.closest('li').after(item);
    } else {
      console.warn(LOG_PREFIX, 'site map "Favorite groups" link not found');
      list.appendChild(item);
    }
  }

  // ==========================================================================
  // === Lifecycle (PLAN D11, Resolved 16) ====================================
  // ==========================================================================
  // Danbooru has no Turbo: every navigation is a full page load, so init()
  // runs once per page. Back/forward can restore a page from the bfcache with
  // its DOM as it was left; the hooks below re-sync it.

  /** UI that shows saved state registers here to be re-read on restore. */
  const stateRefreshers = new Set();
  /** Transient UI (dialogs, popovers, toasts) registers its close here. */
  const overlayClosers = new Set();

  /** @param {!Set<function()>} callbacks */
  function runAll(callbacks) {
    for (const callback of callbacks) {
      try {
        callback();
      } catch (err) {
        console.error(LOG_PREFIX, err);
      }
    }
  }

  /** Re-syncs every saved-state indicator after the list changed. */
  function notifyPagesChanged() {
    runAll(stateRefreshers);
  }

  function init() {
    overlayClosers.add(closeSaveDialog);
    overlayClosers.add(hideToast);
    // Registered on JSON documents too, so the save key can explain why it
    // does nothing there.
    document.addEventListener('keydown', onGlobalKeydown);
    settingsReady = loadSettings();
    if (!isHtmlDocument()) return;
    ensureStyles();
    const user = getCurrentUser();
    // The list page also answers logged-out visitors (with a message).
    if (location.pathname === LIST_PATH) initListPage(user);
    if (!user) return;
    initProfileRow(user);
    initSiteMapLink();
  }

  // Close overlays before the page goes into the bfcache, and re-read saved
  // state when it comes back (another page may have changed the list).
  window.addEventListener('pagehide', () => runAll(overlayClosers));
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    runAll(overlayClosers);
    runAll(stateRefreshers);
  });

  // DEV-ONLY: console access for the Phase 1 manual checks (Task 1.2).
  // Removed before release (Task 7.3).
  window.pfpDebug = {
    getCurrentUser, sanitizeUrl, checkCurrentPage, classify, extractTitle,
    fallbackTitle, toSitePath, listPages, listAllRecords, getPageByUrl,
    countPages, savePage, updatePage, deletePage, purgeTombstones,
    reorderPage, renumberAll, getSettings, saveSettings, openSaveDialog,
    REJECT_MESSAGES,
  };

  // The script runs at document-start so the list page can hide Danbooru's
  // 404 content before it is ever painted (Resolved 25); everything else
  // waits for the parsed document.
  if (location.pathname === LIST_PATH) {
    injectStyles(LIST_CLOAK_ID, LIST_CLOAK_CSS);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, {once: true});
  } else {
    init();
  }
})();
