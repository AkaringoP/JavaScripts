import * as d3 from 'd3';
import {AnalyticsDataManager} from '../core/analytics-data-manager';
import {RateLimitedFetch} from '../core/rate-limiter';
import {SettingsManager} from '../core/settings';
import type {Database} from '../core/database';
import type {ProfileContext} from '../core/profile-context';

export class UserAnalyticsApp {
  [key: string]: any;

  /**
   * Initializes the UserAnalyticsApp.
   * @param {Database} db The Dexie database instance.
   * @param {Object} settings The settings manager.
   * @param {ProfileContext} context The profile context.
   */
  constructor(db: Database, settings: SettingsManager, context: ProfileContext) {
    this.db = db;
    this.settings = settings;
    this.context = context;
    // Initialize RateLimiter: 
    // - Max Concurrency: 6 (Default)
    // - Start Delay: [100, 300] ms
    // - Rate Limit: 7 requests / 1 second (Token Bucket)
    this.rateLimiter = new RateLimitedFetch(6, [100, 300], 6);

    this.dataManager = new AnalyticsDataManager(db);

    this.modalId = 'danbooru-grass-modal';
    this.btnId = 'danbooru-grass-analytics-btn';

    this.isFullySynced = false; // State to track sync status
  }

  /**
   * Initializes and runs the Analytics application.
   */
  run(): void {

    this.createModal(); // Create hidden modal
    this.injectButton(); // Add entry button
  }

  /**
   * Creates the modal DOM structure (hidden by default).
   */
  createModal(): void {
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
   * Tries multiple heuristics to find the correct location.
   */
  injectButton(): void {
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
      btn.className = 'di-analytics-entry-btn';
      btn.title = 'Open Analytics Report';
      btn.innerHTML = '📊';
      btn.style.margin = '0'; // Reset margin since container has it
      btn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Auto-Sync Check: If not synced, wait for sync THEN open
        if (this.isFullySynced === false) {

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
  async performPartialSync(btn: HTMLElement | null = null, shouldRender: boolean = true): Promise<void> {
    if (AnalyticsDataManager.isGlobalSyncing) return;

    const originalText = btn ? btn.innerHTML : '';

    // State for Animation
    let animInterval = null;
    let dotCount = 0;
    const state = {
      current: 0,
      total: 0,
      phase: 'FETCHING', // 'FETCHING' or 'PREPARING'
      message: ''
    };

    if (btn) {
      (btn as any).disabled = true;
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
        subHtml = `<div style="font-size:0.8em; color:#ffeb3b; margin-top:2px;">${state.message || 'Preparing Report'}${dotStr}</div>`;
      } else {
        containerColor = '#ff4444';
        headerHtml = `<div style="font-weight:bold;">Synced: ${state.current.toLocaleString()} / ${state.total.toLocaleString()} (${percent}%)</div>`;
        subHtml = `<div style="font-size:0.8em; color:#888; margin-top:2px;">${state.message || `Fetching data${dotStr}`}</div>`;
      }

      this.updateHeaderStatus(headerHtml + subHtml, containerColor);
    };

    // Start Animation
    render();
    animInterval = setInterval(render, 500);

    const onProgress = (current, total, msg) => {
      state.current = current;
      state.total = total;
      if (msg) state.message = msg;

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

      // (Bubble Chart Data Collection removed)

      // Final Status (Green)
      if (shouldRender) {
        const finalStats = await this.dataManager.getSyncStats(this.context.targetUser);
        this.updateHeaderStatus(`Synced: ${finalStats.count.toLocaleString()} / ${finalStats.count.toLocaleString()}`, '#00ba7c');
      }

      if (btn) {
        btn.innerHTML = originalText;
        (btn as any).disabled = false;
        btn.style.cursor = 'pointer';
      }
      if (shouldRender) {
        this.toggleModal(true);
      }
    } catch (e) {
      if (animInterval) clearInterval(animInterval);
      console.error(e);
      if (btn) {
        btn.innerHTML = 'ERR';
        (btn as any).disabled = false;
        btn.style.cursor = 'pointer';
      }
      this.updateHeaderStatus('Sync Failed', '#ff4444');
    }
  }

  /**
   * Updates the status text in the modal header.
   * @param {string|null} [progressText=null] Text to display (e.g. "Fetching...").
   * @param {string|null} [customColor=null] CSS color for the text.
   * @return {Promise<void>}
   */
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
   * @param {HTMLElement} target The settings button element.
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
    (saveBtn as HTMLElement).onclick = () => {
      const input = popover.querySelector('#sync-thresh-input');
      const val = parseInt((input as HTMLInputElement).value, 10);
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

  /**
   * Shows a secondary modal (popover) on top of the dashboard.
   * @param {string} title The title of the modal.
   * @param {string} contentHtml The HTML content to display.
   * @param {string|null} [helpHtml=null] Optional HTML content for the help tooltip.
   */
  showSubModal(title, contentHtml, helpHtml = null) {
    let subOverlay = document.getElementById(`${this.modalId}-sub-overlay`);

    // Remove existing if any (simplifies logic)
    if (subOverlay) {
      subOverlay.remove();
    }

    subOverlay = document.createElement('div');
    subOverlay.id = `${this.modalId}-sub-overlay`;

    // Styles are inline for simplicity or we can inject them.
    // Replicating overlay style with higher z-index
    Object.assign(subOverlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
      backdropFilter: 'blur(2px)',
      zIndex: '11000', // Higher than main modal (10000)
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: '0',
      transition: 'opacity 0.2s ease',
      cursor: 'default' // reset cursor
    });

    const subWindow = document.createElement('div');
    Object.assign(subWindow.style, {
      backgroundColor: '#fff',
      borderRadius: '12px',
      boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
      width: '90%',
      maxWidth: '800px', // Smaller than main dashboard
      maxHeight: '90vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      transform: 'scale(0.95)',
      transition: 'transform 0.2s ease'
    });

    // Header
    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '15px 20px',
      borderBottom: '1px solid #eee',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: '#f9f9f9',
      position: 'relative'
    });

    // Simple Title Wrapper
    const titleWrapper = document.createElement('div');
    titleWrapper.style.display = 'flex';
    titleWrapper.style.alignItems = 'center';
    titleWrapper.innerHTML = `<h3 style="margin:0; font-size:1.2em; color:#333;">${title}</h3>`;

    // Help Button if helpHtml exists
    if (helpHtml) {
      const helpBtn = document.createElement('div');
      helpBtn.innerHTML = '❓';
      Object.assign(helpBtn.style, {
        marginLeft: '10px',
        cursor: 'help',
        fontSize: '14px',
        color: '#888', // Replaces opacity to prevent child inheritance issues
        position: 'relative'
      });

      // Hover Tooltip logic for Help
      const tooltip = document.createElement('div');
      Object.assign(tooltip.style, {
        position: 'absolute',
        top: '100%',
        left: '0', // Adjust if needed
        width: '550px',
        background: '#000',
        color: '#fff',
        padding: '10px',
        borderRadius: '4px',
        fontSize: '12px',
        zIndex: '11001',
        display: 'none',
        boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
        marginTop: '5px'
      });
      tooltip.innerHTML = helpHtml;
      helpBtn.appendChild(tooltip);

      helpBtn.onmouseover = () => tooltip.style.display = 'block';
      helpBtn.onmouseout = () => tooltip.style.display = 'none';

      titleWrapper.appendChild(helpBtn);
    }

    header.appendChild(titleWrapper);

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    Object.assign(closeBtn.style, {
      background: 'none',
      border: 'none',
      fontSize: '1.5em',
      lineHeight: '1',
      cursor: 'pointer',
      color: '#666'
    });
    closeBtn.onclick = () => closeSubModal();
    header.appendChild(closeBtn);
    subWindow.appendChild(header);

    // Content
    const contentDiv = document.createElement('div');
    Object.assign(contentDiv.style, {
      padding: '20px',
      overflowY: 'auto'
    });
    contentDiv.innerHTML = contentHtml;
    subWindow.appendChild(contentDiv);

    subOverlay.appendChild(subWindow);
    document.body.appendChild(subOverlay);

    // Animation Entry
    requestAnimationFrame(() => {
      subOverlay.style.opacity = '1';
      subWindow.style.transform = 'scale(1)';
    });

    // Close logic
    const closeSubModal = () => {
      subOverlay.style.opacity = '0';
      subWindow.style.transform = 'scale(0.95)';
      setTimeout(() => {
        if (subOverlay.parentElement) subOverlay.remove();
      }, 200);
    };

    subOverlay.addEventListener('click', (e) => {
      if (e.target === subOverlay) closeSubModal();
    });
  }

