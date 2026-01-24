export interface ParsedTags {
    groups: {
        [key: string]: string[];
    };
    originalTags: string[];
}
/**
 * Parses a string containing grouped tag syntax (e.g., `Group[ tag1 tag2 ]`).
 * Extracts groups and their tags, and identifies any "loose" tags that are not part of a group.
 *
 * @param text The raw input string from the textarea.
 * @returns A `ParsedTags` object containing a map of groups and a list of loose tags.
 */
export declare const parseGroupedTags: (text: string) => ParsedTags;
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
export declare const reconstructTags: (currentText: string, groupData: {
    [groupName: string]: string[];
}) => string;
/**
 * Flattens the tag string by removing all group syntax and returning a clean, space-separated list of tags.
 * Used before submitting the form to Danbooru to ensure the server receives standard tag data.
 *
 * @param text The input string potentially containing `Group[ ... ]` syntax.
 * @returns A plain string of space-separated tags.
 */
export declare const flattenTags: (text: string) => string;
/**
 * Synchronizes the saved groups with the current tag list.
 * If tags are removed from the input, they are also removed from their respective groups in the DB.
 * If a group becomes empty, it is marked for deletion.
 *
 * @param groups The current state of groups from the DB.
 * @param currentTags The list of tags currently present in the text input.
 * @returns An object containing the `updatedGroups` and a `changed` flag.
 */
export declare const removeMissingTagsFromGroups: (groups: {
    [key: string]: string[];
}, currentTags: string[]) => {
    updatedGroups: {
        [key: string]: string[];
    };
    changed: boolean;
};
