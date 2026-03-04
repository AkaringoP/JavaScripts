/* --- Helper: Tag Utility --- */
/**
 * Checks whether a tag is top-level (not a sub-tag) by querying its implications.
 * A tag that has antecedent implications (i.e., it implies something else) is a sub-tag.
 * @param {RateLimitedFetch} rateLimiter
 * @param {string} tagName Exact tag name (underscored).
 * @return {Promise<boolean>} True if top-level, false if sub-tag.
 */
export async function isTopLevelTag(rateLimiter, tagName) {
  const impUrl = `/tag_implications.json?search[antecedent_name_matches]=${encodeURIComponent(tagName)}`;
  try {
    const imps = await rateLimiter.fetch(impUrl).then(r => r.json());
    return !(Array.isArray(imps) && imps.length > 0);
  } catch (e) {
    return true; // default to include on error
  }
}
