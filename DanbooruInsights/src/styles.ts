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

    /* -- Hover Utilities -- */
    .di-hover-translate-up { transition: transform 0.2s; }
    .di-hover-translate-up:hover { transform: translateY(-3px) !important; }

    .di-hover-scale { transition: transform 0.2s; }
    .di-hover-scale:hover { transform: scale(1.02) !important; }

    .di-hover-underline { text-decoration: none; }
    .di-hover-underline:hover { text-decoration: underline !important; }

    .di-hover-text-primary { transition: color 0.2s; }
    .di-hover-text-primary:hover { color: #007bff !important; }

    /* -- Layout Utilities -- */
    .di-card { background: #f9f9f9; padding: 15px; border-radius: 8px; }
    .di-card-sm { background: #f9f9f9; padding: 10px; border-radius: 6px; border: 1px solid #eee; }
    .di-flex-col-between { display: flex; flex-direction: column; justify-content: space-between; }
    .di-flex-row-between { display: flex; justify-content: space-between; align-items: center; }
    .di-flex-center { display: flex; justify-content: center; align-items: center; }
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