  getLevelClass(level) {
    if (!level) return 'user-member';
    const l = level.toLowerCase();
    if (l.includes('admin') || l.includes('owner')) return 'user-admin';
    if (l.includes('moderator')) return 'user-moderator';
    if (l.includes('builder') || l.includes('contributor') || l.includes('approver')) return 'user-builder';
    if (l.includes('platinum')) return 'user-platinum';
    if (l.includes('gold')) return 'user-gold';
    if (l.includes('member')) return 'user-member';
    return 'user-member';
  }

  async fetchDashboardData() {
    const dataManager = new AnalyticsDataManager(this.db);
    const user = this.context.targetUser;

    // NSFW State for milestones
    const nsfwKey = 'danbooru_grass_nsfw_enabled';
    const isNsfwEnabled = localStorage.getItem(nsfwKey) === 'true';

    // 1. Fetch Summary Stats first (Local DB) to get starting date for optimizations
    const summaryStats = await dataManager.getSummaryStats(user);
    const { firstUploadDate } = summaryStats;

    const [
      stats,
      total,
      distributions,
      topPosts,
      recentPopularPosts,
      randomPosts,
      promotions,
      milestones1k,
      scatterData
    ] = await Promise.all([
      dataManager.getSyncStats(user),
      dataManager.getTotalPostCount(user),
      Promise.all([
        dataManager.getStatusDistribution(user, firstUploadDate),
        dataManager.getRatingDistribution(user, firstUploadDate), // Optimized with date range
        dataManager.getCharacterDistribution(user),
        dataManager.getCopyrightDistribution(user),
        dataManager.getFavCopyrightDistribution(user),
        dataManager.getBreastsDistribution(user),
        dataManager.getHairLengthDistribution(user),
        dataManager.getHairColorDistribution(user)
      ]).then(([status, rating, char, copy, favCopy, breasts, hairL, hairC]) => ({
        status, rating, character: char, copyright: copy, fav_copyright: favCopy, breasts, hair_length: hairL, hair_color: hairC
      })),
      dataManager.getTopPostsByType(user),
      dataManager.getRecentPopularPosts(user),
      dataManager.getRandomPosts(user),
      dataManager.getPromotionHistory(user),
      dataManager.getMilestones(user, isNsfwEnabled, 1000),
      dataManager.getScatterData(user)
    ]);

    return {
      stats,
      total,
      summaryStats,
      distributions,
      topPosts,
      recentPopularPosts,
      randomPosts,
      promotions,
      milestones1k,
      scatterData
    };
  }

