export interface ParsedTags {
    groups: { [key: string]: string[] };
    originalTags: string[]; // Tags that were not in any group
}

/**
 * Parses text containing groupName[ tags ] syntax.
 * Returns the grouped tags and any remaining ungroupped tags.
 */
export const parseGroupedTags = (text: string): ParsedTags => {
    const groups: { [key: string]: string[] } = {};
    let remainingText = text;

    // Regex to find groupName[ tags ]
    // We use non-greedy matching.
    // Group 1: Group Name (non-whitespace characters)
    // Group 2: Tags content
    const groupRegex = /([^\s\[]+)\[\s*(.+?)\s*\]/g;

    let match;
    while ((match = groupRegex.exec(text)) !== null) {
        const fullMatch = match[0];
        const groupName = match[1].trim();
        const tagsContent = match[2].trim();

        // Split tags by space
        const tags = tagsContent.split(/\s+/).filter(t => t.length > 0);

        if (groups[groupName]) {
            groups[groupName] = [...groups[groupName], ...tags]; // Merge if duplicate group exists?
        } else {
            groups[groupName] = tags;
        }

        // Remove the matched part from the text
        remainingText = remainingText.replace(fullMatch, '');
    }

    // Clean up remaining text to get loose tags
    const originalTags = remainingText.split(/\s+/).filter(t => t.length > 0);

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
export const reconstructTags = (currentText: string, groupData: { [groupName: string]: string[] }): string => {
    // Unique tags from input
    const currentTags = currentText.split(/\s+/).filter(t => t.length > 0);
    const currentTagSet = new Set(currentTags);

    const formedGroups: string[] = [];
    const usedTags = new Set<string>();

    // Iterate over saved groups
    for (const [groupName, groupTags] of Object.entries(groupData)) {
        // Check if all tags in this group exist in currentTags
        // We check against the original set, NOT modifying it yet.
        const allFound = groupTags.every(tag => currentTagSet.has(tag));

        if (allFound) {
            // Create group string
            formedGroups.push(`${groupName}[ ${groupTags.join(' ')} ]`);

            // Mark tags as used so they are removed from loose tags later
            groupTags.forEach(tag => usedTags.add(tag));
        }
    }

    // Filter out tags that were used in ANY group
    // Note: If a tag is in Group A and Group B, it is marked used found in both, so it is removed from loose.
    const looseTags = currentTags.filter(tag => !usedTags.has(tag));

    // Combine remaining loose tags and formed groups
    // Use newline to separate groups for better readability
    const looseString = looseTags.join(' ');
    const groupString = formedGroups.join('\n');

    if (looseString && groupString) {
        return looseString + '\n' + groupString;
    } else {
        return looseString + groupString;
    }
};

/**
 * Flattens the tag string, removing group syntax and leaving only tags.
 */
export const flattenTags = (text: string): string => {
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
export const removeMissingTagsFromGroups = (
    groups: { [key: string]: string[] },
    currentTags: string[]
): { updatedGroups: { [key: string]: string[] }, changed: boolean } => {
    const currentTagSet = new Set(currentTags);
    const updatedGroups: { [key: string]: string[] } = {};
    let changed = false;

    for (const [groupName, tags] of Object.entries(groups)) {
        const newTags = tags.filter(tag => currentTagSet.has(tag));

        if (newTags.length !== tags.length) {
            changed = true;
        }

        // Only keep group if it still has tags
        if (newTags.length > 0) {
            updatedGroups[groupName] = newTags;
        } else {
            // Group became empty -> Removed
            changed = true;
        }
    }

    return { updatedGroups, changed };
};
