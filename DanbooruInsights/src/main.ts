import {CONFIG} from './config';
import {injectGlobalStyles} from './styles';
import {Database} from './core/database';
import {SettingsManager} from './core/settings';
import {RateLimitedFetch} from './core/rate-limiter';
import {TabCoordinator} from './core/tab-coordinator';
import {ProfileContext} from './core/profile-context';
import {GrassApp} from './apps/grass-app';
import {UserAnalyticsApp} from './apps/user-analytics-app';
import {TagAnalyticsApp} from './apps/tag-analytics-app';

// Reserved path segments that are not tag show pages
const WIKI_RESERVED = new Set(['search', 'show_or_new', 'new']);

/* --- Helper: Tag Detection --- */
/**
 * Detects the current tag name from the page URL.
 * Supports Wiki pages and Artist pages.
 * @return {string|null} The tag name, or null if not on a tag page.
 */
export function detectCurrentTag(): string | null {
  const path = window.location.pathname;

  // 1. Wiki Page: /wiki_pages/TAG_NAME (show page only)
  if (path.startsWith('/wiki_pages/')) {
    const segments = path.split('/').filter(s => s !== '');
    // Only /wiki_pages/TAG_NAME is valid (exactly 2 segments)
    if (segments.length !== 2) return null;
    const rawName = segments[1];
    // Exclude reserved action names
    if (WIKI_RESERVED.has(rawName)) return null;
    return decodeURIComponent(rawName);
  }

  // 2. Artist Page: /artists/NUMERIC_ID (show page only)
  if (path.startsWith('/artists/')) {
    const segments = path.split('/').filter(s => s !== '');
    // Only /artists/NUMERIC_ID is valid (exactly 2 segments, numeric ID)
    if (segments.length !== 2 || !/^\d+$/.test(segments[1])) return null;

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
  // Guard: skip non-Danbooru pages (nginx/CDN error pages like 429, 502, etc.)
  // Real Danbooru pages always have body classes (e.g., "c-users a-show").
  // Error pages served by nginx have a bare <body> with no classes.
  if (document.body.classList.length === 0) return;

  // Inject styles only on valid Danbooru pages
  injectGlobalStyles();

  // Shared Singletons
  const db = new Database();
  const settings = new SettingsManager();

  // Shared rate limiter — one per tab, coordinated across tabs
  const rl = CONFIG.RATE_LIMITER;
  const rateLimiter = new RateLimitedFetch(rl.concurrency, rl.jitter, rl.rps);

  // Cross-tab coordination
  const coordinator = new TabCoordinator();
  coordinator.onTabCountChange = (count) => {
    const rps = Math.max(1, Math.floor(rl.rps / count));
    const conc = Math.max(1, Math.floor(rl.concurrency / count));
    rateLimiter.updateLimits(rps, conc);
  };
  coordinator.onBackoffReceived = (until) => {
    rateLimiter.setBackoff(until);
  };
  rateLimiter.onBackoff = (until) => {
    coordinator.broadcastBackoff(until);
  };
  coordinator.start();

  // Routing
  const targetTagName = detectCurrentTag();

  if (targetTagName) {
    // Tag Analytics Mode (Wiki or Artist)
    const tagAnalytics = new TagAnalyticsApp(db, settings, targetTagName, rateLimiter);
    tagAnalytics.run();
  } else {
    // Profile Mode
    const context = new ProfileContext();
    if (!context.isValidProfile()) {
      return;
    }

    const grass = new GrassApp(db, settings, context, rateLimiter);
    const userAnalytics = new UserAnalyticsApp(db, settings, context, rateLimiter);

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
