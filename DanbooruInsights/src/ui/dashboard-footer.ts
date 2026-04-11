import {APP_VERSION, APP_REPO_URL, APP_AUTHOR} from '../version';

/**
 * Returns the HTML markup for the small credit footer shown at the bottom
 * of both UserAnalyticsApp and TagAnalyticsApp dashboards. Kept as a single
 * helper so any tweak (wording, link, styling) propagates to both apps.
 */
export function dashboardFooterHtml(): string {
  return `
    <div class="di-dashboard-footer" style="
      margin-top: 30px;
      padding: 16px 0 8px;
      border-top: 1px solid #eee;
      text-align: center;
      font-size: 11px;
      color: #888;
      line-height: 1.5;
    ">
      <a href="${APP_REPO_URL}" target="_blank" rel="noopener" style="color: #888; text-decoration: none;">
        DanbooruInsights v${APP_VERSION}
      </a>
      <span style="margin: 0 6px; opacity: 0.6;">·</span>
      <span>made by ${APP_AUTHOR}</span>
    </div>
  `;
}
