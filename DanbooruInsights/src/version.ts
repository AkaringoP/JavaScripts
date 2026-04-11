/**
 * Single source of truth for the userscript version. Imported by both
 * `vite.config.ts` (to fill the `@version` field in the userscript header)
 * and the runtime UI (the dashboard footer credit line).
 *
 * Bump this when releasing a new version — nothing else needs to change.
 */
export const APP_VERSION = '9.0.0';

/** GitHub repository URL shown next to the version in the dashboard footer. */
export const APP_REPO_URL = 'https://github.com/AkaringoP/JavaScripts';

/** Author credit shown in the dashboard footer. */
export const APP_AUTHOR = 'AkaringoP';
