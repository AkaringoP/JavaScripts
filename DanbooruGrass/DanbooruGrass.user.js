// ==UserScript==
// @name         Danbooru Grass
// @namespace    http://tampermonkey.net/
// @version      3.1
// @description  Injects a GitHub-style contribution graph into Danbooru profile pages.
// @author       AkaringoP with Antigravity
// @match        https://danbooru.donmai.us/users/*
// @match        https://danbooru.donmai.us/profile
// @grant        none
// @homepageURL  https://github.com/AkaringoP/JavaScripts/tree/main/DanbooruGrass
// @updateURL    https://github.com/AkaringoP/JavaScripts/raw/main/DanbooruGrass/DanbooruGrass.user.js
// @downloadURL  https://github.com/AkaringoP/JavaScripts/raw/main/DanbooruGrass/DanbooruGrass.user.js
// @require      https://d3js.org/d3.v7.min.js
// @require      https://unpkg.com/cal-heatmap/dist/cal-heatmap.min.js
// @require      https://unpkg.com/dexie/dist/dexie.js
// ==/UserScript==

(function() {
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
      light: {name: 'Light', bg: '#ffffff', empty: '#ebedf0', text: '#24292f'},
      solarized_light: {name: 'Solarized Light', bg: '#fdf6e3', empty: '#eee8d5', text: '#586e75', scrollbar: '#93a1a1'},
      sakura: {name: 'Sakura', bg: '#fff0f5', empty: '#ffe0ea', text: '#24292f'},
      sunset: {name: 'Sunset', bg: '#fff5e6', empty: '#ffe0b2', text: '#24292f'},
      ice: {name: 'Ice', bg: '#e6fffb', empty: '#ffffff', text: '#006d75', scrollbar: '#5cdbd3'},
      aurora: {name: 'Aurora', bg: 'linear-gradient(135deg, #BAD1DE 0%, #ECECF5 100%)', empty: '#ffffff', text: '#2e3338', scrollbar: '#9FB5C6'},

      // Dark Schemes
      midnight: {name: 'Midnight', bg: '#000000', empty: '#222222', text: '#f0f6fc'},
      solarized_dark: {name: 'Solarized Dark', bg: '#002b36', empty: '#073642', text: '#93a1a1', scrollbar: '#586e75'},
      newspaper: {name: 'Newspaper', bg: '#f0f0f0', empty: '#dbdbdb', text: '#24292f', scrollbar: '#d0d7de'},
      ocean: {name: 'Ocean', bg: '#1b2a4e', empty: '#2b3d68', text: '#e6edf3'},
    },
  };

  /**
   * Manages user settings and persistence.
   */
  class SettingsManager {
    constructor() {
      this.key = CONFIG.STORAGE_PREFIX + 'settings';
      this.defaults = {
        theme: 'light',
        thresholds: {
          uploads: [1, 10, 25, 50],
          approvals: [10, 50, 100, 150],
          notes: [1, 10, 20, 30],
        },
        rememberedModes: {}, // userId -> mode
      };
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
          thresholds: {...this.defaults.thresholds, ...(saved.thresholds || {})},
          rememberedModes: {...(saved.rememberedModes || {})},
        };
      } catch (e) {
        return this.defaults;
      }
    }

    save(newSettings) {
      this.settings = {...this.settings, ...newSettings};
      localStorage.setItem(this.key, JSON.stringify(this.settings));
    }

    getTheme() {
      const t = this.settings.theme;
      return CONFIG.THEMES[t] ? t : 'light';
    }

    getThresholds(metric) {
      return this.settings.thresholds[metric] || this.defaults.thresholds[metric] || [1, 5, 10, 20];
    }

    setThresholds(metric, values) {
      const newThresholds = {...this.settings.thresholds, [metric]: values};
      this.save({thresholds: newThresholds});
    }

    applyTheme(themeKey) {
      const theme = CONFIG.THEMES[themeKey] || CONFIG.THEMES.light;
      const root = document.querySelector(':root');
      if (root) {
        root.style.setProperty('--grass-bg', theme.bg);
        root.style.setProperty('--grass-empty-cell', theme.empty);
        root.style.setProperty('--grass-text', theme.text);
        root.style.setProperty('--grass-scrollbar-thumb', theme.scrollbar || '#d0d7de');
      }
      this.save({theme: themeKey});
    }

    getLastMode(userId) {
      return this.settings.rememberedModes[userId] || null;
    }

    setLastMode(userId, mode) {
      const newModes = {...this.settings.rememberedModes, [userId]: mode};
      this.save({rememberedModes: newModes});
    }
  }

  // --- 1. Context & Identity ---
  // --- 1.5 Database (Dexie.js) ---
  class Database extends Dexie {
    constructor() {
      super('DanbooruGrassDB');
      this.version(1).stores({
        uploads: 'id, userId, date, count', // id: [userId]_[date]
        approvals: 'id, userId, date, count',
        notes: 'id, userId, date, count',
      });
    }
  }

  // --- 1. Context & Identity ---
  class ProfileContext {
    constructor() {
      try {
        this.targetUser = this.getTargetUserInfo();
      } catch (e) {
        console.error('[Danbooru Grass] Context Init Failed:', e);
        this.targetUser = null;
      }
    }

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
          // Try to find a link to the user's own page which usually contains the ID
          // "Messages" link is a good candidate if it exists
          const messagesLink = document.querySelector('a[href*="/messages?search%5Bto_user_id%5D="]');
          if (messagesLink) {
            const match = messagesLink.href.match(/to_user_id%5D=(\d+)/);
            if (match) id = match[1];
          }

          // Look for "My Account" if we are on our own profile (and it didn't redirect to /users/ID)
          if (!id && window.location.pathname === '/profile') {
            // On /profile, we might be able to find the ID in the "Edit" link or similar
            const editLink = document.querySelector('a[href^="/users/"][href$="/edit"]');
            if (editLink) {
              const m = editLink.getAttribute('href').match(/\/users\/(\d+)\/edit/);
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
        // We search for the "Join Date" text in TH elements.
        const ths = Array.from(document.querySelectorAll('th'));
        const joinHeader = ths.find((el) => el.textContent.trim() === 'Join Date');
        if (joinHeader && joinHeader.nextElementSibling) {
          const val = joinHeader.nextElementSibling;
          const d = val.getAttribute('datetime') || val.textContent.trim();
          if (d) joinDate = d;
        }

        if (!name) return null; // Name is strictly required
        if (!id) console.warn('[Danbooru Grass] User ID not found. Functionality may be limited (Notes).');

        return {name: name, id: id, joinDate: new Date(joinDate)};

      } catch (e) {
        console.warn('[Danbooru Grass] Extraction error:', e);
        return null;
      }
    }

    isValidProfile() {
      return !!this.targetUser && !!this.targetUser.name;
    }
  }

  // --- 2. Data Manager (API & Cache) ---
  class DataManager {
    constructor() {
      this.baseUrl = 'https://danbooru.donmai.us';
      this.db = new Database();
    }

    async getMetricData(metric, userInfo, year) {
      try {
        // Determine fetch configuration
        let endpoint;
        let params;
        let storeName;
        let dateKey;
        let idKey;
        const startDate = `${year}-01-01`;
        const endDate = `${year}-12-31`;

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
            .between(`${userIdVal}_${startDate}`, `${userIdVal}_${endDate}\uffff`, true, true)
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
        } else if (fetchFromDate === todayStr && year === new Date().getFullYear()) {
          // If we already have data up to today, we might still want to refresh 'today'
        } else {
          // Set API Params
          const fetchRange = `${fetchFromDate}..${endDate}`;

          const normalizedName = userInfo.name.replace(/ /g, '_');

          if (metric === 'uploads') {
            params.tags = `user:${normalizedName} date:${fetchRange}`;
          } else if (metric === 'approvals') {
            params['search[post_tags_match]'] = `approver:${normalizedName} date:${fetchRange}`;
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
            if (userInfo.id && item[idKey] && String(item[idKey]) !== String(userInfo.id)) {
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
            .between(`${userIdVal}_${startDate}`, `${userIdVal}_${endDate}\uffff`, true, true)
            .toArray();

        const resultMap = {};
        fullYearData.forEach((i) => resultMap[i.date] = i.count);

        return resultMap;

      } catch (e) {
        console.error('[Danbooru Grass] Data fetch failed:', e);
        throw e; // Propagate error to UI
      }
    }

    async clearCache(metric, userInfo) {
      try {
        let storeName;
        switch (metric) {
          case 'uploads': storeName = 'uploads'; break;
          case 'approvals': storeName = 'approvals'; break;
          case 'notes': storeName = 'notes'; break;
          default: return;
        }
        const table = this.db[storeName];
        const userIdVal = userInfo.id || userInfo.name;

        // Delete all entries for this user in this store
        const items = await table.where('userId').equals(userIdVal).primaryKeys();
        await table.bulkDelete(items);
        console.log(`[Danbooru Grass] Cleared ${items.length} items from ${storeName} for ${userIdVal}`);
        return true;
      } catch (e) {
        console.error('[Danbooru Grass] Clear cache failed:', e);
        return false;
      }
    }

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
          const q = new URLSearchParams({...params, page: currentPage});
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

    async getCacheStats() {
      const stats = {
        indexedDB: {count: 0, size: 0},
        localStorage: {count: 0, size: 0},
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
  // --- 4. Graph Renderer (UI) ---
  class GraphRenderer {
    constructor(settingsManager) {
      this.containerId = 'danbooru-grass-container';
      this.cal = null;
      this.settingsManager = settingsManager;
    }

    injectSkeleton() {
      // Check if container already exists
      if (document.getElementById(this.containerId)) {
        return true; // Preservation Logic: Do not destroy!
      }

      // Normal Injection Logic
      let stats = document.querySelector(CONFIG.SELECTORS.STATISTICS_SECTION);
      // Fallbacks...
      if (!stats) {
        const table = document.querySelector('#a-show > div:nth-child(1) > div:nth-child(2) > table');
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

    setLoading(isLoading) {
      const el = document.getElementById('grass-loading');
      if (el) el.style.display = isLoading ? 'block' : 'none';
      const cal = document.getElementById('cal-heatmap');
      if (cal) cal.style.opacity = isLoading ? '0.5' : '1';
    }

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

      const source = Object.entries(dataMap || {}).map(([k, v]) => ({date: k, value: v}));
      const sanitizedName = userName.replace(/ /g, '_');

      const getUrl = (date, count) => {
        if (!date) return null;
        const dateRange = `${date}..${date}`;

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
      container.style.alignItems = 'flex-start'; // Align Top to avoid Scrollbar offset issues
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
        <div style="\${hiddenStyle}"></div> <!-- Sun (0) -->
        <div style="\${rowStyle}">Mon</div> <!-- Mon (1) -->
        <div style="\${hiddenStyle}"></div> <!-- Tue (2) -->
        <div style="\${rowStyle}">Wed</div> <!-- Wed (3) -->
        <div style="\${hiddenStyle}"></div> <!-- Thu (4) -->
        <div style="\${rowStyle}">Fri</div> <!-- Fri (5) -->
        <div style="\${lastHiddenStyle}"></div> <!-- Sat (6) -->
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
          return {valid: true};
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
            if (!popover.contains(e.target) && !settingsBtn.contains(e.target)) {
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
          const dataManager = new DataManager();
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

        // Cleanup on Close
        // const originalClose = closeSettings;
        // We don't have direct access to override 'closeSettings' easily as it's defined above scope in previous block but we can hook into the click listener?
        // Actually, 'closeSettings' is defined in the parent scope. We can wrap it?
        // Or better, just add a specific listener to the document click to clear interval if hidden?
        // The 'closeSettings' sets display='none'.
        // We can check visibility in the interval (done above).

        purgeBtn.onclick = () => {
          if (confirm('Are you sure you want to clear all cached data? This will trigger a full re-fetch.')) {
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
        const colors = ['var(--grass-empty-cell)', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
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

      console.log(`[Danbooru Grass] Rendering graph for ${year}. Data points: ${source.length}`);

      const currentThresholds = this.settingsManager.getThresholds(metric);

      window.cal.paint({
        itemSelector: '#cal-heatmap-scroll',
        range: 12,
        domain: {
          type: 'month',
          gutter: 3,
          label: {position: 'top', text: 'MMM', height: 20, textAlign: 'start'},
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
        date: {start: new Date(new Date(year, 0, 1).getTime() - (new Date().getTimezoneOffset() * 60000))},
        data: {source: source, x: 'date', y: 'value'},
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

              // 1. Tooltips for Graph Cells
              d3.selectAll('#cal-heatmap-scroll rect')
                  .attr('rx', 2).attr('ry', 2) // Apply border radius
                  .on('mouseover', function(event, d) {
                    // Fallback for datum if D3 binding is tricky
                    const datum = d || d3.select(this).datum();
                    if (!datum || !datum.t) return;

                    const count = (datum.v !== null && datum.v !== undefined) ? datum.v : 0;
                    const dateStr = new Date(datum.t).toISOString().split('T')[0];

                    tooltip.style('opacity', 1)
                        .html(`<strong>${dateStr}</strong>, ${count} ${metric}`)
                        .style('left', (event.pageX + 10) + 'px')
                        .style('top', (event.pageY - 28) + 'px');
                  })
                  .on('mouseout', () => tooltip.style('opacity', 0))
                  .on('click', function(event, d) {
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

              legendDivs.each(function(d, i) {
                if (i >= 0 && i < legendThresholds.length) {
                  d3.select(this)
                      .on('mouseover', function(event) {
                        tooltip.style('opacity', 1)
                            .html(legendThresholds[i])
                            .style('left', (event.pageX + 10) + 'px')
                            .style('top', (event.pageY - 28) + 'px');
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
  async function main() {
    const context = new ProfileContext();
    if (!context.isValidProfile()) {
      console.log('[Danbooru Grass] Not a valid profile page or extraction failed.');
      return;
    }

    console.log(`[Danbooru Grass] Initializing for ${context.targetUser.name}`);

    const dataManager = new DataManager();
    const settingsManager = new SettingsManager();
    const renderer = new GraphRenderer(settingsManager);

    const injected = renderer.injectSkeleton();
    if (!injected) {
      console.log('[Danbooru Grass] UI injection failed. Aborting.');
      return;
    }

    let currentYear = new Date().getFullYear();
    // Load last mode for this user, duplicate 'uploads' if not found
    const userId = context.targetUser.id || context.targetUser.name; // Use safest ID available
    let currentMetric = settingsManager.getLastMode(userId) || 'uploads';

    const joinYear = context.targetUser.joinDate.getFullYear();
    const years = [];
    const startYear = Math.max(joinYear, 2005);
    for (let y = currentYear; y >= startYear; y--) years.push(y);

    const updateView = async () => {
      const onYearChange = (y) => {
        currentYear = y; updateView();
      };

      renderer.setLoading(true);
      try {
        // Initial render for layout (header updates here slightly prematurely but data fills in later)
        // We pass the callback even here so the dropdown works during loading if clicked
        await renderer.renderGraph({}, currentYear, currentMetric, context.targetUser, years, onYearChange, async () => {
          renderer.setLoading(true);
          await dataManager.clearCache(currentMetric, context.targetUser);
          updateView();
        });

        renderer.updateControls(years, currentYear, currentMetric,
            onYearChange,
            (newMetric) => {
              currentMetric = newMetric;
              // Save the new mode preference
              settingsManager.setLastMode(userId, currentMetric);
              updateView();
            },
            /* onRefresh */ async () => {
              renderer.setLoading(true);
              await dataManager.clearCache(currentMetric, context.targetUser);
              updateView();
            },
        );

        const data = await dataManager.getMetricData(currentMetric, context.targetUser, currentYear);

        await renderer.renderGraph(data, currentYear, currentMetric, context.targetUser, years, onYearChange, async () => {
          renderer.setLoading(true);
          await dataManager.clearCache(currentMetric, context.targetUser);
          updateView();
        });
      } catch (e) {
        console.error(e);
        renderer.renderError(e.message || 'Unknown error occurred', () => updateView());
      } finally {
        renderer.setLoading(false);
      }
    };

    // Initial Load
    updateView();
  }

  // Run
  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }

})();
