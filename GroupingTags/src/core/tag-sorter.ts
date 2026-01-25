/**
 * @fileoverview Logic for sorting grouped tags with Character priority.
 */

// Cache for Character Tags to avoid repeated fetch
const characterTagCache: {[postId: number]: Set<string>} = {};

/**
 * Sorts tags within each group in place.
 *
 * **Sorting Logic**:
 * 1. **Character Tags**: Tags listed in `tag_string_character` metadata appear first.
 * 2. **Alphabetical**: Remaining tags are sorted alphanumerically.
 *
 * This ensures that critical character tags (like names) are always visible at the start of a group.
 * A local cache is used to prevent redundant network requests for the same post.
 *
 * @param groups - The grouping object to sort (modified in place).
 *                 Keys are group names, values are arrays of tag strings.
 * @param postId - The ID of the current post (used to fetch metadata).
 * @returns A promise that resolves when sorting is complete.
 */
export async function sortGroupTags(
  groups: {[key: string]: string[]},
  postId: number,
): Promise<void> {
  if (!postId) return;

  let characterTags = characterTagCache[postId];

  // If not cached, fetch it
  if (!characterTags) {
    try {
      const resp = await fetch(`/posts/${postId}.json`);
      if (resp.ok) {
        const data = await resp.json();
        const postData = data.post || data;
        const rawCharString = postData.tag_string_character || '';

        characterTags = new Set(
          (rawCharString.split(/\s+/) || [])
            .map((t: string) => t.trim())
            .filter((t: string) => t.length > 0),
        );

        // Cache it
        characterTagCache[postId] = characterTags;
      }
    } catch (e) {
      console.warn(
        'GroupingTags: Failed to fetch post data for sorting. Falling back to simple alpha sort.',
        e,
      );
      characterTags = new Set();
    }
  }

  // Perform Sort
  Object.keys(groups).forEach(gName => {
    groups[gName].sort((a, b) => {
      const cleanA = a.trim();
      const cleanB = b.trim();
      const isCharA = characterTags?.has(cleanA) || false;
      const isCharB = characterTags?.has(cleanB) || false;

      if (isCharA && !isCharB) return -1;
      if (!isCharA && isCharB) return 1;
      return cleanA.localeCompare(cleanB);
    });
  });
}
