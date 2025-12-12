// ==UserScript==
// @name         Danbooru Grass
// @namespace    http://tampermonkey.net/
// @version      2.0
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

(function () {
    'use strict';

    // --- Configuration & Constants ---
    const CONFIG = {
        STORAGE_PREFIX: 'danbooru_contrib_',
        CLEANUP_THRESHOLD_MS: 7 * 24 * 60 * 60 * 1000, // 7 Days
        SELECTORS: {
            STATISTICS_SECTION: 'div.user-statistics',
        }
    };

    // --- 1. Context & Identity ---
    // --- 1.5 Database (Dexie.js) ---
    class Database extends Dexie {
        constructor() {
            super('DanbooruGrassDB');
            this.version(1).stores({
                uploads: 'id, userId, date, count', // id: [userId]_[date]
                approvals: 'id, userId, date, count',
                notes: 'id, userId, date, count'
            });
        }
    }

    // --- 1. Context & Identity ---
    class ProfileContext {
        constructor() {
            try {
                this.targetUser = this.getTargetUserInfo();
            } catch (e) {
                console.error("[Danbooru Grass] Context Init Failed:", e);
                this.targetUser = null;
            }
        }

        getTargetUserInfo() {
            let name = null;
            let id = null;
            let joinDate = new Date().toISOString();

            try {
                // 1. Try to get ID and Name from body attributes (Danbooru usually has these)
                const body = document.body;
                // On profile page, data-user-name might be the logged-in user, not target.
                // But usually, there is a specific meta tag or current-user specific generic selector?
                // Actually, Danbooru profile pages often put ID in the URL or a specific element.

                // Strategy: Look for "User: [Name]" header
                const nameEl = document.querySelector('#a-show > div:nth-child(1) > h1 > a');
                if (nameEl) name = nameEl.textContent.trim();
                else {
                    const h1 = document.querySelector('h1');
                    if (h1) name = h1.textContent.trim().replace(/^User: /, '');
                }

                if (!name) return null;

                // 2. Try to get User ID
                // Option A: Link to "My Account" or similar might exist, but we need TARGET user ID.
                // Option B: Look for 'User ID: X' in stats or data attributes.
                // Inspecting Danbooru source: <div class="user-statistics"> ... </div> doesn't always have ID.
                // Reliable: The "Messages" link usually contains /users/ID/messages
                const messagesLink = document.querySelector('a[href*="/messages?search%5Bto_user_id%5D="]');
                if (messagesLink) {
                    const match = messagesLink.href.match(/to_user_id%5D=(\d+)/);
                    if (match) id = match[1];
                }

                // Fallback: Look for any link to /users/ID/edit or similar if it's own profile,
                // OR search for a link that looks like /users/ID/params...
                if (!id) {
                    const userLinks = document.querySelectorAll(`a[href^="/users/"]`);
                    for (let link of userLinks) {
                        const m = link.href.match(/\/users\/(\d+)/);
                        // We must ensure this link isn't pointing to SOMEONE ELSE (e.g. inviter).
                        // But usually the profile page links to itself in tabs.
                        // Let's rely on the fact that we know the Name.
                        if (m && link.textContent.includes(name)) {
                            id = m[1];
                            break;
                        }
                    }
                }

                if (!id) {
                    // Last Resort: If we can't find ID, we might need it for some API calls (Notes).
                    // Uploads/Approvals use Name. Notes use ID.
                    console.warn("[Danbooru Grass] User ID not found directly.");
                }

                // Join Date
                const ths = Array.from(document.querySelectorAll('th'));
                const joinHeader = ths.find(el => el.textContent.trim() === 'Join Date');
                if (joinHeader && joinHeader.nextElementSibling) {
                    const val = joinHeader.nextElementSibling;
                    const d = val.getAttribute('datetime') || val.textContent.trim();
                    if (d) joinDate = d;
                }

            } catch (e) {
                console.warn("[Danbooru Grass] Extraction error:", e);
                return null;
            }

            return { name: name || 'Unknown', id: id, joinDate: new Date(joinDate) };
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
                let endpoint, params, storeName, dateKey, idKey;
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
                            only: 'uploader_id,created_at'
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
                            only: 'creator_id,event_at'
                        };
                        break;
                    case 'notes':
                        if (!userInfo.id) throw new Error("User ID required for Notes");
                        endpoint = '/note_versions.json';
                        storeName = 'notes';
                        dateKey = 'created_at';
                        idKey = 'updater_id';
                        params = {
                            ...baseParams,
                            'search[updater_id]': userInfo.id,
                            only: 'updater_id,created_at'
                        };
                        break;
                    default:
                        return {};
                }

                const table = this.db[storeName];
                const userIdVal = userInfo.id || userInfo.name;
                const idPrefix = `${userIdVal}_`;

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
                    console.log("[Danbooru Grass] Year complete in cache. Skipping fetch.");
                } else if (fetchFromDate === todayStr && year === new Date().getFullYear()) {
                    // If we already have data up to today, we might still want to refresh 'today' 
                    // but if the last check was very recent (e.g. this session) maybe we skip?
                    // For now, let's allow re-fetching 'today' effectively.
                } else {
                    // Set API Params
                    const fetchRange = `${fetchFromDate}..${endDate}`;

                    if (metric === 'uploads') {
                        params.tags = `user:${userInfo.name} date:${fetchRange}`;
                    } else if (metric === 'approvals') {
                        params['search[post_tags_match]'] = `approver:${userInfo.name} date:${fetchRange}`;
                    } else if (metric === 'notes') {
                        params['search[created_at]'] = fetchRange;
                    }

                    // 2. Fetch missing range
                    console.log(`[Danbooru Grass] Fetching delta: ${fetchRange}`);
                    const items = await this.fetchAllPages(endpoint, params);
                    console.log(`[Danbooru Grass] Fetched ${items.length} new items.`);

                    // 3. Aggregate
                    const dailyCounts = {};

                    // Note: If we are fetching a range, we MUST count the fetched items.
                    // But wait, "fetchAllPages" returns individual items (posts).
                    // We simply count them.

                    items.forEach(item => {
                        const rawDate = item[dateKey] || item['created_at'];
                        if (!rawDate) return;

                        // Validation: Strict User ID Check
                        // post_events search by 'approver:NAME' returns all events for matched posts, 
                        // which may include previous approvals by others. We must filter by creator_id.
                        if (userInfo.id && item[idKey] && String(item[idKey]) !== String(userInfo.id)) {
                            return;
                        }

                        const dateStr = rawDate.slice(0, 10);
                        dailyCounts[dateStr] = (dailyCounts[dateStr] || 0) + 1;
                    });

                    // 4. Upsert into DB
                    // Note: We might have fetched a partial day (e.g. 'fetchFromDate').
                    // The 'items' list contains the ACTUAL count for that day from the API.
                    // So overwriting the DB entry for that day with 'dailyCounts' is correct.
                    // BUT: 'dailyCounts' only contains days that had activity.
                    // If a day had 0 activity, it won't be in 'dailyCounts'.
                    // If we re-fetch 'today' and there are 0 items, 'dailyCounts' is empty.
                    // We need to handle the case where a day exists in DB but now has 0 (unlikely for historical, but possible for today if deleted?).
                    // Actually, if we fetch range 2025-12-01..2025-12-15.
                    // And result has items only for 12-05.
                    // Days 12-01..12-04, 12-06..12-15 are 0.
                    // We should probably NOT overwrite existing non-zero counts with 0 unless we are sure.
                    // However, the prompt says "If there is a duplicate key... update".
                    // For the 'fetchFromDate' (e.g. 1st), we are re-counting it.
                    // If the API returns 5 items for the 1st, we update DB to 5.
                    // If API returns 0 items for the 1st? Then we don't have an entry in dailyCounts.
                    // We only write what we found. 
                    // This implies we trust the API to return all items.

                    const bulkData = Object.entries(dailyCounts).map(([date, count]) => {
                        return {
                            id: `${userIdVal}_${date}`,
                            userId: userIdVal,
                            date: date,
                            count: count
                        };
                    });

                    if (bulkData.length > 0) {
                        await table.bulkPut(bulkData);
                    }
                }

                // 5. Return Full Year Data from Cache
                // Now we just query the DB for the entire year to ensure we have the merged view (Old Cache + New Upserts)
                const fullYearData = await table.where('id')
                    .between(`${userIdVal}_${startDate}`, `${userIdVal}_${endDate}\uffff`, true, true)
                    .toArray();

                const resultMap = {};
                // If ID matches, we map it. 
                fullYearData.forEach(i => resultMap[i.date] = i.count);

                return resultMap;

            } catch (e) {
                console.error("[Danbooru Grass] Data fetch failed:", e);
                alert(`[Danbooru Grass] Fetch Failed: ${e.message}`);
                return {};
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
                // We find them by userId index and delete
                const items = await table.where('userId').equals(userIdVal).primaryKeys();
                await table.bulkDelete(items);
                console.log(`[Danbooru Grass] Cleared ${items.length} items from ${storeName} for ${userIdVal}`);
                return true;
            } catch (e) {
                console.error("[Danbooru Grass] Clear cache failed:", e);
                return false;
            }
        }

        async fetchAllPages(endpoint, params) {
            let allItems = [];
            let page = 1;

            while (true) {
                // Danbooru page limit 1000 usually, checking 200 as safe
                const q = new URLSearchParams({ ...params, page: page });
                const url = `${this.baseUrl}${endpoint}?${q.toString()}`;

                try {
                    const resp = await fetch(url);
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const json = await resp.json();

                    if (!Array.isArray(json) || json.length === 0) break;

                    allItems = allItems.concat(json);

                    if (json.length < params.limit) break; // Last page
                    page++;

                    // Safety break (approx 100,000 items)
                    if (page > 500) {
                        console.warn("[Danbooru Grass] Hit safety page limit (500).");
                        break;
                    }

                    // Simple rate limit helper
                    await new Promise(r => setTimeout(r, 100));

                } catch (e) {
                    console.error(`[Danbooru Grass] Page ${page} failed:`, e);
                    break;
                }
            }
            return allItems;
        }
    }

    // --- 4. Graph Renderer (UI) ---
    class GraphRenderer {
        constructor() {
            this.containerId = 'danbooru-grass-container';
            this.cal = null;
        }

        injectSkeleton() {
            const existing = document.getElementById(this.containerId);
            if (existing) existing.remove();

            // Try Finding Injection Point
            let stats = document.querySelector(CONFIG.SELECTORS.STATISTICS_SECTION);
            if (!stats) {
                // Selector Fallback
                const table = document.querySelector('#a-show > div:nth-child(1) > div:nth-child(2) > table');
                if (table) stats = table.parentElement;
            }
            if (!stats) {
                // Text Fallback
                const all = document.querySelectorAll('*');
                for (let el of all) {
                    if (el.textContent === 'Statistics' && (el.tagName === 'H1' || el.tagName === 'H2')) {
                        stats = el.parentElement;
                        break;
                    }
                }
            }

            if (!stats) {
                console.error("[Danbooru Grass] Injection point not found.");
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
            ['uploads', 'approvals', 'notes'].forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                opt.text = m.charAt(0).toUpperCase() + m.slice(1);
                if (m === currentMetric) opt.selected = true;
                metricSel.appendChild(opt);
            });
            metricSel.onchange = (e) => onMetricChange(e.target.value);
            controls.appendChild(metricSel);

            // Refresh Button
            const refreshBtn = document.createElement('button');
            refreshBtn.textContent = '↻';
            refreshBtn.title = 'Clear Cache & Refresh';
            refreshBtn.style.cssText = `
                margin-left: 5px;
                padding: 2px 8px;
                border: 1px solid #d0d7de;
                border-radius: 6px;
                background-color: #f6f8fa;
                cursor: pointer;
                font-size: 1.1em;
                color: #24292f;
            `;
            refreshBtn.onclick = () => {
                if (confirm('Clear cache and re-fetch all data for this view?')) {
                    onRefresh();
                }
            };
            controls.appendChild(refreshBtn);
        }

        setLoading(isLoading) {
            const el = document.getElementById('grass-loading');
            if (el) el.style.display = isLoading ? 'block' : 'none';
            const cal = document.getElementById('cal-heatmap');
            if (cal) cal.style.opacity = isLoading ? '0.5' : '1';
        }

        async renderGraph(dataMap, year, metric, userInfo, availableYears, onYearChange) {
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

                    availableYears.forEach(y => {
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
                    console.warn("[Danbooru Grass] Failed to destroy previous instance:", e);
                }
            }
            window.cal = new CalHeatmap();

            const userName = userInfo.name || userInfo;

            // Ensure our container structure supports the side-label + scrollable graph
            const container = document.getElementById('cal-heatmap');
            if (!container) return;

            const source = Object.entries(dataMap || {}).map(([k, v]) => ({ date: k, value: v }));
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
                        background-color: #fff !important;
                        color: #24292f !important;
                        border-radius: 6px;
                    }
                    #danbooru-grass-container h2 {
                        color: #24292f !important;
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
                    .ch-subdomain-bg { fill: #ebedf0; }
                    .ch-domain-bg { fill: transparent !important; } /* Fix black bars */

                    /* Month Labels */
                    .ch-domain-text {
                        fill: #24292f !important;
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
                        background: #d0d7de;
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
            labels.style.color = '#24292f';
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

            // 3. Legend Injection
            const mainContainer = document.getElementById('danbooru-grass-container');
            if (!document.getElementById('danbooru-grass-legend')) {
                const legend = document.createElement('div');
                legend.id = 'danbooru-grass-legend';
                legend.style.display = 'flex';
                legend.style.justifyContent = 'flex-end';
                legend.style.alignItems = 'center';
                legend.style.padding = '5px 20px 10px 0'; // Right align padding
                legend.style.fontSize = '10px';
                legend.style.color = '#57606a';
                legend.style.gap = '4px';

                // Adjusted to 6 colors to support 5 thresholds: 1, 5, 10, 30, 50
                const colors = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39', '#0e4429'];
                // Thresholds: <1 (Grey), 1-4, 5-9, 10-29, 30-49, 50+ (Darkest)
                const rects = colors.map(c =>
                    `<div style="width:10px; height:10px; background-color:${c}; border-radius:2px;"></div>`
                ).join('');

                legend.innerHTML = `
                    <span style="margin-right:4px;">Less</span>
                    ${rects}
                    <span style="margin-left:4px;">More</span>
                `;
                mainContainer.appendChild(legend);
            }

            console.log(`[Danbooru Grass] Rendering graph for ${year}. Data points: ${source.length}`);

            window.cal.paint({
                itemSelector: '#cal-heatmap-scroll',
                range: 12,
                domain: {
                    type: 'month',
                    gutter: 3,
                    label: { position: 'top', text: 'MMM', height: 20, textAlign: 'start' }
                },
                subDomain: {
                    type: 'day',
                    radius: 2,
                    width: 11,
                    height: 11,
                    gutter: 2,
                    label: null
                },
                // Align start date to Local Jan 1st 00:00, represented as UTC to match data
                date: { start: new Date(new Date(year, 0, 1).getTime() - (new Date().getTimezoneOffset() * 60000)) },
                data: { source: source, x: 'date', y: 'value' },
                scale: {
                    color: {
                        range: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39', '#0e4429'],
                        domain: [1, 5, 10, 30, 50],
                        type: 'threshold'
                    }
                },
                theme: 'light',
            })
                .then(() => {
                    console.log("[Danbooru Grass] Render complete.");
                    // Re-apply Styles and Interaction
                    setTimeout(() => {
                        const tooltip = d3.select('#danbooru-grass-tooltip');

                        // 1. Tooltips for Graph Cells
                        d3.selectAll('#cal-heatmap-scroll rect')
                            .attr('rx', 2).attr('ry', 2) // Apply border radius
                            .on('mouseover', function (event, d) {
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
                        const legendThresholds = ["0 (Less)", "1-4", "5-9", "10-29", "30-49", "50+ (More)"];

                        // Select the 6 manual colored divs in the legend
                        // We target > div because we built the legend with standard HTML divs, not SVG.
                        const legendDivs = d3.selectAll('#danbooru-grass-legend > div');

                        legendDivs.each(function (d, i) {
                            if (i >= 0 && i < legendThresholds.length) {
                                d3.select(this)
                                    .on('mouseover', function (event) {
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
                .catch(err => {
                    console.error("[Danbooru Grass] Render failed:", err);
                });
        }
    }

    // --- Main Execution ---
    async function main() {
        const context = new ProfileContext();
        if (!context.isValidProfile()) {
            console.log("[Danbooru Grass] Not a valid profile page or extraction failed.");
            return;
        }

        console.log(`[Danbooru Grass] Initializing for ${context.targetUser.name}`);

        const dataManager = new DataManager();
        const renderer = new GraphRenderer();

        const injected = renderer.injectSkeleton();
        if (!injected) {
            console.log("[Danbooru Grass] UI injection failed. Aborting.");
            return;
        }

        let currentYear = new Date().getFullYear();
        let currentMetric = 'uploads';

        const joinYear = context.targetUser.joinDate.getFullYear();
        const years = [];
        const startYear = Math.max(joinYear, 2005);
        for (let y = currentYear; y >= startYear; y--) years.push(y);

        const updateView = async () => {
            const onYearChange = (y) => { currentYear = y; updateView(); };

            renderer.setLoading(true);
            try {
                // Initial render for layout (header updates here slightly prematurely but data fills in later)
                // We pass the callback even here so the dropdown works during loading if clicked
                await renderer.renderGraph({}, currentYear, currentMetric, context.targetUser, years, onYearChange);

                renderer.updateControls(years, currentYear, currentMetric,
                    onYearChange,
                    (m) => { currentMetric = m; updateView(); },
                    async () => {
                        renderer.setLoading(true);
                        await dataManager.clearCache(currentMetric, context.targetUser);
                        updateView();
                    }
                );

                const data = await dataManager.getMetricData(currentMetric, context.targetUser, currentYear);

                await renderer.renderGraph(data, currentYear, currentMetric, context.targetUser, years, onYearChange);
            } catch (e) {
                console.error(e);
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
