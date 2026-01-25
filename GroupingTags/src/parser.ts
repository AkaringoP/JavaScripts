export interface ParsedTags {
  groups: {[key: string]: string[]};
  originalTags: string[]; // "Loose tags" not belonging to any group
}

/**
 * 1. Parsing Function (Loop-based - Solves nested brackets)
 * Scans the string and counts bracket pairs (Depth) instead of using regex.
 * Example: Correctly recognizes "group[ tag[1] tag2 ]".
 *
 * Update: Uses range masking to safely extract loose tags without breaking nested brackets.
 */
/**
 * Parses the raw tag string into structured groups and loose tags.
 *
 * This function uses a character-by-character scanning approach (instead of Regex)
 * to correctly handle nested brackets and escaped characters.
 *
 * @param text - The raw input string from the Danbooru tag editor.
 * @returns An object containing:
 *  - `groups`: A map of group names to their list of tags.
 *  - `originalTags`: A list of tags that do not satisfy the group syntax or are outside any group.
 *
 * @example
 * ```ts
 * parseGroupedTags("Group[ tag1 ] loose_tag");
 * // Returns { groups: { "Group": ["tag1"] }, originalTags: ["loose_tag"] }
 * ```
 */
export const parseGroupedTags = (text: string): ParsedTags => {
  const groups: {[key: string]: string[]} = {};
  const groupRanges: {start: number; end: number}[] = [];

  let i = 0;
  while (i < text.length) {
    const openBracketIndex = text.indexOf('[', i);
    if (openBracketIndex === -1) break; // No more groups

    // Check for escape character '\['
    if (openBracketIndex > 0 && text[openBracketIndex - 1] === '\\') {
      i = openBracketIndex + 1;
      continue; // Skip escaped bracket
    }

    // Extract group name before '['
    const beforeBracket = text.slice(0, openBracketIndex);
    // Strict naming: Alphanumeric, underscore, hyphen
    const groupNameMatch = beforeBracket.match(/([a-zA-Z0-9_\-]+)\s*$/);

    if (!groupNameMatch) {
      i = openBracketIndex + 1;
      continue; // Ignore malformed or special-char names
    }

    const groupName = groupNameMatch[1];
    const groupStartIndex = groupNameMatch.index!;

    // Find closing bracket ']' (Handle nesting)
    let depth = 1;
    let closeBracketIndex = -1;

    for (let j = openBracketIndex + 1; j < text.length; j++) {
      // Handle escaped brackets inside too?
      // If we support nested brackets, we should respect escaping there too to avoid parse errors.
      if (text[j] === '[' && text[j - 1] !== '\\') depth++;
      else if (text[j] === ']' && text[j - 1] !== '\\') depth--;

      if (depth === 0) {
        closeBracketIndex = j;
        break;
      }
    }

    if (closeBracketIndex !== -1) {
      const content = text.slice(openBracketIndex + 1, closeBracketIndex);
      // Clean up escaped brackets in content if any are meant to be literal?
      // Actually, flattening handles content. We just split by space.
      // But if user typed "tag\[1\]", we want "tag[1]" in the data?
      // For now, let's keep content raw-ish but split.
      // If we want "tag\[1\]" to become "tag[1]", we need unescaping.

      const rawTags = content.split(/\s+/).filter(t => t.length > 0);
      const tags = rawTags.map(t =>
        t.replace(/\\\[/g, '[').replace(/\\\]/g, ']'),
      );

      // Save group (Merge if existing)
      if (groups[groupName]) {
        groups[groupName] = Array.from(
          new Set([...groups[groupName], ...tags]),
        );
      } else {
        groups[groupName] = tags;
      }

      // Record the range of this group (including name) to remove it later
      groupRanges.push({start: groupStartIndex, end: closeBracketIndex + 1});

      i = closeBracketIndex + 1;
    } else {
      i = openBracketIndex + 1;
    }
  }

  // 6. Extract Loose Tags
  // Build "looseText" by replacing group ranges with spaces
  let looseText = '';
  let cursor = 0;

  groupRanges.sort((a, b) => a.start - b.start);

  for (const range of groupRanges) {
    looseText += text.slice(cursor, range.start) + ' ';
    cursor = range.end;
  }
  looseText += text.slice(cursor);

  // Split and Unescape loose tags
  // "def\[n]" -> "def[n]"
  const originalTags = looseText
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => t.replace(/\\\[/g, '[').replace(/\\\]/g, ']'));

  return {groups, originalTags};
};

