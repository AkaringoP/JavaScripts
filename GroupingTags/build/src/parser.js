/**
 * Parses text containing groupName[ tags ] syntax.
 * Returns the grouped tags and any remaining ungroupped tags.
 */
export const parseGroupedTags = (text) => {
    const groups = {};
    // Regex to find groupName[ tags ]
    // We use non-greedy matching.
    const groupRegex = /([^\s\[]+)\[\s*(.+?)\s*\]/g;
    // Use replace with a callback to remove groups from text AND extract data in one pass.
    const remainingText = text.replace(groupRegex, (match, groupName, tagsContent) => {
        const safeGroupName = groupName.trim();
        // Split and filter empty, then deduplicate within the group immediately using Set.
        // REMOVED .sort() to preserve original tag order (e.g. Danbooru's type-based order).
        const tags = Array.from(new Set(tagsContent.trim().split(/\s+/).filter((t) => t.length > 0)));
        if (groups[safeGroupName]) {
            // Merge, Deduplicate if group already exists
            const mergedTags = new Set([...groups[safeGroupName], ...tags]);
            groups[safeGroupName] = Array.from(mergedTags);
        }
        else {
            groups[safeGroupName] = tags;
        }
        return ' '; // Replace keys with space
    });
    // Collect all tags that are now in groups to filter them out of loose tags (deduplication Case 2)
    const allGroupTags = new Set();
    Object.values(groups).forEach(tags => tags.forEach(t => allGroupTags.add(t)));
    // Clean up remaining text to get loose tags, removing those that are already in groups
    const originalTags = remainingText.split(/\s+/).filter(t => t.length > 0 && !allGroupTags.has(t));
    return { groups, originalTags };
};
/**
 * Reconstructs the tag string with grouped syntax.
 * Checks if tags from the groups exist in the currentText.
 * If all tags from a group are found, they are removed from the loose tags
 * and added back as a group string.
 *
 * Supports shared tags: A tag can belong to multiple groups.
 */
export const reconstructTags = (currentText, groupData) => {
    // 0. CLEANUP: Strip existing group syntax from text to avoid duplication/infinite loops.
    // We use the same regex as parseGroupedTags but just remove them.
    const groupRegex = /([^\s\[]+)\[\s*(.+?)\s*\]/g;
    let cleanText = currentText.replace(groupRegex, ' ');
    // 1. Identify which tags are used in groups
    // We need to check against ALL tags present in the input (including those we just stripped from groups)
    // flattenTags gives us exactly that: a flat list of all tags currently in the input.
    const allCurrentTags = flattenTags(currentText).split(/\s+/).filter(t => t.length > 0);
    const currentTagSet = new Set(allCurrentTags);
    const formedGroups = [];
    const usedTags = new Set();
    // Iterate over saved groups
    for (const [groupName, groupTags] of Object.entries(groupData)) {
        // Check if AT LEAST ONE tag from this group exists in currentTags (Partial Match)
        const presentTags = groupTags.filter(tag => currentTagSet.has(tag));
        if (presentTags.length > 0) {
            // Create group string with TRAILING SPACE
            formedGroups.push(`${groupName}[ ${presentTags.join(' ')}  ] `);
            // Mark tags as used so they are removed from loose tags later
            presentTags.forEach(tag => usedTags.add(tag));
        }
    }
    // 2. Reconstruct loose string preserving whitespace from the SCRUBBED text
    // This ensures we don't duplicate "ghosts" of old groups.
    const tokens = cleanText.split(/(\s+)/);
    // Replace used tags with empty string, keep everything else
    const looseString = tokens.map(token => {
        // Token could be whitespace or empty string (from split leading/trailing)
        if (!token.trim()) {
            // Feature: Normalize excessive horizontal whitespace to single space
            // If token consists only of spaces/tabs (no newlines) and is longer than 1 space
            if (token.length > 1 && /^[ \t]+$/.test(token)) {
                return ' ';
            }
            return token;
        }
        // If it's a tag and it's used in a group, remove it (replace with empty)
        if (usedTags.has(token))
            return '';
        return token;
    }).join('');
    // Post-process: Normalize all horizontal whitespace to single space
    const normalizedLooseString = looseString.replace(/[ \t]+/g, ' ');
    const cleanLooseString = normalizedLooseString.trimEnd();
    const groupString = formedGroups.join('\n\n');
    if (cleanLooseString && groupString) {
        // Ensure at least one newline separation
        return cleanLooseString + '\n\n' + groupString;
    }
    else {
        return cleanLooseString + groupString;
    }
};
/**
 * Flattens the tag string, removing group syntax and leaving only tags.
 */
export const flattenTags = (text) => {
    const parsed = parseGroupedTags(text);
    return [
        ...Object.values(parsed.groups).flat(),
        ...parsed.originalTags
    ].join(' ');
};
/**
 * Removes tags from groups if they are not present in the currentTags list.
 * Returns the updated groups map and a boolean indicating if changes were made.
 */
export const removeMissingTagsFromGroups = (groups, currentTags) => {
    const currentTagSet = new Set(currentTags);
    const updatedGroups = {};
    let changed = false;
    for (const [groupName, tags] of Object.entries(groups)) {
        const newTags = tags.filter(tag => currentTagSet.has(tag));
        if (newTags.length !== tags.length) {
            changed = true;
        }
        // Only keep group if it still has tags
        if (newTags.length > 0) {
            updatedGroups[groupName] = newTags;
        }
        else {
            // Group became empty -> Removed
            changed = true;
        }
    }
    return { updatedGroups, changed };
};
//# sourceMappingURL=parser.js.map