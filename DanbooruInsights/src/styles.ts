/**
 * Centralized CSS styles for Danbooru Insights to prevent duplicate injection
 * and improve performance by utilizing CSS classes and pseudo-classes.
 */
export const GLOBAL_CSS = `
    /* -- Animations & Base -- */
    @keyframes di-slide-in-out-a {
        0%, 28% { transform: translateX(0); opacity: 1; }
        33% { transform: translateX(-20px); opacity: 0; }
        35%, 95% { transform: translateX(20px); opacity: 0; }
        100% { transform: translateX(0); opacity: 1; }
    }
    @keyframes di-slide-in-out-b {
        0%, 28% { transform: translateX(20px); opacity: 0; }
        33%, 61% { transform: translateX(0); opacity: 1; }
        66% { transform: translateX(-20px); opacity: 0; }
        68%, 100% { transform: translateX(20px); opacity: 0; }
    }
    @keyframes di-slide-in-out-c {
        0%, 61% { transform: translateX(20px); opacity: 0; }
        66%, 95% { transform: translateX(0); opacity: 1; }
        100% { transform: translateX(-20px); opacity: 0; }
    }

    /* -- UserAnalyticsApp Modal & Button -- */
    #danbooru-grass-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      height: 100dvh;
      background: rgba(0, 0, 0, 0.4);
      z-index: 10000;
      display: none;
      justify-content: center;
      align-items: center;
      backdrop-filter: blur(2px);
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    #danbooru-grass-modal-overlay.visible {
      display: flex;
      opacity: 1;
    }
    /* TagAnalytics modal uses dvh for mobile URL bar handling */
    #tag-analytics-modal {
      height: 100vh !important;
      height: 100dvh !important;
    }
    #danbooru-grass-modal-window {
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
    #danbooru-grass-modal-close {
      position: absolute;
      top: 15px;
      right: 20px;
      font-size: 24px;
      cursor: pointer;
      color: #666;
      z-index: 10;
      line-height: 1;
    }
    #danbooru-grass-modal-close:hover {
      color: #000;
    }
    #danbooru-grass-modal-content {
      padding: 40px;
      overflow-y: auto;
      flex: 1;
    }
    .di-analytics-entry-btn {
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
    .di-analytics-entry-btn:hover {
      background: rgba(128,128,128,0.2);
    }

    /* -- User History timeline: discoverability for scrollable overflow --
       Two-layer approach:
       1. Slim always-visible scrollbar (works on Chrome/Firefox where custom
          ::-webkit-scrollbar disables overlay auto-hide).
       2. Bottom fade gradient (reliable fallback for Safari/macOS where
          overlay scrollbars auto-hide regardless of custom styles).
       The fade is only shown when the has-overflow class is set via JS after
       measuring scrollHeight, so it doesn't clutter the UI when there's
       nothing to scroll. */
    .di-user-history-timeline {
      scrollbar-width: thin;
      scrollbar-color: #bbb transparent;
    }
    .di-user-history-timeline::-webkit-scrollbar {
      width: 8px;
    }
    .di-user-history-timeline::-webkit-scrollbar-track {
      background: transparent;
    }
    .di-user-history-timeline::-webkit-scrollbar-thumb {
      background: #ccc;
      border-radius: 4px;
    }
    .di-user-history-timeline:hover::-webkit-scrollbar-thumb {
      background: #999;
    }
    .di-user-history-wrap {
      position: relative;
    }
    .di-user-history-wrap.has-overflow::after {
      content: '';
      position: absolute;
      left: 14px;
      right: 8px;
      bottom: 0;
      height: 14px;
      background: linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.95) 100%);
      pointer-events: none;
    }
    .di-user-history-wrap.has-overflow.scrolled-to-bottom::after {
      opacity: 0;
      transition: opacity 0.15s ease;
    }

    /* -- Spinner -- */
    .di-spinner {
        width: 50px;
        height: 50px;
        border: 5px solid #f3f3f3;
        border-top: 5px solid #0969da;
        border-radius: 50%;
        animation: di-spin 1s linear infinite;
    }
    @keyframes di-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }

    /* -- Animated Summary Card -- */
    .di-upload-card-pane {
        animation-duration: 15s;
        animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
        animation-iteration-count: infinite;
    }
    #danbooru-insights-upload-card.paused .di-upload-card-pane {
        animation-play-state: paused;
    }
    .di-play-pause-btn {
        position: absolute;
        top: 10px;
        right: 10px;
        background: none;
        border: none;
        cursor: pointer;
        opacity: 0.5;
        transition: opacity 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
        border-radius: 4px;
    }
    .di-play-pause-btn:hover {
        opacity: 1;
        background-color: #f0f0f0;
    }

    /* -- Pie Chart Tabs -- */
    .di-pie-tab {
        background: #eee;
        color: #555;
        border: none;
        padding: 2px 10px;
        border-radius: 12px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s;
    }
    .di-pie-tab:hover { background: #ddd; }
    .di-pie-tab.active { background: #555; color: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
    .di-pie-tab:not(.active):hover { background: #ddd; }

    /* -- User Rankings (Tag Analytics) -- */
    .di-ranking-username:hover { font-weight: bold; }
    .user-admin { color: #ed2426; } .user-admin:hover { color: #ff5a5b; }
    .user-moderator { color: #00ab2c; } .user-moderator:hover { color: #35c64a; }
    .user-builder { color: #a800aa; } .user-builder:hover { color: #d700d9; }
    .user-platinum { color: #777892; } .user-platinum:hover { color: #9192a7; }
    .user-gold { color: #fd9200; } .user-gold:hover { color: #ffc5a5; }
    .user-member { color: #0075f8; } .user-member:hover { color: #5091fa; }
    .user-janitor { color: #000; } .user-janitor:hover { color: #555; }

    /* -- Hover Utilities -- */
    .di-hover-translate-up { transition: transform 0.2s; }

    .di-hover-scale { transition: transform 0.2s; }

    .di-hover-underline { text-decoration: none; }

    .di-hover-text-primary { transition: color 0.2s; }

    /* -- Layout Utilities -- */
    .di-card { background: #f9f9f9; padding: 15px; border-radius: 8px; }
    .di-card-sm { background: #f9f9f9; padding: 10px; border-radius: 6px; border: 1px solid #eee; }
    .di-flex-col-between { display: flex; flex-direction: column; justify-content: space-between; }
    .di-flex-row-between { display: flex; justify-content: space-between; align-items: center; }
    .di-flex-center { display: flex; justify-content: center; align-items: center; }

    /* -- Tag Cloud Widget -- */
    .di-tag-cloud-word {
        cursor: pointer;
        transition: opacity 0.2s, font-size 0.15s ease;
    }
    .di-tag-cloud-container {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 200px;
    }
    .di-tag-cloud-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.75em;
        color: #888;
        padding-top: 8px;
        border-top: 1px solid #eee;
    }

    /* -- Created Tags Widget -- */
    .di-created-tags-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.85em;
    }
    .di-created-tags-table th {
        text-align: left;
        color: #666;
        font-weight: 600;
        padding: 6px 8px;
        border-bottom: 2px solid #e1e4e8;
        font-size: 0.85em;
        text-transform: uppercase;
        letter-spacing: 0.3px;
    }
    .di-created-tags-table td {
        padding: 5px 8px;
        border-bottom: 1px solid #f0f0f0;
    }
    .di-created-tags-row:hover {
        background: #f6f8fa;
    }
    .di-created-tags-row a {
        text-decoration: none;
    }
    .di-created-tags-row a:hover {
        text-decoration: underline;
    }
    .di-created-tags-status {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-size: 0.85em;
        padding: 1px 6px;
        border-radius: 8px;
    }

    /* -- User Analytics Charts -- */
    .month-column .column-overlay { transition: fill 0.2s; }
    .star-shiny {
        font-size: 15px;
        stroke-width: 0.1px !important;
        filter: drop-shadow(0 0 5px #ffd700);
    }

    /* ===== Mobile Responsive ===== */

    @media (max-width: 768px) {
      #danbooru-grass-modal-window {
        width: 100% !important;
        height: 100% !important;
        max-width: none !important;
        border-radius: 0 !important;
      }
      #danbooru-grass-modal-content {
        padding: 20px !important;
        overflow-y: auto !important;
        -webkit-overflow-scrolling: touch !important;
      }
      #tag-analytics-modal > div {
        width: 100% !important;
        height: 100% !important;
        max-width: none !important;
        max-height: 100vh !important;
        border-radius: 0 !important;
      }
      #tag-analytics-content {
        padding-top: 50px !important;
      }

      /* Phase 2: Pie chart + legend vertical */
      .pie-content {
        flex-direction: column !important;
        align-items: center !important;
        justify-content: center !important;
      }
      .danbooru-grass-legend-scroll {
        margin-left: 0 !important;
        margin-top: 10px !important;
        width: 100% !important;
      }

      /* Phase 2: Summary cards single column */
      .di-summary-grid {
        grid-template-columns: 1fr !important;
      }

      /* Phase 2: Upload card inner vertical stack */
      .di-upload-card-inner {
        flex-direction: column !important;
      }

      /* Phase 2: Timeline row word wrap */
      .di-timeline-row {
        white-space: normal !important;
        word-break: break-word !important;
      }

      /* Phase 2: Top posts vertical layout */
      .di-top-post-layout {
        flex-direction: column !important;
        align-items: center !important;
      }
      .di-top-post-thumb {
        width: 120px !important;
        height: 120px !important;
      }

      /* Phase 2: Tag analytics header wrap */
      .di-tag-header {
        flex-direction: column !important;
        align-items: flex-start !important;
        gap: 10px !important;
      }

      /* Phase 2: Trending thumbnails smaller (exclude milestone cards) */
      .di-nsfw-monitor:not(.di-milestone-card) {
        width: 60px !important;
      }

      /* Phase 2: Scatter plot controls unstacked */
      .di-scatter-toggle {
        position: static !important;
        margin-bottom: 5px !important;
      }
      .di-scatter-filter {
        position: static !important;
        width: fit-content !important;
        margin: 5px 0 5px auto !important;
      }

      /* Phase 3: Rankings horizontal swipe */
      #ranking-container {
        display: flex !important;
        overflow-x: auto !important;
        scroll-snap-type: x mandatory !important;
        -webkit-overflow-scrolling: touch !important;
      }
      #ranking-container > .di-card-sm {
        scroll-snap-align: start !important;
        min-width: calc(100vw - 80px) !important;
        flex-shrink: 0 !important;
      }

      /* Phase 4: Created tags table scroll */
      .di-created-tags-wrap {
        overflow-x: auto !important;
      }

      /* Phase 4: Grass handles hide on mobile */
      .di-grass-handle {
        display: none !important;
      }

      /* Phase 4: Settings flyout reposition */
      #danbooru-grass-flyout {
        left: auto !important;
        right: 10px !important;
        max-width: calc(100vw - 20px) !important;
      }

      /* Fix 11: Modal content no horizontal scroll */
      #danbooru-grass-modal-content {
        overflow-x: hidden !important;
      }
      #tag-analytics-content {
        overflow-x: hidden !important;
      }

      /* Fix 4: UserAnalytics header controls wrap */
      #analytics-header-controls {
        flex-direction: column !important;
        align-items: flex-end !important;
        gap: 8px !important;
      }

      /* Fix 1: TagAnalytics header icons spacing */
      .di-tag-header span {
        flex-wrap: wrap !important;
      }
      #tag-settings-anchor {
        margin-left: 10px !important;
      }

      /* Fix: TagAnalytics close button position (avoid status bar) */
      #tag-analytics-close {
        top: 15px !important;
        right: 15px !important;
        font-size: 1.8rem !important;
        min-width: 44px;
        min-height: 44px;
      }

      /* Fix 2: TagAnalytics milestones grid - 2 columns on mobile */
      .milestones-grid {
        grid-template-columns: repeat(2, 1fr) !important;
      }

      /* Fix 10: Created Tags pagination wrap */
      .di-created-tags-wrap > div:last-child {
        flex-wrap: wrap !important;
        justify-content: center !important;
      }
    }

    @media (hover: hover) {
      .di-hover-translate-up:hover { transform: translateY(-3px) !important; }
      .di-hover-scale:hover { transform: scale(1.02) !important; }
      .di-hover-underline:hover { text-decoration: underline !important; }
      .di-hover-text-primary:hover { color: #007bff !important; }
      .month-column:hover .column-overlay { fill: rgba(0, 123, 255, 0.05); }
      .month-column:hover .monthly-bar { fill: #216e39; }
    }

    @media (pointer: coarse) {
      .di-pie-tab {
        padding: 6px 12px;
        font-size: 13px;
        min-height: 36px;
      }
      #danbooru-grass-modal-close,
      #tag-analytics-close {
        font-size: 28px;
        min-width: 44px;
        min-height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .top-post-tab {
        padding: 4px 10px;
        font-size: 12px;
      }
    }
  `;

/**
 * Injects the global stylesheet into the document head exactly once.
 */
export function injectGlobalStyles() {
  if (document.getElementById('danbooru-insights-global-css')) return;
  const style = document.createElement('style');
  style.id = 'danbooru-insights-global-css';
  style.textContent = GLOBAL_CSS;
  document.head.appendChild(style);
}