/**
 * Flattens the structured group data into a single string of tags.
 * This is used when submitting the form to the server.
 *
 * @param text - The raw input text containing group syntax.
 * @returns A space-separated string of unique tags with all group syntax removed.
 */
export const flattenTags = (text: string): string => {
  const {groups, originalTags} = parseGroupedTags(text);
  const groupTags = Object.values(groups).flat();
  // Deduplicate and join
  const result = Array.from(new Set([...groupTags, ...originalTags])).join(' ');
  return result.length > 0 ? result + ' ' : result;
};

/**
 * Reconstructs the user-friendly group syntax from the current tag list.
 *
 * It maps the currently active tags back into their defined groups.
 * Tags that belong to a group are placed inside `GroupName[ ... ]`.
 * Tags that do not belong to any group are left as loose tags.
 *
 * @param currentText - The current flat text in the editor (or previously saved text).
 * @param groupData - The dictionary of group definitions (Name -> Tag List).
 * @returns A formatted string containing the group syntax (e.g. `Group[ tag1 ] loose_tag`).
 *          A trailing space is appended to every group to facilitate typing.
 */
export const reconstructTags = (
  currentText: string,
  groupData: {[groupName: string]: string[]},
): string => {
  // 1. Get all tags currently on screen in order.
  const flatText = flattenTags(currentText);
  const allCurrentTags = flatText.split(/\s+/).filter(t => t.length > 0);

  const usedTags = new Set<string>();
  const formedGroups: string[] = [];

  // 2. Iterate saved groups
  for (const [groupName, groupTags] of Object.entries(groupData)) {
    const groupTagSet = new Set(groupTags);

    // STRICT ORDERING FIX:
    // Instead of filtering 'allCurrentTags' (which keeps original screen order),
    // we iterate 'groupTags' (which is the Sorted Order from DB) and check if present on screen.
    // This enforces the DB's Character-First sort order in the UI.
    const presentTags = groupTags.filter(tag => {
      // We need to check if 'tag' is in 'allCurrentTags'.
      // Using a Set for O(1) lookup would be better if we had one, but 'allCurrentTags' is array.
      // Let's make a Set for fast lookup.
      return allCurrentTags.includes(tag);
    });

    if (presentTags.length > 0) {
      // Escape tags inside group?
      // Generally tags inside [ ] don't need escaping of [ ] unless ambiguous (nested).
      // But for simplicity/safety, let's just output them as is.
      // If we unescaped "tag[1]" -> "tag[1]", putting it back inside Group[ ... ] works fine because of bracket counting.
      // So no need to re-escape INSIDE groups.
      formedGroups.push(`${groupName}[ ${presentTags.join(' ')} ] `);

      presentTags.forEach(t => usedTags.add(t));
    }
  }

  // 3. Extract remaining tags (Loose Tags)
  const looseTags = allCurrentTags.filter(t => !usedTags.has(t));

  // 4. Escape loose tags that look like groups or contain brackets
  // If a loose tag is "def[n]", we must output "def\[n]" so it isn't parsed as a group next time.
  // Actually, strictly we only need to escape '[' if it looks like a group start.
  // But safest is to escape '[' if it's not inside a group.
  const escapedLooseTags = looseTags.map(t =>
    t.replace(/\[/g, '\\[').replace(/\]/g, '\\]'),
  );

  // 4. Combine final string
  const looseString = escapedLooseTags.join(' ');
  const groupString = formedGroups.join('\n\n');

  if (looseString && groupString) {
    return `${looseString}\n\n${groupString}`;
  } else {
    return looseString + groupString;
  }
};

/**
 * Removes tags from the group definitions if they are no longer present in the `currentTags` list.
 * This is used to keep the group definitions in sync with the actual tags on the post.
 *
 * @param groups - The current group definitions.
 * @param currentTags - The list of tags currently present on the post.
 * @returns An object containing the `updatedGroups` and a `changed` flag.
 */
export const removeMissingTagsFromGroups = (
  groups: {[key: string]: string[]},
  currentTags: string[],
): {updatedGroups: {[key: string]: string[]}; changed: boolean} => {
  const currentTagSet = new Set(currentTags);
  const updatedGroups: {[key: string]: string[]} = {};
  let changed = false;

  for (const [groupName, tags] of Object.entries(groups)) {
    const newTags = tags.filter(tag => currentTagSet.has(tag));

    if (newTags.length !== tags.length) {
      changed = true;
    }

    if (newTags.length > 0) {
      updatedGroups[groupName] = newTags;
    } else {
      changed = true; // Group removed
    }
  }

  return {updatedGroups, changed};
};
