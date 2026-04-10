import {CONFIG} from '../config';
import {AnalyticsDataManager} from '../core/analytics-data-manager';
import {RateLimitedFetch} from '../core/rate-limiter';
import {SettingsManager} from '../core/settings';
import {UserAnalyticsDataService} from './user-analytics-data';
import {getLevelClass} from '../utils';
import {renderPieWidget, renderTopPostsWidget, renderMilestonesWidget, renderHistoryChart} from './user-analytics-charts';
import {renderScatterPlot} from './user-analytics-scatter';
import {renderTagCloudWidget} from './tag-cloud-widget';
import {renderCreatedTagsWidget} from './created-tags-widget';
import type {Database} from '../core/database';
import type {ProfileContext} from '../core/profile-context';

/** ProfileContext with a guaranteed non-null targetUser (post-validation). */
type ValidatedProfileContext = ProfileContext & {
  targetUser: NonNullable<ProfileContext['targetUser']>;
};

export class UserAnalyticsApp {
  db: Database;
  settings: SettingsManager;
  context: ValidatedProfileContext;
  rateLimiter: RateLimitedFetch;
  dataManager: AnalyticsDataManager;
  dataService: UserAnalyticsDataService;
  modalId: string;
  btnId: string;
  isFullySynced: boolean;
  isRendering: boolean;

