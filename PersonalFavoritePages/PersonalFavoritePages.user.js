// ==UserScript==
// @name         Danbooru Personal Favorite Pages
// @namespace    https://github.com/AkaringoP
// @version      0.2.0
// @description  Save frequently used Danbooru pages per account, with memos, a custom order and quick navigation.
// @author       AkaringoP
// @license      MIT
// @match        *://danbooru.donmai.us/*
// @icon         https://danbooru.donmai.us/favicon.ico
// @updateURL    https://github.com/AkaringoP/JavaScripts/raw/refs/heads/feature/personal-favorite-pages/PersonalFavoritePages/PersonalFavoritePages.user.js
// @downloadURL  https://github.com/AkaringoP/JavaScripts/raw/refs/heads/feature/personal-favorite-pages/PersonalFavoritePages/PersonalFavoritePages.user.js
// @run-at       document-idle
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
  // submit button.
  const STRIPPED_PARAMS = new Set(['api_key', 'login', 'commit']);
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

  // First match wins (PLAN D3).
  const PAGE_TYPES = Object.freeze([
    ['api', DATA_EXTENSION_PATTERN],
    ['post', /^\/posts\/\d+/],
    ['post-search', /^\/(?:posts\/?)?$/],
    ['pool', /^\/pools(?:\/|$)/],
    ['wiki', /^\/wiki_pages(?:\/|$)/],
    ['artist', /^\/artists(?:\/|$)/],
    ['forum', /^\/forum_(?:topics|posts)(?:\/|$)/],
    ['user', /^\/(?:users(?:\/|$)|profile$)/],
    ['comment', /^\/comments(?:\/|$)/],
  ]);

  const TITLE_SUFFIX_PATTERN = /\s*\|\s*Danbooru\s*$/;

  // Characters that must stay percent-encoded when a URL part is shown
  // decoded, because they would change how the text parses back.
  const PATH_KEEP_ENCODED = /[/?#%\s]/g;
  const QUERY_KEEP_ENCODED = /[&=#+%\s]/g;

  const STYLE_ID = 'pfp-style';
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
      type: classify(new URL(cleanUrl).pathname),
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
        next.type = classify(new URL(newUrl).pathname);
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
   * @param {string} pathname
   * @return {string} One of the PAGE_TYPES names, or 'other'.
   */
  function classify(pathname) {
    const match = PAGE_TYPES.find(([, pattern]) => pattern.test(pathname));
    return match ? match[0] : 'other';
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
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
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
      typeChip.textContent = classify(new URL(checked.url).pathname);
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
      openSaveDialog({url: checked.url, title: extractTitle(checked.url)});
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
    loadSettings();
    if (!isHtmlDocument()) return;
    ensureStyles();
    if (!getCurrentUser()) return;
    // Entry points and page modules hook in here as they are built.
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

  init();
})();
