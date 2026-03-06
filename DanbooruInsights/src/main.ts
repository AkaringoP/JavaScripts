import {injectGlobalStyles} from './styles';
import {Database} from './core/database';
import {SettingsManager} from './core/settings';
import {ProfileContext} from './core/profile-context';
import {GrassApp} from './apps/grass-app';
import {UserAnalyticsApp} from './apps/user-analytics-app';
import {TagAnalyticsApp} from './apps/tag-analytics-app';

// Inject exactly once on script execution
injectGlobalStyles();

/* --- Helper: Tag Detection --- */
/**
 * Detects the current tag name from the page URL.
 * Supports Wiki pages and Artist pages.
 * @return {string|null} The tag name, or null if not on a tag page.
 */
export function detectCurrentTag(): string | null {
  const path = window.location.pathname;

  // 1. Wiki Page: /wiki_pages/TAG_NAME
  if (path.startsWith('/wiki_pages/')) {
    const rawName = path.split('/').pop();
    if (!rawName) return null;
    return decodeURIComponent(rawName);
  }

  // 2. Artist Page: /artists/12345
  if (path.startsWith('/artists/')) {
    // 2a. Data Attribute (Primary)
    if (document.body.dataset.artistName) {
      return document.body.dataset.artistName;
    }

    // 2b. "View posts" Link (Fallback)
    const postLink = document.querySelector('a[href^="/posts?tags="]');
    if (postLink) {
      const urlParams = new URLSearchParams((postLink as HTMLAnchorElement).search);
      return urlParams.get('tags');
    }
  }

  return null;
}

/**
 * Main entry point for the script.
 * Initializes context, database, settings, and applications.
 */
async function main(): Promise<void> {
  // Shared Singletons
  const db = new Database();
  const settings = new SettingsManager();

  // Routing
  const targetTagName = detectCurrentTag();

  if (targetTagName) {
    // Tag Analytics Mode (Wiki or Artist)

    const tagAnalytics = new TagAnalyticsApp(db, settings, targetTagName);
    tagAnalytics.run();
  } else {
    // Profile Mode
    const context = new ProfileContext();
    if (!context.isValidProfile()) {

      return;
    }

    const grass = new GrassApp(db, settings, context);
    const userAnalytics = new UserAnalyticsApp(db, settings, context);

    // Execution
    grass.run();
    userAnalytics.run();
  }
}

// Run
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
