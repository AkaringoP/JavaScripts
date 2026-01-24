/**
 * Parses a string containing grouped tag syntax (e.g., `Group[ tag1 tag2 ]`).
 * Extracts groups and their tags, and identifies any "loose" tags that are not part of a group.
 *
 * @param text The raw input string from the textarea.
 * @returns A `ParsedTags` object containing a map of groups and a list of loose tags.
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
 * Reconstructs the tag string by applying group syntax to tags that belong to known groups.
 *
 * **Partial Match Strategy**: If *any* tag from a saved group is present in the input,
 * the group syntax `Group[ ... ]` is reconstructed providing those tags.
 * Missing tags are simply omitted from the group.
 *
 * **Idempotency**: First strips any existing group syntax from the input to prevent duplication,
 * then rebuilds it from scratch based on the comprehensive list of tags found.
 *
 * @param currentText The current text in the textarea (may contain raw tags or existing groups).
 * @param groupData The saved group definitions from IndexedDB.
 * @returns The formatted string with groups displayed on separate lines.
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
 * Flattens the tag string by removing all group syntax and returning a clean, space-separated list of tags.
 * Used before submitting the form to Danbooru to ensure the server receives standard tag data.
 *
 * @param text The input string potentially containing `Group[ ... ]` syntax.
 * @returns A plain string of space-separated tags.
 */
export const flattenTags = (text) => {
    const parsed = parseGroupedTags(text);
    return [
        ...Object.values(parsed.groups).flat(),
        ...parsed.originalTags
    ].join(' ');
};
/**
 * Synchronizes the saved groups with the current tag list.
 * If tags are removed from the input, they are also removed from their respective groups in the DB.
 * If a group becomes empty, it is marked for deletion.
 *
 * @param groups The current state of groups from the DB.
 * @param currentTags The list of tags currently present in the text input.
 * @returns An object containing the `updatedGroups` and a `changed` flag.
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