  /**
   * Renders the main dashboard content inside the modal.
   * Handles sync checks, header controls, and widget initialization.
   * @return {Promise<void>}
   */
  async renderDashboard() {
    if (this.isRendering) return;
    this.isRendering = true;

    try {
      const content = document.getElementById(`${this.modalId}-content`);
      if (!content) return;

      // Show Loading State Immediately
      content.innerHTML = `
        <div id="analytics-loading-report" style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:100px 0; color:#555;">
           <div class="di-spinner"></div>
           <div style="font-size:1.2em; font-weight:600; margin-top: 20px;">Generating Report...</div>
           <div style="font-size:0.9em; color:#888; margin-top:10px;">Analyzing contributions and trends</div>
        </div>
      `;

      // Pre-fetch all data!
      const dashboardData = await this.fetchDashboardData();
      const { stats, total, summaryStats, distributions, topPosts, recentPopularPosts, randomPosts, promotions, milestones1k, scatterData } = dashboardData;
      const { maxUploads, maxDate, firstUploadDate, lastUploadDate } = summaryStats;
      const today = new Date();
      const oneDay = 1000 * 60 * 60 * 24;

      // 1. Header (Flexbox)
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
         <p style="color:#555; margin:0;">Detailed statistics and history for <span class="${this.getLevelClass(this.context.targetUser.level_string)}">${this.context.targetUser.name}</span></p>
      </div>
       <div id="analytics-header-controls" style="display:none; align-items:center;">
         <label style="display:flex; align-items:center; margin-right:15px; font-size:13px; color:#57606a; cursor:pointer; user-select:none;">
            <input type="checkbox" id="user-analytics-nsfw-toggle" ${isNsfwEnabled ? 'checked' : ''} style="margin-right:6px;">
            Enable NSFW
         </label>
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
      const dBtn = header.querySelector('#analytics-reset-btn') as HTMLElement;

      // NSFW Logic
      setTimeout(() => {
        const nsfwToggle = header.querySelector('#user-analytics-nsfw-toggle') as HTMLInputElement;
        if (nsfwToggle) {
          nsfwToggle.onchange = (e) => {
            isNsfwEnabled = (e.target as HTMLInputElement).checked;
            localStorage.setItem(nsfwKey, String(isNsfwEnabled));

            // Efficient UI Update (No full re-render)
            const boobsBtn = document.querySelector('.di-pie-tab[data-mode="breasts"]') as HTMLElement;
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


        if (dBtn) {
          dBtn.onclick = async () => {
            if (confirm("⚠ FULL RESET WARNING ⚠\n\nThis will DELETE all local analytics data for this user and require a full re-sync.\n\nContinue?")) {
              dBtn.innerHTML = '⌛';
              await this.dataManager.clearUserData(this.context.targetUser);
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
          const diffTime = Math.abs(now.getTime() - lastSyncDate.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          if (diffDays > 7 && dBtn) {
            // Show Notification Bubble
            const bubble = document.createElement('div');
            bubble.innerHTML = 'Full data refresh recommended';
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

            // Anchor to Reset button parent
            (dBtn.parentNode as HTMLElement).style.position = 'relative';
            dBtn.parentNode.appendChild(bubble);

            // Auto remove after 10 seconds
            setTimeout(() => {
              if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
            }, 10000);
          }
        }
      }, 0);

      // Now clear content and append new data
      content.innerHTML = '';
      content.appendChild(header);

      // Condition: Show Dashboard if Synced OR if we have data and total is unknown
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
        const btn = syncDiv.querySelector('#analytics-start-sync') as HTMLButtonElement;

        // Check Global Sync State
        if (AnalyticsDataManager.isGlobalSyncing) {
          btn.innerHTML = 'Fetching in background...';
          btn.disabled = true;
          btn.style.backgroundColor = '#94d3a2'; // Light green/disabled
          btn.style.cursor = 'not-allowed';

          // Restore Progress Bar
          const progressDiv = syncDiv.querySelector('#analytics-main-progress') as HTMLElement;
          const bar = syncDiv.querySelector('#analytics-main-bar') as HTMLElement;
          const percent = syncDiv.querySelector('#analytics-main-percent') as HTMLElement;
          const countText = syncDiv.querySelector('#analytics-main-count') as HTMLElement;

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
          const progressDiv = syncDiv.querySelector('#analytics-main-progress') as HTMLElement;
          const bar = syncDiv.querySelector('#analytics-main-bar') as HTMLElement;
          const percent = syncDiv.querySelector('#analytics-main-percent') as HTMLElement;
          const countText = syncDiv.querySelector('#analytics-main-count') as HTMLElement;

          progressDiv.style.display = 'block';

          // Subscribe locally immediately
          AnalyticsDataManager.onProgressCallback = (c, max) => {
            const p = max > 0 ? Math.round((c / max) * 100) : 0;
            bar.style.width = `${p}%`;
            percent.textContent = max > 0 ? `${p}%` : 'Scanning...';
            countText.textContent = `${c} / ${max > 0 ? max : '?'}`;
          };

          await this.dataManager.syncAllPosts(this.context.targetUser, null); // Pass null, let internal broadcast handle it

          // --- Bubble Chart Data Collection ---
          try {
            const dist = await this.dataManager.getCopyrightDistribution(this.context.targetUser);
            const topCopyrights = dist.slice(0, 10).map(d => d.tagName).filter(n => n && n !== 'Other');

            if (topCopyrights.length > 0) {
              const bar = syncDiv.querySelector('#analytics-main-bar') as HTMLElement;
              const percent = syncDiv.querySelector('#analytics-main-percent') as HTMLElement;
              const countText = syncDiv.querySelector('#analytics-main-count') as HTMLElement;

              await this.dataManager.fetchBubbleData(this.context.targetUser, topCopyrights, (c, t, msg) => {
                const p = t > 0 ? Math.round((c / t) * 100) : 0;
                bar.style.width = `${p}%`;
                percent.textContent = `${p}%`;
                countText.textContent = `Fetching Analytics: ${c} / ${t}`;
              });
            }
          } catch (err) {
            console.error('[Danbooru Grass] Bubble Data Fetch Failed:', err);
          }

          // Done
          this.updateHeaderStatus();
          this.renderDashboard();
        };

        return; // Stop here, don't render dashboard
      }

      // --- VIEW 2: DASHBOARD (REPORT) ---
      // Show Header Controls
      const headerControls = header.querySelector('#analytics-header-controls') as HTMLElement;
      if (headerControls) headerControls.style.display = 'flex';

      // Show widgets

      const dashboardDiv = document.createElement('div');

      // Summary Card Wrapper
      const summaryWrapper = document.createElement('div');
      summaryWrapper.style.display = 'grid';
      summaryWrapper.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
      summaryWrapper.style.gap = '15px';
      summaryWrapper.style.marginBottom = '35px'; // Increased Spacing

      /**
       * Creates a summary card HTML string.
       * @param {string} title Card title.
       * @param {string|number} val Main value to display.
       * @param {string} icon Icon character or HTML.
       * @param {string} [details=''] Additional HTML details.
       * @return {string} HTML string.
       */
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

      // Calculations for Card 1 (Uploads) All-Time
      let avgUploads: number | string = 0;
      let daysSinceFirst = 0;
      if (firstUploadDate) {
        daysSinceFirst = Math.floor((today.getTime() - firstUploadDate.getTime()) / oneDay);
        if (daysSinceFirst > 0) {
          avgUploads = (stats.count / daysSinceFirst).toFixed(2);
        }
      }

      const uploadDetailsAll = `
       <div style="display:flex; flex-direction:column; gap:4px; border-left:2px solid #eee; padding-left:12px;">
           <div>📈 <strong>Average:</strong> ${avgUploads} posts / day</div>
           <div>🔥 <strong>Max:</strong> ${maxUploads} posts <span style="color:#888;">(${maxDate})</span></div>
       </div>
    `;

      // Calculations for Card 1 (Uploads) 1-Year
      const { count1Year, maxUploads1Year, maxDate1Year } = summaryStats;
      let avgUploads1Year: number | string = 0;
      const daysSinceFirst1Year = Math.min(daysSinceFirst, 365);
      if (daysSinceFirst1Year > 0) {
        avgUploads1Year = ((count1Year || 0) / daysSinceFirst1Year).toFixed(2);
      }

      const uploadDetails1Year = `
       <div style="display:flex; flex-direction:column; gap:4px; border-left:2px solid #eee; padding-left:12px;">
           <div>📈 <strong>Average:</strong> ${avgUploads1Year} posts / day</div>
           <div>🔥 <strong>Max:</strong> ${maxUploads1Year || 0} posts <span style="color:#888;">(${maxDate1Year || 'N/A'})</span></div>
       </div>
    `;

      // Calculations for Card 1 (Uploads) 3rd Pane (Consistency)
      const { maxStreak, maxStreakStart, maxStreakEnd, activeDays } = summaryStats;
      let activeRatio = "0.0";
      if (daysSinceFirst > 0) {
        activeRatio = ((activeDays / daysSinceFirst) * 100).toFixed(1);
      } else if (activeDays > 0) {
        activeRatio = "100.0";
      }

      let activeAvg = "0.0";
      if (activeDays > 0) {
        activeAvg = (stats.count / activeDays).toFixed(1);
      }

      const streakPeriod = maxStreakStart && maxStreakEnd ? ` <span style="color:#888;">(${maxStreakStart} ~ ${maxStreakEnd})</span>` : '';

      const consistencyDetails = `
       <div style="display:flex; flex-direction:column; gap:4px; border-left:2px solid #eee; padding-left:12px;">
           <div>🏃‍♂️ <strong>Max Streak:</strong> ${maxStreak} days${streakPeriod}</div>
           <div>🌟 <strong>Active Ratio:</strong> ${activeRatio}% <span style="color:#888;">(${activeDays}/${daysSinceFirst.toLocaleString()} days)</span></div>
           <div>🎯 <strong>Active Avg:</strong> ${activeAvg} posts/day</div>
       </div>
    `;

      // Animated Slide Card for Uploads (Static Icon, Slide Out Left, Slide In Right, 3 Panes)
      const uploadCardHtml = `
          <div id="danbooru-insights-upload-card" style="background:#fff; border:1px solid #e1e4e8; border-radius:8px; padding:15px; display:flex; align-items:flex-start; overflow:hidden; position:relative; min-height:106px;">
                 <div style="font-size:2em; margin-right:15px; margin-top:5px; flex-shrink:0;">🖼️</div>
                 
                 <div style="position:relative; flex-grow:1; display:grid; height:100%;">
                     <!-- All Time Pane -->
                     <div class="di-upload-card-pane" style="grid-area: 1 / 1; animation-name: di-slide-in-out-a;">
                        <div style="font-size:0.85em; color:#666; text-transform:uppercase; letter-spacing:0.5px;">TOTAL UPLOADS</div>
                        <div style="display:flex; align-items:center; gap:12px;">
                            <div style="font-size:1.5em; font-weight:bold; color:#333;">${stats.count.toLocaleString()}</div>
                            <div style="font-size:0.85em; color:#555;">${uploadDetailsAll}</div>
                        </div>
                     </div>

                     <!-- Last 1 Year Pane -->
                     <div class="di-upload-card-pane" style="grid-area: 1 / 1; animation-name: di-slide-in-out-b;">
                        <div style="font-size:0.85em; color:#666; text-transform:uppercase; letter-spacing:0.5px;">LAST 1 YEAR</div>
                        <div style="display:flex; align-items:center; gap:12px;">
                            <div style="font-size:1.5em; font-weight:bold; color:#333;">${(count1Year || 0).toLocaleString()}</div>
                            <div style="font-size:0.85em; color:#555;">${uploadDetails1Year}</div>
                        </div>
                     </div>
                     
                     <!-- Consistency Pane -->
                     <div class="di-upload-card-pane" style="grid-area: 1 / 1; animation-name: di-slide-in-out-c;">
                        <div style="font-size:0.85em; color:#666; text-transform:uppercase; letter-spacing:0.5px;">UPLOAD HABITS</div>
                        <div style="display:flex; align-items:center; gap:12px;">
                            <div style="font-size:0.85em; color:#555; margin-left: -12px;">${consistencyDetails}</div>
                        </div>
                     </div>
                 </div>

                 <button id="analytics-upload-btn-play-pause" class="di-play-pause-btn" title="Pause Animation">
                     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                         <rect x="5" y="4" width="4" height="16"></rect>
                         <rect x="15" y="4" width="4" height="16"></rect>
                     </svg>
                 </button>
          </div>
      `;
      summaryWrapper.innerHTML += uploadCardHtml;

      // Calculations for Card 2 (Latest Post & Days)
      const lastDate = lastUploadDate ? lastUploadDate.toISOString().split('T')[0] : 'N/A';

      let daysSinceJoin = 0;
      let joinDateStr = '';
      if (this.context.targetUser.created_at) {
        const joinDate = new Date(this.context.targetUser.created_at);
        daysSinceJoin = Math.floor((today.getTime() - joinDate.getTime()) / oneDay);
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

      // Bind Play/Pause Button Logic
      const btnPlayPause = dashboardDiv.querySelector('#analytics-upload-btn-play-pause') as HTMLElement;
      const uploadCard = dashboardDiv.querySelector('#danbooru-insights-upload-card') as HTMLElement;
      if (btnPlayPause && uploadCard) {
        let isPaused = false;
        btnPlayPause.addEventListener('click', () => {
          isPaused = !isPaused;
          if (isPaused) {
            uploadCard.classList.add('paused');
            btnPlayPause.title = 'Play Animation';
            btnPlayPause.innerHTML = `
                     <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                         <polygon points="5 3 19 12 5 21 5 3"></polygon>
                     </svg>
                  `;
          } else {
            uploadCard.classList.remove('paused');
            btnPlayPause.title = 'Pause Animation';
            btnPlayPause.innerHTML = `
                     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                         <rect x="5" y="4" width="4" height="16"></rect>
                         <rect x="15" y="4" width="4" height="16"></rect>
                     </svg>
                  `;
          }
        });
      }

      // --- ROW 2: Top Stats (Pie + Top Post) ---
      const topStatsRow = document.createElement('div');
      topStatsRow.style.display = 'grid';
      topStatsRow.style.gridTemplateColumns = 'repeat(auto-fit, minmax(300px, 1fr))'; // Responsive
      topStatsRow.style.gap = '15px';
      topStatsRow.style.marginBottom = '35px'; // Increased Spacing

      const pieContainer = document.createElement('div');
      pieContainer.style.background = '#fff';
      pieContainer.style.border = '1px solid #e1e4e8';
      pieContainer.style.borderRadius = '8px';
      pieContainer.style.padding = '15px';
      pieContainer.style.display = 'flex';
      pieContainer.style.flexDirection = 'column';
      pieContainer.style.color = '#888';

      const topPostContainer = document.createElement('div');
      topPostContainer.style.background = '#fff';
      topPostContainer.style.border = '1px solid #e1e4e8';
      topPostContainer.style.borderRadius = '8px';
      topPostContainer.style.padding = '15px';
      topPostContainer.style.display = 'flex';
      topPostContainer.style.flexDirection = 'column';

      // --- PIE CHART WIDGET REFRACTOR ---

      // Data Store for Pie Charts (Initialized with pre-fetched data)
      const pieData = { ...distributions };

      // Pre-process special distributions
      if (pieData.breasts) {
        const data = pieData.breasts;
        const total = data.reduce((acc, c) => acc + c.count, 0);
        pieData.breasts = data.map(d => ({
          ...d,
          frequency: total > 0 ? d.count / total : 0,
          value: total > 0 ? d.count / total : 0,
          label: d.name,
          details: { ...d, thumb: null }
        }));
      }

      // Render Loop State based on RAF
      let renderPending = false;
      const requestRender = () => {
        if (renderPending) return;
        renderPending = true;
        requestAnimationFrame(() => {
          renderPieContent();
          renderPending = false;
        });
      };

      // Listen for Lazy Loaded Updates
      const onPieDataUpdate = (e) => {
        if (!document.body.contains(dashboardDiv)) {
          window.removeEventListener('DanbooruInsights:DataUpdated', onPieDataUpdate);
          return;
        }
        const { contentType, data } = e.detail;
        const keyMap = {
          'character_dist': 'character',
          'copyright_dist': 'copyright',
          'fav_copyright_dist': 'fav_copyright',
          'breasts_dist': 'breasts',
          'hair_length_dist': 'hair_length',
          'hair_color_dist': 'hair_color',
          'rating_dist': 'rating'
        };
        const key = keyMap[contentType];

        // Special handling for breasts/hair_length/hair_color if they need processing?
        // The data originating from `getBreastsDistribution` is already processed structure (name, count, thumb).
        // But `loadTab` has some extra mapping logic for 'breasts' (lines 5047-5060) to add 'value', 'label'.
        // We need to replicate that if we replace the data?
        // OR we ensure `getXDistribution` returns fully usable objects?
        // `loadTab` logic for 'breasts' was:
        // data = data.map(d => ({ ...d, frequency: ..., value: ... }));
        // If we receive "raw" items from enrichThumbnails, they might lack 'value'/'label' if `loadTab` added them.
        // BUT `enrichThumbnails` received `items` which were PASSED IN.
        // So if `loadTab` modified them in place, they are already modified?
        // Wait, `loadTab` assigns `pieData[tabName] = data`.
        // If `data` was a NEW array (map return), then `enrichThumbnails` (which works on the original array passed to it) might be working on a DIFFERENT array if `loadTab` re-mapped it?
        // Let's check `loadTab` logic again.

        if (key && pieData[key]) {
          // If we are replacing the WHOLE array, we lose custom props added by `loadTab` (like 'value', 'label').
          // However, `data` in the event is the `items` array from `AnalyticsDataManager`.
          // `getBreastsDistribution` returns `filtered`.
          // `UserAnalyticsApp` calls `getBreastsDistribution`, gets `data`.
          // Then it MAPS it: `data = data.map(...)`.
          // So `pieData.breasts` holds the mapped array.
          // `enrichThumbnails` was called with `filtered` (the original array) inside `getBreastsDistribution`.
          // So `enrichThumbnails` updates the ORIGINAL objects.
          // If `loadTab` did a shallow copy `...d`, then `pieData` has NEW objects.
          // So modifying the original objects in `enrichThumbnails` won't affect `pieData` objects if they were copied.

          // Check `loadTab`: `data = data.map(d => ({ ...d, ... }))`.
          // YES, it creates NEW objects. 
          // So `enrichThumbnails` updates to `filtered` will NOT propagate to `pieData` automatically if `loadTab` ran.
          // WE MUST MERGE.

          // Merge Strategy:
          // Iterate `pieData[key]` and update thumbs from `data` based on name/tagName.

          const incomingMap = new Map(data.map(d => [d.name, d]));
          const currentData = pieData[key];

          let changed = false;
          currentData.forEach((item: any) => {
            const update = incomingMap.get(item.name) as any; // Match by name (unique?)
            if (update && update.thumb && item.thumb !== update.thumb) {
              item.thumb = update.thumb; // Update the thumb in the View Model
              if (item.details) item.details.thumb = update.thumb; // Update details too
              changed = true;
            }
          });

          if (changed && currentPieTab === key) {
            requestRender();
          }
        } else if (key) {
          // If pieData[key] is null (not loaded yet), we might want to just set it?
          // But if we haven't processed it (added value/frequency props), we shouldn't just dump raw data.
          // The `loadTab` logic handles formatting.
          // So ignore if not loaded?
          // Or rely on `loadTab` to fetch the cached (now enriched) data eventually.
        }
      };

      window.addEventListener('DanbooruInsights:DataUpdated', onPieDataUpdate);

      let currentPieTab = 'copyright'; // Default to Copy as requested

      /**
       * Handles click events on pie chart slices.
       * Opens a search query in a new tab based on the selected slice.
       * @param {Object} d The data object from D3.
       */
      const handlePieClick = (d) => {
        const targetName = this.context.targetUser.normalizedName || this.context.targetUser.name.replace(/ /g, '_') || '';
        if (!targetName) return;
        let query = '';
        const details = d.data.details;

        // Search Logic
        if (currentPieTab === 'rating') {
          if (details && details.rating) query = `rating:${details.rating}`;
        } else if (currentPieTab === 'fav_copyright') {
          // Fav Copy uses ordfav
          query = `ordfav:${this.context.targetUser.normalizedName} ${details.tagName || d.data.label}`;
          window.open(`/posts?tags=${encodeURIComponent(query)}`, '_blank');
          return;
        } else if (currentPieTab === 'status') {
          query = `status:${details.name}`;
        } else if (currentPieTab === 'breasts' || currentPieTab === 'hair_length' || currentPieTab === 'hair_color') {
          if (details.originalTag) query = details.originalTag;
          else query = d.data.label.toLowerCase().replace(/ /g, '_');
        } else {
          // Standard (Character, Copyright, etc.)
          query = details.tagName || d.data.label;
        }

        if (query) {
          const urlPrefix = `user:${targetName}`;
          window.open(`/posts?tags=${encodeURIComponent(`${urlPrefix} ${query}`)}`, '_blank');
        }
      };

      /**
       * Renders the Pie Chart content based on the current tab.
       * Handles data visualization and interaction.
       * @return {void}
       */
      const renderPieContent = () => {
        const contextUser = this.context.targetUser;
        const data = pieData[currentPieTab];
        const container = pieContainer.querySelector('.pie-content') as HTMLElement;

        if (!data) {
          container.innerHTML = '<div style="color:#888; padding:30px; text-align:center;">Loading...</div>';
          return;
        }

        if (data.length === 0) {
          container.innerHTML = '<div style="color:#888; padding:30px; text-align:center;">No data available</div>';
          return;
        }

        if (!contextUser.normalizedName && contextUser.name) {
          contextUser.normalizedName = contextUser.name.replace(/ /g, '_');
        }

        // Sort: Hair Length has a specific order (custom sort)
        if (currentPieTab === 'hair_length') {
          const order = ['Bald', 'Very Short Hair', 'Short Hair', 'Medium Hair', 'Long Hair', 'Very Long Hair', 'Absurdly Long Hair'];
          data.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
        }

        container.style.display = 'flex';
        container.style.flexDirection = 'row';
        container.style.alignItems = 'center';
        container.style.justifyContent = 'space-around';
        container.style.perspective = '1000px';

        // Colors & Labels Generation
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
          if (['rating', 'status', 'breasts', 'hair_length', 'hair_color'].includes(currentPieTab)) {
            return {
              value: d.count,
              label: (currentPieTab === 'rating') ? (ratingLabels[d.rating] || d.rating) : d.label || d.name,
              color: (currentPieTab === 'rating') ? (ratingColors[d.rating] || '#999') : (
                (currentPieTab === 'hair_color' && d.color) ? d.color : (d.color || (d.isOther ? '#bdbdbd' : palette[i % palette.length]))
              ),
              details: d
            };
          }
          else {
            let sliceColor = d.isOther ? '#bdbdbd' : palette[i % palette.length];
            if (currentPieTab === 'hair_color' && d.color) {
              sliceColor = d.color;
            }

            return {
              value: d.frequency,
              label: d.name,
              color: sliceColor,
              details: d
            };
          }
        });

        // Filter out invalid/zero values to prevent D3 errors
        const validData = processedData.filter(d => Number.isFinite(d.value) && d.value > 0);
        const totalValue = validData.reduce((acc, curr) => acc + curr.value, 0);

        if (validData.length === 0 || totalValue === 0) {
          container.innerHTML = '<div style="color:#888; padding:30px; text-align:center;">No data available (Total count is 0)</div>';
          return;
        }

        // --- D3 Chart (Join Pattern) ---
        let chartWrapper = container.querySelector('.pie-chart-wrapper') as HTMLElement;

        // 1. Enter (Create wrapper if missing)
        if (!chartWrapper) {
          container.innerHTML = ''; // Clear loading/error text

          chartWrapper = document.createElement('div');
          chartWrapper.className = 'pie-chart-wrapper';
          chartWrapper.style.width = '180px';
          chartWrapper.style.height = '180px';
          chartWrapper.style.transformStyle = 'preserve-3d';
          chartWrapper.style.transform = 'rotateX(40deg) rotateY(0deg)';
          chartWrapper.style.transition = 'transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
          chartWrapper.style.cursor = 'pointer';

          // Shadow
          const shadow = document.createElement('div');
          shadow.style.position = 'absolute';
          shadow.style.top = '50%';
          shadow.style.left = '50%';
          shadow.style.width = '140px';
          shadow.style.height = '140px';
          shadow.style.transform = 'translate(-50%, -50%) translateZ(-10px)';
          shadow.style.borderRadius = '50%';
          shadow.style.background = 'rgba(0,0,0,0.2)';
          shadow.style.filter = 'blur(5px)';
          chartWrapper.appendChild(shadow);

          // Hover Effects
          chartWrapper.addEventListener('mouseenter', () => {
            chartWrapper.style.transform = 'rotateX(0deg) scale(1.1)';
            shadow.style.transform = 'translate(-50%, -50%) translateZ(-30px) scale(0.9)';
            shadow.style.opacity = '0.5';
          });
          chartWrapper.addEventListener('mouseleave', () => {
            chartWrapper.style.transform = 'rotateX(40deg)';
            shadow.style.transform = 'translate(-50%, -50%) translateZ(-10px)';
            shadow.style.opacity = '1';
          });

          container.appendChild(chartWrapper);

          // Create SVG

          d3.select(chartWrapper)
            .append("svg")
            .attr("width", 180)
            .attr("height", 180)
            .style("overflow", "visible")
            .append("g")
            .attr("transform", `translate(90,90)`); // 180/2

          // Legend Container
          const legendDiv = document.createElement('div');
          legendDiv.className = 'danbooru-grass-legend-scroll';
          legendDiv.style.display = 'flex';
          legendDiv.style.flexDirection = 'column';
          legendDiv.style.marginLeft = '20px';
          legendDiv.style.maxHeight = '180px';
          legendDiv.style.overflowY = 'auto';
          legendDiv.style.paddingRight = '5px';

          // Custom Scrollbar
          const scrollbarStyle = document.createElement('style');
          scrollbarStyle.innerHTML = `
              .danbooru-grass-legend-scroll::-webkit-scrollbar { width: 6px; }
              .danbooru-grass-legend-scroll::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 3px; }
              .danbooru-grass-legend-scroll::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 3px; }
              .danbooru-grass-legend-scroll::-webkit-scrollbar-thumb:hover { background: #a8a8a8; }
           `;
          legendDiv.appendChild(scrollbarStyle);
          container.appendChild(legendDiv);
        }

        const width = 180;
        const height = 180;
        const radius = Math.min(width, height) / 2 - 20;

        const svg = d3.select(chartWrapper).select('svg g');
        const pie = d3.pie().value(d => d.value).sort(null);
        const arc = d3.arc().innerRadius(0).outerRadius(radius);
        const arcHover = d3.arc().innerRadius(0).outerRadius(radius * 1.2);

        // Tooltip (Join Pattern)
        const tooltip = d3.select("body").selectAll(".danbooru-grass-pie-tooltip").data([0]).join("div")
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

        // PATHS (Join Pattern)
        svg.selectAll('path')
          .data(pie(validData), d => d.data.label)
          .join(
            enter => enter.append('path')
              .attr('class', 'danbooru-grass-pie-path')
              .attr('d', arc)
              .attr('fill', d => d.data.color)
              .style('opacity', '0.9')
              .style('cursor', 'pointer'),
            update => update
              .attr('class', 'danbooru-grass-pie-path')
              .attr('d', arc)
              .call(update => update.transition().duration(500)
                .attr('fill', d => d.data.color))
          )
          .attr('stroke', '#fff')
          .style('stroke-width', '1px')
          .on('mouseover', function (event, d) {
            d3.select(this).transition().duration(200).attr('d', arcHover)
              .style('opacity', '1')
              .style('filter', 'drop-shadow(0px 0px 8px rgba(255,255,255,0.4))');

            let html = '';
            const details = d.data.details;
            const thumbUrl = details.thumb;
            const thumbHtml = thumbUrl ? `
            <div style="width: 80px; height: 80px; border-radius: 4px; overflow: hidden; background: #333; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">
              <img src="${thumbUrl}" style="width: 100%; height: 100%; object-fit: cover;">
            </div>` : '';

            if (currentPieTab === 'rating') {
              html = `
              <div style="display: flex; gap: 12px; align-items: start;">
                ${thumbHtml}
                <div>
                  <div style="font-weight: bold; color: ${d.data.color}; margin-bottom: 4px; font-size: 14px;">${d.data.label}</div>
                  <div style="font-size: 11px; color: #ccc;">Count: <strong style="color:#fff;">${details.count.toLocaleString()}</strong></div>
                  <div style="font-size: 11px; color: #ccc;">Ratio: <strong style="color:#fff;">${Math.round((d.data.value / totalValue) * 100)}%</strong></div>
                </div>
              </div>
            `;
            } else {
              const percentage = ((d.data.value / totalValue) * 100).toFixed(1) + '%';
              html = `
              <div style="display: flex; gap: 12px; align-items: start;">
                ${thumbHtml}
                <div style="max-width: 180px;">
                  <div style="font-weight: bold; color: ${d.data.color}; margin-bottom: 4px; font-size: 14px; word-wrap: break-word;">${d.data.label}</div>
                  <div style="font-size: 11px; color: #ccc;">Freq: <strong style="color:#fff;">${percentage}</strong></div>
                  ${!details.isOther ? `<div style="font-size: 11px; color: #ccc;">Posts: <strong style="color:#fff;">${details.count ? details.count.toLocaleString() : '?'}</strong></div>` : ''}
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
          .on('click', (event, d) => handlePieClick(d));

        // Update Legend
        const legendDiv = container.querySelector('.danbooru-grass-legend-scroll');
        if (legendDiv) { // Should exist
          let legendTitle = 'DIST.';
          if (currentPieTab === 'copyright') legendTitle = 'COPYRIGHTS';
          else if (currentPieTab === 'character') legendTitle = 'CHARACTERS';
          else if (currentPieTab === 'fav_copyright') legendTitle = 'FAVORITE COPYRIGHTS';
          else if (currentPieTab === 'status') legendTitle = 'STATUS';
          else if (currentPieTab === 'rating') legendTitle = 'RATINGS';
          else if (currentPieTab === 'hair_length') legendTitle = 'HAIR LENGTH'
          else if (currentPieTab === 'hair_color') legendTitle = 'HAIR COLOR';
          else if (currentPieTab === 'breasts') legendTitle = 'BREASTS';

          // Rebuild legend content (simplest for text updates)
          // Preserve style tag
          const styleTag = legendDiv.querySelector('style') ? legendDiv.querySelector('style').outerHTML : '';

          const listHtml = processedData.map(d => {
            const val = (d.value / totalValue) * 100;
            const pct = val.toFixed(1) + '%';
            let targetUrl = '#';
            let query = '';

            if (!d.details.isOther) {
              if (currentPieTab === 'rating') {
                query = `rating:${d.details.rating}`;
                targetUrl = `/posts?tags=${encodeURIComponent(`user:${contextUser.normalizedName} ${query}`)}`;
              } else if (currentPieTab === 'breasts') {
                const tag = d.label.toLowerCase().replace(/ /g, '_');
                targetUrl = `/posts?tags=${encodeURIComponent(`user:${contextUser.normalizedName} ${tag}`)}`;
              } else if (currentPieTab === 'fav_copyright') {
                query = `ordfav:${contextUser.normalizedName} ${d.details.tagName || d.label}`;
                targetUrl = `/posts?tags=${encodeURIComponent(query)}`;
              } else if (currentPieTab === 'status') {
                query = `status:${d.details.name}`;
                targetUrl = `/posts?tags=${encodeURIComponent(`user:${contextUser.normalizedName} ${query}`)}`;
              } else {
                query = d.details.tagName || d.label;
                targetUrl = `/posts?tags=${encodeURIComponent(`user:${contextUser.normalizedName} ${query}`)}`;
              }
            }

            return `
                   <div style="display:flex; align-items:center; font-size:0.85em; margin-bottom:5px;">
                      <div style="width:12px; height:12px; background:${d.color}; border-radius:2px; margin-right:8px; border:1px solid rgba(0,0,0,0.1); flex-shrink:0;"></div>
                      ${d.details.isOther
                ? `<div style="color:#555; width:90px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${d.label}">${d.label}</div>`
                : `<a href="${targetUrl}" target="_blank" class="di-hover-underline" style="color:#555; width:90px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-decoration:none;" title="${d.label}">${d.label}</a>`
              }
                      <div style="font-weight:bold; color:#333; margin-left:auto;" title="${d.details.count ? d.details.count.toLocaleString() : ''}">${pct}</div>
                   </div>`;
          }).join('');

          legendDiv.innerHTML = styleTag + `
               <div style="font-size:0.8em; color:#888; margin-bottom:8px; text-transform:uppercase; position:sticky; top:0; background:#fff; padding-bottom:4px; border-bottom:1px solid #eee;">${legendTitle}</div>
               ${listHtml}
          `;
        }
      };

      const updatePieTabs = () => {
        const btns = pieContainer.querySelectorAll('.di-pie-tab');
        btns.forEach(btn => {
          const el = btn as HTMLElement;
          const mode = el.getAttribute('data-mode');
          if (mode === currentPieTab) {
            // Active Style (Dark Pill)
            el.style.background = '#555';
            el.style.color = '#fff';
            el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)';
          } else {
            // Inactive Style (Light Pill)
            el.style.background = '#eee';
            el.style.color = '#555';
            el.style.boxShadow = 'none';
          }
        });
      };

      // Header with Tabs (Pill Style)
      pieContainer.innerHTML = `
         <div style="width:100%; display:flex; flex-direction:column;">
             <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; width:100%;">
                 <!-- Tabs Container: Flex Wrap, Gap -->
                 <div style="display:flex; flex-wrap:wrap; gap:4px; max-width:100%;">
                     <button class="di-pie-tab" data-mode="copyright">Copy</button>
                     <button class="di-pie-tab" data-mode="character">Char</button>
                     <button class="di-pie-tab" data-mode="fav_copyright">Fav_Copy</button>
                     <button class="di-pie-tab" data-mode="status">Status</button>
                     <button class="di-pie-tab" data-mode="rating">Rate</button>
                     <button class="di-pie-tab" data-mode="hair_length">Hair_L</button>
                     <button class="di-pie-tab" data-mode="hair_color">Hair_C</button>
                     <button class="di-pie-tab" data-mode="breasts" style="display:${isNsfwEnabled ? 'block' : 'none'};">Boobs</button>
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
            data = await this.dataManager.getRatingDistribution(this.context.targetUser, firstUploadDate);
          } else if (tabName === 'status') {
            data = await this.dataManager.getStatusDistribution(this.context.targetUser, firstUploadDate);
            const statusColors = {
              'active': '#2da44e', // Green
              'deleted': '#d73a49', // Red (Danbooru deleted color)
              'pending': '#0969da', // Blue
              'flagged': '#cf222e', // Red
              'banned': '#6e7781', // Grey
              'appealed': '#bf3989' // Purple
            };
            data = data.map(d => ({
              ...d,
              color: statusColors[d.name] || '#888'
            }));
          } else if (tabName === 'character') {
            data = await this.dataManager.getCharacterDistribution(this.context.targetUser);
          } else if (tabName === 'copyright') {
            data = await this.dataManager.getCopyrightDistribution(this.context.targetUser);
          } else if (tabName === 'fav_copyright') {
            data = await this.dataManager.getFavCopyrightDistribution(this.context.targetUser);
          } else if (tabName === 'breasts') {
            data = await this.dataManager.getBreastsDistribution(this.context.targetUser);
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
        if ((e.target as HTMLElement).classList.contains('di-pie-tab')) {
          const mode = (e.target as HTMLElement).getAttribute('data-mode');
          if (currentPieTab !== mode) {
            currentPieTab = mode;
            updatePieTabs();
            loadTab(mode);
          }
        }
      });


      // Initial Load (Default Tab: Copyright)
      updatePieTabs();
      loadTab(currentPieTab);


      topPostContainer.style.padding = '15px';

      // Use pre-fetched top posts
      // Structure: { most: {sfw, nsfw}, recent: {sfw, nsfw}, random: {sfw, nsfw} }
      const topPostGroups = {
        most: topPosts,
        recent: recentPopularPosts,
        random: randomPosts
      };

      let currentWidgetMode = 'recent'; // 'recent', 'most', 'random'
      let currentTab = 'sfw'; // 'sfw', 'nsfw'

      /**
       * Renders the content of the Top Post widget.
       */
      const renderTopPostContent = () => {
        const group = topPostGroups[currentWidgetMode];
        const data = group ? group[currentTab] : null;
        const contentDiv = topPostContainer.querySelector('.top-post-content');

        if (!data) {
          contentDiv.innerHTML = '<div style="color:#888; padding:20px 0;">No posts found or loading...</div>';
          return;
        }

        const thumbUrl = AnalyticsDataManager.getBestThumbnailUrl(data);
        const dateStr = data.created_at ? new Date(data.created_at).toISOString().split('T')[0] : 'N/A';
        const link = `/posts/${data.id}`;
        const ratingMap = { 'g': 'General', 's': 'Sensitive', 'q': 'Questionable', 'e': 'Explicit' };
        const ratingLabel = ratingMap[data.rating] || data.rating;

        // Refresh Button Visibility
        const refreshBtn = topPostContainer.querySelector('#analytics-random-refresh') as HTMLElement;
        if (refreshBtn) {
          refreshBtn.style.display = (currentWidgetMode === 'random') ? 'inline-block' : 'none';
        }

        // Search Link logic
        const searchLinkBtn = topPostContainer.querySelector('#analytics-more-post-link') as HTMLElement;
        if (searchLinkBtn) {
          // Only show for Recent Popular mode
          searchLinkBtn.style.display = (currentWidgetMode === 'recent') ? 'inline-block' : 'none';

          const normalizedName = this.context.targetUser.normalizedName;
          const ratingTag = currentTab === 'sfw' ? 'is:sfw' : 'is:nsfw';
          const searchQuery = `user:${normalizedName} order:score age:<1w ${ratingTag}`;

          searchLinkBtn.onclick = () => {
            window.open(`/posts?tags=${encodeURIComponent(searchQuery)}`, '_blank');
          };
        }

        // Helper to generate tag lines
        const createTagLine = (label, icon, tags) => {
          if (!tags) return '';
          const tagList = tags.replace(/_/g, ' ');
          const displayTags = (label === 'Char' && tags.split(' ').length > 5)
            ? tagList.split(' ').slice(0, 5).join(', ') + '...'
            : tagList;
          return `<div>${icon} <strong>${label}:</strong> ${displayTags}</div>`;
        };

        const artistLine = createTagLine('Artist', '🎨', data.tag_string_artist);
        const copyrightLine = createTagLine('Copy', '©️', data.tag_string_copyright);
        const charLine = createTagLine('Char', '👤', data.tag_string_character);

        contentDiv.innerHTML = `
          <div style="display:flex; gap:15px; align-items:flex-start;">
              <a href="${link}" target="_blank" style="display:block; width:150px; height:150px; flex-shrink:0; background:#eee; border-radius:4px; overflow:hidden; position:relative;">
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
                          ${artistLine}
                          ${copyrightLine}
                          ${charLine}
                      </div>
                  </div>
              </div>
          </div>
       `;
      };

      /**
       * Updates the Top Post tab styles (SFW/NSFW).
       */
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

      // Header with Dropdown
      topPostContainer.innerHTML = `
         <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div style="font-size:0.85em; color:#666; letter-spacing:0.5px; display:flex; align-items:center; gap:5px;">
               <select id="analytics-top-post-select" style="border:none; background:transparent; font-weight:bold; color:#666; cursor:pointer; text-transform:uppercase; font-size:1em; outline:none;">
                  <option value="recent">🔥 Recent Popular Post</option>
                  <option value="most">🏆 Most Popular Post</option>
                  <option value="random">🎲 Random Post</option>
               </select>
                <button id="analytics-random-refresh" style="display:none; border:none; background:transparent; cursor:pointer; font-size:1.2em; padding:0 4px; margin-left:5px; filter: grayscale(100%); opacity: 0.6;" title="Load New Random Post">
                     🔄
                 </button>
                <button id="analytics-more-post-link" style="border:none; background:transparent; cursor:pointer; font-size:1.1em; padding:0 4px; margin-left:2px; filter: grayscale(100%); opacity: 0.6;" title="See more posts">
                     ↗️
                 </button>
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

      // Dropdown Event Listener
      const modeSelect = topPostContainer.querySelector('#analytics-top-post-select') as HTMLSelectElement;
      if (modeSelect) {
        modeSelect.addEventListener('change', (e) => {
          currentWidgetMode = (e.target as HTMLSelectElement).value;
          renderTopPostContent();
        });
      }

      // Random Refresh Logic
      const refreshBtn = topPostContainer.querySelector('#analytics-random-refresh') as HTMLElement;
      if (refreshBtn) {
        refreshBtn.onclick = async (e) => {
          e.stopPropagation();
          // Rotate animation
          refreshBtn.style.transform = 'rotate(360deg)';
          setTimeout(() => refreshBtn.style.transform = 'rotate(0deg)', 400);

          // Show loading state in content
          const contentDiv = topPostContainer.querySelector('.top-post-content') as HTMLElement;
          contentDiv.style.opacity = '0.5';

          try {
            const newRandoms = await (new AnalyticsDataManager(this.db)).getRandomPosts(this.context.targetUser);
            topPostGroups.random = newRandoms;
            renderTopPostContent();
          } catch (err) {
            console.error('Failed to refresh random post:', err);
          } finally {
            contentDiv.style.opacity = '1';
          }
        };
      }

      // Tab Event Delegation
      topPostContainer.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('top-post-tab')) {
          currentTab = (e.target as HTMLElement).getAttribute('data-mode');
          updateTabs();
          renderTopPostContent();
        }
      });

      topStatsRow.appendChild(pieContainer);
      topStatsRow.appendChild(topPostContainer);
      dashboardDiv.appendChild(topStatsRow);

      updateTabs(); // Initialize tabs style (default: sfw)
      renderTopPostContent();
      content.appendChild(dashboardDiv);

      // 3. Milestones Widget
      const milestonesDiv = document.createElement('div');
      milestonesDiv.style.marginTop = '20px';
      dashboardDiv.appendChild(milestonesDiv);

      let currentMilestoneStep: 'auto' | number = 'auto'; // shared state for closure

      /**
       * Renders the Milestones widget.
       */
      const renderMilestones = async () => {
        const milestones = await (new AnalyticsDataManager(this.db)).getMilestones(this.context.targetUser, isNsfwEnabled, currentMilestoneStep);

        let msHtml = '<div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:8px; margin-bottom:10px;">';
        msHtml += '<h3 style="color:#333; margin:0;">🏆 Milestones</h3>';

        msHtml += '<div style="display:flex; align-items:center; gap:10px;">';

        // Interval Selector
        msHtml += `<select id="analytics-milestone-step" style="border:1px solid #d0d7de; border-radius:4px; padding:2px 4px; font-size:0.85em; color:#555; background-color:#f6f8fa;">
          <option value="auto" ${currentMilestoneStep === 'auto' ? 'selected' : ''}>Auto</option>
          <option value="1000" ${currentMilestoneStep === 1000 || String(currentMilestoneStep) === '1000' ? 'selected' : ''}>Every 1k</option>
          <option value="2500" ${currentMilestoneStep === 2500 || String(currentMilestoneStep) === '2500' ? 'selected' : ''}>Every 2.5k</option>
          <option value="5000" ${currentMilestoneStep === 5000 || String(currentMilestoneStep) === '5000' ? 'selected' : ''}>Every 5k</option>
      </select>`;

        msHtml += '<button id="analytics-milestone-toggle" style="background:none; border:none; color:#0969da; cursor:pointer; font-size:0.9em; display:none;">Show More</button>';
        msHtml += '</div>';
        msHtml += '</div>';

        if (milestones.length === 0) {
          milestonesDiv.innerHTML = msHtml + '<div style="color:#888; font-size:0.9em;">No milestones found.</div>';
          // Still attach listener for dropdown even if empty?
          // Rarely empty if total > 0.
          const sel = milestonesDiv.querySelector('#analytics-milestone-step') as HTMLSelectElement;
          if (sel) {
            sel.onchange = (e) => {
              const v = (e.target as HTMLSelectElement).value;
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
          const thumbUrl = AnalyticsDataManager.getBestThumbnailUrl(p);
          const showThumb = isNsfwEnabled || isSafe;

          msHtml += `
          <a href="/posts/${p.id}" target="_blank" class="di-hover-scale" style="
             display:flex; justify-content:space-between; align-items:center; text-decoration:none; color:inherit;
             background:#fff; border:1px solid #e1e4e8; border-radius:6px; padding:10px;
          ">
             <div>
                 <div style="font-size:0.8em; color:#888; letter-spacing:0.5px;">#${p.id}</div>
                 <div style="font-size:1.1em; font-weight:bold; color:#0969da; margin-top:4px;">${m.type}</div>
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
        const stepSelect = milestonesDiv.querySelector('#analytics-milestone-step') as HTMLSelectElement;
        if (stepSelect) {
          stepSelect.onchange = (e) => {
            const v = (e.target as HTMLSelectElement).value;
            currentMilestoneStep = v === 'auto' ? 'auto' : parseInt(v);
            renderMilestones();
          };
        }

        // Toggle Logic
        // Calculate rows? or just check count.
        // If grid has auto-fill, rows depend on width.
        // Simple check: > 6 items?
        if (milestones.length > 6) {
          const btn = milestonesDiv.querySelector('#analytics-milestone-toggle') as HTMLElement;
          const container = milestonesDiv.querySelector(`#${containerId}`) as HTMLElement;
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
      /**
       * Applies NSFW setting updates to widgets without full re-render.
       */
      applyNsfwUpdate = async () => {
        // 1. Top Post Button
        const nsfwBtn = document.getElementById('analytics-top-nsfw-btn');
        if (nsfwBtn) {
          nsfwBtn.style.display = isNsfwEnabled ? 'inline-block' : 'none';
        }

        // 2. Tab Switch
        if (!isNsfwEnabled && currentTab === 'nsfw') {
          const sfwBtn = topPostContainer.querySelector('button[data-mode="sfw"]') as HTMLElement;
          if (sfwBtn) sfwBtn.click();
        }

        // 3. Milestones
        await renderMilestones();
      };

      // Initial Load
      await renderMilestones();

      // 4. Monthly Activity Chart
      let minDate = null;
      if (promotions.length > 0) {
        minDate = promotions[0].date;
      }

      const monthly = await (new AnalyticsDataManager(this.db)).getMonthlyStats(this.context.targetUser, minDate);
      if (monthly.length > 0) {
        const chartDiv = document.createElement('div');
        chartDiv.style.marginTop = '24px';
        let chartHtml = '<h3 style="color:#333; border-bottom:1px solid #eee; padding-bottom:10px; margin-bottom:15px;">📅 Monthly Activity</h3>';

        // SVG Implementation
        // SVG Implementation
        const minBarWidth = 25; // Minimum width per bar
        const padLeftScroll = 10;
        const padRight = 20;
        const padBottom = 25;
        const padTop = 20;
        const yAxisWidth = 45;

        // Data Prep & Dynamic Width
        const maxCount = Math.max(...monthly.map(m => m.count));
        const requiredWidth = padLeftScroll + padRight + (monthly.length * minBarWidth);
        const vWidth = Math.max(800, requiredWidth); // At least 800, extend if needed
        const vHeight = 200;

        // Container (Main Wrapper)
        const mainWrapper = document.createElement('div');
        mainWrapper.className = 'chart-flex-wrapper';
        mainWrapper.style.display = 'flex';
        mainWrapper.style.width = '100%';
        mainWrapper.style.position = 'relative';
        mainWrapper.style.border = '1px solid #e1e4e8';
        mainWrapper.style.borderRadius = '8px';
        mainWrapper.style.backgroundColor = '#fff';
        mainWrapper.style.overflow = 'hidden';

        // Axis Container (Fixed)
        const yAxisWrapper = document.createElement('div');
        yAxisWrapper.style.width = `${yAxisWidth}px`;
        yAxisWrapper.style.flexShrink = '0';
        yAxisWrapper.style.borderRight = '1px solid #f0f0f0';
        yAxisWrapper.style.zIndex = '5';
        yAxisWrapper.style.backgroundColor = '#fff';
        mainWrapper.appendChild(yAxisWrapper);

        // Scrollable Content
        const chartWrapper = document.createElement('div');
        chartWrapper.className = 'scroll-wrapper';
        chartWrapper.style.flex = '1';
        chartWrapper.style.overflowX = 'auto';
        chartWrapper.style.overflowY = 'hidden';
        mainWrapper.appendChild(chartWrapper);

        // Axis Logic
        let tickMax = Math.ceil(maxCount / 500) * 500;
        if (tickMax < 500) tickMax = 500;

        let tickStep = 500;
        if (tickMax <= 2000) {
          tickStep = tickMax / 4;
        }

        const numTicks = Math.round(tickMax / tickStep);

        // 1. Fixed Y-Axis SVG
        let ySvg = `<svg width="${yAxisWidth}" height="${vHeight}">`;
        for (let i = 0; i <= numTicks; i++) {
          const val = i * tickStep;
          const y = (vHeight - padBottom) - ((val / tickMax) * (vHeight - padBottom - padTop));
          ySvg += `<text x="${yAxisWidth - 5}" y="${y + 4}" text-anchor="end" font-size="10" fill="#888">${val}</text>`;
        }
        ySvg += '</svg>';
        yAxisWrapper.innerHTML = ySvg;

        // 2. Scrollable Content SVG
        let svg = `<svg width="${vWidth}" height="${vHeight}">`;

        // Grid Lines (Horizontal)
        for (let i = 1; i <= numTicks; i++) {
          const val = i * tickStep;
          const y = (vHeight - padBottom) - ((val / tickMax) * (vHeight - padBottom - padTop));
          svg += `<line x1="0" y1="${y}" x2="${vWidth}" y2="${y}" stroke="#eee" stroke-width="1" />`;
        }
        // Bottom axis line
        svg += `<line x1="0" y1="${vHeight - padBottom}" x2="${vWidth}" y2="${vHeight - padBottom}" stroke="#ccc" />`;

        const barAreaWidth = vWidth - padLeftScroll - padRight;
        const step = barAreaWidth / monthly.length;
        const barWidth = step * 0.75;

        // 3. Columns (Bars & Overlays)
        monthly.forEach((m, idx) => {
          const x = padLeftScroll + (step * idx) + (step - barWidth) / 2;
          const barH = (m.count / tickMax) * (vHeight - padBottom - padTop);
          const y = (vHeight - padBottom) - barH;

          const colX = padLeftScroll + (step * idx);
          const colWidth = step;

          const nextDate = idx < monthly.length - 1 ? monthly[idx + 1].date : null;
          let dateFilter = `date:${m.date}-01`;
          if (nextDate) {
            dateFilter = `date:${m.date}-01...${nextDate}-01`;
          } else {
            const [yy, mm] = m.date.split('-').map(Number);
            // Calculate next month
            const nextMonth = new Date(yy, mm, 1); // mm is 1-indexed from map(Number), so new Date(yy, mm, 1) is actually month+1
            const nextY = nextMonth.getFullYear();
            const nextM = String(nextMonth.getMonth() + 1).padStart(2, '0');
            dateFilter = `date:${m.date}-01...${nextY}-${nextM}-01`;
          }
          const searchUrl = `/posts?tags=user:${encodeURIComponent(this.context.targetUser.normalizedName)}+${dateFilter}`;

          svg += `
            <g class="month-column" style="cursor: pointer;" onclick="window.open('${searchUrl}', '_blank')">
              <rect class="column-overlay" x="${colX}" y="0" width="${colWidth}" height="${vHeight - padBottom}" fill="transparent" />
              <rect class="monthly-bar" x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="#40c463" rx="2" style="pointer-events: none;" />
              <title>${m.label}: ${m.count} posts</title>
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

        // 4. Promotions Overlay
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
            const x = padLeftScroll + (step * idx);

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

        // 5. Milestone Stars (Pre-fetched)

        // Map milestones to months
        monthly.forEach((mo, idx) => {
          const mKey = mo.date;
          const stars = milestones1k.filter(m => {
            const pDate = new Date(m.post.created_at);
            const k = `${pDate.getFullYear()}-${String(pDate.getMonth() + 1).padStart(2, '0')}`;
            return k === mKey;
          });

          if (stars.length > 0) {
            const x = padLeftScroll + (step * idx) + (step / 2);

            stars.forEach((m, si) => {
              const y = 14 + (si * 18);

              let fill = '#ffd700';
              let stroke = '#b8860b';
              let style = 'filter: drop-shadow(0px 1px 1px rgba(0,0,0,0.3));';
              let animClass = '';

              if (m.index === 1) {
                fill = '#00e676'; // Green for #1
                stroke = '#00a050';
              } else if (m.index % 10000 === 0) {
                fill = '#ffb300';
                animClass = 'star-shiny';
              }

              svg += `
                   <a href="/posts/${m.post.id}" target="_blank" style="cursor: pointer; pointer-events: all;" onclick="event.stopPropagation()">
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
        chartDiv.appendChild(mainWrapper);

        const style = document.createElement('style');
        style.textContent = `
        .month-column .column-overlay { transition: fill 0.2s; }
        .month-column:hover .column-overlay { fill: rgba(0, 123, 255, 0.05); }
        .month-column:hover .monthly-bar { fill: #216e39; }
        
        .star-shiny {
           font-size: 15px;
           stroke-width: 0.1px !important; 
           filter: drop-shadow(0 0 5px #ffd700);
        }
      `;
        chartDiv.appendChild(style);

        dashboardDiv.appendChild(chartDiv);

        // Scroll to end
        setTimeout(() => {
          if (chartWrapper) chartWrapper.scrollLeft = chartWrapper.scrollWidth;
        }, 100);

        // Auto-scroll to end (Recent)
        requestAnimationFrame(() => {
          chartWrapper.scrollLeft = chartWrapper.scrollWidth;
        });
      }

      // ========================================================
      // 4. Scatter Plot Widget (High Performance) (Pre-fetched)

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
              const bEl = b as HTMLElement;
              const isMe = bEl.textContent.includes(label);
              bEl.style.background = '#fff';
              bEl.style.color = '#333';
              if (isMe) {
                bEl.style.background = '#0969da';
                bEl.style.color = '#fff';
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
          if (popover.style.display !== 'none' && !popover.contains(e.target as Node)) {
            popover.style.display = 'none';
          }
        });

        const currentScale: any = {};

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
            ctx.fillText(String(val), padL - 5, y + 3);
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
                  ctx.fillText(String(y), xCenter, padT + drawH + 15);
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
                 <span style="width: 60px; color: #007bff; font-weight: 500; font-size: 13px; margin-right: 10px;">#${it.id}</span>
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
          const closeBtn = popover.querySelector('#scatter-pop-close') as HTMLElement;
          if (closeBtn) {
            closeBtn.onclick = (e) => {
              e.stopPropagation();
              popover.style.display = 'none';
            };
          }

          // Load More Handler
          const loadMoreContainer = popover.querySelector('#pop-load-more') as HTMLElement;
          const loadMoreBtn = popover.querySelector('#btn-load-more') as HTMLElement;
          const listContainer = popover.querySelector('#pop-list-container') as HTMLElement;
          const countLabel = popover.querySelector('#pop-count-label') as HTMLElement;

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
    } finally {
      this.isRendering = false;
    }
  }
}
