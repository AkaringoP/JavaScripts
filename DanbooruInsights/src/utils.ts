import type {RateLimitedFetch} from './core/rate-limiter';

/* --- Helper: HTML Escaping --- */
/**
 * Escapes HTML special characters to prevent XSS when inserting into innerHTML.
 * @param {string} text The text to escape.
 * @return {string} The escaped HTML-safe string.
 */
export function escapeHtml(text: string): string {
  const el = document.createElement('div');
  el.textContent = text;
  return el.innerHTML;
}

/* --- Helper: Tag Utility --- */
/**
 * Checks whether a tag is top-level (not a sub-tag) by querying its implications.
 * A tag that has antecedent implications (i.e., it implies something else) is a sub-tag.
 * @param {RateLimitedFetch} rateLimiter
 * @param {string} tagName Exact tag name (underscored).
 * @return {Promise<boolean>} True if top-level, false if sub-tag.
 */
export async function isTopLevelTag(
  rateLimiter: RateLimitedFetch,
  tagName: string
): Promise<boolean> {
  const impUrl = `/tag_implications.json?search[antecedent_name_matches]=${encodeURIComponent(tagName)}`;
  try {
    const imps = await rateLimiter.fetch(impUrl).then(r => r.json());
    return !(Array.isArray(imps) && imps.length > 0);
  } catch (e: unknown) {
    return true; // default to include on error
  }
}
