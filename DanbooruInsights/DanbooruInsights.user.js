// ==UserScript==
// @name         Danbooru Insights
// @namespace    http://tampermonkey.net/
// @version      4.4
// @description  Injects a GitHub-style contribution graph and advanced analytics dashboard into Danbooru profile pages.
// @author       AkaringoP with Antigravity
// @match        https://danbooru.donmai.us/users/*
// @match        https://danbooru.donmai.us/profile
// @icon         https://danbooru.donmai.us/favicon.ico
// @grant        none
// @homepageURL  https://github.com/AkaringoP/JavaScripts/tree/main/DanbooruInsights
// @updateURL    https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/DanbooruInsights/DanbooruInsights.user.js
// @downloadURL  https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/DanbooruInsights/DanbooruInsights.user.js
// @require      https://d3js.org/d3.v7.min.js
// @require      https://unpkg.com/cal-heatmap/dist/cal-heatmap.min.js
// @require      https://unpkg.com/dexie/dist/dexie.js
// ==/UserScript==

(function () {
  'use strict';

  // --- Configuration & Constants ---
  const CONFIG = {
    STORAGE_PREFIX: 'danbooru_contrib_',
    CLEANUP_THRESHOLD_MS: 7 * 24 * 60 * 60 * 1000, // 7 Days
    SELECTORS: {
      STATISTICS_SECTION: 'div.user-statistics',
    },
    THEMES: {
      // Light Schemes
      light: {
        name: 'Light',
        bg: '#ffffff',
        empty: '#ebedf0',
        text: '#24292f'
      },
      solarized_light: {
        name: 'Solarized Light',
        bg: '#fdf6e3',
        empty: '#eee8d5',
        text: '#586e75',
        scrollbar: '#93a1a1'
      },
      sakura: {
        name: 'Sakura',
        bg: '#fff0f5',
        empty: '#ffe0ea',
        text: '#24292f'
      },
      sunset: {
        name: 'Sunset',
        bg: '#fff5e6',
        empty: '#ffe0b2',
        text: '#24292f'
      },
      ice: {
        name: 'Ice',
        bg: '#e6fffb',
        empty: '#ffffff',
        text: '#006d75',
        scrollbar: '#5cdbd3'
      },
      aurora: {
        name: 'Aurora',
        bg: 'linear-gradient(135deg, #BAD1DE 0%, #ECECF5 100%)',
        empty: '#ffffff',
        text: '#2e3338',
        scrollbar: '#9FB5C6'
      },

      // Dark Schemes
      midnight: {
        name: 'Midnight',
        bg: '#000000',
        empty: '#222222',
        text: '#f0f6fc'
      },
      solarized_dark: {
        name: 'Solarized Dark',
        bg: '#002b36',
        empty: '#073642',
        text: '#93a1a1',
        scrollbar: '#586e75'
      },
      newspaper: {
        name: 'Newspaper',
        bg: '#f0f0f0',
        empty: '#dbdbdb',
        text: '#24292f',
        scrollbar: '#d0d7de'
      },
      ocean: {
        name: 'Ocean',
        bg: '#1b2a4e',
        empty: '#2b3d68',
        text: '#e6edf3'
      },
    },
  };

  /**
   * Manages user settings and persistence using localStorage.
   */
  class SettingsManager {
    /**
     * Initializes the SettingsManager, loading existing settings or defaults.
     */
    constructor() {
      /**
       * The key used to store settings in localStorage.
       * @type {string}
       */
      this.key = CONFIG.STORAGE_PREFIX + 'settings';
      /**
       * Default settings values.
       * @type {Object}
       */
      this.defaults = {
        theme: 'light',
        thresholds: {
          uploads: [1, 10, 25, 50],
          approvals: [10, 50, 100, 150],
          notes: [1, 10, 20, 30],
        },
        rememberedModes: {}, // userId -> mode
      };
      /**
       * The currently loaded settings.
       * @type {Object}
       */
      this.settings = this.load();
    }

    /**
     * Loads settings from localStorage with migration support.
     * @return {Object} The loaded settings object.
     */
    load() {
      try {
        const s = localStorage.getItem(this.key);
        const saved = s ? JSON.parse(s) : {};

        // Migration: remembered_modes -> rememberedModes
        if (saved.remembered_modes && !saved.rememberedModes) {
          saved.rememberedModes = saved.remembered_modes;
          delete saved.remembered_modes;
        }

        // Deep merge defaults with saved
        return {
          ...this.defaults,
          ...saved,
          thresholds: {
            ...this.defaults.thresholds,
            ...(saved.thresholds || {})
          },
          rememberedModes: {
            ...(saved.rememberedModes || {})
          },
        };
      } catch (e) {
        console.error('[Danbooru Grass] Error loading settings, using defaults:', e);
        return this.defaults;
      }
    }

    /**
     * Saves new settings to localStorage.
     * @param {Object} newSettings Partial settings to update.
     */
    save(newSettings) {
      this.settings = {
        ...this.settings,
        ...newSettings
      };
      localStorage.setItem(this.key, JSON.stringify(this.settings));
    }

    /**
     * Gets the current theme key, falling back to 'light' if invalid.
     * @return {string} The theme key.
     */
    getTheme() {
      const t = this.settings.theme;
      return CONFIG.THEMES[t] ? t : 'light';
    }

    /**
     * Gets thresholds for a specific metric.
     * @param {string} metric 'uploads', 'approvals', or 'notes'.
     * @return {Array<number>} Array of 4 threshold integers.
     */
    getThresholds(metric) {
      return this.settings.thresholds[metric] ||
        this.defaults.thresholds[metric] || [1, 5, 10, 20];
    }

    /**
     * Sets thresholds for a specific metric and saves them.
     * @param {string} metric 'uploads', 'approvals', or 'notes'.
     * @param {Array<number>} values Array of 4 threshold integers.
     */
    setThresholds(metric, values) {
      const newThresholds = {
        ...this.settings.thresholds,
        [metric]: values
      };
      this.save({
        thresholds: newThresholds
      });
    }

    /**
     * Applies the selected theme to CSS variables on the document root.
     * @param {string} themeKey The key of the theme to apply.
     */
    applyTheme(themeKey) {
      const theme = CONFIG.THEMES[themeKey] || CONFIG.THEMES.light;
      const root = document.querySelector(':root');
      if (root) {
        root.style.setProperty('--grass-bg', theme.bg);
        root.style.setProperty('--grass-empty-cell', theme.empty);
        root.style.setProperty('--grass-text', theme.text);
        root.style.setProperty(
          '--grass-scrollbar-thumb',
          theme.scrollbar || '#d0d7de'
        );
      }
      this.save({
        theme: themeKey
      });
    }

    /**
     * Gets the last used mode for a specific user.
     * @param {string} userId The ID of the user.
     * @return {string|null} The mode ('uploads', 'approvals', 'notes') or null if not found.
     */
    getLastMode(userId) {
      return this.settings.rememberedModes[userId] || null;
    }

    /**
     * Sets the last used mode for a specific user and saves it.
     * @param {string} userId The ID of the user.
     * @param {string} mode The mode ('uploads', 'approvals', 'notes').
     */
    setLastMode(userId, mode) {
      const newModes = {
        ...this.settings.rememberedModes,
        [userId]: mode
      };
      this.save({
        rememberedModes: newModes
      });
    }

    /**
     * Gets the sync threshold (max diff allowed to skip sync).
     * @return {number} Threshold (default 5).
     */
    getSyncThreshold() {
      return typeof this.settings.syncThreshold === 'number' ? this.settings.syncThreshold : 5;
    }

    /**
     * Sets the sync threshold.
     * @param {number} val
     */
    setSyncThreshold(val) {
      this.save({
        syncThreshold: parseInt(val, 10)
      });
    }
  }

  // --- 1. Context & Identity ---
  // --- 1.5 Database (Dexie.js) ---
  /**
   * Dexie.js database for caching Danbooru Grass data.
   */
  class Database extends Dexie {
    constructor() {
      super('DanbooruGrassDB');

      // [v1] Existing schema (used up to v3.1) - For Grass feature
      // Do not modify. (Legacy)
      this.version(1).stores({
        uploads: 'id, userId, date, count', // id: [userId]_[date]
        approvals: 'id, userId, date, count',
        notes: 'id, userId, date, count'
      });

      // [v2] New schema (v4.0 update) - Analytics feature added
      // Keep existing tables, define new 'posts' table.
      this.version(2).stores({
        // 1. Keep existing tables (Grass)
        uploads: 'id, userId, date, count',
        approvals: 'id, userId, date, count',
        notes: 'id, userId, date, count',

        // 2. Add new table (Analytics)
        // Index description:
        // PK: id (Post ID is unique global)
        // no: User-specific sequence (1-based index)
        posts: 'id, uploader_id, no, created_at, score, rating, tag_count_general'
      });

      // [v3] Stats Cache
      // Cache expensive aggregations (Pie Charts)
      // PK: [key+userId] (Compound key for uniqueness per user per metric)
      this.version(3).stores({
        uploads: 'id, userId, date, count',
        approvals: 'id, userId, date, count',
        notes: 'id, userId, date, count',
        posts: 'id, uploader_id, no, created_at, score, rating, tag_count_general',
        piestats: '[key+userId], userId, updated_at'
      });
    }
  }

  // --- 1. Context & Identity ---
  /**
   * Manages the context of the current profile page.
   */
  class ProfileContext {
    constructor() {
      try {
        this.targetUser = this.getTargetUserInfo();
      } catch (e) {
        console.error('[Danbooru Grass] Context Init Failed:', e);
        this.targetUser = null;
      }
    }

    /**
     * Extracts target user information from the DOM.
     * @return {{name: string, id: string|null, joinDate: Date}|null} User info or null.
     */
    getTargetUserInfo() {
      let name = null;
      let id = null;
      let joinDate = new Date().toISOString();

      try {
        // --- 1. Extract Name ---
        // Priority A: Document Title (Most stable)
        // Format: "User: [Name] | Danbooru"
        const titleMatch = document.title.match(/^User: (.+?) \|/);
        if (titleMatch) {
          name = titleMatch[1];
        }

        // Priority B: H1 Header (Legacy/Visual)
        if (!name) {
          const h1 = document.querySelector('h1');
          if (h1) name = h1.textContent.trim().replace(/^User: /, '');
        }

        // --- 2. Extract ID ---
        // Priority A: URL Path (Most stable for direct links)
        // Format: /users/12345
        const urlMatch = window.location.pathname.match(/^\/users\/(\d+)/);
        if (urlMatch) {
          id = urlMatch[1];
        }

        // Priority B: Meta Tags or Body Attributes (If available)
        // Danbooru often puts the *current* user in meta, strict check needed.
        // We skip this to avoid confusion with logged-in user unless we are sure.

        // Priority C: DOM Search (Fallback)
        if (!id && name) {
          // Try to find a link to the user's own page which usually contains ID
          // "Messages" link is a good candidate if it exists
          const messagesLink = document.querySelector(
            'a[href*="/messages?search%5Bto_user_id%5D="]'
          );
          if (messagesLink) {
            const match = messagesLink.href.match(/to_user_id%5D=(\d+)/);
            if (match) id = match[1];
          }

          // Look for "My Account" if we are on our own profile
          // (and it didn't redirect to /users/ID)
          if (!id && window.location.pathname === '/profile') {
            // On /profile, we might be able to find the ID in the "Edit" link
            const editLink = document.querySelector(
              'a[href^="/users/"][href$="/edit"]'
            );
            if (editLink) {
              const m = editLink.getAttribute('href')
                .match(/\/users\/(\d+)\/edit/);
              if (m) id = m[1];
            }
          }

          // Scrape generic user links that match the name
          if (!id) {
            const userLinks = document.querySelectorAll(`a[href^="/users/"]`);
            for (let link of userLinks) {
              const m = link.getAttribute('href').match(/\/users\/(\d+)(?:\?|$)/);
              if (m && link.textContent.trim() === name) {
                id = m[1];
                break;
              }
            }
          }
        }

        // --- 3. Extract Join Date ---
        // "Join Date" is in the statistics table.
        // We search for the "Join Date" text in TH or TD (for flexibility).
        // Try looking for a cell containing "Join Date"
        // Danbooru format: <table>...<th>Join Date</th><td><time timestamp="...">2019-07-29</time></td>...</table>
        // Or sometimes just text.
        const cells = Array.from(document.querySelectorAll('th, td'));
        const joinHeader = cells.find((el) => el.textContent.trim() === 'Join Date');

        if (joinHeader) {
          let valEl = joinHeader.nextElementSibling;
          if (valEl) {
            // Check for <time> element inside
            const timeEl = valEl.querySelector('time');
            if (timeEl) {
              joinDate = timeEl.getAttribute('datetime') || timeEl.textContent.trim();
            } else {
              // Fallback to text content (e.g. "2019-07-29")
              joinDate = valEl.textContent.trim();
              // If it contains "ago", we might have an issue, but usually it's date on profile.
            }
          }
        }

        if (!name) return null; // Name is strictly required
        if (!id) {
          console.warn(
            '[Danbooru Grass] User ID not found. Functionality may be limited (Notes).'
          );
        }

        return {
          name: name,
          id: id,
          created_at: joinDate, // Used as 'created_at' in other parts
          joinDate: new Date(joinDate) // Keep for reference
        };

      } catch (e) {
        console.warn('[Danbooru Grass] Extraction error:', e);
        return null;
      }
    }

    /**
     * Checks if the current page is a valid profile page.
     * @return {boolean} True if valid.
     */
    isValidProfile() {
      if (!this.targetUser || !this.targetUser.name) return false;

      // Strict URL Check: Only main profile pages
      // Allowed: /profile, /users/12345
      // Disallowed: /users/12345/uploads, /users/12345/favorites, etc.
      const path = window.location.pathname;
      const isProfileUrl = path === '/profile' || /^\/users\/\d+$/.test(path);

      if (!isProfileUrl) {
        console.log('[Danbooru Grass] Not a main profile page (URL mismatch).');
        return false;
      }

      return true;
    }
  }

  // --- 2. Data Manager (API & Cache) ---
  /**
   * Handles API requests and caching via Dexie.js.
   */
  class DataManager {
    constructor(db) {
      this.baseUrl = 'https://danbooru.donmai.us';
      this.db = db;
    }

    /**
     * Retrieves cached stats if valid (within 24 hours).
     */
    async getStats(key, userId) {
      try {
        const record = await this.db.piestats.get({ key, userId });
        if (record) {
          // Optional: Check expiration if we wanted strictly time-based, 
          // but user said "expire on full reset", so we effectively trust cache until reset.
          return record.data;
        }
        return null;
      } catch (e) {
        console.warn('Failed to load stats cache', e);
        return null;
      }
    }

    /**
     * Saves stats to cache.
     */
    async saveStats(key, userId, data) {
      try {
        await this.db.piestats.put({
          key,
          userId,
          data,
          updated_at: new Date().toISOString()
        });
      } catch (e) {
        console.warn('Failed to save stats cache', e);
      }
    }

    /**
     * Fetches metric data for a given year, using cache when possible.
     * @param {string} metric 'uploads', 'approvals', or 'notes'.
     * @param {Object} userInfo User info object.
     * @param {number} year The year to fetch.
     * @return {Promise<Object>} Map of date string to count.
     */
    async getMetricData(metric, userInfo, year) {
      try {
        // Determine fetch configuration
        let endpoint;
        let params;
        let storeName;
        let dateKey;
        let idKey;
        const startDate = `${year}-01-01`;
        const endDate = `${parseInt(year) + 1}-01-01`;

        // Params common to all
        const baseParams = {
          limit: 200,
        };

        switch (metric) {
          case 'uploads':
            endpoint = '/posts.json';
            storeName = 'uploads';
            dateKey = 'created_at';
            idKey = 'uploader_id';
            params = {
              ...baseParams,
              only: 'uploader_id,created_at',
            };
            break;
          case 'approvals':
            endpoint = '/post_events.json';
            storeName = 'approvals';
            dateKey = 'event_at';
            idKey = 'creator_id';
            params = {
              ...baseParams,
              'search[category]': 'Approval',
              only: 'creator_id,event_at',
            };
            break;
          case 'notes':
            if (!userInfo.id) throw new Error('User ID required for Notes');
            endpoint = '/note_versions.json';
            storeName = 'notes';
            dateKey = 'created_at';
            idKey = 'updater_id';
            params = {
              ...baseParams,
              'search[updater_id]': userInfo.id,
              only: 'updater_id,created_at',
            };
            break;
          default:
            return {};
        }

        const table = this.db[storeName];
        const userIdVal = userInfo.id || userInfo.name;
        // const idPrefix = `${userIdVal}_`; // unused

        // 1. Check for latest cached date for this user in this year
        // We use the ID range to efficiently find the last entry for this user.
        // ID format: "UserId_YYYY-MM-DD"
        let fetchFromDate = startDate;

        // Query range for this specific year to see where we left off
        const lastEntry = await table.where('id')
          .between(
            `${userIdVal}_${startDate}`,
            `${userIdVal}_${endDate}\uffff`,
            true,
            true
          )
          .last();

        if (lastEntry) {
          console.log(`[Danbooru Grass] Found cached data up to ${lastEntry.date}`);
          // Safety Buffer: Start fetching from 3 days prior to the last cached date
          const lastDate = new Date(lastEntry.date);
          lastDate.setDate(lastDate.getDate() - 3);

          const bufferDateStr = lastDate.toISOString().slice(0, 10);

          // Ensure we don't go before the year start
          fetchFromDate = bufferDateStr < startDate ? startDate : bufferDateStr;
        }

        // Optimization: If cached up to Dec 31st of that year, and year is past, skip fetch.
        const todayStr = new Date().toISOString().slice(0, 10);
        if (fetchFromDate >= endDate && year < new Date().getFullYear()) {
          console.log('[Danbooru Grass] Year complete in cache. Skipping fetch.');
        } else if (
          fetchFromDate === todayStr &&
          year === new Date().getFullYear()
        ) {
          // If we already have data up to today, we might still want to refresh 'today'
        } else {
          // Set API Params
          const fetchRange = `${fetchFromDate}..${endDate}`;
          const normalizedName = userInfo.name.replace(/ /g, '_');

          if (metric === 'uploads') {
            params.tags = `user:${normalizedName} date:${fetchRange}`;
          } else if (metric === 'approvals') {
            params['search[post_tags_match]'] =
              `approver:${normalizedName} date:${fetchRange}`;
          } else if (metric === 'notes') {
            params['search[created_at]'] = fetchRange;
          }

          // 2. Fetch missing range
          console.log(`[Danbooru Grass] Fetching delta: ${fetchRange}`);
          const items = await this.fetchAllPages(endpoint, params);
          console.log(`[Danbooru Grass] Fetched ${items.length} new items.`);

          // 3. Aggregate
          const dailyCounts = {};

          items.forEach((item) => {
            const rawDate = item[dateKey] || item['created_at'];
            if (!rawDate) return;

            // Validation: Strict User ID Check
            if (
              userInfo.id &&
              item[idKey] &&
              String(item[idKey]) !== String(userInfo.id)
            ) {
              return;
            }

            const dateStr = rawDate.slice(0, 10);
            dailyCounts[dateStr] = (dailyCounts[dateStr] || 0) + 1;
          });

          // 4. Upsert into DB
          const bulkData = Object.entries(dailyCounts).map(([date, count]) => {
            return {
              id: `${userIdVal}_${date}`,
              userId: userIdVal,
              date: date,
              count: count,
            };
          });

          if (bulkData.length > 0) {
            await table.bulkPut(bulkData);
          }
        }

        // 5. Return Full Year Data from Cache
        const fullYearData = await table.where('id')
          .between(
            `${userIdVal}_${startDate}`,
            `${userIdVal}_${endDate}\uffff`,
            true,
            true
          )
          .toArray();

        const resultMap = {};
        fullYearData.forEach((i) => resultMap[i.date] = i.count);

        return resultMap;

      } catch (e) {
        console.error('[Danbooru Grass] Data fetch failed:', e);
        throw e; // Propagate error to UI
      }
    }

    /**
     * Clears the cache for a specific metric and user.
     * @param {string} metric 'uploads', 'approvals', or 'notes'.
     * @param {Object} userInfo User info object.
     * @return {Promise<boolean>} True if successful.
     */
    async clearCache(metric, userInfo) {
      try {
        let storeName;
        switch (metric) {
          case 'uploads':
            storeName = 'uploads';
            break;
          case 'approvals':
            storeName = 'approvals';
            break;
          case 'notes':
            storeName = 'notes';
            break;
          default:
            return;
        }
        const table = this.db[storeName];
        const userIdVal = userInfo.id || userInfo.name;

        // Delete all entries for this user in this store
        const items = await table.where('userId').equals(userIdVal).primaryKeys();
        await table.bulkDelete(items);
        console.log(
          `[Danbooru Grass] Cleared ${items.length} items from ${storeName} for ${userIdVal}`
        );
        return true;
      } catch (e) {
        console.error('[Danbooru Grass] Clear cache failed:', e);
        return false;
      }
    }

    /**
     * Fetches all pages for a given endpoint and params (handling pagination).
     * @param {string} endpoint API endpoint.
     * @param {Object} params API parameters.
     * @return {Promise<Array>} List of all fetched items.
     */
    async fetchAllPages(endpoint, params) {
      let allItems = [];
      let page = 1;
      const BATCH_SIZE = 5; // 🚀 Batch size: 5 pages at a time
      const DELAY_BETWEEN_BATCHES = 150; // Delay to respect server limits

      while (true) {
        const promises = [];

        // 1. Prepare Batch Requests
        for (let i = 0; i < BATCH_SIZE; i++) {
          const currentPage = page + i;
          const q = new URLSearchParams({
            ...params,
            page: currentPage
          });
          const url = `${this.baseUrl}${endpoint}?${q.toString()}`;

          // Create Promise for each request
          promises.push(
            fetch(url).then(async (resp) => {
              if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
              return resp.json();
            }).catch((e) => {
              console.warn(`[Danbooru Grass] Page ${currentPage} failed:`, e);
              return []; // Return empty array on failure to keep flow
            })
          );
        }

        // 2. Execute Batch (Parallel)
        const batchResults = await Promise.all(promises);

        let finished = false;

        // 3. Process Results
        for (const json of batchResults) {
          if (!Array.isArray(json) || json.length === 0) {
            finished = true; // No data means end of stream
            continue;
          }
          allItems = allItems.concat(json);

          // If less than limit, it's the last page
          if (json.length < params.limit) {
            finished = true;
          }
        }

        if (finished) break;

        page += BATCH_SIZE;

        // Safety Break
        if (page > 1000) {
          console.warn('[Danbooru Grass] Hit safety page limit.');
          break;
        }

        // 4. Batch Delay
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES));
      }
      return allItems;
    }

    /**
     * Gets statistics about the cache usage.
     * @return {Promise<Object>} Object containing count and size stats.
     */
    async getCacheStats() {
      const stats = {
        indexedDB: {
          count: 0,
          size: 0
        },
        localStorage: {
          count: 0,
          size: 0
        },
      };

      // 1. IndexedDB Stats
      try {
        const tables = ['uploads', 'approvals', 'notes'];
        for (const t of tables) {
          const c = await this.db[t].count();
          stats.indexedDB.count += c;
        }
        // Approximate size: navigator.storage (Origin total)
        if (navigator.storage && navigator.storage.estimate) {
          const est = await navigator.storage.estimate();
          if (est.usageDetails && est.usageDetails.indexedDB) {
            stats.indexedDB.size = est.usageDetails.indexedDB;
          } else {
            stats.indexedDB.size = est.usage; // Fallback to total origin usage
          }
        }
      } catch (e) {
        console.warn('Failed to get IDB stats', e);
      }

      // 2. LocalStorage Stats
      let lsCount = 0;
      let lsSize = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith(CONFIG.STORAGE_PREFIX)) {
          lsCount++;
          const val = localStorage.getItem(k);
          if (val) lsSize += (k.length + val.length) * 2;
        }
      }
      stats.localStorage.count = lsCount;
      stats.localStorage.size = lsSize;

      return stats;
    }
  }

  // --- 4. Graph Renderer (UI) ---
  /**
   * Handles DOM manipulation and graph rendering.
   */
  class GraphRenderer {
    /**
     * @param {SettingsManager} settingsManager The settings manager instance.
     */
    constructor(settingsManager, db) {
      this.containerId = 'danbooru-grass-container';
      this.cal = null;
      this.settingsManager = settingsManager;
      this.db = db;
    }

    /**
     * Injects the skeleton HTML structure into the page.
     * @return {boolean} True if injection was successful or already exists.
     */
    injectSkeleton() {
      // Check if container already exists
      if (document.getElementById(this.containerId)) {
        return true; // Preservation Logic: Do not destroy!
      }

      // Normal Injection Logic
      let stats = document.querySelector(CONFIG.SELECTORS.STATISTICS_SECTION);
      // Fallbacks...
      if (!stats) {
        const table = document.querySelector(
          '#a-show > div:nth-child(1) > div:nth-child(2) > table'
        );
        if (table) stats = table.parentElement;
      }
      if (!stats) {
        // Text Fallback (H1/H2)
        document.querySelectorAll('h1, h2').forEach((el) => {
          if (el.textContent.trim() === 'Statistics') stats = el.parentElement;
        });
      }

      if (!stats) {
        console.error('[Danbooru Grass] Injection point not found.');
        return false;
      }

      // Wrapper Logic
      let wrapper = document.getElementById('danbooru-grass-wrapper');
      if (!wrapper) {
        if (stats.parentNode.id === 'danbooru-grass-wrapper') {
          wrapper = stats.parentNode;
        } else {
          wrapper = document.createElement('div');
          wrapper.id = 'danbooru-grass-wrapper';
          wrapper.style.display = 'flex';
          wrapper.style.alignItems = 'flex-start';
          wrapper.style.gap = '20px';
          wrapper.style.flexWrap = 'wrap';
          wrapper.style.width = '100%';
          stats.parentNode.insertBefore(wrapper, stats);
          wrapper.appendChild(stats);
        }
      }

      const container = document.createElement('div');
      container.id = this.containerId;
      container.style.flex = '1';
      container.style.minWidth = '300px';
      container.style.background = 'var(--card-background-color, #222)';
      container.style.padding = '15px';
      container.style.borderRadius = '8px';
      container.style.minHeight = '180px';
      container.style.color = 'var(--text-color, #eee)';
      container.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:10px; align-items:center;">
          <h2 style="font-size:1.2em; margin:0;">Contribution Graph</h2>
          <div id="grass-controls" style="gap:10px; display:flex;"></div>
        </div>
        <div id="cal-heatmap" style="overflow-x:auto; padding-bottom:5px;"></div>
        <div id="grass-loading" style="text-align:center; padding:20px; color:#888;">Initializing...</div>
      `;

      // Apply Initial Theme
      const currentTheme = this.settingsManager.getTheme();
      this.settingsManager.applyTheme(currentTheme);

      wrapper.appendChild(container);

      // Create Tooltip Element globally
      if (!document.getElementById('danbooru-grass-tooltip')) {
        const tooltip = document.createElement('div');
        tooltip.id = 'danbooru-grass-tooltip';
        tooltip.style.position = 'absolute';
        tooltip.style.padding = '8px';
        tooltip.style.background = '#222';
        tooltip.style.color = '#fff';
        tooltip.style.borderRadius = '4px';
        tooltip.style.border = '1px solid #444';
        tooltip.style.pointerEvents = 'none';
        tooltip.style.opacity = '0';
        tooltip.style.zIndex = '99999';
        tooltip.style.fontSize = '12px';
        document.body.appendChild(tooltip);
      }

      return true;
    }

    /**
     * Updates the control/filter UI.
     * @param {Array<number>} availableYears List of available years.
     * @param {number} currentYear Currently selected year.
     * @param {string} currentMetric Currently selected metric.
     * @param {Function} onYearChange Callback for year change.
     * @param {Function} onMetricChange Callback for metric change.
     * @param {Function} onRefresh Callback for refresh.
     */
    updateControls(availableYears, currentYear, currentMetric, onYearChange, onMetricChange, onRefresh) {
      const controls = document.getElementById('grass-controls');
      if (!controls) return;
      controls.innerHTML = '';

      const metricSel = document.createElement('select');
      metricSel.className = 'ui-select';
      ['uploads', 'approvals', 'notes'].forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.text = m.charAt(0).toUpperCase() + m.slice(1);
        if (m === currentMetric) opt.selected = true;
        metricSel.appendChild(opt);
      });
      metricSel.onchange = (e) => onMetricChange(e.target.value);
      controls.appendChild(metricSel);
    }

    /**
     * Toggles the loading state UI.
     * @param {boolean} isLoading True to show loading state.
     */
    setLoading(isLoading) {
      const el = document.getElementById('grass-loading');
      if (el) el.style.display = isLoading ? 'block' : 'none';
      const cal = document.getElementById('cal-heatmap');
      if (cal) cal.style.opacity = isLoading ? '0.5' : '1';
    }

    /**
     * Renders the contribution graph.
     * @param {Object} dataMap Map of date strings to counts.
     * @param {number} year The year to render.
     * @param {string} metric The metric being displayed.
     * @param {Object} userInfo User info object.
     * @param {Array<number>} availableYears List of available years.
     * @param {Function} onYearChange Callback for year change.
     * @param {Function} onRefresh Callback for refresh.
     */
    async renderGraph(dataMap, year, metric, userInfo, availableYears, onYearChange, onRefresh) {
      // Update Header with Total Count and Embedded Year Selector
      const total = Object.values(dataMap || {}).reduce((acc, v) => acc + v, 0);
      const header = document.querySelector('#danbooru-grass-container h2');

      if (header) {
        header.innerHTML = ''; // Clear existing text

        // 1. Text Part
        const textSpan = document.createElement('span');
        textSpan.textContent = `${total.toLocaleString()} contributions in `;
        header.appendChild(textSpan);

        // 2. Year Selector Part
        if (availableYears && onYearChange) {
          const yearSelect = document.createElement('select');
          yearSelect.style.cssText = `
            font-family: inherit;
            font-size: inherit;
            font-weight: normal;
            color: #24292f;
            background-color: #f6f8fa;
            border: 1px solid #d0d7de;
            border-radius: 6px;
            padding: 2px 4px;
            margin-left: 6px;
            cursor: pointer;
            vertical-align: baseline;
          `;

          availableYears.forEach((y) => {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = y;
            if (y === year) opt.selected = true;
            yearSelect.appendChild(opt);
          });

          yearSelect.onchange = (e) => onYearChange(parseInt(e.target.value, 10));
          header.appendChild(yearSelect);
        } else {
          // Fallback if no controls passed (e.g. init)
          header.appendChild(document.createTextNode(year));
        }
      }

      if (window.cal && typeof window.cal.destroy === 'function') {
        try {
          window.cal.destroy();
        } catch (e) {
          console.warn('[Danbooru Grass] Failed to destroy previous instance:', e);
        }
      }
      window.cal = new CalHeatmap();

      const userName = userInfo.name || userInfo;

      // Ensure our container structure supports the side-label + scrollable graph
      const container = document.getElementById('cal-heatmap');
      if (!container) return;

      const source = Object.entries(dataMap || {}).map(([k, v]) => ({
        date: k,
        value: v
      }));
      const sanitizedName = userName.replace(/ /g, '_');

      const getUrl = (date, count) => {
        if (!date) return null;

        switch (metric) {
          case 'uploads':
            return `/posts?tags=user:${sanitizedName}+date:${date}`;
          case 'approvals':
            return null; // Disable click for approvals (hover only)
          case 'notes':
            return `/posts?tags=noteupdater:${sanitizedName}+date:${date}`;
          default:
            return null;
        }
      };


      // Inject Custom CSS
      const styleId = 'danbooru-grass-styles';
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          /* Container & Header Styling */
          #danbooru-grass-container {
            background: var(--grass-bg, #fff) !important;
            color: var(--grass-text, #24292f) !important;
            border-radius: 6px;
          }
          #danbooru-grass-container h2 {
            color: var(--grass-text, #24292f) !important;
            font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
            font-weight: normal !important;
          }
          /* Controls */
          #grass-controls select {
            background-color: #f6f8fa !important;
            color: #24292f !important;
            border: 1px solid #d0d7de !important;
            border-radius: 6px;
            padding: 2px 2px;
          }
          /* Empty Cells & Domain Backgrounds */
          .ch-subdomain-bg { fill: var(--grass-empty-cell, #ebedf0); }
          .ch-domain-bg { fill: transparent !important; } /* Fix black bars */

          /* All SVG Text (Months & Days) */
          #cal-heatmap text,
          #gh-day-labels text {
            fill: var(--grass-text, #24292f) !important;
            font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
            font-size: 10px;
          }

          /* Scrollable Area */
          #cal-heatmap-scroll {
            overflow-x: auto;
            overflow-y: hidden;
            flex: 1;
            white-space: nowrap;
          }
          #cal-heatmap-scroll::-webkit-scrollbar { height: 8px; }
          #cal-heatmap-scroll::-webkit-scrollbar-thumb {
            background: var(--grass-scrollbar-thumb, #d0d7de);
            border-radius: 4px;
          }

          /* Settings Popover */
          #danbooru-grass-settings-popover {
            position: absolute;
            top: 0;
            left: 45px;
            bottom: auto;
            background: #fff;
            color: #24292f;
            border: 1px solid #d0d7de;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            border-radius: 8px;
            padding: 12px;
            z-index: 10000;
            display: none;
            width: 290px;
            transform-origin: top left;
          }
          .theme-grid {
            display: grid;
            grid-template-columns: repeat(6, 1fr);
            gap: 8px;
          }
          .theme-icon {
            width: 36px;
            height: 36px;
            border-radius: 8px;
            position: relative;
            cursor: pointer;
            border: 2px solid transparent;
            box-sizing: border-box;
          }
          .theme-icon:hover { transform: scale(1.1); }
          .theme-icon.active { border-color: #0969da; }
          .theme-icon-inner {
            position: absolute;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            width: 16px; height: 16px;
            border-radius: 4px;
          }
          .popover-header {
            font-weight: 600;
            font-size: 12px;
            color: #24292f;
            margin-bottom: 8px;
          }
          .popover-select {
            width: 100%;
            margin-bottom: 10px;
            padding: 4px;
            border-radius: 4px;
            border: 1px solid #d0d7de;
            background-color: #f6f8fa;
            font-size: 12px;
          }
          .threshold-row {
            display: flex;
            align-items: center;
            margin-bottom: 6px;
            font-size: 12px;
          }
          .threshold-input {
            width: 60px;
            margin-left: auto;
            padding: 2px 4px;
            border: 1px solid #d0d7de;
            border-radius: 4px;
          }
        `;
        document.head.appendChild(style);
      }

      // Ensure our container structure supports the side-label + scrollable graph

      container.innerHTML = ''; // Reset
      container.style.display = 'flex';
      container.style.flexDirection = 'row';
      container.style.alignItems = 'flex-start'; // Align Top to avoid Scrollbar offset
      container.style.overflow = 'hidden';

      // 1. Label Column
      const labels = document.createElement('div');
      labels.id = 'gh-day-labels';
      labels.style.display = 'flex';
      labels.style.flexDirection = 'column';
      // Align padding-top: Month Header (20px)
      labels.style.paddingTop = '20px';
      labels.style.paddingRight = '5px';
      labels.style.marginRight = '5px';
      labels.style.textAlign = 'right';
      labels.style.flexShrink = '0';
      labels.style.color = 'var(--grass-text, #24292f)';
      labels.style.fontSize = '9px';

      // Align "Mon, Wed, Fri" to rows 1, 3, 5 (Sunday is Row 0)
      // Grid Stride = Cell Height (11) + Gutter (2).
      // To match perfectly, we use divs of Height 11px and Margin-Bottom 2px.
      const rowStyle = 'height:11px; line-height:11px; margin-bottom:2px;';
      const hiddenStyle = 'height:11px; visibility:hidden; margin-bottom:2px;';
      const lastHiddenStyle = 'height:11px; visibility:hidden; margin-bottom:0;';

      labels.innerHTML = `
        <div style="${hiddenStyle}"></div> <!-- Sun (0) -->
        <div style="${rowStyle}">Mon</div> <!-- Mon (1) -->
        <div style="${hiddenStyle}"></div> <!-- Tue (2) -->
        <div style="${rowStyle}">Wed</div> <!-- Wed (3) -->
        <div style="${hiddenStyle}"></div> <!-- Thu (4) -->
        <div style="${rowStyle}">Fri</div> <!-- Fri (5) -->
        <div style="${lastHiddenStyle}"></div> <!-- Sat (6) -->
      `;
      container.appendChild(labels);

      // 2. Scrollable Graph Wrapper
      const scrollWrapper = document.createElement('div');
      scrollWrapper.id = 'cal-heatmap-scroll';
      scrollWrapper.style.minHeight = '140px'; // Ensure height for graph
      container.appendChild(scrollWrapper);

      // 3. Footer (Settings & Legend)
      const mainContainer = document.getElementById('danbooru-grass-container');
      if (!document.getElementById('danbooru-grass-footer')) {
        const footer = document.createElement('div');
        footer.id = 'danbooru-grass-footer';
        footer.style.display = 'flex';
        footer.style.justifyContent = 'space-between';
        footer.style.alignItems = 'center';
        footer.style.padding = '5px 20px 10px 0px'; // Added left padding
        footer.style.marginTop = '10px';
        mainContainer.appendChild(footer);

        // 3.1 Settings Button (Left)
        const settingsBtn = document.createElement('div');
        settingsBtn.id = 'danbooru-grass-settings';
        settingsBtn.title = 'Settings';
        settingsBtn.style.cssText = `
          padding: 2px 8px;
          border: 1px solid #d0d7de;
          border-radius: 6px;
          background-color: #f6f8fa;
          cursor: pointer;
          display: flex;
          align-items: center;
          color: #57606a;
        `;
        settingsBtn.innerHTML = `
          <svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" style="fill: currentColor;">
            <path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.292.028 1.555.563l.566 1.142c.27.547.106 1.181-.394 1.524l-.904.621c-.056.038-.076.104-.076.17a8.7 8.7 0 0 0 0 1.018c0 .066.02.132.076.17l.904.62c.5.344.664.978.394 1.524l-.566 1.142c-.263.535-.91.74-1.555.563l-1.103-.303c-.066-.019-.176-.011-.299.071a6.8 6.8 0 0 1-.668.386c-.133.066-.194.158-.212.224l-.288 1.107c-.17.646-.716 1.196-1.461 1.26a8.2 8.2 0 0 1-.701.031 8.2 8.2 0 0 1-.701-.031c-.745-.064-1.29-.614-1.461-1.26l-.288-1.106c-.018-.066-.079-.158-.212-.224a6.8 6.8 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.292-.028-1.555-.563l-.566-1.142c-.27-.547-.106-1.181.394-1.524l.904-.621c.056-.038.076-.104.076-.17a8.7 8.7 0 0 0 0-1.018c0-.066-.02-.132-.076-.17l-.904-.62c-.5-.344-.664-.978-.394-1.524l.566-1.142c.263-.535.91-.74 1.555-.563l1.103.303c.066.019.176.011.299-.071.214-.143.437-.272.668-.386.133-.066.194-.158.212-.224l.288-1.107C6.71.645 7.256.095 8.001.031A8.2 8.2 0 0 1 8 0Zm-.571 1.525c-.036.003-.108.036-.123.098l-.289 1.106c-.17.643-.64 1.103-1.246 1.218a5.2 5.2 0 0 0-1.157.669c-.53.411-1.192.427-1.748.046l-.904-.621c-.055-.038-.135-.04-.158.006l-.566 1.142c-.023.047.013.109.055.137l.904.621a1.9 1.9 0 0 1 0 3.23l-.904.621c-.042.029-.078.09-.055.137l.566 1.142c.023.047.103.044.158.006l.904-.621c.556-.38 1.218-.365 1.748.046.348.27.753.496 1.157.669.606.115 1.076.575 1.246 1.218l.289 1.106c.015.062.087.095.123.098.36.031.725.031 1.082 0 .036-.003.108-.036.123-.098l.289-1.106c.17-.643.64-1.103 1.246-1.218.404-.173.809-.399 1.157-.669.53-.411 1.192-.427 1.748-.046l.904.621c.055.038.135.04.158-.006l.566-1.142c.023-.047-.013-.109-.055-.137l-.904-.621a1.9 1.9 0 0 1 0-3.23l.904-.621c.042-.029.078-.09.055-.137l-.566-1.142c-.023-.047-.103-.044-.158-.006l-.904.621c-.556.38-1.218.365-1.748-.046a5.2 5.2 0 0 0-1.157-.669c-.606-.115-1.076-.575-1.246-1.218l-.289-1.106c-.015-.062-.087-.095-.123-.098a6.5 6.5 0 0 0-1.082 0ZM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"></path>
          </svg>
        `;
        let settingsChanged = false;

        const validateThresholds = () => {
          const modes = ['uploads', 'approvals', 'notes'];
          for (const m of modes) {
            const vals = this.settingsManager.getThresholds(m);
            for (let i = 0; i < vals.length - 1; i++) {
              if (vals[i] >= vals[i + 1]) {
                return {
                  valid: false,
                  msg: `Invalid in [${m}]: Level ${i + 1} (${vals[i]}) must be smaller than Level ${i + 2} (${vals[i + 1]})`,
                };
              }
            }
          }
          return { valid: true };
        };

        const closeSettings = () => {
          const pop = document.getElementById('danbooru-grass-settings-popover');
          if (pop) {
            // Validation Check
            const check = validateThresholds();
            if (!check.valid) {
              alert(check.msg);
              return; // Do NOT close
            }

            pop.style.display = 'none';
            if (settingsChanged) {
              console.log('[Danbooru Grass] Settings changed. Refreshing view...');
              settingsChanged = false; // Reset
              if (typeof onYearChange === 'function') {
                onYearChange(year);
              }
            }
          }
        };

        settingsBtn.onmouseover = () => {
          settingsBtn.style.backgroundColor = '#eaeef2';
        };
        settingsBtn.onmouseout = () => {
          settingsBtn.style.backgroundColor = '#f6f8fa';
        };
        settingsBtn.onclick = (e) => {
          const pop = document.getElementById('danbooru-grass-settings-popover');
          if (pop) {
            const current = pop.style.display;
            if (current === 'block') {
              closeSettings();
            } else {
              pop.style.display = 'block';
            }
            e.stopPropagation();
          }
        };
        footer.appendChild(settingsBtn);

        // 3.1.5 Settings Popover
        const popover = document.createElement('div');
        popover.id = 'danbooru-grass-settings-popover';

        // Close on click outside
        document.addEventListener('click', (e) => {
          if (popover && popover.style.display === 'block') {
            if (
              !popover.contains(e.target) &&
              !settingsBtn.contains(e.target)
            ) {
              closeSettings();
            }
          }
        });

        // --- 1. Color Themes Section ---
        const themeHeader = document.createElement('div');
        themeHeader.className = 'popover-header';
        themeHeader.textContent = 'Color Themes';
        popover.appendChild(themeHeader);

        const grid = document.createElement('div');
        grid.className = 'theme-grid';

        const currentTheme = this.settingsManager.getTheme();

        Object.entries(CONFIG.THEMES).forEach(([key, theme]) => {
          const icon = document.createElement('div');
          icon.className = 'theme-icon';
          if (key === currentTheme) icon.classList.add('active'); // Highlight active theme
          icon.title = theme.name;
          icon.style.background = theme.bg;

          // Inner Circle (Empty Cell Color)
          const inner = document.createElement('div');
          inner.className = 'theme-icon-inner';
          inner.style.background = theme.empty;
          icon.appendChild(inner);

          icon.onclick = () => {
            this.settingsManager.applyTheme(key);
            // Update active state visual
            document.querySelectorAll('.theme-icon').forEach((el) => el.classList.remove('active'));
            icon.classList.add('active');
          };
          grid.appendChild(icon);
        });
        popover.appendChild(grid);

        // --- 2. Thresholds Section ---
        const threshHeader = document.createElement('div');
        threshHeader.className = 'popover-header';
        threshHeader.textContent = 'Set thresholds';
        threshHeader.style.marginTop = '15px';
        popover.appendChild(threshHeader);

        // Mode Selector
        const modeSelect = document.createElement('select');
        modeSelect.className = 'popover-select';
        ['uploads', 'approvals', 'notes'].forEach((m) => {
          const opt = document.createElement('option');
          opt.value = m;
          opt.textContent = m.charAt(0).toUpperCase() + m.slice(1);
          if (m === metric.toLowerCase() || (m === 'uploads' && !metric)) opt.selected = true;
          modeSelect.appendChild(opt);
        });
        popover.appendChild(modeSelect);

        // Editor Container
        const editor = document.createElement('div');
        popover.appendChild(editor);

        const renderEditor = (mode) => {
          editor.innerHTML = '';
          const vals = this.settingsManager.getThresholds(mode);
          const inputColors = ['#9be9a8', '#40c463', '#30a14e', '#216e39'];

          vals.forEach((val, idx) => {
            const row = document.createElement('div');
            row.className = 'threshold-row';

            const label = document.createElement('span');
            label.textContent = `Level ${idx + 1}:`;
            label.style.width = '50px';

            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'threshold-input';
            input.value = val;

            // Styling
            input.style.backgroundColor = inputColors[idx];
            input.style.color = '#ffffff';
            input.style.textShadow = '0px 1px 2px rgba(0,0,0,0.8)';
            input.style.fontWeight = 'bold';
            input.style.border = '1px solid #d0d7de';
            input.style.borderRadius = '4px';

            input.onchange = () => {
              const newVals = [...vals];
              newVals[idx] = parseInt(input.value);
              // Update Settings directly (Validation deferred to close)
              this.settingsManager.setThresholds(mode, newVals);
              settingsChanged = true;
              vals[idx] = newVals[idx];
            };

            row.appendChild(label);
            row.appendChild(input);
            editor.appendChild(row);
          });
        };

        modeSelect.addEventListener('change', () => renderEditor(modeSelect.value));
        renderEditor(modeSelect.value); // Initial Render

        // --- 3.1.5 Cache Info Section ---
        const cacheSection = document.createElement('div');
        cacheSection.style.marginTop = '15px';
        cacheSection.style.borderTop = '1px solid #d0d7de';
        cacheSection.style.paddingTop = '10px';

        // Header with Purge Button
        const cacheHeader = document.createElement('div');
        cacheHeader.style.display = 'flex';
        cacheHeader.style.justifyContent = 'space-between';
        cacheHeader.style.alignItems = 'center';
        cacheHeader.style.marginBottom = '5px';
        cacheHeader.innerHTML = `
          <div style="font-weight:bold; color:#24292f;">Cache Info</div>
          <button id="grass-purge-btn" title="Purge Cache" style="
            padding: 2px 6px;
            background-color: #ffebe9;
            border: 1px solid #ff818266;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            color: #cf222e;
            line-height: 1;
          ">↺</button>
        `;
        cacheSection.appendChild(cacheHeader);

        // Stats Container (Toggleable)
        const cacheStatsContainer = document.createElement('div');
        cacheStatsContainer.id = 'grass-cache-container';
        cacheStatsContainer.innerHTML = `
          <div style="font-size:12px; margin-bottom:10px;">
            <a href="#" id="grass-cache-trigger" style="color:#0969da; text-decoration:none;">[ Show Stats ]</a>
          </div>
          <div id="grass-cache-content" style="display:none;"></div>
        `;
        cacheSection.appendChild(cacheStatsContainer);
        popover.appendChild(cacheSection);

        // Logic
        const trigger = cacheSection.querySelector('#grass-cache-trigger');
        const contentDiv = cacheSection.querySelector('#grass-cache-content');
        const purgeBtn = cacheSection.querySelector('#grass-purge-btn');

        const formatBytes = (bytes, decimals = 2) => {
          if (!+bytes) return '0 B';
          const k = 1024;
          const dm = decimals < 0 ? 0 : decimals;
          const sizes = ['B', 'KB', 'MB', 'GB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
        };

        let isStatsVisible = false;
        let statsInterval = null;

        const updateMyStats = async () => {
          const dataManager = new DataManager(this.db);
          const stats = await dataManager.getCacheStats();
          contentDiv.innerHTML = `
            <table style="width:100%; border-collapse:collapse; font-size:11px;">
              <tr style="border-bottom:1px solid #eee;">
                <th style="text-align:left; padding:2px;">Source</th>
                <th style="text-align:right; padding:2px;">Items</th>
                <th style="text-align:right; padding:2px;">Size</th>
              </tr>
              <tr>
                <td style="padding:2px;">IndexedDB</td>
                <td style="text-align:right; padding:2px;">${stats.indexedDB.count}</td>
                <td style="text-align:right; padding:2px;">${formatBytes(stats.indexedDB.size)}</td>
              </tr>
              <tr>
                <td style="padding:2px;">Settings</td>
                <td style="text-align:right; padding:2px;">${stats.localStorage.count}</td>
                <td style="text-align:right; padding:2px;">${formatBytes(stats.localStorage.size)}</td>
              </tr>
            </table>
          `;
        };

        trigger.onclick = async (e) => {
          e.preventDefault();

          if (isStatsVisible) {
            // Hide
            contentDiv.style.display = 'none';
            trigger.textContent = '[ Show Stats ]';
            isStatsVisible = false;
            if (statsInterval) {
              clearInterval(statsInterval);
              statsInterval = null;
            }
          } else {
            // Show
            trigger.textContent = 'Calculating...';
            contentDiv.style.display = 'block';
            await updateMyStats(); // Initial load
            trigger.textContent = '[ Hide Stats ]';
            isStatsVisible = true;

            // Start Polling (Real-time updates)
            if (statsInterval) clearInterval(statsInterval);
            statsInterval = setInterval(() => {
              if (isStatsVisible && popover.style.display === 'block') {
                updateMyStats();
              } else {
                // Safety clear
                clearInterval(statsInterval);
              }
            }, 100);
          }
        };

        purgeBtn.onclick = () => {
          if (confirm(
            'Are you sure you want to clear all cached data? This will trigger a full re-fetch.'
          )) {
            onRefresh();
          }
        };

        footer.appendChild(popover); // Append to footer so it's relative
        footer.style.position = 'relative'; // Ensure popover positions correctly

        // 3.2 Legend (Right)
        const legend = document.createElement('div');
        legend.id = 'danbooru-grass-legend';
        legend.style.display = 'flex';
        legend.style.justifyContent = 'flex-end';
        legend.style.alignItems = 'center';
        legend.style.fontSize = '10px';
        legend.style.color = 'var(--grass-text, #57606a)';
        legend.style.gap = '4px';

        // Custom Thresholds Logic (Empty + 4 Levels)
        const colors = [
          'var(--grass-empty-cell)', '#9be9a8', '#40c463', '#30a14e', '#216e39'
        ];
        // const thresholds = this.settingsManager.getThresholds(metric); // Unused local var

        // Create Legend Rects
        // Colors[0] is Empty (< T1).
        // Colors[1] is L1 (>= T1).
        // ...
        // Colors[4] is L4 (>= T4).
        const rects = colors.map((c) =>
          `<div style="width:10px; height:10px; background:${c}; border-radius:2px;"></div>`
        ).join('');

        legend.innerHTML = `
          <span style="margin-right:4px;">Less</span>
          ${rects}
          <span style="margin-left:4px;">More</span>
        `;
        footer.appendChild(legend);
      }

      console.log(
        `[Danbooru Grass] Rendering graph for ${year}. Data points: ${source.length}`
      );

      // --- GUARD: Empty Data Guard ---
      if (source.length === 0) {
        // If no data, CalHeatmap v3 (or wrappers) might crash on paint with empty source.
        // Or specific options trigger it. To be safe/clean, we show a message.
        if (container) {
          container.innerHTML = `
            <div style="text-align:center; padding:40px; color:#888;">
              <div style="font-size:2em; margin-bottom:10px;">📉</div>
              No contributions found for <strong>${year}</strong>.<br>
              <span style="font-size:0.9em;">(Try clicking the "Refresh" or "Sync" button if this is unexpected)</span>
            </div>
          `;
        }
        return;
      }

      const currentThresholds = this.settingsManager.getThresholds(metric);

      window.cal.paint({
        itemSelector: '#cal-heatmap-scroll',
        range: 12,
        domain: {
          type: 'month',
          gutter: 3,
          label: {
            position: 'top',
            text: 'MMM',
            height: 20,
            textAlign: 'start'
          },
        },
        subDomain: {
          type: 'day',
          radius: 2,
          width: 11,
          height: 11,
          gutter: 2,
          label: null,
        },
        // Align start date to Local Jan 1st 00:00, represented as UTC to match data
        date: {
          start: new Date(
            new Date(year, 0, 1).getTime() -
            (new Date().getTimezoneOffset() * 60000)
          )
        },
        data: {
          source: source,
          x: 'date',
          y: 'value'
        },
        scale: {
          color: {
            range: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
            domain: currentThresholds,
            type: 'threshold',
          },
        },
        theme: 'light',
      })
        .then(() => {
          console.log('[Danbooru Grass] Render complete.');
          // Re-apply Styles and Interaction
          setTimeout(() => {
            const tooltip = d3.select('#danbooru-grass-tooltip');

            // Helper: Smart Tooltip Positioning
            const updateTooltip = (event, content) => {
              tooltip.style('opacity', 1).html(content);

              const node = tooltip.node();
              if (!node) return;

              const rect = node.getBoundingClientRect();
              const viewportWidth = window.innerWidth;

              // Default Position: Right (+10), Top (-28)
              let left = event.pageX + 10;
              let top = event.pageY - 28;

              // Check for Right Overflow
              if (left + rect.width > viewportWidth - 20) {
                // Overflow detected: Switch to "Top-Centered"
                // Position above the cursor, centered horizontally
                left = event.pageX - (rect.width / 2);
                top = event.pageY - rect.height - 15; // Move appropriately above

                // Safety: Don't overflow left
                if (left < 5) left = 5;
              }

              tooltip
                .style('left', left + 'px')
                .style('top', top + 'px');
            };

            // --- Auto-Scroll to Current Date (Refined) ---
            const scrollContainer = document.getElementById('cal-heatmap-scroll');
            if (scrollContainer) {
              if (year === new Date().getFullYear()) {
                const currentMonth = new Date().getMonth() + 1; // 1-12
                // Find the Nth .ch-domain (Month) element
                // We look for 'svg.ch-domain' or just '.ch-domain' that are direct children if possible
                // Based on user feedback, it seems to be 'svg.ch-domain'
                const targetMonth = scrollContainer.querySelector(`.ch-domain:nth-of-type(${currentMonth})`);

                if (targetMonth) {
                  const containerRect = scrollContainer.getBoundingClientRect();
                  const elementRect = targetMonth.getBoundingClientRect();
                  // Scroll to the element with a slight padding
                  scrollContainer.scrollLeft += (elementRect.left - containerRect.left - 10);
                } else {
                  // Fallback: Scroll to end
                  scrollContainer.scrollLeft = scrollContainer.scrollWidth;
                }
              } else {
                scrollContainer.scrollLeft = 0;
              }
            }

            // 1. Tooltips for Graph Cells
            d3.selectAll('#cal-heatmap-scroll rect')
              .attr('rx', 2).attr('ry', 2) // Apply border radius
              .on('mouseover', function (event, d) {
                // Fallback for datum if D3 binding is tricky
                const datum = d || d3.select(this).datum();
                if (!datum || !datum.t) return;

                const count = (datum.v !== null && datum.v !== undefined) ? datum.v : 0;
                const dateStr = new Date(datum.t).toISOString().split('T')[0];

                updateTooltip(event, `<strong>${dateStr}</strong>, ${count} ${metric}`);
              })
              .on('mouseout', () => tooltip.style('opacity', 0))
              .on('click', function (event, d) {
                const datum = d || d3.select(this).datum();
                if (!datum || !datum.t) return;
                // Enable click even if value is 0
                const count = (datum.v !== null && datum.v !== undefined) ? datum.v : 0;
                const dateStr = new Date(datum.t).toISOString().split('T')[0];
                const link = getUrl(dateStr, count);
                if (link) window.open(link, '_blank');
              });

            // 2. Tooltips for Legend Cells
            // Calculate ranges based on thresholds [t1, t2, t3, t4]
            // Box 0: Less than t1 (usually 0 if t1=1)
            // Box 1: t1 to t2-1
            // Box 2: t2 to t3-1
            // Box 3: t3 to t4-1
            // Box 4: t4+

            const t = this.settingsManager.getThresholds(metric);
            const legendThresholds = [
              `${t[0] > 1 ? `0-${t[0] - 1}` : '0'} (Less)`,
              `${t[0]}-${t[1] - 1}`,
              `${t[1]}-${t[2] - 1}`,
              `${t[2]}-${t[3] - 1}`,
              `${t[3]}+ (More)`,
            ];

            // Select the 6 manual colored divs in the legend
            // We target > div because we built the legend with standard HTML divs, not SVG.
            const legendDivs = d3.selectAll('#danbooru-grass-legend > div');

            legendDivs.each(function (d, i) {
              if (i >= 0 && i < legendThresholds.length) {
                d3.select(this)
                  .on('mouseover', function (event) {
                    updateTooltip(event, legendThresholds[i]);
                  })
                  .on('mouseout', () => tooltip.style('opacity', 0));
              }
            });
          }, 300); // Increased timeout significantly to ensure render is done
        })
        .catch((err) => {
          console.error('[Danbooru Grass] Render failed:', err);
        });
    }

    /**
     * Renders an error message in the container.
     * @param {string} message The error message.
     * @param {Function} onRetry Retry callback.
     */
    renderError(message, onRetry) {
      const container = document.getElementById(this.containerId);
      if (!container) return;
      container.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:140px; color:#cf222e; text-align:center;">
          <div style="font-weight:bold; margin-bottom:8px;">Unable to load contribution data</div>
          <div style="font-size:0.9em; margin-bottom:12px; color: var(--grass-text, #57606a);">${message}</div>
          <button id="grass-retry-btn" style="
            padding: 5px 16px;
            background-color: #f6f8fa;
            border: 1px solid #d0d7de;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            color: #24292f;
          ">Retry</button>
        </div>
      `;
      const btn = document.getElementById('grass-retry-btn');
      if (btn) btn.onclick = onRetry;
    }
  }

  // --- Main Execution ---
  /**
   * Main entry point of the script.
   */
  // --- 5. Applications ---

  /**
   * GrassApp: Encapsulates the contribution graph functionality (Legacy/Existing).
   */
  class GrassApp {
    constructor(db, settings, context) {
      this.db = db;
      this.settings = settings;
      this.context = context;
    }

    async run() {
      console.log('🌱 Starting GrassApp...');
      const context = this.context;

      // We pass the Shared DB instance to DataManager
      const dataManager = new DataManager(this.db);
      // We pass the Shared Settings instance to GraphRenderer
      const renderer = new GraphRenderer(this.settings, this.db);

      const injected = renderer.injectSkeleton();
      if (!injected) {
        console.log('[Danbooru Grass] UI injection failed. Aborting GrassApp.');
        return;
      }

      let currentYear = new Date().getFullYear();
      // Load last mode for this user, duplicate 'uploads' if not found
      const userId = context.targetUser.id || context.targetUser.name;
      let currentMetric = this.settings.getLastMode(userId) || 'uploads';

      const joinYear = context.targetUser.joinDate.getFullYear();
      const years = [];
      const startYear = Math.max(joinYear, 2005);
      for (let y = currentYear; y >= startYear; y--) years.push(y);

      const updateView = async () => {
        const onYearChange = (y) => {
          currentYear = y;
          updateView();
        };

        renderer.setLoading(true);
        try {
          // Initial render for layout
          await renderer.renderGraph(
            {},
            currentYear,
            currentMetric,
            context.targetUser,
            years,
            onYearChange,
            async () => {
              renderer.setLoading(true);
              await dataManager.clearCache(currentMetric, context.targetUser);
              updateView();
            }
          );

          renderer.updateControls(
            years,
            currentYear,
            currentMetric,
            onYearChange,
            (newMetric) => {
              currentMetric = newMetric;
              // Save the new mode preference
              this.settings.setLastMode(userId, currentMetric);
              updateView();
            },
            /* onRefresh */
            async () => {
              renderer.setLoading(true);
              await dataManager.clearCache(currentMetric, context.targetUser);
              updateView();
            },
          );

          const data = await dataManager.getMetricData(
            currentMetric,
            context.targetUser,
            currentYear
          );

          await renderer.renderGraph(
            data,
            currentYear,
            currentMetric,
            context.targetUser,
            years,
            onYearChange,
            async () => {
              renderer.setLoading(true);
              await dataManager.clearCache(currentMetric, context.targetUser);
              updateView();
            }
          );
        } catch (e) {
          console.error(e);
          renderer.renderError(e.message || 'Unknown error occurred', () =>
            updateView()
          );
        } finally {
          renderer.setLoading(false);
        }
      };

      // Initial Load
      updateView();
    }
  }

  /**
   * AnalyticsApp: Manages the new Analytics feature (Button & Modal).
   */
  class AnalyticsApp {
    constructor(db, settings, context) {
      this.db = db;
      this.settings = settings;
      this.context = context;
      this.dataManager = new AnalyticsDataManager(db);
      this.modalId = 'danbooru-grass-analytics-modal';
    }

    run() {
      console.log('📊 Analytics App Initializing...');
      this.injectStyles();
      this.createModal(); // Create hidden modal
      this.injectButton(); // Add entry button
    }

    /**
     * Injects CSS styles for the modal and button.
     */
    injectStyles() {
      const styleId = 'danbooru-grass-analytics-style';
      if (document.getElementById(styleId)) return;

      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        /* Modal Overlay */
        #${this.modalId}-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.4);
          z-index: 10000;
          display: none;
          justify-content: center;
          align-items: center;
          backdrop-filter: blur(2px);
          opacity: 0;
          transition: opacity 0.2s ease;
        }
        #${this.modalId}-overlay.visible {
          display: flex;
          opacity: 1;
        }

        /* Modal Window */
        #${this.modalId}-window {
          width: 80%;
          max-width: 1000px;
          height: 80%;
          background: rgba(255, 255, 255, 0.9);
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.2);
          backdrop-filter: blur(10px);
          display: flex;
          flex-direction: column;
          position: relative;
          color: #333;
          font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
        }

        /* Close Button */
        #${this.modalId}-close {
          position: absolute;
          top: 15px;
          right: 20px;
          font-size: 24px;
          cursor: pointer;
          color: #666;
          z-index: 10;
          line-height: 1;
        }
        #${this.modalId}-close:hover {
          color: #000;
        }

        /* Content Area */
        #${this.modalId}-content {
          padding: 40px;
          overflow-y: auto;
          flex: 1;
        }

        /* Entry Button */
        .analytics-entry-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-left: 10px;
          vertical-align: middle;
          cursor: pointer;
          background: transparent;
          border: none;
          padding: 4px;
          border-radius: 50%;
          transition: background 0.2s;
          font-size: 1.2em;
        }
        .analytics-entry-btn:hover {
          background: rgba(128,128,128,0.2);
        }
      `;
      document.head.appendChild(style);
    }

    /**
     * Creates the modal DOM structure (hidden by default).
     */
    createModal() {
      if (document.getElementById(`${this.modalId}-overlay`)) return;

      const overlay = document.createElement('div');
      overlay.id = `${this.modalId}-overlay`;

      // Window Container
      const windowDiv = document.createElement('div');
      windowDiv.id = `${this.modalId}-window`;

      // Close Button
      const closeBtn = document.createElement('div');
      closeBtn.id = `${this.modalId}-close`;
      closeBtn.innerHTML = '&times;';
      closeBtn.onclick = () => this.toggleModal(false);
      windowDiv.appendChild(closeBtn);

      // Content Area
      const content = document.createElement('div');
      content.id = `${this.modalId}-content`;
      content.innerHTML = `
        <h1 style="margin-top:0; color:#333;">Analytics Dashboard</h1>
        <p style="color:#555;">Select a metric to view detailed reports.</p>
        <!-- Placeholder for future charts -->
      `;
      windowDiv.appendChild(content);

      overlay.appendChild(windowDiv);

      // Close on click outside
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          this.toggleModal(false);
        }
      });

      document.body.appendChild(overlay);
    }

    /**
     * Injects the entry button next to the username.
     */
    injectButton() {
      // Priority 1: H1 containing the username
      let targetElement = null;
      const h1s = document.querySelectorAll('h1');

      // Heuristic: The user name H1 usually matches the title or context
      for (const h1 of h1s) {
        if (h1.textContent.includes(this.context.targetUser.name)) {
          targetElement = h1;
          break;
        }
      }

      // Fallback: Just the first H1 if name match fails (e.g. slight difference)
      if (!targetElement && h1s.length > 0) {
        targetElement = h1s[0];
      }

      if (targetElement) {
        // Container for button + status
        const container = document.createElement('span');
        container.style.display = 'inline-flex';
        container.style.alignItems = 'center';
        container.style.marginLeft = '10px';
        container.style.verticalAlign = 'middle';

        // Button
        const btn = document.createElement('span');
        btn.className = 'analytics-entry-btn';
        btn.title = 'Open Analytics Report';
        btn.innerHTML = '📊';
        btn.style.margin = '0'; // Reset margin since container has it
        btn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();

          // Auto-Sync Check: If not synced, wait for sync THEN open
          if (this.isFullySynced === false) {
            console.log('[Danbooru Grass] Auto-sync triggered on open.');
            try {
              await this.performPartialSync(btn, false);
            } catch (err) {
              console.error('[Danbooru Grass] Auto-sync failed:', err);
            }
          }

          this.toggleModal(true);
        };
        container.appendChild(btn);

        // Status Text (Mobile/Compact friendly)
        const statusText = document.createElement('div');
        statusText.id = `${this.modalId}-header-status`;
        statusText.style.fontSize = '0.5em'; // Relative to H1
        statusText.style.fontWeight = 'normal';
        statusText.style.color = '#888';
        statusText.style.marginLeft = '12px';
        statusText.style.lineHeight = '1.2';
        statusText.innerHTML = ''; // Init empty
        container.appendChild(statusText);

        targetElement.appendChild(container);

        // Initial Status Check
        this.updateHeaderStatus();
      } else {
        console.warn('[AnalyticsApp] Could not find H1 to inject button');
      }
    }

    /**
     * Performs a partial sync/update.
     * @param {HTMLElement} btn Optional button element to update UI.
     * @param {boolean} shouldRender Whether to re-render the dashboard after sync (default: true).
     */
    async performPartialSync(btn = null, shouldRender = true) {
      if (AnalyticsDataManager.isGlobalSyncing) return;

      const originalText = btn ? btn.innerHTML : '';

      // State for Animation
      let animInterval = null;
      let dotCount = 0;
      const state = {
        current: 0,
        total: 0,
        phase: 'FETCHING', // 'FETCHING' or 'PREPARING'
      };

      if (btn) {
        btn.disabled = true;
        btn.style.cursor = 'wait';
      }

      // Animation Loop
      const render = () => {
        dotCount = (dotCount % 3) + 1;
        const dotStr = '.'.repeat(dotCount);
        const percent = state.total > 0 ? Math.floor((state.current / state.total) * 100) : 0;

        let headerHtml = '';
        let subHtml = '';
        let containerColor = '#ff4444';

        if (state.phase === 'PREPARING') {
          containerColor = 'inherit';
          headerHtml = `<div style="color:#00ba7c; font-weight:bold;">Synced: ${state.current.toLocaleString()} / ${state.total.toLocaleString()} (${percent}%)</div>`;
          subHtml = `<div style="font-size:0.8em; color:#ffeb3b; margin-top:2px;">Preparing Report${dotStr}</div>`;
        } else {
          containerColor = '#ff4444';
          headerHtml = `<div style="font-weight:bold;">Synced: ${state.current.toLocaleString()} / ${state.total.toLocaleString()} (${percent}%)</div>`;
          subHtml = `<div style="font-size:0.8em; color:#888; margin-top:2px;">Fetching data${dotStr}</div>`;
        }

        this.updateHeaderStatus(headerHtml + subHtml, containerColor);
      };

      // Start Animation
      render();
      animInterval = setInterval(render, 500);

      const onProgress = (current, total, msg) => {
        state.current = current;
        state.total = total;

        const isComplete = (total > 0 && current >= total);
        if (msg === 'PREPARING' || isComplete) {
          state.phase = 'PREPARING';
        } else {
          state.phase = 'FETCHING';
        }
      };

      try {
        await this.dataManager.syncAllPosts(this.context.targetUser, onProgress);

        if (animInterval) clearInterval(animInterval);

        // Final Status (Green)
        if (shouldRender) {
          const finalStats = await this.dataManager.getSyncStats(this.context.targetUser);
          this.updateHeaderStatus(`Synced: ${finalStats.count.toLocaleString()} / ${finalStats.count.toLocaleString()}`, '#00ba7c');
        }

        if (btn) {
          btn.innerHTML = originalText;
          btn.disabled = false;
          btn.style.cursor = 'pointer';
        }
        if (shouldRender) {
          this.renderDashboard();
          this.toggleModal(true);
        }
      } catch (e) {
        if (animInterval) clearInterval(animInterval);
        console.error(e);
        if (btn) {
          btn.innerHTML = 'ERR';
          btn.disabled = false;
          btn.style.cursor = 'pointer';
        }
        this.updateHeaderStatus('Sync Failed', '#ff4444');
      }
    }

    async updateHeaderStatus(progressText = null, customColor = null) {
      const el = document.getElementById(`${this.modalId}-header-status`);
      if (!el) return;

      if (progressText) {
        // Real-time update during sync
        el.innerHTML = progressText;
        el.style.color = customColor || '#d73a49'; // Use custom or default warning color
        return;
      }

      const dataManager = new AnalyticsDataManager(this.db);
      const stats = await dataManager.getSyncStats(this.context.targetUser);

      // Use Robust Total Fetching
      const total = await dataManager.getTotalPostCount(this.context.targetUser);

      const count = stats.count;
      const lastSyncKey = `danbooru_grass_last_sync_${this.context.targetUser.id}`;
      const lastSync = localStorage.getItem(lastSyncKey);
      const lastSyncText = lastSync ? new Date(lastSync).toLocaleDateString() : 'Never';

      // Dynamic Sync Threshold
      const settingsManager = new SettingsManager();
      const tolerance = settingsManager.getSyncThreshold();
      const isSynced = (total > 0 && count >= total - tolerance);
      this.isFullySynced = isSynced; // Store state for auto-sync check

      // Update UI
      const statusColor = (stats.lastSync && isSynced) ? '#28a745' : '#d73a49';
      el.innerHTML = '';
      el.style.color = statusColor;
      el.title = `Last synced: ${lastSyncText}`;

      // Row 1: Synced Count + Settings Button
      const row1 = document.createElement('div');
      row1.style.display = 'flex';
      row1.style.alignItems = 'center';

      const text1 = document.createElement('span');
      text1.textContent = `Synced: ${count.toLocaleString()} / ${(total || '?').toLocaleString()}`;
      text1.style.color = statusColor; // Force color
      text1.style.fontWeight = 'bold'; // Optional: Make it pop a bit more if needed, but user didn't ask. I'll stick to color.
      row1.appendChild(text1);

      // Settings Button (Gear)
      const settingBtn = document.createElement('span');
      settingBtn.innerHTML = '⚙️';
      settingBtn.style.cursor = 'pointer';
      settingBtn.style.marginLeft = '6px';
      settingBtn.style.fontSize = '12px';
      settingBtn.title = 'Configure Sync Threshold';
      settingBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.showSyncSettingsPopover(settingBtn);
      };
      row1.appendChild(settingBtn);
      el.appendChild(row1);

      // Row 2: Date / Status Text
      const row2 = document.createElement('div');
      if (stats.lastSync && isSynced) {
        row2.innerHTML = `<span style="font-size:1em; font-weight:normal; color:#28a745;">${lastSyncText}</span>`;
      } else {
        row2.textContent = 'Not fully synced';
      }
      el.appendChild(row2);
    }

    /**
     * Shows the Sync Settings Popover.
     * @param {HTMLElement} target The settings button.
     */
    showSyncSettingsPopover(target) {
      // Remove existing
      const existing = document.getElementById('danbooru-grass-sync-settings');
      if (existing) existing.remove();

      const settingsManager = new SettingsManager();
      const currentVal = settingsManager.getSyncThreshold();

      const popover = document.createElement('div');
      popover.id = 'danbooru-grass-sync-settings';
      popover.style.position = 'absolute';
      popover.style.zIndex = '10001';
      popover.style.background = '#fff';
      popover.style.border = '1px solid #ccc';
      popover.style.borderRadius = '6px';
      popover.style.padding = '12px';
      popover.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
      popover.style.fontSize = '11px'; // Reduced by 20%
      popover.style.color = '#333';
      popover.style.width = '220px';

      // Position logic
      const rect = target.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

      popover.style.top = `${rect.top + scrollTop}px`;
      popover.style.left = `${rect.right + scrollLeft + 10}px`;

      popover.innerHTML = `
        <div style="margin-bottom:8px; line-height:1.4;">
          <strong>Partial Sync Threshold</strong><br>
          Allow report view without sync if: <br>
          (Total - Synced) <= Threshold
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between;">
           <input type="number" id="sync-thresh-input" value="${currentVal}" min="0" style="width:60px; padding:3px; border:1px solid #ddd; border-radius:3px; background:#ffffff; color:#000000;">
           <button id="sync-thresh-save" style="background:none; border:1px solid #28a745; color:#28a745; border-radius:4px; cursor:pointer; padding:2px 8px; font-size:11px;">✅ Save</button>
        </div>
      `;

      document.body.appendChild(popover);

      // Close on click outside
      const closeHandler = (e) => {
        if (!popover.contains(e.target) && e.target !== target) {
          popover.remove();
          document.removeEventListener('click', closeHandler);
        }
      };
      setTimeout(() => document.addEventListener('click', closeHandler), 0);

      // Save Handler
      const saveBtn = popover.querySelector('#sync-thresh-save');
      saveBtn.onclick = () => {
        const input = popover.querySelector('#sync-thresh-input');
        const val = parseInt(input.value, 10);
        if (!isNaN(val) && val >= 0) {
          settingsManager.setSyncThreshold(val);
          popover.remove();
          document.removeEventListener('click', closeHandler);
          // Refresh Header Status immediately to reflect new threshold state
          this.updateHeaderStatus();
        } else {
          alert('Please enter a valid number.');
        }
      };
    }

    /**
     * Toggles the visibility of the modal.
     * @param {boolean} show True to show, false to hide.
     */
    toggleModal(show) {
      const overlay = document.getElementById(`${this.modalId}-overlay`);
      if (!overlay) return;

      if (show) {
        overlay.style.display = 'flex';
        // slight delay to allow display:flex to apply before opacity transition
        requestAnimationFrame(() => {
          overlay.classList.add('visible');
        });
        document.body.style.overflow = 'hidden'; // Prevent background scrolling

        // Check Logic: If synced, show dashboard. If not, auto-sync?
        // User request: "Ask user if they want to fetch... if stop, resume later"
        // We will perform this check in renderDashboard
        this.renderDashboard();
      } else {
        overlay.classList.remove('visible');
        setTimeout(() => {
          overlay.style.display = 'none';
          document.body.style.overflow = '';
          this.updateHeaderStatus(); // Update menu status on close
        }, 200); // Match transition duration
      }
    }

    async renderDashboard() {
      const content = document.getElementById(`${this.modalId}-content`);
      if (!content) return;

      content.innerHTML = ''; // Clear previous

      // 1. Header (Flexbox with Refresh Button)
      // NSFW State
      const nsfwKey = 'danbooru_grass_nsfw_enabled';
      let isNsfwEnabled = localStorage.getItem(nsfwKey) === 'true';
      let applyNsfwUpdate = null;
      let isMilestoneExpanded = false;

      // 1. Header (Flexbox with Refresh Button)
      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'flex-start';
      header.style.marginBottom = '25px'; // Increased Spacing
      header.innerHTML = `
        <div>
           <h2 style="margin-top:0; color:#333; margin-bottom:4px;">Analytics Dashboard</h2>
           <p style="color:#555; margin:0;">Detailed statistics and history for ${this.context.targetUser.name}</p>
        </div>
        <div id="analytics-header-controls" style="display:none; align-items:center;">
           <label style="display:flex; align-items:center; margin-right:15px; font-size:13px; color:#57606a; cursor:pointer; user-select:none;">
              <input type="checkbox" id="analytics-nsfw-toggle" ${isNsfwEnabled ? 'checked' : ''} style="margin-right:6px;">
              Enable NSFW
           </label>
           <button id="analytics-refresh-btn" title="Update Data (Partial Sync)" style="
              background: none; 
              border: 1px solid #e1e4e8; 
              border-radius: 6px; 
              padding: 6px 10px; 
              cursor: pointer;
              color: #555;
              transition: all 0.2s;
              margin-right: 8px;
           ">🔄</button>
           <button id="analytics-reset-btn" title="Full Reset (Delete All Data)" style="
              background: none; 
              border: 1px solid #e1e4e8; 
              border-radius: 6px; 
              padding: 6px 10px; 
              cursor: pointer;
              color: #d73a49;
              transition: all 0.2s;
           ">🗑️</button>
        </div>
      `;
      content.appendChild(header);

      // NSFW Logic
      setTimeout(() => {
        const nsfwToggle = header.querySelector('#analytics-nsfw-toggle');
        if (nsfwToggle) {
          nsfwToggle.onchange = (e) => {
            isNsfwEnabled = e.target.checked;
            localStorage.setItem(nsfwKey, isNsfwEnabled);

            // Efficient UI Update (No full re-render)
            const boobsBtn = document.querySelector('.pie-tab[data-mode="breasts"]');
            if (boobsBtn) {
              boobsBtn.style.display = isNsfwEnabled ? 'block' : 'none';
            }

            // If we are currently on the 'Boobs' tab and NSFW is disabled, switch to 'Copy'
            if (!isNsfwEnabled && currentPieTab === 'breasts') {
              currentPieTab = 'copyright';
              if (typeof updatePieTabs === 'function') updatePieTabs();
              if (typeof loadTab === 'function') loadTab('copyright');
            }

            // Also update any other NSFW sensitive elements if they exist
            if (applyNsfwUpdate) applyNsfwUpdate();
          };
        }
      }, 0);

      // Refresh & Reset Handler
      setTimeout(() => {
        const rBtn = header.querySelector('#analytics-refresh-btn');
        const dBtn = header.querySelector('#analytics-reset-btn');

        if (rBtn) {
          rBtn.onclick = async () => {
            // Partial Sync (Update) via reusable method
            await this.performPartialSync(rBtn);
          };
          rBtn.onmouseover = () => rBtn.style.background = '#f6f8fa';
          rBtn.onmouseout = () => rBtn.style.background = 'none';
        }

        if (dBtn) {
          dBtn.onclick = async () => {
            if (confirm("⚠ FULL RESET WARNING ⚠\n\nThis will DELETE all local analytics data for this user and require a full re-sync.\n\nContinue?")) {
              dBtn.innerHTML = '⌛';
              await dataManager.clearUserData(this.context.targetUser);
              alert("Data cleared.");
              this.toggleModal(false);
            }
          };
          dBtn.onmouseover = () => { dBtn.style.background = '#ffeef0'; dBtn.style.borderColor = '#d73a49'; };
          dBtn.onmouseout = () => { dBtn.style.background = 'none'; dBtn.style.borderColor = '#e1e4e8'; };
        }

        // Stale Data Check (Last sync > 7 days)
        const lastSyncKey = `danbooru_grass_last_sync_${this.context.targetUser.id}`;
        const lastSyncStr = localStorage.getItem(lastSyncKey);
        if (lastSyncStr) {
          const lastSyncDate = new Date(lastSyncStr);
          const now = new Date();
          const diffTime = Math.abs(now - lastSyncDate);
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          if (diffDays > 7) {
            // Show Notification Bubble
            const bubble = document.createElement('div');
            bubble.innerHTML = 'Full data refresh required';
            bubble.style.cssText = `
                position: absolute;
                top: -45px;
                right: 0px; 
                background: #ffeb3b;
                color: #333;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 12px;
                z-index: 10001;
                white-space: nowrap;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
              `;

            // Arrow
            const arrow = document.createElement('div');
            arrow.style.cssText = `
                position: absolute;
                bottom: -6px;
                right: 12px;
                width: 0;
                height: 0;
                border-left: 6px solid transparent;
                border-right: 6px solid transparent;
                border-top: 6px solid #ffeb3b;
              `;
            bubble.appendChild(arrow);

            // Wrapper for relative positioning to the button container
            // Note: The parent 'header' is flex, but we can append to the button container if we make it relative
            // Or just append to 'content' (which is the modal body) and use absolute positioning logic.
            // Actually, rBtn is inside the second div of header. Let's make that div relative.
            rBtn.parentNode.style.position = 'relative';
            rBtn.parentNode.appendChild(bubble);

            // Auto remove after 10 seconds
            setTimeout(() => {
              if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
            }, 10000);
          }
        }
      }, 0);

      // Data Check
      const dataManager = new AnalyticsDataManager(this.db);
      const stats = await dataManager.getSyncStats(this.context.targetUser);

      // Robust Total
      const total = await dataManager.getTotalPostCount(this.context.targetUser);

      // Condition: Show Dashboard if Synced OR if we have data and total is unknown (meaning we can't strictly block)
      // Actually, if total is 0, we treat it as incomplete usually.
      // But if count > 0 and total is 0, and we are here...
      // Let's stick to strict gating: Need count >= total.
      // User issue: "Resume Sync not working" was because total=0 and we blocked dashboard.
      // Modified Logic: If total > 0, check count >= total.
      // If total == 0, check if we have "enough" posts? 
      // Or just show "Sync Required" but with a "Force View" option?
      // No, "Resume Sync" should work even if total=0 (fixed in syncAllPosts).
      // So if total=0, we show Sync Screen. User clicks Resume. Sync runs.
      // Sync finishes (because no new items).
      // Re-renders. total=0 again. Screen stays "Required".
      // Loop!

      // FIX: If total is 0, but Last Sync was very recent? 
      // OR: Trust that `syncAllPosts` sets a flag?
      // Alternative: If total is 0, we assume total = count (optimistic). -> Dashboard opens.
      // But we need to know if we *tried* to sync?
      // `stats.lastSync` tells us.
      // If `lastSync` exists, we should probably allow viewing.
      // Usually users want to view *history* even if incomplete.
      // But we gated it.

      // Updated Gating Logic: 
      // If (count < total) AND (total > 0), show Sync Screen.
      // If (total === 0), show Sync Screen ONLY IF count === 0.
      // If we have some posts (count > 0) and total is unknown, SHOW DASHBOARD.
      // This prevents the infinite loop for failed profile fetches.

      // Allow a small tolerance for deleted posts/API caching drift (e.g. 10 posts)
      const tolerance = 10;
      const needsSync = (total > 0 && stats.count < total - tolerance) || (total === 0 && stats.count === 0);

      if (needsSync) {
        // Show Sync/Resume View
        const syncDiv = document.createElement('div');
        syncDiv.style.textAlign = 'center';
        syncDiv.style.padding = '40px 20px';
        syncDiv.style.color = '#555';

        let msg = `We have <strong>${stats.count}</strong> posts synced, but the user has <strong>${total || 'more'}</strong>.`;
        if (total === 0 && stats.count > 0) msg = `We have <strong>${stats.count}</strong> posts synced. Total count unavailable.`;
        if (stats.count === 0) msg = `To generate the report, we need to fetch all post metadata for <strong>${this.context.targetUser.name}</strong>.`;

        syncDiv.innerHTML = `
          <div style="font-size:48px; margin-bottom:20px;">💾</div>
          <h3 style="margin-top:0;">Data Synchronization Required</h3>
          <p>${msg}</p>
          <p style="font-size:0.9em; color:#777; margin-bottom:30px;">
             This one-time process might take a while depending on the post count.<br>
             You can close this window - data collection will continue in the background.
          </p>
          <button id="analytics-start-sync" style="
            background-color: #0969da; color: white; border: none; padding: 10px 20px;
            font-size: 16px; font-weight: 600; border-radius: 6px; cursor: pointer;
            box-shadow: 0 1px 3px rgba(0,0,0,0.12); transition: background 0.2s;
          ">${stats.count > 0 ? 'Resume Sync' : 'Start Data Fetch'}</button>
          
          <div id="analytics-main-progress" style="margin-top:25px; display:none; max-width:400px; margin-left:auto; margin-right:auto;">
             <div style="display:flex; justify-content:space-between; font-size:0.85em; margin-bottom:5px; color:#555;">
                <span>Fetching metadata...</span>
                <span id="analytics-main-percent">0%</span>
             </div>
             <div style="width:100%; height:8px; background:#e1e4e8; border-radius:4px; overflow:hidden;">
                <div id="analytics-main-bar" style="width:0%; height:100%; background:#2da44e; transition: width 0.2s;"></div>
             </div>
             <div id="analytics-main-count" style="font-size:0.8em; color:#666; margin-top:5px; text-align:right;"></div>
          </div>
        `;

        content.appendChild(syncDiv);

        // Setup Sync Button
        const btn = syncDiv.querySelector('#analytics-start-sync');

        // Check Global Sync State
        if (AnalyticsDataManager.isGlobalSyncing) {
          btn.innerHTML = 'Fetching in background...';
          btn.disabled = true;
          btn.style.backgroundColor = '#94d3a2'; // Light green/disabled
          btn.style.cursor = 'not-allowed';

          // Restore Progress Bar
          const progressDiv = syncDiv.querySelector('#analytics-main-progress');
          const bar = syncDiv.querySelector('#analytics-main-bar');
          const percent = syncDiv.querySelector('#analytics-main-percent');
          const countText = syncDiv.querySelector('#analytics-main-count');

          progressDiv.style.display = 'block';

          // Initial State
          const { current, total } = AnalyticsDataManager.syncProgress;
          if (total > 0) {
            const p = Math.round((current / total) * 100);
            bar.style.width = `${p}%`;
            percent.textContent = `${p}%`;
            countText.textContent = `${current} / ${total}`;
          }

          // Subscribe
          AnalyticsDataManager.onProgressCallback = (c, max) => {
            const p = max > 0 ? Math.round((c / max) * 100) : 0;
            bar.style.width = `${p}%`;
            percent.textContent = max > 0 ? `${p}%` : 'Scanning...';
            countText.textContent = `${c} / ${max > 0 ? max : '?'}`;
          };
        }

        btn.onclick = async () => {
          btn.innerHTML = 'Fetching...';
          btn.disabled = true;
          btn.style.opacity = '0.7';
          const progressDiv = syncDiv.querySelector('#analytics-main-progress');
          const bar = syncDiv.querySelector('#analytics-main-bar');
          const percent = syncDiv.querySelector('#analytics-main-percent');
          const countText = syncDiv.querySelector('#analytics-main-count');

          progressDiv.style.display = 'block';

          // Subscribe locally immediately
          AnalyticsDataManager.onProgressCallback = (c, max) => {
            const p = max > 0 ? Math.round((c / max) * 100) : 0;
            bar.style.width = `${p}%`;
            percent.textContent = max > 0 ? `${p}%` : 'Scanning...';
            countText.textContent = `${c} / ${max > 0 ? max : '?'}`;
          };

          await dataManager.syncAllPosts(this.context.targetUser, null); // Pass null, let internal broadcast handle it

          // Done
          this.updateHeaderStatus();
          this.renderDashboard();
        };

        return; // Stop here, don't render dashboard
      }

      // --- VIEW 2: DASHBOARD (REPORT) ---
      // Show Header Controls
      const headerControls = header.querySelector('#analytics-header-controls');
      if (headerControls) headerControls.style.display = 'flex';

      // Show widgets

      const dashboardDiv = document.createElement('div');

      // Summary Card Wrapper
      const summaryWrapper = document.createElement('div');
      summaryWrapper.style.display = 'grid';
      summaryWrapper.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
      summaryWrapper.style.gap = '15px';
      summaryWrapper.style.marginBottom = '35px'; // Increased Spacing

      const makeCard = (title, val, icon, details = '') => `
            <div style="background:#fff; border:1px solid #e1e4e8; border-radius:8px; padding:15px; display:flex; align-items:flex-start;">
               <div style="font-size:2em; margin-right:15px; margin-top:5px;">${icon}</div>
               <div>
                  <div style="font-size:0.85em; color:#666; text-transform:uppercase; letter-spacing:0.5px;">${title}</div>
                  <div style="display:flex; align-items:center; gap:12px;">
                      <div style="font-size:1.5em; font-weight:bold; color:#333;">${val}</div>
                      ${details ? `<div style="font-size:0.85em; color:#555;">${details}</div>` : ''}
                  </div>
               </div>
            </div>
         `;

      // Stats Calculations
      const summaryStats = await dataManager.getSummaryStats(this.context.targetUser);
      const { maxUploads, maxDate, firstUploadDate } = summaryStats;

      const today = new Date();
      const oneDay = 1000 * 60 * 60 * 24;

      // Calculations for Card 1 (Uploads)
      let avgUploads = 0;
      let daysSinceFirst = 0;

      if (firstUploadDate) {
        daysSinceFirst = Math.floor((today - firstUploadDate) / oneDay);
        if (daysSinceFirst > 0) {
          avgUploads = (stats.count / daysSinceFirst).toFixed(2);
        }
      }

      // Details for Card 1
      const uploadDetails = `
         <div style="display:flex; flex-direction:column; gap:4px; border-left:2px solid #eee; padding-left:12px;">
             <div>📈 <strong>Average:</strong> ${avgUploads} posts / day</div>
             <div>🔥 <strong>Max:</strong> ${maxUploads} posts <span style="color:#888;">(${maxDate})</span></div>
         </div>
      `;

      summaryWrapper.innerHTML += makeCard('Total Uploads', stats.count.toLocaleString(), '🖼️', uploadDetails);

      // Calculations for Card 2 (Latest Post & Days)
      const lastDate = stats.lastSync ? new Date(stats.lastSync).toISOString().split('T')[0] : 'N/A';

      let daysSinceJoin = 0;
      let joinDateStr = '';
      if (this.context.targetUser.created_at) {
        const joinDate = new Date(this.context.targetUser.created_at);
        daysSinceJoin = Math.floor((today - joinDate) / oneDay);
        joinDateStr = joinDate.toISOString().split('T')[0];
      }

      const firstUploadDateStr = firstUploadDate ? firstUploadDate.toISOString().split('T')[0] : '';

      // Details for Card 2
      const dateDetails = `
         <div style="display:flex; flex-direction:column; gap:4px; border-left:2px solid #eee; padding-left:12px;">
             <div>🎊 <strong>Join:</strong> ${daysSinceJoin.toLocaleString()} days ago <span style="color:#888;">(${joinDateStr})</span></div>
             <div>🚀 <strong>1st Post:</strong> ${daysSinceFirst.toLocaleString()} days ago <span style="color:#888;">(${firstUploadDateStr})</span></div>
         </div>
      `;

      summaryWrapper.innerHTML += makeCard('Latest Post', lastDate, '📅', dateDetails);

      dashboardDiv.appendChild(summaryWrapper);

      // --- ROW 2: Top Stats (Pie + Top Post) ---
      const topStatsRow = document.createElement('div');
      topStatsRow.style.display = 'grid';
      topStatsRow.style.gridTemplateColumns = 'repeat(auto-fit, minmax(300px, 1fr))'; // Responsive
      topStatsRow.style.gap = '15px';
      topStatsRow.style.marginBottom = '35px'; // Increased Spacing

      // 1. Pie Chart Placeholder
      const pieContainer = document.createElement('div');
      pieContainer.style.background = '#fff';
      pieContainer.style.border = '1px solid #e1e4e8';
      pieContainer.style.borderRadius = '8px';
      pieContainer.style.padding = '15px';
      pieContainer.style.minHeight = '150px';
      pieContainer.style.display = 'flex';
      pieContainer.style.alignItems = 'center';
      pieContainer.style.justifyContent = 'center';
      pieContainer.style.color = '#888';
      pieContainer.innerHTML = '<div>⌛ Loading Stats...</div>';

      // --- PIE CHART WIDGET REFRACTOR ---

      // Async Data Store for Pie Charts
      const pieData = {
        rating: null,
        character: null,
        copyright: null,
        fav_copyright: null
      };

      let currentPieTab = 'copyright'; // Default to Copy as requested

      const renderPieContent = () => {
        const contextUser = this.context.targetUser;
        const data = pieData[currentPieTab];
        const container = pieContainer.querySelector('.pie-content');

        if (!data) {
          container.innerHTML = '<div style="color:#888; padding:30px; text-align:center;">Loading...</div>';
          return;
        }

        if (data.length === 0) {
          container.innerHTML = '<div style="color:#888; padding:30px; text-align:center;">No data available</div>';
          return;
        }

        container.innerHTML = '';
        container.style.display = 'flex';
        container.style.flexDirection = 'row';
        container.style.alignItems = 'center';
        container.style.justifyContent = 'space-around';
        container.style.perspective = '1000px';

        // Colors & Labels Generation
        // Rating has fixed colors. Character/Copyright needs dynamic palette.
        const ratingColors = { 'g': '#28a745', 's': '#fd7e14', 'q': '#6f42c1', 'e': '#dc3545' };
        const ratingLabels = { 'g': 'General', 's': 'Sensitive', 'q': 'Questionable', 'e': 'Explicit' };

        // Palette for Characters (Vibrant, Distinct)
        const palette = [
          '#e91e63', '#9c27b0', '#673ab7', '#3f51b5',
          '#2196f3', '#03a9f4', '#00bcd4', '#009688',
          '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b',
          '#ffc107', '#ff9800', '#ff5722', '#795548'
        ];

        const processedData = data.map((d, i) => {
          // If Rating
          if (currentPieTab === 'rating') {
            return {
              value: d.count,
              label: ratingLabels[d.rating] || d.rating,
              color: ratingColors[d.rating] || '#999',
              details: d // original data
            };
          }
          // If Character/Copyright
          else {
            return {
              value: d.frequency, // Use frequency for Pie Slice Size? Or count? 
              // User said: "Top 10... Others... frequency... hover show frequency"
              // Pie chart usually represents the 'whole'. Frequency 0.0356 is share.
              // If we use frequency, the total might not be exactly 1.0 if we only have top 10 + others(calculated).
              // Actually we calculated 'others' so sum matches 1.0.
              // For 'others', count is 0.
              label: d.name,
              color: d.isOther ? '#bdbdbd' : palette[i % palette.length],
              details: d
            };
          }
        });

        const totalValue = processedData.reduce((acc, curr) => acc + curr.value, 0);

        // --- D3 Chart ---
        const width = 180;
        const height = 180;
        const radius = Math.min(width, height) / 2 - 20;

        const chartWrapper = document.createElement('div');
        chartWrapper.style.width = `${width}px`;
        chartWrapper.style.height = `${height}px`;
        chartWrapper.style.transformStyle = 'preserve-3d';
        chartWrapper.style.transform = 'rotateX(40deg) rotateY(0deg)';
        chartWrapper.style.transition = 'transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        chartWrapper.style.cursor = 'pointer';

        // Shadow
        const shadow = document.createElement('div');
        shadow.style.position = 'absolute';
        shadow.style.top = '50%';
        shadow.style.left = '50%';
        shadow.style.width = `${radius * 2}px`;
        shadow.style.height = `${radius * 2}px`;
        shadow.style.transform = 'translate(-50%, -50%) translateZ(-10px)';
        shadow.style.borderRadius = '50%';
        shadow.style.background = 'rgba(0,0,0,0.2)';
        shadow.style.filter = 'blur(5px)';
        chartWrapper.appendChild(shadow);

        // Hover
        container.addEventListener('mouseenter', () => {
          chartWrapper.style.transform = 'rotateX(0deg) scale(1.1)';
          shadow.style.transform = 'translate(-50%, -50%) translateZ(-30px) scale(0.9)';
          shadow.style.opacity = '0.5';
        });
        container.addEventListener('mouseleave', () => {
          chartWrapper.style.transform = 'rotateX(40deg)';
          shadow.style.transform = 'translate(-50%, -50%) translateZ(-10px)';
          shadow.style.opacity = '1';
        });

        const svg = d3.select(chartWrapper)
          .append("svg")
          .attr("width", width)
          .attr("height", height)
          .style("overflow", "visible")
          .append("g")
          .attr("transform", `translate(${width / 2},${height / 2})`);

        const pie = d3.pie().value(d => d.value).sort(null);
        const arc = d3.arc().innerRadius(0).outerRadius(radius);
        const arcHover = d3.arc().innerRadius(0).outerRadius(radius * 1.2);

        // Tooltip
        d3.select(".danbooru-grass-pie-tooltip").remove();
        const tooltip = d3.select("body").append("div")
          .attr("class", "danbooru-grass-pie-tooltip")
          .style("position", "absolute")
          .style("background", "rgba(30, 30, 30, 0.95)")
          .style("color", "#fff")
          .style("padding", "8px 12px")
          .style("border-radius", "6px")
          .style("font-size", "12px")
          .style("pointer-events", "none")
          .style("z-index", "2147483647")
          .style("opacity", "0");

        svg.selectAll('path')
          .data(pie(processedData))
          .enter()
          .append('path')
          .attr('d', arc)
          .attr('fill', d => d.data.color)
          .attr('stroke', '#fff')
          .style('stroke-width', '1px')
          .style('opacity', '0.9')
          .on('mouseover', function (event, d) {
            d3.select(this).transition().duration(200).attr('d', arcHover).style('opacity', '1')
              .style('filter', 'drop-shadow(0px 0px 8px rgba(255,255,255,0.4))');

            let html = '';
            if (currentPieTab === 'rating') {
              html = `
                        <div style="font-weight:bold; color:${d.data.color}; margin-bottom:2px;">${d.data.label}</div>
                        <div>Count: <strong>${d.data.details.count.toLocaleString()}</strong></div>
                        <div>Ratio: <strong>${Math.round((d.data.value / totalValue) * 100)}%</strong></div>
                     `;
            } else {
              // Character / Copyright
              // User requested: Name, Post Count, Frequency
              // Note: Post Count is GLOBAL if grouping by 'related_tag' API results.
              // But user seems to want to see the stats provided by that API.
              const percentage = (d.data.value * 100).toFixed(1) + '%';
              html = `
                  <div style="display:flex; gap:10px; align-items:center;">
                    ${d.data.details.thumb ? `<div style="width:40px; height:40px; border-radius:4px; overflow:hidden; background:#333;"><img src="${d.data.details.thumb}" style="width:100%; height:100%; object-fit:cover;"></div>` : ''}
                    <div>
                        <div style="font-weight:bold; color:${d.data.color}; margin-bottom:2px; max-width:150px; word-wrap:break-word;">${d.data.label}</div>
                        <div>Freq: <strong>${percentage}</strong></div>
                        ${!d.data.details.isOther ? `<div>Posts: <strong>${d.data.details.count ? d.data.details.count.toLocaleString() : '?'}</strong></div>` : ''}
                    </div>
                  </div>
               `;
            }

            tooltip.html(html).style("opacity", 1);
          })
          .on('mousemove', function (event) {
            tooltip.style("left", (event.pageX + 15) + "px").style("top", (event.pageY + 15) + "px");
          })
          .on('mouseout', function () {
            d3.select(this).transition().duration(200).attr('d', arc).style('opacity', '0.9').style('filter', 'none');
            tooltip.style("opacity", 0);
          })
          .on('click', function (event, d) {
            // Click action: open search page
            // user:{name} {tag}
            // except for "Others"
            if (d.data.details.isOther) return;
            const user = contextUser;

            let query = '';
            if (currentPieTab === 'rating') {
              // rating:q
              query = `rating:${d.data.details.rating}`;
            } else if (currentPieTab === 'breasts') {
              // user:{name} {tag} (reconstruct tag from label)
              // Label is "Flat Chest".
              // Original logic had tag... but we formatted it.
              // Let's store original tag in details if possible?
              // The label was "Flat Chest". We can lower case and replace space with underscore
              const tag = d.data.label.toLowerCase().replace(/ /g, '_');
              query = `user:${user.name.replace(/ /g, '_')} ${tag}`;
            } else {
              // character or copyright or fav_copyright
              // d.data.details.tagName is set for these
              if (currentPieTab === 'fav_copyright') {
                // For fav_copyright, we need to query ordfav:{user} + {tag}
                // But wait, the window open should probably just search for posts with that tag?
                // User asked for "Fav_Copy chart".
                // If I click a slice "Idolmaster", I expect to see User's Favs of Idolmaster.
                // So query = `ordfav:${user.name} ${tagName}`.
                // The default logic below uses `user:${user.name} ${query}`.
                // So I need to handle the prefix differently.
              }

              if (currentPieTab === 'fav_copyright') {
                query = `ordfav:${user.name} ${d.data.details.tagName || d.data.label}`;
                // Open directly, bypassing the standard user:name prefix logic used below
                const targetUrl = `/posts?tags=${encodeURIComponent(query)}`;
                window.open(targetUrl, '_blank');
                return;
              }

              query = d.data.details.tagName || d.data.label;
            }

            // Base User
            // Use closure variable or safe access
            // this.context is available in renderDashboard, but inside d3 'function' logic 'this' is element.
            // We can access 'pieData.user' if we set it, BUT we can also just use the valid closure scope if we are careful.
            // Best to just use the variable we have access to from renderDashboard scope.
            // However, 'this' in renderDashboard is the app.

            // Let's rely on a strictly passed user object or global fallback.
            // Actually, simplest is to capture it outside.
            // user previously defined


            const targetUrl = `/posts?tags=${encodeURIComponent(`user:${user.name} ${query}`)}`;
            window.open(targetUrl, '_blank');
          });

        container.appendChild(chartWrapper);

        // --- Legend (Scrollable) ---
        const legendDiv = document.createElement('div');
        legendDiv.style.display = 'flex';
        legendDiv.style.flexDirection = 'column';
        legendDiv.style.marginLeft = '20px';
        legendDiv.style.maxHeight = '180px'; // Matching chart height
        legendDiv.style.overflowY = 'auto'; // Scrollable
        legendDiv.style.paddingRight = '5px'; // Space for scrollbar

        // Custom Scrollbar styling for Webkit
        const scrollbarStyle = document.createElement('style');
        scrollbarStyle.innerHTML = `
            .danbooru-grass-legend-scroll::-webkit-scrollbar { width: 6px; }
            .danbooru-grass-legend-scroll::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 3px; }
            .danbooru-grass-legend-scroll::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 3px; }
            .danbooru-grass-legend-scroll::-webkit-scrollbar-thumb:hover { background: #a8a8a8; }
         `;
        legendDiv.classList.add('danbooru-grass-legend-scroll');
        legendDiv.appendChild(scrollbarStyle);

        let legendTitle = 'DIST.';
        if (currentPieTab === 'rating') legendTitle = 'RATING DIST.';
        else if (currentPieTab === 'character') legendTitle = 'CHAR. DIST.';
        else if (currentPieTab === 'copyright') legendTitle = 'COPY. DIST.';
        else if (currentPieTab === 'fav_copyright') legendTitle = 'FAV. COPY.';

        legendDiv.innerHTML += `
             <div style="font-size:0.8em; color:#888; margin-bottom:8px; text-transform:uppercase; position:sticky; top:0; background:#fff; padding-bottom:4px; border-bottom:1px solid #eee;">${legendTitle}</div>
             ${processedData.map(d => {
          const pct = currentPieTab === 'rating'
            ? Math.round((d.value / totalValue) * 100) + '%'
            : (d.value * 100).toFixed(1) + '%';

          return `
                 <div style="display:flex; align-items:center; font-size:0.85em; margin-bottom:5px;">
                    <div style="width:12px; height:12px; background:${d.color}; border-radius:2px; margin-right:8px; border:1px solid rgba(0,0,0,0.1); flex-shrink:0;"></div>
                    <div style="color:#555; width:90px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${d.label}">${d.label}</div>
                    <div style="font-weight:bold; color:#333;">${pct}</div>
                 </div>`;
        }).join('')}
         `;
        container.appendChild(legendDiv);
      };

      const updatePieTabs = () => {
        const btns = pieContainer.querySelectorAll('.pie-tab');
        btns.forEach(btn => {
          const mode = btn.getAttribute('data-mode');
          if (mode === currentPieTab) {
            btn.style.background = '#0969da';
            btn.style.color = '#fff';
          } else {
            btn.style.background = '#f6f8fa';
            btn.style.color = '#24292f';
          }
        });
      };

      // Header with Tabs
      pieContainer.innerHTML = `
           <div style="width:100%; display:flex; flex-direction:column;">
               <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; width:100%;">
                   <div style="display:flex; gap:0px; border:1px solid #d0d7de; border-radius:6px; overflow:hidden;">
                       <button class="pie-tab" data-mode="copyright" style="border:none; background:#f6f8fa; color:#24292f; padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s;">Copy</button>
                       <button class="pie-tab" data-mode="character" style="border:none; border-left:1px solid #d0d7de; background:#f6f8fa; color:#24292f; padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s;">Char</button>
                       <button class="pie-tab" data-mode="rating" style="border:none; border-left:1px solid #d0d7de; background:#f6f8fa; color:#24292f; padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s;">Rate</button>
                       <button class="pie-tab" data-mode="fav_copyright" style="border:none; border-left:1px solid #d0d7de; background:#f6f8fa; color:#24292f; padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s;">Fav_Copy</button>
                       <button class="pie-tab" data-mode="breasts" style="display:${isNsfwEnabled ? 'block' : 'none'}; border:none; border-left:1px solid #d0d7de; background:#f6f8fa; color:#24292f; padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s;">Boobs</button>
                   </div>
               </div>
               <div class="pie-content" style="flex:1; display:flex; justify-content:center; align-items:center; min-height:160px;">
                   Loading...
               </div>
           </div>
      `;

      // Lazy Loading for Pie Chart Tabs
      const loadTab = async (tabName) => {
        // 1. Check if data exists
        if (pieData[tabName]) {
          renderPieContent();
          return;
        }

        // 2. Show Loading
        const pieContent = pieContainer.querySelector('.pie-content');
        if (pieContent) pieContent.innerHTML = '<div style="color:#666;">Loading...</div>';

        // 3. Fetch Data
        try {
          let data = [];
          if (tabName === 'rating') {
            data = await dataManager.getRatingDistribution(this.context.targetUser);
          } else if (tabName === 'character') {
            data = await dataManager.getCharacterDistribution(this.context.targetUser);
          } else if (tabName === 'copyright') {
            data = await dataManager.getCopyrightDistribution(this.context.targetUser);
          } else if (tabName === 'fav_copyright') {
            data = await dataManager.getFavCopyrightDistribution(this.context.targetUser);
          } else if (tabName === 'breasts') {
            data = await dataManager.getBreastsDistribution(this.context.targetUser);
            // Ensure 'value' property exists for pie chart logic if not present
            // getBreastsReturns {name, count}
            // Pie logic uses 'value' (frequency) or calculates it
            // Let's manually calculate total and assign 'value' as ratio
            const total = data.reduce((acc, c) => acc + c.count, 0);
            data = data.map(d => ({
              ...d,
              frequency: total > 0 ? d.count / total : 0,
              value: total > 0 ? d.count / total : 0,
              label: d.name,
              details: { ...d, thumb: null } // stub details
            }));
          }

          pieData[tabName] = data;

          // 4. Render only if still active tab (avoid race condition)
          if (currentPieTab === tabName) {
            renderPieContent();
            updatePieTabs();
          }
        } catch (e) {
          console.error(e);
          if (pieContent) pieContent.innerHTML = 'Error loading data.';
        }
      };

      // Event Delegation
      pieContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('pie-tab')) {
          const mode = e.target.getAttribute('data-mode');
          if (currentPieTab !== mode) {
            currentPieTab = mode;
            updatePieTabs();
            loadTab(mode);
          }
        }
      });

      topStatsRow.appendChild(pieContainer);

      // Initial Load (Default Tab: Copyright)
      updatePieTabs();
      loadTab(currentPieTab);


      // 2. Top Post Widget
      const topPostContainer = document.createElement('div');
      topPostContainer.style.background = '#fff';
      topPostContainer.style.border = '1px solid #e1e4e8';
      topPostContainer.style.borderRadius = '8px';
      topPostContainer.style.padding = '15px';
      topPostContainer.innerHTML = 'Loading Top Post...';

      topStatsRow.appendChild(topPostContainer);
      dashboardDiv.appendChild(topStatsRow);

      // Async Load Top Post Data (Parallel with Pie Chart)
      // Stores fetched data for instant switching
      const topPostData = {
        sfw: null,
        nsfw: null
      };

      let currentTab = 'sfw'; // Default

      const renderTopPostContent = () => {
        const data = topPostData[currentTab];
        const contentDiv = topPostContainer.querySelector('.top-post-content');

        if (!data) {
          contentDiv.innerHTML = '<div style="color:#888; padding:20px 0;">No posts found or loading...</div>';
          return;
        }

        const thumbUrl = data.preview_file_url || data.large_file_url || data.file_url;
        const dateStr = data.created_at ? new Date(data.created_at).toISOString().split('T')[0] : 'N/A';
        const link = `/posts/${data.id}`;
        const ratingMap = { 'g': 'General', 's': 'Sensitive', 'q': 'Questionable', 'e': 'Explicit' };
        const ratingLabel = ratingMap[data.rating] || data.rating;

        contentDiv.innerHTML = `
            <div style="display:flex; gap:15px; align-items:flex-start;">
                <a href="${link}" target="_blank" style="display:block; width:150px; height:150px; flex-shrink:0; background:#eee; border-radius:4px; overflow:hidden;">
                    <img src="${thumbUrl}" style="width:100%; height:100%; object-fit:cover;" alt="#${data.id}">
                </a>
                <div style="flex:1;">
                    <div style="font-weight:bold; font-size:1.1em; color:#0969da; margin-bottom:4px;">
                        <a href="${link}" target="_blank" style="text-decoration:none; color:inherit;">Post #${data.id}</a>
                    </div>
                    <div style="font-size:0.9em; color:#555; line-height:1.5;">
                        📅 ${dateStr}<br>
                        ❤️ Score: <strong>${data.score}</strong><br>
                        ⭐ Favs: <strong>${data.fav_count || '?'}</strong><br>
                        🤔 Rating: <strong>${ratingLabel}</strong>
                        
                        <div style="margin-top:8px; border-top:1px solid #eee; padding-top:6px;">
                            ${data.tag_string_artist ? `<div>🎨 <strong>Artist:</strong> ${data.tag_string_artist.replace(/_/g, ' ')}</div>` : ''}
                            ${data.tag_string_copyright ? `<div>©️ <strong>Copy:</strong> ${data.tag_string_copyright.replace(/_/g, ' ')}</div>` : ''}
                            ${data.tag_string_character ? `<div>👤 <strong>Char:</strong> ${data.tag_string_character.split(' ').slice(0, 5).join(', ').replace(/_/g, ' ')}${data.tag_string_character.split(' ').length > 5 ? '...' : ''}</div>` : ''}
                        </div>
                    </div>
                </div>
            </div>
         `;
      };

      const updateTabs = () => {
        const btnSfw = topPostContainer.querySelector('button[data-mode="sfw"]');
        const btnNsfw = topPostContainer.querySelector('button[data-mode="nsfw"]');

        const setStyle = (btn, isActive) => {
          if (!btn) return;
          btn.style.background = isActive ? '#0969da' : '#f6f8fa';
          btn.style.color = isActive ? '#fff' : '#24292f';
        };

        setStyle(btnSfw, currentTab === 'sfw');
        setStyle(btnNsfw, currentTab === 'nsfw');
      };


      topPostContainer.innerHTML = `
           <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <div style="font-size:0.85em; color:#666; text-transform:uppercase; letter-spacing:0.5px;">
                 🏆 Most Popular Post
              </div>
              <div style="display:flex; gap:0px; border:1px solid #d0d7de; border-radius:6px; overflow:hidden;">
                 <button class="top-post-tab" data-mode="sfw" style="border:none; background:#f6f8fa; color:#24292f; padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s;">SFW</button>
                 <button class="top-post-tab" id="analytics-top-nsfw-btn" data-mode="nsfw" style="border:none; border-left:1px solid #d0d7de; background:#f6f8fa; color:#24292f; padding:2px 8px; font-size:11px; cursor:pointer; transition: background 0.5s, color 0.5s; display: ${isNsfwEnabled ? 'inline-block' : 'none'};">NSFW</button>
              </div>
           </div>
           <div class="top-post-content">
               <div style="color:#666; font-size:0.9em;">Loading stats...</div>
           </div>
      `;

      // Event Delegation
      topPostContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('top-post-tab')) {
          currentTab = e.target.getAttribute('data-mode');
          updateTabs();
          renderTopPostContent();
        }
      });

      // Initial Tab State
      updateTabs();

      // Fetch Data
      dataManager.getTopPostsByType(this.context.targetUser).then(result => {
        topPostData.sfw = result.sfw;
        topPostData.nsfw = result.nsfw;
        renderTopPostContent();
      });
      content.appendChild(dashboardDiv);

      // 3. Milestones Widget
      const milestonesDiv = document.createElement('div');
      milestonesDiv.style.marginTop = '20px';
      dashboardDiv.appendChild(milestonesDiv);

      let currentMilestoneStep = 'auto'; // shared state for closure

      const renderMilestones = async () => {
        // Clear previous content but keep structure if possible? 
        // Actually, just rebuild.
        milestonesDiv.innerHTML = '<div style="color:#888; padding:20px 0;">Loading milestones...</div>';

        const milestones = await dataManager.getMilestones(this.context.targetUser, isNsfwEnabled, currentMilestoneStep);

        let msHtml = '<div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:8px; margin-bottom:10px;">';
        msHtml += '<h3 style="color:#333; margin:0;">🏆 Milestones</h3>';

        msHtml += '<div style="display:flex; align-items:center; gap:10px;">';

        // Interval Selector
        msHtml += `<select id="analytics-milestone-step" style="border:1px solid #d0d7de; border-radius:4px; padding:2px 4px; font-size:0.85em; color:#555; background-color:#f6f8fa;">
            <option value="auto" ${currentMilestoneStep === 'auto' ? 'selected' : ''}>Auto</option>
            <option value="1000" ${currentMilestoneStep === 1000 ? 'selected' : ''}>Every 1k</option>
            <option value="2500" ${currentMilestoneStep === 2500 ? 'selected' : ''}>Every 2.5k</option>
            <option value="5000" ${currentMilestoneStep === 5000 ? 'selected' : ''}>Every 5k</option>
        </select>`;

        msHtml += '<button id="analytics-milestone-toggle" style="background:none; border:none; color:#0969da; cursor:pointer; font-size:0.9em; display:none;">Show More</button>';
        msHtml += '</div>';
        msHtml += '</div>';

        if (milestones.length === 0) {
          milestonesDiv.innerHTML = msHtml + '<div style="color:#888; font-size:0.9em;">No milestones found.</div>';
          // Still attach listener for dropdown even if empty?
          // Rarely empty if total > 0.
          const sel = milestonesDiv.querySelector('#analytics-milestone-step');
          if (sel) {
            sel.onchange = (e) => {
              const v = e.target.value;
              currentMilestoneStep = v === 'auto' ? 'auto' : parseInt(v);
              renderMilestones();
            };
          }
          return;
        }

        const containerId = 'analytics-milestone-container';
        msHtml += `<div id="${containerId}" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap:10px; max-height:110px; overflow:hidden; transition: max-height 0.3s ease;">`;

        milestones.forEach(m => {
          const p = m.post;
          const isSafe = (p.rating === 's' || p.rating === 'g');
          const thumbUrl = (p.preview_file_url || p.file_url);
          const showThumb = isNsfwEnabled || isSafe;

          msHtml += `
            <a href="/posts/${p.id}" target="_blank" style="
               display:flex; justify-content:space-between; align-items:center; text-decoration:none; color:inherit;
               background:#fff; border:1px solid #e1e4e8; border-radius:6px; padding:10px;
               transition: transform 0.1s;
            " onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
               <div>
                   <div style="font-size:0.8em; color:#888; text-transform:uppercase; letter-spacing:0.5px;">${m.type}</div>
                   <div style="font-size:1.1em; font-weight:bold; color:#0969da; margin-top:4px;">#${m.index}</div>
                   <div style="font-size:0.8em; color:#555; margin-top:2px;">${new Date(p.created_at).toLocaleDateString()}</div>
                   <div style="font-size:0.75em; color:#aaa; margin-top:4px;">Score: ${p.score}</div>
               </div>
               ${(showThumb && thumbUrl) ? `<div style="width:60px; height:60px; margin-left:10px; flex-shrink:0; background:#f0f0f0; border-radius:4px; overflow:hidden; display:flex; align-items:center; justify-content:center;"><img src="${thumbUrl}" style="width:100%; height:100%; object-fit:cover;"></div>` : ''}
            </a>
          `;
        });
        msHtml += '</div>';
        milestonesDiv.innerHTML = msHtml;

        // Attach Dropdown Listener
        const stepSelect = milestonesDiv.querySelector('#analytics-milestone-step');
        if (stepSelect) {
          stepSelect.onchange = (e) => {
            const v = e.target.value;
            currentMilestoneStep = v === 'auto' ? 'auto' : parseInt(v);
            renderMilestones();
          };
        }

        // Toggle Logic
        // Calculate rows? or just check count.
        // If grid has auto-fill, rows depend on width.
        // Simple check: > 6 items?
        if (milestones.length > 6) {
          const btn = milestonesDiv.querySelector('#analytics-milestone-toggle');
          const container = milestonesDiv.querySelector(`#${containerId}`);
          btn.style.display = 'block';

          // Apply state
          if (isMilestoneExpanded) {
            container.style.maxHeight = '2000px';
            btn.textContent = 'Show Less';
          }

          btn.onclick = () => {
            isMilestoneExpanded = !isMilestoneExpanded;
            if (isMilestoneExpanded) {
              container.style.maxHeight = '2000px';
              btn.textContent = 'Show Less';
            } else {
              container.style.maxHeight = '110px';
              btn.textContent = 'Show More';
            }
          };
        }
      };

      // Define Update Function
      applyNsfwUpdate = async () => {
        // 1. Top Post Button
        const nsfwBtn = document.getElementById('analytics-top-nsfw-btn');
        if (nsfwBtn) {
          nsfwBtn.style.display = isNsfwEnabled ? 'inline-block' : 'none';
        }

        // 2. Tab Switch
        if (!isNsfwEnabled && currentTab === 'nsfw') {
          const sfwBtn = topPostContainer.querySelector('button[data-mode="sfw"]');
          if (sfwBtn) sfwBtn.click();
        }

        // 3. Milestones
        await renderMilestones();
      };

      // Initial Load
      await renderMilestones();

      // 4. Monthly Activity Chart
      // 4. Monthly Activity Chart
      // Fetch promotions first to extend graph range if needed
      const promotions = await dataManager.getPromotionHistory(this.context.targetUser);

      let minDate = null;
      if (promotions.length > 0) {
        minDate = promotions[0].date;
      }

      const monthly = await dataManager.getMonthlyStats(this.context.targetUser, minDate);
      if (monthly.length > 0) {
        const chartDiv = document.createElement('div');
        chartDiv.style.marginTop = '24px';
        let chartHtml = '<h3 style="color:#333; border-bottom:1px solid #eee; padding-bottom:10px; margin-bottom:15px;">📅 Monthly Activity</h3>';

        // SVG Implementation
        // SVG Implementation
        const minBarWidth = 25; // Minimum width per bar
        const padLeft = 40;
        const padRight = 20;
        const padBottom = 25;
        const padTop = 20;

        // Data Prep & Dynamic Width
        const maxCount = Math.max(...monthly.map(m => m.count));
        const requiredWidth = padLeft + padRight + (monthly.length * minBarWidth);
        const vWidth = Math.max(800, requiredWidth); // At least 800, extend if needed
        const vHeight = 200;

        // Container (Scrollable)
        const chartWrapper = document.createElement('div');
        chartWrapper.style.overflowX = 'auto';
        chartWrapper.style.width = '100%';
        chartWrapper.style.border = '1px solid #e1e4e8';
        chartWrapper.style.borderRadius = '8px';
        chartWrapper.style.backgroundColor = '#fff';

        // Axis Logic
        let tickMax = Math.ceil(maxCount / 500) * 500;
        if (tickMax < 500) tickMax = 500;

        let tickStep = 500;
        if (tickMax <= 2000) {
          tickStep = tickMax / 4;
        }

        // Create SVG
        // Use pixel width for SVG content to force scroll
        let svg = `<svg viewBox="0 0 ${vWidth} ${vHeight}" style="min-width:100%; width:${vWidth}px; height:200px;">`;

        // 1. Grid Lines
        const numTicks = Math.round(tickMax / tickStep);
        for (let i = 0; i <= numTicks; i++) {
          const val = i * tickStep;
          const y = (vHeight - padBottom) - ((val / tickMax) * (vHeight - padBottom - padTop));

          // Grid Line
          if (i > 0) {
            svg += `<line x1="${padLeft}" y1="${y}" x2="${vWidth - padRight}" y2="${y}" stroke="#eee" stroke-dasharray="4 2" />`;
          } else {
            // Bottom axis line
            svg += `<line x1="${padLeft}" y1="${y}" x2="${vWidth - padRight}" y2="${y}" stroke="#ccc" />`;
          }

          // Label
          svg += `<text x="${padLeft - 5}" y="${y + 4}" text-anchor="end" font-size="10" fill="#888">${val}</text>`;
        }

        // 2. Bars & X-AxisLabels
        const barAreaWidth = vWidth - padLeft - padRight;
        const step = barAreaWidth / monthly.length;
        const barWidth = step * 0.75;

        monthly.forEach((m, idx) => {
          const x = padLeft + (step * idx) + (step - barWidth) / 2;
          const barH = (m.count / tickMax) * (vHeight - padBottom - padTop);
          const y = (vHeight - padBottom) - barH;

          // Bar
          svg += `
              <g class="bar-group">
                <rect class="monthly-bar" data-date="${m.date}" x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="#40c463" rx="2" style="pointer-events: all;">
                   <title>${m.label}: ${m.count} posts</title>
                </rect>
              </g>
            `;

          // X-Axis Labels (Year)
          const [year, month] = m.date.split('-');
          const isJan = month === '01';

          if (isJan || idx === 0) {
            const tx = x + barWidth / 2;
            const ty = vHeight - 5;
            const text = isJan ? year : `${year}-${month}`;

            svg += `<text x="${tx}" y="${ty}" text-anchor="middle" font-size="10" fill="#666">${text}</text>`;
            svg += `<line x1="${tx}" y1="${vHeight - padBottom}" x2="${tx}" y2="${vHeight - padBottom + 3}" stroke="#ccc" />`;
          }
        });

        // 3. Promotions Overlay
        if (promotions && promotions.length > 0) {
          const [sY, sM] = monthly[0].date.split('-').map(Number);
          promotions.forEach(p => {
            const pY = p.date.getFullYear();
            const pM = p.date.getMonth() + 1;
            const pD = p.date.getDate();
            const monthDiff = (pY - sY) * 12 + (pM - sM);
            const daysInMonth = new Date(pY, pM, 0).getDate();
            const frac = (pD - 1) / daysInMonth;
            const idx = monthDiff + frac;

            if (idx < 0 || idx > monthly.length) return;
            const x = padLeft + (step * idx);

            // Separator Line
            svg += `
                <g class="promotion-marker">
                   <line x1="${x}" y1="${padTop}" x2="${x}" y2="${vHeight - padBottom}" stroke="#ff5722" stroke-width="2" stroke-dasharray="4 2"></line>
                   <rect x="${x - 4}" y="${padTop}" width="8" height="${vHeight - padBottom - padTop}" fill="transparent">
                       <title>${p.date.toLocaleDateString()}: Promoted to ${p.role}</title>
                   </rect>
                </g>
             `;
          });
        }

        // 4. Milestone Stars (Every 1000th)
        const milestones1k = await dataManager.getMilestones(this.context.targetUser, isNsfwEnabled, 1000);

        // Map milestones to months
        milestones1k.forEach(m => {
          const pDate = new Date(m.post.created_at);
          const mKey = `${pDate.getFullYear()}-${String(pDate.getMonth() + 1).padStart(2, '0')}`;

          // Find matching month index
          const monthIdx = monthly.findIndex(mo => mo.date === mKey);
          if (monthIdx !== -1) {
            const x = padLeft + (step * monthIdx) + (step * 0.75) / 2; // Center of bar

            // Handle stacking if multiple in same month (though rare with 1k step, possible for bulk)
            // We'll calculate stack offset dynamically if needed, but for now assuming low collision or simple stack
            // Let's filter milestones per month loop is safer? 
            // Better: Iterate monthly and filter milestones there to manage stacking Y.
          }
        });

        // Re-loop for unified stacking
        monthly.forEach((mo, idx) => {
          const mKey = mo.date;
          const stars = milestones1k.filter(m => {
            const pDate = new Date(m.post.created_at);
            const k = `${pDate.getFullYear()}-${String(pDate.getMonth() + 1).padStart(2, '0')}`;
            return k === mKey;
          });

          if (stars.length > 0) {
            const x = padLeft + (step * idx) + (step / 2);

            stars.forEach((m, si) => {
              const y = 14 + (si * 18); // Center-based spacing

              let fill = '#ffd700';
              let stroke = '#b8860b';
              let style = 'filter: drop-shadow(0px 1px 1px rgba(0,0,0,0.3));';
              let animClass = ''; // Use for static class too

              if (m.index === 1) {
                fill = '#00e676'; // Green for #1
                stroke = '#00a050';
              } else if (m.index % 10000 === 0) {
                fill = '#ffb300'; // Deep Gold
                animClass = 'star-shiny';
              }

              // Star SVG
              svg += `
                     <a href="/posts/${m.post.id}" target="_blank" style="cursor: pointer;">
                        <text class="${animClass}" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="12" fill="${fill}" stroke="${stroke}" stroke-width="0.5" style="${style}">
                           ★
                           <title>Milestone #${m.index} (${new Date(m.post.created_at).toLocaleDateString()})</title>
                        </text>
                     </a>
                   `;
            });
          }
        });

        svg += '</svg>';

        chartDiv.innerHTML = chartHtml;
        chartWrapper.innerHTML = svg;
        chartDiv.appendChild(chartWrapper);

        // Add minimal CSS for hover effect via JS? 
        // We can just add a <style> tag inside the SVG or Chart Div!
        const style = document.createElement('style');
        style.textContent = `
          .bar-group rect { transition: fill 0.2s; }
          .bar-group rect:hover { fill: #216e39; }
          
          .star-shiny {
             font-size: 15px;
             stroke-width: 0.1px !important; 
             filter: drop-shadow(0 0 5px #ffd700); /* Stronger yellow glow */
          }
        `;
        chartDiv.appendChild(style);

        dashboardDiv.appendChild(chartDiv);

        // Click Handler for Monthly Bars
        chartWrapper.querySelectorAll('.monthly-bar').forEach(rect => {
          rect.addEventListener('click', () => {
            const mDate = rect.getAttribute('data-date'); // YYYY-MM
            if (!mDate) return;

            const [y, m] = mDate.split('-').map(Number);
            const lastDay = new Date(y, m, 0).getDate();
            const startDate = `${mDate}-01`;
            const endDate = `${mDate}-${lastDay}`;

            const query = `user:${this.context.targetUser.name} date:${startDate}..${endDate}`;
            const url = `/posts?tags=${encodeURIComponent(query)}`;
            window.open(url, '_blank');
          });
        });

        // Auto-scroll to end (Recent)
        requestAnimationFrame(() => {
          chartWrapper.scrollLeft = chartWrapper.scrollWidth;
        });
      }

      // ========================================================
      // 4. Scatter Plot Widget (High Performance)
      // ========================================================
      const scatterData = await dataManager.getScatterData(this.context.targetUser);

      if (scatterData.length > 0) {
        // Wrapper for Header + Widget
        const scatterWrapper = document.createElement('div');
        scatterWrapper.style.marginTop = '24px';
        scatterWrapper.style.marginBottom = '20px';

        // Header Container (Flex) - Simplified
        const headerContainer = document.createElement('div');
        headerContainer.style.display = 'flex';
        headerContainer.style.alignItems = 'center';
        headerContainer.style.borderBottom = '1px solid #eee';
        headerContainer.style.paddingBottom = '10px';
        headerContainer.style.marginBottom = '15px';

        // Title
        const header = document.createElement('h3');
        header.textContent = '📊 Post Performance';
        header.style.color = '#333';
        header.style.margin = '0';
        headerContainer.appendChild(header);

        scatterWrapper.appendChild(headerContainer);

        // Widget Box (The white box)
        const scatterDiv = document.createElement('div');
        scatterDiv.className = 'dashboard-widget';
        scatterDiv.style.background = '#fff';
        scatterDiv.style.border = '1px solid #e1e4e8';
        scatterDiv.style.borderRadius = '6px';
        scatterDiv.style.padding = '15px';
        scatterDiv.style.position = 'relative'; // For filters

        scatterWrapper.appendChild(scatterDiv);

        // Metric Toggle (Top Left inside Widget)
        const toggleContainer = document.createElement('div');
        toggleContainer.style.position = 'absolute';
        toggleContainer.style.top = '15px';
        toggleContainer.style.left = '15px';
        toggleContainer.style.zIndex = '5';
        toggleContainer.style.display = 'flex';
        toggleContainer.style.gap = '10px';
        toggleContainer.style.fontSize = '0.9em';

        let currentScatterMode = 'score'; // 'score' or 'tags'
        let selectedYear = null; // Year Zoom State

        const makeToggleBtn = (id, label, active, tooltip = null) => {
          const btn = document.createElement('button');
          btn.style.border = '1px solid #d0d7de';
          btn.style.borderRadius = '20px';
          btn.style.padding = '2px 10px';
          btn.style.background = active ? '#0969da' : '#fff';
          btn.style.color = active ? '#fff' : '#333';
          btn.style.cursor = 'pointer';
          btn.style.transition = 'all 0.2s';
          btn.style.fontSize = '12px';
          btn.style.display = 'flex';
          btn.style.alignItems = 'center';
          btn.style.gap = '5px';

          const span = document.createElement('span');
          span.textContent = label;
          btn.appendChild(span);

          if (tooltip) {
            const help = document.createElement('span');
            help.textContent = '❔';
            help.style.cursor = 'help';
            help.title = tooltip;
            help.style.fontSize = '0.9em';
            help.style.opacity = '0.8';
            btn.appendChild(help);
          }

          btn.onclick = () => {
            if (currentScatterMode === id) return;
            currentScatterMode = id;
            Array.from(toggleContainer.children).forEach(b => {
              const isMe = b.textContent.includes(label);
              b.style.background = '#fff';
              b.style.color = '#333';
              if (isMe) {
                b.style.background = '#0969da';
                b.style.color = '#fff';
              }
            });
            renderScatter();
          };
          return btn;
        };

        toggleContainer.appendChild(makeToggleBtn('score', 'Score', true));
        toggleContainer.appendChild(makeToggleBtn('tags', 'Tag Count', false, 'General Tags Only'));

        scatterDiv.appendChild(toggleContainer);

        // Reset Scale Button (Back Button)
        const resetBtn = document.createElement('button');
        resetBtn.textContent = '<';
        resetBtn.style.position = 'absolute';
        resetBtn.style.bottom = '10px'; // Moved lower
        resetBtn.style.left = '15px';
        resetBtn.style.zIndex = '5';
        resetBtn.style.border = '1px solid #d0d7de';
        resetBtn.style.background = '#fff';
        resetBtn.style.borderRadius = '4px';
        resetBtn.style.padding = '2px 8px';
        resetBtn.style.cursor = 'pointer';
        resetBtn.style.fontSize = '11px';
        resetBtn.style.display = 'none';

        resetBtn.onclick = () => {
          selectedYear = null;
          resetBtn.style.display = 'none';
          yearLabel.style.display = 'none';
          renderScatter();
        };
        scatterDiv.appendChild(resetBtn);

        // Year Indicator (Where Reset Button was)
        const yearLabel = document.createElement('div');
        yearLabel.style.position = 'absolute';
        yearLabel.style.bottom = '40px'; // Higher than reset btn
        yearLabel.style.left = '15px';
        yearLabel.style.zIndex = '4';
        yearLabel.style.fontSize = '16px';
        yearLabel.style.fontWeight = 'bold';
        yearLabel.style.color = '#000000';
        yearLabel.style.pointerEvents = 'none';
        yearLabel.style.display = 'none';
        scatterDiv.appendChild(yearLabel);

        // Filters UI (Top Right)
        const filterContainer = document.createElement('div');
        filterContainer.style.position = 'absolute';
        filterContainer.style.top = '15px';
        filterContainer.style.right = '15px';
        filterContainer.style.zIndex = '5';
        filterContainer.style.background = 'rgba(255,255,255,0.9)';
        filterContainer.style.padding = '2px 8px';
        filterContainer.style.borderRadius = '12px';
        filterContainer.style.border = '1px solid #eee';
        filterContainer.style.display = 'flex';
        filterContainer.style.alignItems = 'center';
        filterContainer.style.gap = '15px'; // Increased gap for count

        // Visible Count Label
        const countLabel = document.createElement('span');
        countLabel.textContent = '...';
        countLabel.style.fontSize = '12px';
        countLabel.style.fontWeight = 'bold';
        countLabel.style.color = '#333';
        countLabel.style.marginRight = '5px';
        filterContainer.appendChild(countLabel);

        const ratings = {
          g: { label: 'G', color: '#4caf50' }, // Green
          s: { label: 'S', color: '#ffb74d' }, // Orange/Yellow
          q: { label: 'Q', color: '#ab47bc' }, // Purple
          e: { label: 'E', color: '#f44336' }  // Red
        };
        const activeFilters = { g: true, s: true, q: true, e: true };

        Object.keys(ratings).forEach(key => {
          const btn = document.createElement('div');
          const conf = ratings[key];

          btn.style.display = 'flex';
          btn.style.alignItems = 'center';
          btn.style.cursor = 'pointer';
          btn.style.userSelect = 'none';
          btn.style.gap = '4px';

          // Label Text
          const label = document.createElement('span');
          label.textContent = conf.label;
          label.style.fontWeight = 'normal';
          label.style.color = '#000000'; // Init color
          label.style.fontSize = '12px';

          // Circle Indicator
          const circle = document.createElement('div');
          circle.style.width = '16px';
          circle.style.height = '16px';
          circle.style.borderRadius = '50%';
          circle.style.background = conf.color;
          circle.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)';
          circle.style.transition = 'background 0.3s, transform 0.3s';

          btn.appendChild(label);
          btn.appendChild(circle);

          btn.onclick = () => {
            activeFilters[key] = !activeFilters[key];
            // Toggle Visual
            if (activeFilters[key]) {
              circle.style.background = conf.color;
              circle.style.opacity = '1';
            } else {
              circle.style.background = '#e0e0e0';
              circle.style.opacity = '0.7';
            }
            renderScatter();
          };

          filterContainer.appendChild(btn);
        });


        // Canvas Container
        const canvasContainer = document.createElement('div');
        canvasContainer.style.width = '100%';
        canvasContainer.style.height = '300px';
        canvasContainer.style.position = 'relative';
        scatterDiv.appendChild(canvasContainer);

        const canvas = document.createElement('canvas');
        // Handle high DPI
        const dpr = window.devicePixelRatio || 1;
        const width = 800; // Layout logic can vary, let's assume specific or calc later
        // Ideally we start with clientWidth after append, but for now fixed internal res
        // We'll resize on mount.

        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvasContainer.appendChild(canvas);
        scatterDiv.appendChild(filterContainer); // Append last to ensure top z-index visual

        const ctx = canvas.getContext('2d', { alpha: false }); // Optimize for opaque bg if possible, but we check filters

        // Overlay Container for Lines
        const overlayDiv = document.createElement('div');
        overlayDiv.style.position = 'absolute';
        overlayDiv.style.top = '0';
        overlayDiv.style.left = '0';
        overlayDiv.style.width = '100%';
        overlayDiv.style.height = '100%';
        overlayDiv.style.pointerEvents = 'none'; // Passthrough
        canvasContainer.appendChild(overlayDiv);

        // Drag Selection UI
        const selectionDiv = document.createElement('div');
        selectionDiv.style.position = 'absolute';
        selectionDiv.style.border = '1px dashed #007bff';
        selectionDiv.style.backgroundColor = 'rgba(0, 123, 255, 0.2)';
        selectionDiv.style.display = 'none';
        selectionDiv.style.pointerEvents = 'none';
        canvasContainer.appendChild(selectionDiv);

        // Popover UI
        const popover = document.createElement('div');
        popover.id = 'scatter-popover-ui';
        popover.style.cssText = 'position: fixed; z-index: 10000; background: #fff; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: none; max-height: 300px; width: 320px; flex-direction: column; font-family: sans-serif;';
        document.body.appendChild(popover);

        // Close Popover Handler
        document.addEventListener('mousedown', (e) => {
          if (popover.style.display !== 'none' && !popover.contains(e.target)) {
            popover.style.display = 'none';
          }
        });

        const currentScale = {};

        // Render Logic
        const renderScatter = () => {
          if (!scatterDiv.isConnected) return; // Safety

          const rect = canvasContainer.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;

          if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            ctx.scale(dpr, dpr);
          }
          const w = rect.width;
          const h = rect.height;

          // Clear
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);

          // Clear Overlays
          overlayDiv.innerHTML = '';

          // Bounds
          const padL = 40, padR = 20, padT = 60, padB = 50; // Increased padB for reset button
          const drawW = w - padL - padR;
          const drawH = h - padT - padB;

          let minDate = Infinity;
          let maxDate = -Infinity;
          let maxVal = 0;

          // Determine Time Range
          if (selectedYear) {
            minDate = new Date(selectedYear, 0, 1).getTime();
            maxDate = new Date(selectedYear, 11, 31, 23, 59, 59).getTime();

            resetBtn.style.display = 'block';
            yearLabel.textContent = selectedYear;
            yearLabel.style.display = 'block';
          } else {
            resetBtn.style.display = 'none';
            yearLabel.style.display = 'none'; // Hide

            // Full Range Calc
            for (const d of scatterData) {
              if (d.d < minDate) minDate = d.d;
              if (d.d > maxDate) maxDate = d.d;
            }
            // Add small buffer if empty or minimal
            if (minDate === Infinity) { minDate = Date.now(); maxDate = minDate + 86400000; }
            else {
              // Snap minDate to Jan 1st of the start year for clean origin
              const startY = new Date(minDate).getFullYear();
              minDate = new Date(startY, 0, 1).getTime();
            }
          }

          // Determine Max Value (Metrics) visible in this range?
          // Or global max? Usually specific range max is more useful for zooming.

          const timeRange = maxDate - minDate || 1;

          // Re-scan for maxVal within the view window
          // If we zoom, we want the Y-scale to adapt to the visible data points? 
          // User didn't specify, but adaptive is usually better.
          // Let's stick to global or filtered?
          // "Just show that year's data". Let's adapt Y to that year's data for better visibility.

          for (const d of scatterData) {
            if (d.d >= minDate && d.d <= maxDate) {
              const val = currentScatterMode === 'tags' ? (d.t || 0) : d.s;
              if (val > maxVal) maxVal = val;
            }
          }
          if (maxVal === 0) maxVal = 100; // Default

          // Dynamic Scale Step
          let stepY = 100;
          if (currentScatterMode === 'tags') {
            if (maxVal < 50) stepY = 10;
            else if (maxVal < 200) stepY = 25;
            else stepY = 50;
          } else {
            if (maxVal < 200) stepY = 50;
            else if (maxVal < 1000) stepY = 100;
            else stepY = 500;
          }

          // Round MaxVal up to next step
          maxVal = Math.ceil(maxVal / stepY) * stepY;
          if (maxVal < stepY) maxVal = stepY;


          // Update Scale for Interaction
          Object.assign(currentScale, { minDate, maxDate, maxVal, timeRange, padL, padT, drawW, drawH, mode: currentScatterMode });

          // Filter Data
          const visiblePoints = scatterData.filter(d => {
            // Date Range Check (Crucial for correct count)
            if (d.d < minDate || d.d > maxDate) return false;
            return activeFilters[d.r];
          });

          countLabel.textContent = `${visiblePoints.length} items`;

          // 1. Draw Grid/Axes
          ctx.beginPath();
          ctx.strokeStyle = '#eee';
          ctx.lineWidth = 1;

          // Y Grid
          for (let val = 0; val <= maxVal; val += stepY) {
            const y = padT + drawH - (val / maxVal) * drawH;
            ctx.moveTo(padL, y);
            ctx.lineTo(w - padR, y);

            ctx.fillStyle = '#888';
            ctx.font = '10px Arial';
            ctx.textAlign = 'right';
            ctx.fillText(val, padL - 5, y + 3);
          }
          ctx.stroke();

          // X Axis
          ctx.beginPath();
          ctx.strokeStyle = '#ccc';
          ctx.moveTo(padL, padT + drawH);
          ctx.lineTo(w - padR, padT + drawH);
          ctx.stroke();

          // X Axis Labels
          ctx.fillStyle = '#666';
          ctx.textAlign = 'center';

          if (selectedYear) {
            // Month View (Jan, Feb...)
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            months.forEach((m, i) => {
              const stepW = drawW / 12;
              const x = padL + (stepW * i) + (stepW / 2);
              ctx.fillText(m, x, padT + drawH + 15);

              if (i > 0) {
                const tickX = padL + (stepW * i);
                ctx.beginPath();
                ctx.moveTo(tickX, padT + drawH);
                ctx.lineTo(tickX, padT + drawH + 5);
                ctx.stroke();
              }
            });
          } else {
            // Year View
            const startYear = new Date(minDate).getFullYear();
            const endYear = new Date(maxDate).getFullYear();

            for (let y = startYear; y <= endYear; y++) {
              const d = new Date(y, 0, 1).getTime();
              // Calculate position
              const x = padL + ((d - minDate) / timeRange) * drawW;

              // Draw if within bounds
              if (x >= padL - 5 && x <= w - padR + 5) {
                // Label
                // Center year in its slot? 
                const nextD = new Date(y + 1, 0, 1).getTime();
                const xNext = padL + ((nextD - minDate) / timeRange) * drawW;
                const xCenter = (x + xNext) / 2;

                // Draw label roughly centered
                if (xCenter > padL - 10 && xCenter < w - padR + 10) {
                  ctx.fillText(y, xCenter, padT + drawH + 15);
                }

                // Tick
                ctx.beginPath();
                ctx.moveTo(x, padT + drawH);
                ctx.lineTo(x, padT + drawH + 5);
                ctx.stroke();
              }
            }
          }

          // 2. Draw Points
          visiblePoints.forEach(pt => {
            if (pt.d < minDate || pt.d > maxDate) return;

            const val = currentScatterMode === 'tags' ? (pt.t || 0) : pt.s;
            const x = padL + ((pt.d - minDate) / timeRange) * drawW;
            const y = padT + drawH - (val / maxVal) * drawH;

            let color = '#ccc';
            if (pt.r === 'g') color = '#4caf50';
            else if (pt.r === 's') color = '#ffb74d';
            else if (pt.r === 'q') color = '#ab47bc';
            else if (pt.r === 'e') color = '#f44336';

            ctx.fillStyle = color;
            ctx.fillRect(x - 1, y - 1, 2, 2);
          });

          // 3. Render Overlays
          // ... (Keep existing overlay logic) ... 
          // We can simplify and just re-implement the short helper
          const addOverlayLine = (dateObjOrStr, color, title, isDashed, thickness = '2px') => {
            const d = new Date(dateObjOrStr).getTime();
            if (d < minDate || d > maxDate) return;

            const x = padL + ((d - minDate) / timeRange) * drawW;

            const line = document.createElement('div');
            line.style.position = 'absolute';
            line.style.left = x + 'px';
            line.style.top = padT + 'px';
            line.style.height = drawH + 'px';
            line.style.borderLeft = `${thickness} ${isDashed ? 'dashed' : 'solid'} ${color}`;
            line.style.width = '4px';
            line.style.cursor = 'help';
            line.style.pointerEvents = 'auto';
            line.title = title;

            overlayDiv.appendChild(line);
          };

          // Join Date Overlay
          if (this.context.targetUser && this.context.targetUser.joinDate) {
            const jd = new Date(this.context.targetUser.joinDate);
            addOverlayLine(jd, '#00E676', `${jd.toLocaleDateString()}: Joined Danbooru`, true, '2px');
          }

          if (promotions) {
            promotions.forEach(p => {
              addOverlayLine(p.date, '#ff5722', `${p.date.toLocaleDateString()}: ${p.role}`, true);
            });
          }

          if (currentScatterMode === 'score') {
            addOverlayLine('2021-11-24', '#bbb', 'All users could vote since this day.', true, '1px');
          }
        };

        dashboardDiv.appendChild(scatterWrapper);

        // Initial Render after layout
        requestAnimationFrame(renderScatter);
        window.addEventListener('resize', renderScatter);

        // Click Listener for Year Zoom
        // Click Listener for Year Zoom
        canvas.addEventListener('click', (e) => {
          if (Date.now() - lastDragEndTime < 100) return;

          const rect = canvasContainer.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;

          // Check bounds
          // Bottom padding area (X-axis labels)
          // Restrict to label area (e.g., +40px from axis) to prevent footer clicks
          const axisY = currentScale.padT + currentScale.drawH;
          if (y > axisY && y < axisY + 40 && !selectedYear) {
            // Calculate clicked date
            // t = (x - padL) / drawW * range + min
            const t = ((x - currentScale.padL) / currentScale.drawW) * currentScale.timeRange + currentScale.minDate;
            const clickedDate = new Date(t);
            const clickedYear = clickedDate.getFullYear();

            // Valid year check?
            if (clickedYear >= new Date(currentScale.minDate).getFullYear() && clickedYear <= new Date(currentScale.maxDate).getFullYear()) {
              selectedYear = clickedYear;
              renderScatter();
            }
          }
        });

        // Hover Effect for Year Labels
        canvas.addEventListener('mousemove', (e) => {
          if (dragStart) return; // Disable hover effect during drag

          const rect = canvasContainer.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;

          let isHand = false;
          // Check bounds for X-axis labels
          const axisY = currentScale.padT + currentScale.drawH;
          if (y > axisY && y < axisY + 40 && !selectedYear) {
            const t = ((x - currentScale.padL) / currentScale.drawW) * currentScale.timeRange + currentScale.minDate;
            const hoveredYear = new Date(t).getFullYear();
            if (hoveredYear >= new Date(currentScale.minDate).getFullYear() && hoveredYear <= new Date(currentScale.maxDate).getFullYear()) {
              isHand = true;
            }
          }

          canvas.style.cursor = isHand ? 'pointer' : 'default';
        });
        // Drag Event Listeners
        let dragStart = null;
        let ignoreNextClick = false;
        let lastDragEndTime = 0;

        canvas.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          // Reset ignore flag on new press
          ignoreNextClick = false;

          const rect = canvasContainer.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;

          // Allow dragging only within draw area (ish)
          if (x < currentScale.padL || x > currentScale.padL + currentScale.drawW ||
            y < currentScale.padT || y > currentScale.padT + currentScale.drawH) return;

          dragStart = { x, y };
          selectionDiv.style.left = x + 'px';
          selectionDiv.style.top = y + 'px';
          selectionDiv.style.width = '0px';
          selectionDiv.style.height = '0px';
          selectionDiv.style.display = 'block';
        });

        window.addEventListener('mousemove', (e) => {
          if (!dragStart) return;
          const rect = canvasContainer.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;

          // Constraints
          const rL = currentScale.padL;
          const rT = currentScale.padT;
          const rW = currentScale.drawW;
          // Max Y is now bottom of canvas to cover negative values

          const currentX = Math.max(rL, Math.min(rL + rW, mx));
          const currentY = Math.max(rT, Math.min(rect.height, my));

          const x = Math.min(dragStart.x, currentX);
          const y = Math.min(dragStart.y, currentY);
          const w = Math.abs(currentX - dragStart.x);
          const h = Math.abs(currentY - dragStart.y);

          selectionDiv.style.left = x + 'px';
          selectionDiv.style.top = y + 'px';
          selectionDiv.style.width = w + 'px';
          selectionDiv.style.height = h + 'px';
        });

        window.addEventListener('mouseup', (e) => {
          if (!dragStart) return;
          const ds = dragStart;
          dragStart = null;
          selectionDiv.style.display = 'none';

          const rect = canvasContainer.getBoundingClientRect();
          const endX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
          const endY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

          // If moved significantly, it was a drag
          if (Math.abs(endX - ds.x) >= 5 || Math.abs(endY - ds.y) >= 5) {
            ignoreNextClick = true; // Prevent click-to-zoom
            lastDragEndTime = Date.now();
          }

          if (Math.abs(endX - ds.x) < 5 && Math.abs(endY - ds.y) < 5) return;

          const x1 = Math.min(ds.x, endX);
          const x2 = Math.max(ds.x, endX);
          const y1 = Math.min(ds.y, endY);
          const y2 = Math.max(ds.y, endY);

          const dateMin = ((x1 - currentScale.padL) / currentScale.drawW) * currentScale.timeRange + currentScale.minDate;
          const dateMax = ((x2 - currentScale.padL) / currentScale.drawW) * currentScale.timeRange + currentScale.minDate;

          const valMin = ((currentScale.padT + currentScale.drawH - y2) / currentScale.drawH) * currentScale.maxVal;
          const valMax = ((currentScale.padT + currentScale.drawH - y1) / currentScale.drawH) * currentScale.maxVal;

          const result = scatterData.filter(d => {
            if (!activeFilters[d.r]) return false;
            const val = currentScale.mode === 'tags' ? (d.t || 0) : d.s;
            return d.d >= dateMin && d.d <= dateMax && val >= valMin && val <= valMax;
          });

          if (result.length === 0) return;

          // Pass full list to popover (sorted)
          const sortedList = result.sort((a, b) => {
            const vA = currentScale.mode === 'tags' ? (a.t || 0) : a.s;
            const vB = currentScale.mode === 'tags' ? (b.t || 0) : b.s;
            return vB - vA;
          });

          // Compute Actual Range from Data (to avoid showing -73 when min is -2)
          let aDMin = Infinity, aDMax = -Infinity;
          let aVMin = Infinity, aVMax = -Infinity;

          sortedList.forEach(d => {
            if (d.d < aDMin) aDMin = d.d;
            if (d.d > aDMax) aDMax = d.d;

            const v = currentScale.mode === 'tags' ? (d.t || 0) : d.s;
            if (v < aVMin) aVMin = v;
            if (v > aVMax) aVMax = v;
          });

          showPopover(e.clientX, e.clientY, sortedList, aDMin, aDMax, aVMin, aVMax);
        });

        const showPopover = (mx, my, items, dMin, dMax, sMin, sMax) => {
          const d1 = new Date(dMin).toLocaleDateString();
          const d2 = new Date(dMax).toLocaleDateString();
          const sm1 = Math.floor(sMin);
          const sm2 = Math.ceil(sMax);
          const totalCount = items.length;
          const isTags = currentScale.mode === 'tags';
          let visibleLimit = 50;

          const renderItems = (start, limit) => {
            let chunkHtml = '';
            const slice = items.slice(start, start + limit);

            slice.forEach(it => {
              const itDate = new Date(it.d).toLocaleDateString();
              const val = isTags ? (it.t || 0) : it.s;
              let color = '#ccc';
              if (it.r === 'g') color = '#4caf50';
              else if (it.r === 's') color = '#ffb74d';
              else if (it.r === 'q') color = '#ab47bc';
              else if (it.r === 'e') color = '#f44336';

              chunkHtml += `
                 <div class="pop-item" data-id="${it.id}" style="padding: 8px 15px; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; cursor: pointer; transition: bg 0.2s;">
                   <div style="width: 10px; height: 10px; border-radius: 50%; background: ${color}; margin-right: 10px;"></div>
                   <span style="color: #007bff; font-weight: 500; font-size: 13px; margin-right: 10px; width: 60px;">#${it.id}</span>
                   <span style="flex: 1; color: #666; font-size: 12px;">${itDate}</span>
                   <span style="font-weight: bold; color: #333; font-size: 13px;">${val}</span>
                 </div>
               `;
            });
            return chunkHtml;
          };

          // Define Main HTML Structure
          let headerHtml = `
             <div style="padding: 10px 15px; background: #fafafa; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: start;">
               <div style="display:flex; flex-direction:column;">
                  <span style="font-weight: 600; font-size: 13px; color: #333;">${d1} ~ ${d2}</span>
                  <span style="font-size: 11px; color: #666; margin-top:2px;">${isTags ? 'Tag Count' : 'Score'}: ${sm1} ~ ${sm2}</span>
               </div>
               <div style="display:flex; align-items:center; gap: 10px; margin-top:2px;">
                 <span id="pop-count-label" style="font-size: 12px; color: #888;">${Math.min(visibleLimit, totalCount)} / ${totalCount} items</span>
                 <button id="scatter-pop-close" style="background:none; border:none; color:#999; font-size:16px; cursor:pointer; line-height:1; padding:0;">&times;</button>
               </div>
             </div>
             <div id="pop-list-container" style="flex: 1; overflow-y: auto;">
               ${renderItems(0, visibleLimit)}
             </div>
             <div id="pop-load-more" style="display: ${totalCount > visibleLimit ? 'block' : 'none'}; padding: 10px; text-align: center; border-top: 1px solid #eee; background: #fff;">
                <button id="btn-load-more" style="width: 100%; padding: 6px; background: #f0f0f0; border: none; border-radius: 4px; color: #555; cursor: pointer; font-size: 12px;">Load More (+50)</button>
             </div>
           `;

          popover.innerHTML = headerHtml;

          // Event Attachment Helper
          const attachEvents = (parent) => {
            parent.querySelectorAll('.pop-item').forEach(el => {
              el.onmouseover = () => el.style.backgroundColor = '#f5f9ff';
              el.onmouseout = () => el.style.backgroundColor = 'transparent';
              el.onclick = () => window.open(`/posts/${el.dataset.id}`, '_blank');
            });
          };

          // Attach initial events
          attachEvents(popover.querySelector('#pop-list-container'));

          // Close Handler
          const closeBtn = popover.querySelector('#scatter-pop-close');
          if (closeBtn) {
            closeBtn.onclick = (e) => {
              e.stopPropagation();
              popover.style.display = 'none';
            };
          }

          // Load More Handler
          const loadMoreContainer = popover.querySelector('#pop-load-more');
          const loadMoreBtn = popover.querySelector('#btn-load-more');
          const listContainer = popover.querySelector('#pop-list-container');
          const countLabel = popover.querySelector('#pop-count-label');

          if (loadMoreBtn) {
            loadMoreBtn.onclick = () => {
              const start = visibleLimit;
              visibleLimit += 50;
              const newHtml = renderItems(start, 50);

              // Append HTML string to container
              listContainer.insertAdjacentHTML('beforeend', newHtml);

              // Attach events to new items (this matches only new ones if we are careful, or re-run on all?)
              // attachEvents runs on all matching .pop-item inside parent.
              // To optimize, we could create elements instead of HTML strings, but this is fast enough.
              // Let's just re-attach to the LAST 50 added? NO, simple re-query is fine or efficient delegation.
              // Simplest: Re-run attach on container (overwriting isn't bad) or just last children.
              // For safety, let's just re-run on container.
              attachEvents(listContainer);

              // Update Label
              countLabel.textContent = `${Math.min(visibleLimit, totalCount)} / ${totalCount} items`;

              // Hide button if done
              if (visibleLimit >= totalCount) {
                loadMoreContainer.style.display = 'none';
              }
            };
          }

          popover.style.display = 'flex';
          const pH = popover.offsetHeight || 300; // Recalc if needed logic later

          let posX = mx + 15;
          let posY = my + 15;

          // Safety Clamp
          if (posX + 320 > window.innerWidth) posX = window.innerWidth - 320 - 10;
          if (posX < 10) posX = 10;

          if (posY + pH > window.innerHeight) posY = window.innerHeight - pH - 10;
          if (posY < 10) posY = 10;

          popover.style.left = posX + 'px';
          popover.style.top = posY + 'px';
        };
      }




      // Update header status (ensure it's green if ready)
      this.updateHeaderStatus();
    }
  }

  /**
   * AnalyticsDataManager: Handles heavy data fetching for full history.
   */
  class AnalyticsDataManager extends DataManager {
    static isGlobalSyncing = false;
    static syncProgress = { current: 0, total: 0 };
    static onProgressCallback = null;

    constructor(db) {
      super(db);
    }

    /**
     * Gets simple stats about the synced posts for a user.
     */
    async getSyncStats(userInfo) {
      const uploaderId = parseInt(userInfo.id);
      if (!uploaderId) return { count: 0, lastSync: null };

      const count = await this.db.posts.where('uploader_id').equals(uploaderId).count();
      const lastEntry = await this.db.posts.orderBy('created_at').last();

      return {
        count,
        lastSync: lastEntry ? lastEntry.created_at : null // Approximate
      };
    }

    /**
     * Calculates summary statistics (Avg Uploads, Max Uploads, etc.)
     * @param {Object} userInfo
     */
    async getSummaryStats(userInfo) {
      const uploaderId = parseInt(userInfo.id);
      if (!uploaderId) return { maxUploads: 0, maxDate: 'N/A', firstUploadDate: null };

      // efficiently fetch just created_at
      const posts = await this.db.posts.where('uploader_id').equals(uploaderId).toArray();

      if (posts.length === 0) return { maxUploads: 0, maxDate: 'N/A', firstUploadDate: null };

      const history = {};
      let firstUploadDate = null;

      posts.forEach(p => {
        const dStr = p.created_at.split('T')[0];
        history[dStr] = (history[dStr] || 0) + 1;

        const d = new Date(p.created_at);
        if (!firstUploadDate || d < firstUploadDate) {
          firstUploadDate = d;
        }
      });

      let maxUploads = 0;
      let maxDate = 'N/A';

      for (const [date, count] of Object.entries(history)) {
        if (count > maxUploads) {
          maxUploads = count;
          maxDate = date;
        }
      }

      return {
        maxUploads,
        maxDate,
        firstUploadDate
      };
    }

    /**
     * Retrieves key milestone posts (e.g. 1st, 100th, 1000th ...).
     */
    async getMilestones(userInfo, isNsfwEnabled = false, customStep = 'auto') {
      const uploaderId = parseInt(userInfo.id);
      if (!uploaderId) return [];

      const total = await this.db.posts.where('uploader_id').equals(uploaderId).count();
      if (total === 0) return [];

      // Define Milestones based on Total Count logic
      let targets = [];

      if (customStep !== 'auto' && typeof customStep === 'number') {
        targets.push(1);
        for (let i = customStep; i <= total; i += customStep) {
          targets.push(i);
        }
      } else {
        // Case 1: Small (< 1,500) -> 1, 100, 200...
        if (total < 1500) {
          targets.push(1);
          for (let i = 100; i <= total; i += 100) {
            targets.push(i);
          }
        }
        // Case 2: Medium (1,500 ~ 10,000) -> 1, 100, 500, 1000, 1500, 2000...
        else if (total <= 10000) {
          targets.push(1);
          if (total >= 100) targets.push(100);
          // Step 500 starting from 500
          for (let i = 500; i <= total; i += 500) {
            targets.push(i);
          }
        }
        // Case 4: Huge (> 100,000) -> 1, 100, 1000, 5000, 10000, ... (Step 5000)
        else if (total > 100000) {
          targets.push(1);
          if (total >= 100) targets.push(100);
          if (total >= 1000) targets.push(1000);

          for (let i = 5000; i <= total; i += 5000) {
            targets.push(i);
          }
        }
        // Case 3: Very Large (> 50,000) -> 1, 100, 1000, 2500, 5000, ... (Step 2500)
        else if (total > 50000) {
          targets.push(1);
          if (total >= 100) targets.push(100);
          if (total >= 1000) targets.push(1000);

          for (let i = 2500; i <= total; i += 2500) {
            targets.push(i);
          }
        }
        // Case 2: Large (> 10,000) -> 1, 100, 1000, 2000...
        else {
          targets.push(1);
          if (total >= 100) targets.push(100);
          for (let i = 1000; i <= total; i += 1000) {
            targets.push(i);
          }
        }
      }

      // Ensure unique and sort ASC
      targets = [...new Set(targets)].sort((a, b) => a - b);

      const milestones = [];
      const matches = await this.db.posts
        .where('no').anyOf(targets)
        .filter(p => p.uploader_id === uploaderId)
        .toArray();

      // NEW: Fetch missing thumbnails for Safety logic
      // We want to show thumbnails for Safe(s) or General(g) posts.
      // OR if NSFW is enabled, show all.
      // If we don't have 'preview_file_url' locally (old sync), we fetch it now.
      const missingIds = [];
      matches.forEach(p => {
        const isSafe = (p.rating === 's' || p.rating === 'g');
        const shouldFetch = isNsfwEnabled || isSafe;
        if (shouldFetch && !p.preview_file_url && !p.file_url) {
          missingIds.push(p.id);
        }
      });

      if (missingIds.length > 0) {
        try {
          // Chunk requests if too many
          const chunkSize = 100;
          for (let i = 0; i < missingIds.length; i += chunkSize) {
            const chunk = missingIds.slice(i, i + chunkSize);
            const idsStr = chunk.join(',');
            const url = `${this.baseUrl}/posts.json?tags=id:${idsStr}&limit=100&only=id,preview_file_url,file_url,rating`;

            const res = await fetch(url);
            if (res.ok) {
              const fetchedItems = await res.json();
              // Update local matches objects
              fetchedItems.forEach(item => {
                const local = matches.find(m => m.id === item.id);
                if (local) {
                  local.preview_file_url = item.preview_file_url;
                  local.file_url = item.file_url;
                  // Ensure rating matches just in case
                  local.rating = item.rating;
                }
              });
            }
          }
        } catch (e) {
          console.warn("[Danbooru Grass] Failed to fetch missing milestone thumbnails", e);
        }
      }

      // Map back to result structure
      // Create lookup
      const map = new Map(matches.map(p => [p.no, p]));

      const results = [];

      targets.forEach(t => {
        // Just push specific targets
        const p = map.get(t);
        if (p) {
          // Label logic
          let label = `#${t} `;
          if (t >= 1000 && t % 1000 === 0) label = `${t / 1000} k`;
          if (t === 1) label = 'First';

          results.push({ type: label, post: p, index: t });
        }
      });

      // Let's sort strictly by Index ASC.
      results.sort((a, b) => a.index - b.index);

      return results;
    }


    /**
     * Aggregates post counts by month.
     * Aggregates post counts by month.
     * Returns array of { date: 'YYYY-MM', count: number, label: string }
     * @param {Object} userInfo
     * @param {Date} [minDate] Optional start date (inclusive) for the timeline
     */
    async getMonthlyStats(userInfo, minDate = null) {
      const uploaderId = parseInt(userInfo.id);
      if (!uploaderId) return [];

      const counts = {}; // "2023-01": 5

      // Streaming iteration to avoid memory spikes
      await this.db.posts.where('uploader_id').equals(uploaderId).each(post => {
        if (!post.created_at) return;
        // created_at is likely ISO string "2023-01-01T..."
        const month = post.created_at.substring(0, 7); // "YYYY-MM"
        counts[month] = (counts[month] || 0) + 1;
      });

      // Convert to array and Fill Gaps for Linear timeline
      let results = [];
      const keys = Object.keys(counts).sort();

      if (keys.length > 0) {
        let startKey = keys[0];
        const endKey = keys[keys.length - 1];

        // Extend start date if minDate is provided and earlier
        if (minDate) {
          const mY = minDate.getFullYear();
          const mM = minDate.getMonth() + 1;
          const mKey = `${mY}-${String(mM).padStart(2, '0')}`;
          if (mKey < startKey) startKey = mKey;
        }

        let [y, m] = startKey.split('-').map(Number);
        const [endY, endM] = endKey.split('-').map(Number);

        // Loop until we pass endYear/endMonth
        while (y < endY || (y === endY && m <= endM)) {
          const k = `${y}-${String(m).padStart(2, '0')}`;
          results.push({
            date: k,
            count: counts[k] || 0,
            label: k
          });

          m++;
          if (m > 12) {
            m = 1;
            y++;
          }
        }
      } else {
        // No data
        results = [];
      }

      return results;
    }

    /**
     * Fetches rating distribution from /reports/posts.json
     * @param {Object} userInfo
     * @returns {Promise<Array<{rating: string, count: number, label: string}>>}
     */
    async getRatingDistribution(userInfo) {
      if (!userInfo.name) return [];

      // Determine 'from' date (Join Date) and 'to' date (Tomorrow)
      const fromDate = userInfo.joinDate ? userInfo.joinDate.toISOString().split('T')[0] : '2005-01-01';

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const toDate = tomorrow.toISOString().split('T')[0];

      const params = new URLSearchParams({
        'search[group]': 'rating',
        'search[tags]': `user:${userInfo.name.replace(/ /g, '_')} `,
        'search[from]': fromDate,
        'search[to]': toDate
      });

      const url = `/reports/posts.json?${params.toString()}`;

      try {
        // Expected API Response: HTML table or JSON?
        // User reports usually return HTML unless .json is appended and supported.
        // User said: "just use /reports/posts.json ... it returns specific values".
        // Let's assume it returns JSON array like string '[[ "g", 123 ], [ "s", 456 ]]'.
        // Or object? Danbooru reports often return an array of arrays.

        const resp = await fetch(url);
        const text = await resp.text();

        // Danbooru Reports often return a visualization string or raw data.
        // Let's parse JSON.
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.warn('[Danbooru Grass] Report is not JSON. Falling back.', text.substring(0, 100));
          return [];
        }

        // Typical format: [["g", 10], ["s", 5], ...]
        // Check structure
        if (!Array.isArray(data)) return [];

        const map = {
          'g': 'General',
          's': 'Sensitive',
          'q': 'Questionable',
          'e': 'Explicit'
        };

        return data.map(item => {
          // item is object { rating: "s", posts: 19654 }
          const r = item.rating;
          const c = item.posts;
          return {
            rating: r,
            count: c,
            label: map[r] || r
          };
        });

      } catch (e) {
        console.error('[Danbooru Grass] Failed to fetch rating distribution', e);
        return [];
      }
    }

    /**
     * Fetches Character distribution from related_tag.json
     * @param {Object} userInfo
     * @returns {Promise<Array<{name: string, count: number, frequency: number, isOther: boolean}>>}
     */
    async getCharacterDistribution(userInfo, forceRefresh = false) {
      if (!userInfo.name) return [];
      const uploaderId = parseInt(userInfo.id || 0); // Need ID for cache key
      const cacheKey = 'character_dist';

      if (!forceRefresh && uploaderId) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) return cached;
      }

      const normalizedName = userInfo.name.replace(/ /g, '_');
      const url = `/related_tag.json?commit=Search&search[category]=4&search[order]=Frequency&search[query]=user:${encodeURIComponent(normalizedName)}`;

      try {
        const resp = await fetch(url).then(r => r.json());

        if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags)) return [];

        const tags = resp.related_tags;

        // Limit to Top 10 Concurrent Fetch
        const top10 = await this.mapConcurrent(tags.slice(0, 10), 2, async (item) => {
          const tagName = item.tag.name;
          const displayName = tagName.replace(/_/g, ' ');

          let userCount = 0;
          try {
            const countUrl = `/counts/posts.json?tags=${encodeURIComponent(`user:${normalizedName} ${tagName}`)}`;
            const countResp = await fetch(countUrl).then(r => r.json());
            userCount = countResp.counts && countResp.counts.posts ? countResp.counts.posts : 0;
          } catch (e) {
            console.warn('Failed to fetch count for', tagName);
          }

          return {
            name: displayName,
            tagName: tagName,
            count: userCount || item.tag.post_count,
            frequency: item.frequency,
            thumb: '',
            isOther: false
          };
        });

        const sumFreq = top10.reduce((acc, curr) => acc + curr.frequency, 0);
        const otherFreq = 1.0 - sumFreq;

        if (otherFreq > 0.001) {
          top10.push({
            name: 'Others',
            tagName: '',
            count: 0,
            frequency: otherFreq,
            thumb: '',
            isOther: true
          });
        }

        if (uploaderId) await this.saveStats(cacheKey, uploaderId, top10);
        return top10;

      } catch (e) {
        console.warn('[Danbooru Grass] Failed to fetch character distribution', e);
        return [];
      }
    }

    /**
     * Fetches Copyright distribution from related_tag.json
     * Filters out sub-copyrights by checking tag_implications.
     * @param {Object} userInfo
     * @returns {Promise<Array<{name: string, count: number, frequency: number, isOther: boolean}>>}
     */
    async getCopyrightDistribution(userInfo, forceRefresh = false) {
      if (!userInfo.name) return [];
      const uploaderId = parseInt(userInfo.id || 0);
      const cacheKey = 'copyright_dist';

      if (!forceRefresh && uploaderId) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) return cached;
      }

      const normalizedName = userInfo.name.replace(/ /g, '_');
      const url = `/related_tag.json?commit=Search&search[category]=3&search[order]=Frequency&search[query]=user:${encodeURIComponent(normalizedName)}`;

      try {
        const resp = await fetch(url).then(r => r.json());
        if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags)) return [];

        let tags = resp.related_tags;

        // Limit to Top 20 Candidates for filtering performance
        const candidates = tags.slice(0, 20);

        // Concurrent Filter checks - Limit 5
        const filteredResults = await this.mapConcurrent(candidates, 2, async (item) => {
          const tagName = item.tag.name;
          const impUrl = `/tag_implications.json?search[antecedent_name_matches]=${encodeURIComponent(tagName)}`;
          try {
            const imps = await fetch(impUrl).then(r => r.json());
            if (Array.isArray(imps) && imps.length > 0) return null;
            return item;
          } catch (e) { return item; }
        });
        const filtered = filteredResults.filter(item => item !== null);

        // Concurrent Fetch Data for Top 10 - Limit 5
        const top10 = await this.mapConcurrent(filtered.slice(0, 10), 2, async (item) => {
          const tagName = item.tag.name;
          const displayName = tagName.replace(/_/g, ' ');

          // 1. Fetch User specific count
          let userCount = 0;
          try {
            const countUrl = `/counts/posts.json?tags=${encodeURIComponent(`user:${normalizedName} ${tagName}`)}`;
            const countResp = await fetch(countUrl).then(r => r.json());
            userCount = countResp.counts && countResp.counts.posts ? countResp.counts.posts : 0;
          } catch (e) { }

          return {
            name: displayName,
            tagName: tagName,
            count: userCount || item.tag.post_count,
            frequency: item.frequency,
            thumb: '',
            isOther: false
          };
        });

        const sumFreq = top10.reduce((acc, curr) => acc + curr.frequency, 0);
        const otherFreq = 1.0 - sumFreq;

        if (otherFreq > 0.001) {
          top10.push({
            name: 'Others',
            tagName: '',
            count: 0,
            frequency: otherFreq,
            thumb: '',
            isOther: true
          });
        }

        if (uploaderId) await this.saveStats(cacheKey, uploaderId, top10);
        return top10;

      } catch (e) {
        console.warn('[Danbooru Grass] Failed to fetch copyright distribution', e);
        return [];
      }
    }

    /**
     * Helper for concurrent processing with limit
     */
    async mapConcurrent(items, concurrency, fn) {
      const results = new Array(items.length);
      let index = 0;
      const next = async () => {
        while (index < items.length) {
          const i = index++;
          results[i] = await fn(items[i]);
          // Rate limit protection
          await new Promise(r => setTimeout(r, 250));
        }
      }
      await Promise.all(Array.from({ length: concurrency }, next));
      return results;
    }

    /**
     * Fetches Favorite Copyright distribution.
     * Uses ordfav:{user} to find favorites.
     * @param {Object} userInfo
     */
    async getFavCopyrightDistribution(userInfo, forceRefresh = false) {
      if (!userInfo.name) return [];
      const uploaderId = parseInt(userInfo.id || 0);
      const cacheKey = 'fav_copyright_dist';

      if (!forceRefresh && uploaderId) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) return cached;
      }

      const normalizedName = userInfo.name.replace(/ /g, '_');
      const url = `/related_tag.json?commit=Search&search[category]=3&search[order]=Frequency&search[query]=ordfav:${encodeURIComponent(normalizedName)}`;

      try {
        const resp = await fetch(url).then(r => r.json());
        if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags)) return [];

        let tags = resp.related_tags;
        const candidates = tags.slice(0, 20);

        // Concurrent Filter checks (Sub-copyright) - Limit 5
        const filteredResults = await this.mapConcurrent(candidates, 2, async (item) => {
          const tagName = item.tag.name;
          const impUrl = `/tag_implications.json?search[antecedent_name_matches]=${encodeURIComponent(tagName)}`;
          try {
            const imps = await fetch(impUrl).then(r => r.json());
            if (Array.isArray(imps) && imps.length > 0) return null;
            return item;
          } catch (e) { return item; }
        });

        const filtered = filteredResults.filter(item => item !== null);

        // Concurrent Fetch Data for Top 10 - Limit 5
        const top10 = await this.mapConcurrent(filtered.slice(0, 10), 2, async (item) => {
          const tagName = item.tag.name;
          const displayName = tagName.replace(/_/g, ' ');

          // 1. Fetch Fav Count
          let favCount = 0;
          try {
            const countUrl = `/counts/posts.json?tags=${encodeURIComponent(`ordfav:${normalizedName} ${tagName}`)}`;
            const countResp = await fetch(countUrl).then(r => r.json());
            favCount = countResp.counts && countResp.counts.posts ? countResp.counts.posts : 0;
          } catch (e) { }

          // No Thumbnail for Fav_Copy as requested

          return {
            name: displayName,
            tagName: tagName,
            count: favCount || item.tag.post_count,
            frequency: item.frequency,
            thumb: '',
            isOther: false
          };
        });

        // Others
        const sumFreq = top10.reduce((acc, curr) => acc + curr.frequency, 0);
        const otherFreq = 1.0 - sumFreq;

        if (otherFreq > 0.001) {
          top10.push({
            name: 'Others',
            tagName: '',
            count: 0,
            frequency: otherFreq,
            thumb: '',
            isOther: true
          });
        }

        if (uploaderId) await this.saveStats(cacheKey, uploaderId, top10);
        return top10;
      } catch (e) {
        console.warn('[Danbooru Grass] Failed to fetch fav copyright distribution', e);
        return [];
      }
    }

    /**
     * Fetches Top SFW and NSFW posts in parallel using API.
     * @param {Object} userInfo
     * @returns {Promise<{sfw: Object|null, nsfw: Object|null}>}
     */
    async getTopPostsByType(userInfo) {
      if (!userInfo.name) return { sfw: null, nsfw: null };

      // Helper for fetching 1 top post
      const fetchTop = async (ratingTags) => {
        try {
          // Use tags=... order:score rating:x limit=1
          const normalizedName = userInfo.name.replace(/ /g, '_');
          const query = `user:${normalizedName} order:score rating:${ratingTags} `;
          const url = `/posts.json?tags=${encodeURIComponent(query)}&limit=1`;
          const resp = await fetch(url).then(r => r.json());
          if (Array.isArray(resp) && resp.length > 0) {
            return resp[0];
          }
        } catch (e) {
          console.warn(`[Danbooru Grass] Failed to fetch top post for ${ratingTags}`, e);
        }
        return null;
      };

      const [sfw, nsfw] = await Promise.all([
        fetchTop('g,s'), // General, Sensitive
        fetchTop('q,e')  // Questionable, Explicit
      ]);

      return { sfw, nsfw };
    }

    /**
     * Gets the post with the highest score and fetches its details.
     * @param {Object} userInfo
     * @param {string} filterMode 'sfw' | 'nsfw' | 'all' (default: 'sfw')
     */
    async getTopScorePost(userInfo, filterMode = 'sfw') {
      const uploaderId = parseInt(userInfo.id);
      if (!uploaderId) return null;

      // Filter Logic for IndexedDB
      // Since Dexie 'sortBy' takes a string index, we can't easily combine it with complex filters efficiently
      // without compound indexes.
      // However, for a single user, it's efficient enough to traverse.

      let collection = this.db.posts.where('uploader_id').equals(uploaderId);

      if (filterMode === 'sfw') {
        // 'g' (general) or 's' (sensitive)
        collection = collection.and(p => p.rating === 'g' || p.rating === 's');
      } else if (filterMode === 'nsfw') {
        // 'q' (questionable) or 'e' (explicit)
        collection = collection.and(p => p.rating === 'q' || p.rating === 'e');
      }

      // Sort by score DESC
      const topLocal = await collection.reverse().sortBy('score').then(r => r[0]);

      if (!topLocal) return null;

      // 2. Fetch details (thumbnail, fav_count)
      try {
        const url = `/posts/${topLocal.id}.json`;
        const details = await fetch(url).then(r => r.json());
        if (details && details.id) {
          return details; // Return full API object
        }
      } catch (e) {
        console.warn('[Danbooru Grass] Failed to fetch top post details', e);
      }

      return topLocal; // Fallback to local data (might miss thumb/favs)
    }

    /**
     * Fetches data for Scatter Plot.
     * Returns minimal object array to save memory/time.
     * @param {Object} userInfo
     * @returns {Promise<Array<{d:number, s:number, r:string}>>}
     */
    async getScatterData(userInfo) {
      const uploaderId = parseInt(userInfo.id);
      if (!uploaderId) return [];

      const result = [];
      // Streaming iterate
      await this.db.posts.where('uploader_id').equals(uploaderId).each(post => {
        if (!post.created_at) return;
        // Use timestamps for faster plotting
        const d = new Date(post.created_at).getTime();
        // Rating: g, s, q, e
        const r = post.rating;
        const s = post.score || 0;
        const t = post.tag_count_general || 0;

        result.push({ id: post.id, d, s, t, r });
      });

      return result;
    }

    /**
     * Fetches promotion history from user feedbacks.
     * @param {Object} userInfo
     */
    async getPromotionHistory(userInfo) {
      if (!userInfo.name) return [];
      try {
        const normalizedName = userInfo.name.replace(/ /g, '_');
        const url = `/user_feedbacks.json?commit=Search&search%5Bbody_matches%5D=promoted&search%5Buser_name%5D=${encodeURIComponent(normalizedName)}`;
        const feedbacks = await fetch(url).then(r => r.json());

        if (!Array.isArray(feedbacks)) return [];

        return feedbacks.map(f => {
          // Parse Body: "promoted to a Builder level account"
          const match = f.body.match(/promoted to a (.+?) level/i);
          const role = match ? match[1] : 'Unknown';
          return {
            date: new Date(f.created_at),
            role: role,
            rawBody: f.body
          };
        }).filter(item => item.role !== 'Unknown').sort((a, b) => a.date - b.date);
      } catch (e) {
        console.error('[Danbooru Grass] Failed to fetch promotions', e);
        return [];
      }
    }

    /**
     * Fetches breast size distribution by checking specific tags.
     * @param {Object} userInfo
     * @returns {Promise<Array>}
     */
    async getBreastsDistribution(userInfo, forceRefresh = false) {
      if (!userInfo.name) return [];
      const uploaderId = parseInt(userInfo.id || 0);
      const cacheKey = 'breasts_dist';

      if (!forceRefresh && uploaderId) {
        const cached = await this.getStats(cacheKey, uploaderId);
        if (cached) return cached;
      }

      const normalizedName = userInfo.name.replace(/ /g, '_');
      const tags = [
        'flat_chest',
        'small_breasts',
        'medium_breasts',
        'large_breasts',
        'huge_breasts',
        'gigantic_breasts'
      ];

      // Use mapConcurrent from base class to fetch efficiently
      const results = await this.mapConcurrent(tags, 6, async (tag) => {
        try {
          // Fetch count for "user:name tag"
          // Using counts/posts.json
          const uniqueTag = `user:${normalizedName} ${tag}`;
          const url = `/counts/posts.json?tags=${encodeURIComponent(uniqueTag)}`;
          const resp = await fetch(url).then(r => r.json());

          let count = 0;
          if (resp && resp.counts && typeof resp.counts.posts === 'number') {
            count = resp.counts.posts;
          }

          // Format Label
          // flat_chest -> Flat Chest
          const label = tag.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');

          return {
            name: label,
            count: count,
            frequency: 0, // Calculated later if needed, but pie chart needs raw count
            isOther: false
          };
        } catch (e) {
          console.warn(`[Danbooru Grass] Failed to fetch count for ${tag}`, e);
          return { name: tag, count: 0 };
        }
      });

      // Filter out zero counts
      const filtered = results.filter(r => r.count > 0).sort((a, b) => b.count - a.count);

      if (uploaderId) await this.saveStats(cacheKey, uploaderId, filtered);
      return filtered;
    }

    /**
     * Helper to get robust total count
     */
    async getTotalPostCount(userInfo) {
      if (!userInfo.name) return 0;
      let total = 0;
      try {
        // Method A: Exact Search Count (API)
        // Use tags=... order:score rating:x limit=1
        const normalizedName = userInfo.name.replace(/ /g, '_');
        const countUrl = `/counts/posts.json?tags=user:${encodeURIComponent(normalizedName)}`;
        const countData = await fetch(countUrl).then(r => r.json());
        if (countData && typeof countData.counts === 'object' && typeof countData.counts.posts === 'number') {
          return countData.counts.posts;
        }
      } catch (e) {
        console.warn('[Danbooru Grass] Counts API failed:', e);
      }

      // Method B: Profile API Fallback
      try {
        const profileUrl = `/users/${userInfo.id}.json`;
        const profile = await fetch(profileUrl).then(r => r.json());
        if (profile && typeof profile.post_upload_count === 'number') {
          return profile.post_upload_count;
        }
      } catch (e2) { }

      // Method C: DOM Fallback
      try {
        const statsLink = document.querySelector(
          '#danbooru-grass-wrapper > div:nth-child(1) > table > tbody > tr:nth-child(6) > td > a:nth-child(1)'
        );
        if (statsLink) {
          return parseInt(statsLink.textContent.replace(/,/g, ''), 10);
        }
      } catch (e3) { }

      return 0; // Failed
    }

    /**
     * Syncs all posts for the user.
     * @param {Object} userInfo
     * @param {Function} onProgress (current, total) => void
     */
    async syncAllPosts(userInfo, onProgress) {
      if (!userInfo.id) {
        console.error('User ID required for sync');
        return;
      }

      const uploaderId = parseInt(userInfo.id);

      // Global Sync Lock
      if (AnalyticsDataManager.isGlobalSyncing) {
        console.warn('[Danbooru Grass] Sync already in progress.');
        return;
      }
      AnalyticsDataManager.isGlobalSyncing = true;
      AnalyticsDataManager.syncProgress = { current: 0, total: 0 };

      // Helper to broadcast progress
      const reportProgress = (c, t, msg = null) => {
        AnalyticsDataManager.syncProgress = { current: c, total: t };
        if (AnalyticsDataManager.onProgressCallback) {
          AnalyticsDataManager.onProgressCallback(c, t, msg);
        }
        if (onProgress) onProgress(c, t, msg);
      };

      try {

        // 1. Get total count
        let total = await this.getTotalPostCount(userInfo);
        console.log(`[Danbooru Grass] Sync Goal: ${total} `);

        // 2. Resume Check
        // Strategy: overlapping sync (1 month back) to catch updates (score/tags)
        const newestArr = await this.db.posts.where('uploader_id').equals(uploaderId).reverse().limit(1).toArray();
        let startId = 0;

        if (newestArr.length > 0) {
          const newest = newestArr[0];
          const newestDate = new Date(newest.created_at);
          const cutOffDate = new Date(newestDate);
          cutOffDate.setMonth(cutOffDate.getMonth() - 1);

          console.log(`[Danbooru Grass] Newest Post: ${newestDate.toISOString().split('T')[0]}, Re-syncing from: ${cutOffDate.toISOString().split('T')[0]}`);

          // Find the first post that is OLDER than cutOffDate to determine startId
          let found = false;
          await this.db.posts.where('uploader_id').equals(uploaderId).reverse().each(p => {
            if (found) return;
            if (new Date(p.created_at) < cutOffDate) {
              startId = p.id;
              found = true;
              return false; // Stop iteration
            }
          });

          // fallback: if history is shorter than 1 month, startId stays 0 (Full Sync)
        }

        // Initialize currentNo based on startId
        // If startId is 0, we start counting from 0.
        // If startId > 0, we start counting from the number of posts we have UP TO that point.
        let currentNo = 0;
        if (startId > 0) {
          // Fix: Count ONLY this user's posts below startId
          // Using filter() on the collection because composite index might not exist for (id, uploader_id)
          currentNo = await this.db.posts.where('uploader_id').equals(uploaderId).filter(p => p.id <= startId).count();
          console.log(`[Danbooru Grass] Resuming count from ${currentNo} (ID: ${startId})`);
        } else {
          console.log('[Danbooru Grass] Full sync count starting from 0');
        }

        console.log(`[Danbooru Grass] Resuming sync for ${userInfo.name} from Post ID > ${startId} (Local Count: ${currentNo})`);

        // FIX: If total is 0 (Failed to fetch), we CANNOT assume "Already Synced".
        // We must assume "Unknown" and proceed to try and fetch new posts.
        // IF total > 0 (Success), then we check if current >= total.
        // BUT with the new overlapping logic, we almost ALWAYS want to sync at least the overlap.
        // So we relax the "Already synced" check if we have a valid startId > 0 (meaning we have history).
        // If startId > 0, we proceed to fetch updates.
        // If startId == 0 and current == total, then maybe we are really done?
        // Actually, user wants "Update". So if we calculated a startId, we should run.

        if (startId === 0 && total > 0 && currentNo >= total) {
          console.log('[Danbooru Grass] Already synced (Goal reached).');
          reportProgress(currentNo, total);
          return;
        }

        // If total is 0, we simply run blindly until empty. That's fine.


        // 3. Buffered Parallel Fetching Logic
        let lastFetchedId = startId;
        const limit = 200; // API Limit
        // 3 concurrency = 600 items.
        // User complaint "jerky" likely means 5 threads * 200 = 1000 items is too big a batch.
        // Draining incrementally with buffer will solve this.
        const parallel_count = 5;

        let pageOffset = 1;
        // 3. Worker Pool Logic (Rolling Window)
        const MAX_CONCURRENCY = 5;
        const WORKER_DELAY = 400; // 5 workers * 1 req / 0.4s = 12.5 req/s (Max)

        // Shared State
        let activeWorkers = 0;
        let hasMore = true;
        let completedCount = 0;

        // Ordered Commit State
        const buffer = new Map(); // page -> items
        let nextExpectedPage = 1;

        const worker = async (workerId) => {
          // Staggered Start: Prevent initial burst
          if (workerId > 0) await new Promise(r => setTimeout(r, workerId * 200));

          while (hasMore) {
            // 1. Claim a page
            const currentPage = pageOffset++;

            try {
              const params = {
                limit,
                page: currentPage,
                'tags': `user:${userInfo.name.replace(/ /g, '_')} order:id_asc id:>${startId}`,
                'only': 'id,uploader_id,created_at,score,rating,tag_count_general,preview_file_url,file_url'
              };
              const q = new URLSearchParams(params);
              const url = `/posts.json?${q.toString()}`;

              // Retry Logic
              let items = null;
              let attempts = 0;
              while (attempts < 3) {
                try {
                  items = await fetch(url).then(r => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    return r.json();
                  });
                  break; // Success
                } catch (err) {
                  attempts++;
                  const isServerErr = err.message.includes('500') || err.message.includes('502') || err.message.includes('503') || err.message.includes('504');
                  console.warn(`[Worker ${workerId}] Page ${currentPage} attempt ${attempts} failed: ${err.message}`);

                  if (attempts >= 3 || !isServerErr) throw err; // Give up or fatal error

                  // Backoff: 1s, 2s, 4s...
                  await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempts - 1)));
                }
              }

              if (items.length === 0) {
                hasMore = false; // Signal end
                return;
              }

              // 2. Buffer the result
              buffer.set(currentPage, items);

              // 3. Ordered Commit Loop (Check if we can save)
              while (buffer.has(nextExpectedPage)) {
                const batchItems = buffer.get(nextExpectedPage);
                buffer.delete(nextExpectedPage); // Remove from buffer

                if (batchItems.length > 0) {
                  // Assign Sequential Numbers
                  const bulkData = batchItems.map((p) => ({
                    id: p.id,
                    uploader_id: p.uploader_id,
                    created_at: p.created_at,
                    score: p.score,
                    rating: p.rating,
                    tag_count_general: p.tag_count_general,
                    preview_file_url: p.preview_file_url,
                    file_url: p.file_url,
                    no: ++currentNo
                  }));

                  await this.db.posts.bulkPut(bulkData);

                  // Update Progress
                  // currentNo is now accurate (reset based on startId)
                  reportProgress(currentNo, total > currentNo ? total : currentNo);
                }

                nextExpectedPage++;
              }

            } catch (e) {
              console.error(`[Worker ${workerId}] Page ${currentPage} failed`, e);
              hasMore = false;
            }

            // Rate Limit Sleep
            if (hasMore) {
              await new Promise(r => setTimeout(r, WORKER_DELAY));
            }
          }
        };

        // Ignite Workers
        const workers = [];
        for (let i = 0; i < MAX_CONCURRENCY; i++) {
          workers.push(worker(i));
        }

        await Promise.all(workers);

        // Save "Last Synced Date" metadata
        const lastSyncKey = `danbooru_grass_last_sync_${userInfo.id}`;
        localStorage.setItem(lastSyncKey, new Date().toISOString());

        // Auto-cleanup other users' stale data (older than 14 days)
        await this.cleanupStaleData(userInfo.id);

        // Signal UI: Processing Stats
        reportProgress(total, total, 'PREPARING');

        // Refresh all stats after sync
        await this.refreshAllStats(userInfo);

      } finally {
        AnalyticsDataManager.isGlobalSyncing = false;
      }
    }

    /**
     * Cleans up data for other users if they haven't been synced in 14 days.
     * @param {number|string} currentUserId - The ID of the currently active user (to skip).
     */
    async cleanupStaleData(currentUserId) {
      const currentId = parseInt(currentUserId);
      const THRESHOLD = 14 * 24 * 60 * 60 * 1000; // 14 days in ms
      const now = new Date().getTime();

      try {
        // 1. Get all unique uploader_ids from DB
        // Dexie doesn't have a direct 'distinct' query efficiently without keys.
        // But we can iterate unique keys if indexed? 'uploader_id' is indexed.
        const allIds = await this.db.posts.orderBy('uploader_id').uniqueKeys();

        for (const uid of allIds) {
          if (uid === currentId) continue; // Skip current user

          const syncKey = `danbooru_grass_last_sync_${uid}`;
          const lastSyncStr = localStorage.getItem(syncKey);

          let shouldDelete = false;
          if (!lastSyncStr) {
            // No record? Treat as stale (or maybe very old format). Delete to be safe/clean?
            // Or maybe it's a new user not yet synced?
            // If it's in DB but has no sync date, it's zombie data.
            shouldDelete = true;
          } else {
            const lastDate = new Date(lastSyncStr).getTime();
            if (now - lastDate > THRESHOLD) {
              shouldDelete = true;
            }
          }

          if (shouldDelete) {
            console.log(`[Danbooru Grass] Cleaning up stale data for User ID: ${uid}`);
            await this.db.posts.where('uploader_id').equals(uid).delete();
            await this.db.piestats.where('userId').equals(uid).delete(); // Also clear stats for this user
            localStorage.removeItem(syncKey);
          }
        }
      } catch (e) {
        console.warn('[Danbooru Grass] Cleanup failed', e);
      }
    }

    async refreshAllStats(userInfo) {
      console.log(`[Analytics] Refreshing all stats for user ${userInfo.name}`);
      const forceRefresh = true;
      try {
        await Promise.all([
          this.getRatingDistribution(userInfo, forceRefresh),
          this.getCharacterDistribution(userInfo, forceRefresh),
          this.getCopyrightDistribution(userInfo, forceRefresh),
          this.getFavCopyrightDistribution(userInfo, forceRefresh),
          this.getBreastsDistribution(userInfo, forceRefresh)
        ]);
        console.log(`[Analytics] All stats refreshed for user ${userInfo.name}`);
      } catch (e) {
        console.warn('[Analytics] Failed to refresh stats', e);
      }
    }

    async clearUserData(userInfo) {
      if (!userInfo.id) return;
      const uploaderId = parseInt(userInfo.id);

      // Delete posts for this user
      await this.db.posts.where('uploader_id').equals(uploaderId).delete();
      await this.db.piestats.where('userId').equals(uploaderId).delete();

      // Clear legacy tables if they exist/used
      await this.db.uploads.where('userId').equals(uploaderId).delete();
      await this.db.approvals.where('userId').equals(uploaderId).delete();
      await this.db.notes.where('userId').equals(uploaderId).delete();

      // Clear metadata
      const lastSyncKey = `danbooru_grass_last_sync_${userInfo.id}`;
      localStorage.removeItem(lastSyncKey);

      console.log(`[Analytics] Cleared data for user ${uploaderId}`);
    }
  }

  // --- Main Controller ---

  async function main() {
    // 1. Context & Shared Infrastructure
    const context = new ProfileContext();
    if (!context.isValidProfile()) {
      console.log('[Danbooru Grass] Not a valid profile page. Skipping.');
      return;
    }

    console.log(`[Danbooru Grass] Initializing for ${context.targetUser.name}`);

    // Shared Singletons
    const db = new Database();
    const settings = new SettingsManager();

    // 2. Instantiate Apps
    const grass = new GrassApp(db, settings, context);
    const analytics = new AnalyticsApp(db, settings, context);

    // 3. Execution
    // Grass runs immediately (Legacy behavior)
    grass.run();

    // Analytics runs immediately to inject the button (Button is always visible)
    analytics.run();
  }

  // Run
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }

})();