  /**
   * Initializes the UserAnalyticsApp.
   * @param {Database} db The Dexie database instance.
   * @param {Object} settings The settings manager.
   * @param {ProfileContext} context The profile context.
   */
  constructor(db: Database, settings: SettingsManager, context: ProfileContext, rateLimiter?: RateLimitedFetch) {
    this.db = db;
    this.settings = settings;
    this.context = context as ValidatedProfileContext;
    const rl = CONFIG.RATE_LIMITER;
    this.rateLimiter = rateLimiter ?? new RateLimitedFetch(rl.concurrency, rl.jitter, rl.rps);

    this.dataManager = new AnalyticsDataManager(db, this.rateLimiter);
    this.dataService = new UserAnalyticsDataService(db);

    this.modalId = 'danbooru-grass-modal';
    this.btnId = 'danbooru-grass-analytics-btn';

    this.isFullySynced = false;
    this.isRendering = false;
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

    // Close on Escape key
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && overlay.classList.contains('visible')) {
        this.toggleModal(false);
      }
    });

    // Close on browser back button (mobile-friendly)
    window.addEventListener('popstate', () => {
      if (overlay.classList.contains('visible') && history.state?.diModalOpen !== this.modalId) {
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
      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-label', 'Open user analytics report');
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

    const onProgress = (current: number, total: number, msg?: string) => {
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
      const MAX_QUICK_SYNC_POSTS = CONFIG.MAX_OPTIMIZED_POSTS;
      const syncTotal = await this.dataManager.getTotalPostCount(this.context.targetUser);
      if (syncTotal > 0 && syncTotal <= MAX_QUICK_SYNC_POSTS) {
        await this.dataManager.quickSyncAllPosts(this.context.targetUser, onProgress);
      } else {
        await this.dataManager.syncAllPosts(this.context.targetUser, onProgress);
      }

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
  async updateHeaderStatus(progressText: string | null = null, customColor: string | null = null) {
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
  showSyncSettingsPopover(target: HTMLElement) {
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
    const closeHandler = (e: MouseEvent) => {
      if (!popover.contains(e.target as Node) && e.target !== target) {
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
  toggleModal(show: boolean) {
    const overlay = document.getElementById(`${this.modalId}-overlay`);
    if (!overlay) return;

    if (show) {
      // Push history state for back button support
      if (history.state?.diModalOpen !== this.modalId) {
        history.pushState({diModalOpen: this.modalId}, '', location.href);
      }

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
      // If history state still belongs to us, route through history.back()
      // so the URL stays in sync. The popstate listener will re-enter this
      // branch with state cleared and run the actual hide logic.
      if (history.state?.diModalOpen === this.modalId) {
        history.back();
        return;
      }

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
  showSubModal(title: string, contentHtml: string, helpHtml: string | null = null) {
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

      // Quick Sync Pre-Check: If total posts ≤ MAX_QUICK_SYNC_POSTS and DB is incomplete,
      // fetch all posts inline (no sync UI required) before rendering the dashboard.
      const MAX_QUICK_SYNC_POSTS = CONFIG.MAX_OPTIMIZED_POSTS;
      {
        const [preStats, preTotal] = await Promise.all([
          this.dataManager.getSyncStats(this.context.targetUser),
          this.dataManager.getTotalPostCount(this.context.targetUser)
        ]);

        if (preTotal > 0 && preTotal <= MAX_QUICK_SYNC_POSTS && preStats.count < preTotal) {
          content.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:100px 0; color:#555;">
              <div class="di-spinner"></div>
              <div style="font-size:1.2em; font-weight:600; margin-top:20px;">Syncing Data...</div>
              <div id="analytics-quick-sync-msg" style="font-size:0.9em; color:#888; margin-top:10px;">Fetching posts...</div>
              <div style="width:300px; height:8px; background:#e1e4e8; border-radius:4px; overflow:hidden; margin-top:15px;">
                <div id="analytics-quick-sync-bar" style="width:0%; height:100%; background:#2da44e; transition:width 0.2s;"></div>
              </div>
            </div>
          `;

          const qBar = content.querySelector('#analytics-quick-sync-bar') as HTMLElement;
          const qMsg = content.querySelector('#analytics-quick-sync-msg') as HTMLElement;

          await this.dataManager.quickSyncAllPosts(this.context.targetUser, (c: number, t: number, msg?: string) => {
            if (qBar && t > 0) qBar.style.width = `${Math.round((c / t) * 100)}%`;
            if (qMsg && msg && msg !== 'PREPARING') qMsg.textContent = msg;
          });

          this.isFullySynced = true;
          this.updateHeaderStatus();

          // Restore loading spinner before heavy data fetch
          content.innerHTML = `
            <div id="analytics-loading-report" style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:100px 0; color:#555;">
               <div class="di-spinner"></div>
               <div style="font-size:1.2em; font-weight:600; margin-top: 20px;">Generating Report...</div>
               <div style="font-size:0.9em; color:#888; margin-top:10px;">Analyzing contributions and trends</div>
            </div>
          `;
        }
      }

      // Pre-fetch all data!
      const dashboardData = await this.dataService.fetchDashboardData(this.context);
      const { stats, total, summaryStats, distributions, topPosts, recentPopularPosts, randomPosts, milestones1k, scatterData, levelChanges, timelineMilestones, tagCloudGeneral } = dashboardData;
      const { maxUploads, maxDate, firstUploadDate, lastUploadDate } = summaryStats;
      const today = new Date();
      const oneDay = 1000 * 60 * 60 * 24;

      // 1. Header (Flexbox)
      // NSFW State
      const nsfwKey = 'danbooru_grass_nsfw_enabled';
      let isNsfwEnabled = localStorage.getItem(nsfwKey) === 'true';
      let applyNsfwUpdate: (() => Promise<void>) | null = null;

      // 1. Header (Flexbox with Refresh Button)
      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'flex-start';
      header.style.marginBottom = '25px'; // Increased Spacing
      header.innerHTML = `
      <div>
         <h2 style="margin-top:0; color:#333; margin-bottom:4px;">Analytics Dashboard</h2>
         <p style="color:#555; margin:0;">Detailed statistics and history for <span class="${getLevelClass(this.context.targetUser.level_string)}">${this.context.targetUser.name}</span></p>
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

            // Delegate all NSFW updates to the combined callback wired up after widget init
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
            dBtn.parentNode?.appendChild(bubble);

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

          await this.dataManager.syncAllPosts(this.context.targetUser, () => {}); // No-op: internal broadcast handles progress

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
      summaryWrapper.className = 'di-summary-grid';
      summaryWrapper.style.display = 'grid';
      summaryWrapper.style.gridTemplateColumns = 'repeat(auto-fit, minmax(300px, 1fr))';
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
      const makeCard = (title: string, val: string | number, icon: string, details: string = '') => `
          <div style="background:#fff; border:1px solid #e1e4e8; border-radius:8px; padding:15px; display:flex; align-items:flex-start;">
             <div style="font-size:2em; margin-right:15px; margin-top:5px;">${icon}</div>
             <div style="flex:1; min-width:0;">
                <div style="font-size:0.85em; color:#666; text-transform:uppercase; letter-spacing:0.5px;">${title}</div>
                ${val ? `<div style="font-size:1.5em; font-weight:bold; color:#333;">${val}</div>` : ''}
                ${details ? `<div style="font-size:0.85em; color:#555;">${details}</div>` : ''}
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
                        <div class="di-upload-card-inner" style="display:flex; align-items:center; gap:12px;">
                            <div style="font-size:1.5em; font-weight:bold; color:#333;">${stats.count.toLocaleString()}</div>
                            <div style="font-size:0.85em; color:#555;">${uploadDetailsAll}</div>
                        </div>
                     </div>

                     <!-- Last 1 Year Pane -->
                     <div class="di-upload-card-pane" style="grid-area: 1 / 1; animation-name: di-slide-in-out-b;">
                        <div style="font-size:0.85em; color:#666; text-transform:uppercase; letter-spacing:0.5px;">LAST 1 YEAR</div>
                        <div class="di-upload-card-inner" style="display:flex; align-items:center; gap:12px;">
                            <div style="font-size:1.5em; font-weight:bold; color:#333;">${(count1Year || 0).toLocaleString()}</div>
                            <div style="font-size:0.85em; color:#555;">${uploadDetails1Year}</div>
                        </div>
                     </div>
                     
                     <!-- Consistency Pane -->
                     <div class="di-upload-card-pane" style="grid-area: 1 / 1; animation-name: di-slide-in-out-c;">
                        <div style="font-size:0.85em; color:#666; text-transform:uppercase; letter-spacing:0.5px;">UPLOAD HABITS</div>
                        <div class="di-upload-card-inner" style="display:flex; align-items:center; gap:12px;">
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

      // Build timeline events (all types merged, sorted by date ASC)
      interface TimelineEvent {
        date: Date;
        icon: string;
        html: string;
      }
      const tlEvents: TimelineEvent[] = [];

      // Join
      if (this.context.targetUser.created_at) {
        const joinDate = new Date(this.context.targetUser.created_at);
        tlEvents.push({
          date: joinDate,
          icon: '🎊',
          html: `🎊 <strong>Join:</strong> ${daysSinceJoin.toLocaleString()} days ago <span style="color:#888;">(${joinDateStr})</span>`
        });
      }

      // 1st Post
      if (firstUploadDate) {
        tlEvents.push({
          date: firstUploadDate,
          icon: '🚀',
          html: `🚀 <strong>1st Post:</strong> ${daysSinceFirst.toLocaleString()} days ago <span style="color:#888;">(${firstUploadDateStr})</span>`
        });
      }

      // Timeline milestones (100th, 1000th, 10000th, ...)
      const milestoneIcons: Record<number, string> = {100: '💯'};
      timelineMilestones.forEach(m => {
        const icon = milestoneIcons[m.index] ?? '🏅';
        const label = `${m.index.toLocaleString()}th Post`;
        const dateStr = m.date.toISOString().split('T')[0];
        const daysAgo = Math.floor((today.getTime() - m.date.getTime()) / oneDay);
        tlEvents.push({
          date: m.date,
          icon,
          html: `${icon} <strong>${label}:</strong> ${daysAgo.toLocaleString()} days ago <span style="color:#888;">(${dateStr})</span>`
        });
      });

      // Level changes
      levelChanges.forEach(lc => {
        const icon = lc.isPromotion ? '⬆️' : '⬇️';
        const dateStr = lc.date.toISOString().split('T')[0];
        const daysAgo = Math.floor((today.getTime() - lc.date.getTime()) / oneDay);
        const fromLevelClass = getLevelClass(lc.fromLevel);
        const toLevelClass = getLevelClass(lc.toLevel);
        tlEvents.push({
          date: lc.date,
          icon,
          html: `${icon} <strong class="${fromLevelClass}">${lc.fromLevel}</strong> → <strong class="${toLevelClass}">${lc.toLevel}</strong> ${daysAgo.toLocaleString()} days ago <span style="color:#888;">(${dateStr})</span>`
        });
      });

      // Latest Post (with total post count as Nth)
      if (lastUploadDate) {
        const daysAgoLast = Math.floor((today.getTime() - lastUploadDate.getTime()) / oneDay);
        const latestLabel = total > 0 ? `${total.toLocaleString()}th Post` : 'Latest Post';
        tlEvents.push({
          date: lastUploadDate,
          icon: '📌',
          html: `📌 <strong>${latestLabel}:</strong> ${daysAgoLast.toLocaleString()} days ago <span style="color:#888;">(${lastDate})</span>`
        });
      }

      // Sort by date ASC
      tlEvents.sort((a, b) => a.date.getTime() - b.date.getTime());

      const timelineRows = tlEvents.map(ev =>
        `<div class="di-timeline-row" style="white-space:nowrap;">${ev.html}</div>`
      ).join('');

      // Details for Card 2 — scrollable timeline (3 rows visible by default).
      // Discoverability for overflowing rows uses two layers:
      //   1. `di-user-history-timeline` — slim custom scrollbar (Chrome/Firefox).
      //   2. `di-user-history-wrap` + `has-overflow` class — bottom fade gradient
      //      for macOS Safari where overlay scrollbars auto-hide regardless of
      //      custom ::-webkit-scrollbar styles.
      // The has-overflow class is toggled below after the element is in the DOM
      // so scrollHeight can be measured.
      const dateDetails = `
       <div class="di-user-history-wrap">
         <div class="di-user-history-timeline" style="display:flex; flex-direction:column; gap:4px; border-left:2px solid #eee; padding-left:12px; max-height:66px; overflow-y:auto;">
             ${timelineRows}
         </div>
       </div>
    `;

      summaryWrapper.innerHTML += makeCard('User History', '', '📅', dateDetails);

      dashboardDiv.appendChild(summaryWrapper);

      // Toggle `.has-overflow` on the wrap so the bottom fade gradient only
      // shows when there's actually more content below the fold. Also hide
      // the fade when the user has scrolled to the bottom.
      const historyTimeline = dashboardDiv.querySelector('.di-user-history-timeline') as HTMLElement | null;
      const historyWrap = historyTimeline?.parentElement as HTMLElement | null;
      if (historyTimeline && historyWrap) {
        if (historyTimeline.scrollHeight > historyTimeline.clientHeight + 1) {
          historyWrap.classList.add('has-overflow');
          historyTimeline.addEventListener('scroll', () => {
            const atBottom = historyTimeline.scrollTop + historyTimeline.clientHeight >= historyTimeline.scrollHeight - 1;
            historyWrap.classList.toggle('scrolled-to-bottom', atBottom);
          });
        }
      }

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

      // --- PIE CHART WIDGET ---
      const pieResult = renderPieWidget(pieContainer, distributions, isNsfwEnabled, this.dataManager, this.context, firstUploadDate);

      // --- TOP POSTS WIDGET ---
      const topPostsResult = renderTopPostsWidget(topPostContainer, topPosts, recentPopularPosts, randomPosts, isNsfwEnabled, this.db, this.context);

      topStatsRow.appendChild(pieContainer);
      topStatsRow.appendChild(topPostContainer);
      dashboardDiv.appendChild(topStatsRow);
      content.appendChild(dashboardDiv);

      // 3. Milestones Widget
      const milestonesDiv = document.createElement('div');
      milestonesDiv.style.marginTop = '20px';
      dashboardDiv.appendChild(milestonesDiv);

      const milestonesResult = await renderMilestonesWidget(milestonesDiv, this.db, this.context, isNsfwEnabled);

      // Wire up NSFW toggle to delegate to all widget callbacks
      applyNsfwUpdate = async () => {
        pieResult.onNsfwChange(isNsfwEnabled);
        topPostsResult.onNsfwChange(isNsfwEnabled);
        await milestonesResult.onNsfwChange(isNsfwEnabled);
      };

      // 4. Monthly Activity Chart
      await renderHistoryChart(dashboardDiv, this.db, this.context, milestones1k, levelChanges);

      // 5. Created Tags Widget (lazy load) — after Monthly Activity
      const createdTagsContainer = document.createElement('div');
      createdTagsContainer.style.marginTop = '35px';
      dashboardDiv.appendChild(createdTagsContainer);
      renderCreatedTagsWidget(createdTagsContainer, this.dataManager, this.context.targetUser);

      // 6. Tag Cloud Widget
      const tagCloudContainer = document.createElement('div');
      tagCloudContainer.style.marginTop = '35px';
      dashboardDiv.appendChild(tagCloudContainer);
      renderTagCloudWidget(tagCloudContainer, {
        initialData: tagCloudGeneral,
        fetchData: (catId: number) => this.dataManager.getTagCloudData(
          this.context.targetUser, catId
        ),
        userName: this.context.targetUser.normalizedName,
        categories: [
          {id: 0, label: 'General', color: '#0075f8'},
          {id: 1, label: 'Artist', color: '#a00'},
          {id: 3, label: 'Copy', color: '#a800aa'},
          {id: 4, label: 'Char', color: '#00ab2c'},
        ],
      });

      // 6. Scatter Plot Widget
      if (scatterData.length > 0) {
        renderScatterPlot(dashboardDiv, scatterData, this.context, levelChanges);
      }



      // Update header status (ensure it's green if ready)
      this.updateHeaderStatus();
    } finally {
      this.isRendering = false;
    }
  }
}
