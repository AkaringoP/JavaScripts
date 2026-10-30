// ==UserScript==
// @name         Danbooru Personal Favorite Pages
// @namespace    https://github.com/AkaringoP
// @version      0.1.0
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
  const ACCOUNT_SUBPAGES = 'email|password|totp|backup_codes|api_keys';
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
    {reason: 'self', pattern: new RegExp(`^${LIST_PATH}/?$`)},
  ]);
  // body[data-action] values of Danbooru's static error pages (Resolved 15).
  const ERROR_ACTIONS = new Set(['not-found', 'error']);

  /** User-facing text for every rejection reason. */
  const REJECT_MESSAGES = Object.freeze({
    invalid: 'Not a valid URL.',
    external: 'Only danbooru.donmai.us pages can be saved.',
    token: 'This page carries a one-time token.',
    auth: 'Login and logout pages are not saved.',
    account: 'Account security pages are not saved.',
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

  // Colours always come from Danbooru's semantic variables (PLAN D5), so the
  // UI follows the light / dark / auto themes without detection code. Only
  // layout tokens live here. Never put backticks inside this literal.
  const GLOBAL_CSS = `
    :root {
      --pfp-radius: 4px;
      --pfp-gap: 8px;
      --pfp-z-overlay: 10000;
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
    const path = url.pathname.replace(DATA_EXTENSION_PATTERN, '');
    const rule = DENY_RULES.find(({pattern}) => pattern.test(path));
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
   * Whether the page being viewed can be saved, and its URL if so. Adds the
   * checks that only make sense for an open page (PLAN D13-5).
   * @return {!UrlCheck}
   */
  function checkCurrentPage() {
    // JSON / XML documents have no Danbooru body attributes, so the account
    // cannot be confirmed there (PLAN D13). Tampermonkey on Whale does run
    // on them (measured), so this reason does reach the user.
    if (!document.contentType.includes('html')) {
      return {ok: false, reason: 'notHtml'};
    }
    if (!getCurrentUser()) return {ok: false, reason: 'loggedOut'};
    const checked = sanitizeUrl(location.href);
    if (!checked.ok) return checked;
    const {controller, action} = document.body.dataset;
    if (controller === 'static' && ERROR_ACTIONS.has(action)) {
      return {ok: false, reason: 'errorPage'};
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

  /**
   * @param {string} id
   * @param {string} css
   */
  function injectStyles(id, css) {
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
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

  function init() {
    if (!document.contentType.includes('html')) return;
    injectStyles('pfp-style', GLOBAL_CSS);
    if (!getCurrentUser()) return;
    // Entry points and page modules are added from Phase 2 on.
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
    fallbackTitle, listPages, listAllRecords, getPageByUrl, countPages,
    savePage, updatePage, deletePage, purgeTombstones, reorderPage,
    renumberAll, getSettings, saveSettings, REJECT_MESSAGES,
  };

  init();
})();
