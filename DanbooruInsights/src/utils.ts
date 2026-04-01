import type {PostVariant} from './types';
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
/**
 * Returns the CSS class name for a Danbooru user level string.
 * Maps level strings (e.g., "Gold", "Moderator") to Danbooru's user-* CSS classes.
 */
export function getLevelClass(level: string | null): string {
  if (!level) return 'user-member';
  const l = level.toLowerCase();
  if (l.includes('admin') || l.includes('owner')) return 'user-admin';
  if (l.includes('moderator')) return 'user-moderator';
  if (l.includes('builder') || l.includes('contributor') || l.includes('approver')) return 'user-builder';
  if (l.includes('platinum')) return 'user-platinum';
  if (l.includes('gold')) return 'user-gold';
  if (l.includes('janitor')) return 'user-janitor';
  if (l.includes('member')) return 'user-member';
  return 'user-member';
}

/**
 * Returns the best available thumbnail URL from a Danbooru post object.
 * Priority: 720x720 webp > 360x360 webp > other variants > preview > file.
 */
export function getBestThumbnailUrl(post: any): string {
  if (!post) return '';

  // 1. Try modern variants
  if (post.variants && Array.isArray(post.variants) && post.variants.length > 0) {
    const preferredTypes = ['720x720', '360x360'];
    // 1a. Try preferred variants in WebP
    for (const type of preferredTypes) {
      const variant = post.variants.find((v: PostVariant) => v.type === type && v.file_ext === 'webp');
      if (variant) return variant.url;
    }
    // 1b. Try preferred variants in any format
    for (const type of preferredTypes) {
      const variant = post.variants.find((v: PostVariant) => v.type === type);
      if (variant) return variant.url;
    }
    // 1c. Last resort: any variant
    if (post.variants[0] && post.variants[0].url) return post.variants[0].url;
  }

  // 2. Fallback to legacy fields
  return post.preview_file_url || post.file_url || post.large_file_url || '';
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
