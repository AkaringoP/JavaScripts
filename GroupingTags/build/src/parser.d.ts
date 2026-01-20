export interface ParsedTags {
    groups: {
        [key: string]: string[];
    };
    originalTags: string[];
}
/**
 * Parses text containing groupName[ tags ] syntax.
 * Returns the grouped tags and any remaining ungroupped tags.
 */
export declare const parseGroupedTags: (text: string) => ParsedTags;
/**
 * Reconstructs the tag string with grouped syntax.
 * Checks if tags from the groups exist in the currentText.
 * If all tags from a group are found, they are removed from the loose tags
 * and added back as a group string.
 *
 * Supports shared tags: A tag can belong to multiple groups.
 */
export declare const reconstructTags: (currentText: string, groupData: {
    [groupName: string]: string[];
}) => string;
/**
 * Flattens the tag string, removing group syntax and leaving only tags.
 */
export declare const flattenTags: (text: string) => string;
/**
 * Removes tags from groups if they are not present in the currentTags list.
 * Returns the updated groups map and a boolean indicating if changes were made.
 */
export declare const removeMissingTagsFromGroups: (groups: {
    [key: string]: string[];
}, currentTags: string[]) => {
    updatedGroups: {
        [key: string]: string[];
    };
    changed: boolean;
};
