/**
 * SmartInputHandler
 *
 * Manages advanced typing interactions within the "Edit Tags" textarea.
 *
 * **Key Features**:
 * - **Auto-Closing Brackets**: Automatically inserts `]` when `[` is typed suitable for group names.
 * - **Smart Padding**: Enforces `[ | ]` spacing for compatibility with Danbooru's autocomplete.
 * - **Tab Escape**: Allows jumping out of a group using the `Tab` key.
 * - **IME Support**: Intelligently pauses logic during compositions (e.g., Korean/Japanese input) to prevent corruption.
 * - **Undo/Redo Protection**: Uses `execCommand` where possible to preserve the browser's native undo history.
 */
export class SmartInputHandler {
    input = null;
    isBound = false;
    checkEnabled;
    isDeleting = false;
    isComposing = false;
    constructor(selector, checkEnabled) {
        this.checkEnabled = checkEnabled;
        this.input = document.querySelector(selector);
        if (this.input) {
            this.init();
        }
        else {
            console.warn(`SmartInputHandler: Element not found for selector "${selector}"`);
        }
    }
    init() {
        if (!this.input || this.isBound)
            return;
        // DEBUG: Global Capture for KeyDown to ensure we catch it
        document.addEventListener('keydown', (e) => this.onKeyDown(e), true);
        this.input.addEventListener('keyup', () => { this.isDeleting = false; }, true);
        // IME Composition Events - Critical for Korean support
        this.input.addEventListener('compositionstart', () => { this.isComposing = true; });
        this.input.addEventListener('compositionend', () => {
            this.isComposing = false;
            // Trigger a check after composition ends to ensure formatting
            this.handleInput(null);
        });
        // Use 'input' event for text modifications to avoid selectionchange loops
        this.input.addEventListener('input', (e) => this.handleInput(e));
        document.addEventListener('selectionchange', () => this.onSelectionChange());
        this.isBound = true;
        console.log('SmartInputHandler: Initialized (Global Capture & Debug).');
    }
    onKeyDown(e) {
        if (!this.checkEnabled())
            return;
        if (this.isComposing)
            return; // Ignore keys during composition
        if (e.key === 'Backspace' || e.key === 'Delete') {
            this.isDeleting = true;
        }
        else {
            this.isDeleting = false;
        }
        if (e.key === 'Tab') {
            const cursor = this.input.selectionStart;
            const text = this.input.value;
            // Tab Escape: Check if followed by optional whitespace, ']', AND optional trailing whitespace.
            // Condition 1: Cursor right side must match `\s*\]\s*`.
            // Condition 2: Cursor left side must NOT be text (to avoid escaping while typing).
            const charBefore = text[cursor - 1];
            // If charBefore exists, is NOT whitespace, and is NOT '[', then we are likely typing text.
            // e.g. "tag| ]" -> charBefore 'g' -> BLOCK
            // " | ]" -> charBefore ' ' -> ALLOW
            // "[| ]" -> charBefore '[' -> ALLOW
            const isTextBefore = charBefore && /\S/.test(charBefore) && charBefore !== '[';
            if (!isTextBefore) {
                // Look ahead from cursor
                const remaining = text.slice(cursor);
                // Match: (spaces?) + ] + (spaces?)
                // Changed \s to [ \t] to prevent matching newlines and jumping to next line/group
                const match = remaining.match(/^([ \t]*\][ \t]*)/);
                if (match) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    const matchedStr = match[1];
                    const hasTrailingSpace = /[ \t]$/.test(matchedStr);
                    const jumpOffset = matchedStr.length;
                    // Force async execution to override site behavior
                    setTimeout(() => {
                        if (!this.input)
                            return;
                        this.input.focus();
                        // 1. Move Cursor to Jump Target
                        const targetPos = cursor + jumpOffset;
                        this.input.setSelectionRange(targetPos, targetPos);
                        // 2. Insert Space if needed
                        if (!hasTrailingSpace) {
                            this.insertText(' ', 1);
                        }
                    }, 0);
                }
            }
        }
        else if (e.key === '[') {
            const cursor = this.input.selectionStart;
            const text = this.input.value;
            // Check for escape character
            if (cursor > 0 && text[cursor - 1] === '\\') {
                return; // Allow literal '[' input
            }
            // Check if we are inside a group
            // Count open/close brackets up to cursor
            let balance = 0;
            for (let i = 0; i < cursor; i++) {
                if (text[i] === '[')
                    balance++;
                else if (text[i] === ']')
                    balance--;
            }
            // If balance > 0, we are inside a group. 
            // Disable Smart Features (Merge/Create) and allow native typing.
            // This treats inner brackets as plain text tags.
            if (balance > 0)
                return;
            const charBefore = text[cursor - 1];
            if (charBefore && /\S/.test(charBefore)) {
                // Feature: Smart Merge
                // Check if user is typing a group name that already exists
                // 1. Get the word being typed
                let nameStart = cursor - 1;
                while (nameStart >= 0 && /\S/.test(text[nameStart]) && text[nameStart] !== '[') {
                    nameStart--;
                }
                nameStart++; // Start of the word
                const candidateName = text.slice(nameStart, cursor);
                // 2. Scan for existing group "candidateName["
                // We use a regex to find OTHER instances
                // Look for: non-whitespace, candidateName, [, whitespace?
                const escapedName = candidateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(^|\\s)${escapedName}\\s*\\[`, 'g');
                let match;
                while ((match = regex.exec(text)) !== null) {
                    // Ignore if this is the one we are typing (unlikely since we haven't typed '[' yet, but name is there)
                    // The match index points to start of matched string.
                    // If match is at nameStart, it's what we are typing.
                    // But wait, we haven't typed '[' yet. So the text doesn't have '[' at cursor.
                    // So any match in text MUST be a DIFFERENT group.
                    // Found existing group!
                    e.preventDefault();
                    // 3. Find insertion point in existing group
                    // match.index is start of " name[". match[0] is the full match string.
                    const groupStart = match.index + match[0].length; // Points to char after '['
                    // We need to find the matching ']'
                    // Simple search for now (or sophisticated balancing if needed)
                    // Let's rely on finding next ']' for that group
                    // Assuming no nested brackets for the same group name usually?
                    // Let's implement robust search for closing bracket of THAT group.
                    let depth = 1;
                    let existingCloseIdx = groupStart;
                    while (depth > 0 && existingCloseIdx < text.length) {
                        if (text[existingCloseIdx] === '[')
                            depth++;
                        else if (text[existingCloseIdx] === ']')
                            depth--;
                        if (depth > 0)
                            existingCloseIdx++;
                    }
                    if (depth === 0) {
                        // Found valid closing bracket at existingCloseIdx
                        // 4. Delete the candidate name we just typed
                        // Range: nameStart to cursor
                        this.input.setSelectionRange(nameStart, cursor);
                        document.execCommand('delete'); // Use execCommand for Undo history
                        // 5. Jump to existing group
                        // We want to be inside, at the end. 
                        // If it's "name[  ]", we want "name[  | ]"
                        // existingCloseIdx points to ']'
                        // But wait, deleting shifted indices.
                        // Calculate shift amount
                        const deletedLen = cursor - nameStart;
                        let jumpPos = existingCloseIdx;
                        if (existingCloseIdx > nameStart) {
                            // The group was AFTER us? Then index shifted.
                            jumpPos -= deletedLen;
                        }
                        // Check for space padding in existing group
                        // jumpPos points to ']'
                        // We want cursor at ' | ]' (between two spaces) to prevent 'tagabc]' autocompletion fail.
                        const valAfterDelete = this.input.value;
                        // jumpPos is index of ']'
                        // Count existing spaces before ']'
                        let spaceCount = 0;
                        let k = jumpPos - 1;
                        while (k >= 0 && valAfterDelete[k] === ' ') {
                            spaceCount++;
                            k--;
                        }
                        // Ensure at least 2 spaces
                        if (spaceCount < 2) {
                            const spacesToAdd = 2 - spaceCount;
                            const spaces = ' '.repeat(spacesToAdd);
                            this.input.setSelectionRange(jumpPos, jumpPos);
                            document.execCommand('insertText', false, spaces);
                            jumpPos += spacesToAdd; // ']' shifted right
                        }
                        // Set cursor to (jumpPos - 1) -> Between the last two spaces
                        // "tag  ]" (index of ] is N).
                        // N-1 is between the two spaces. "tag | ]"
                        this.input.setSelectionRange(jumpPos - 1, jumpPos - 1);
                        // Helper: Scroll to view
                        this.input.blur();
                        this.input.focus();
                        return; // Done
                    }
                }
                // If no existing group, proceed with creation
                e.preventDefault();
                // Add trailing space as requested: '[  ] '
                this.insertText('[  ] ', 2);
            }
        }
        else if (e.key === ']') {
            const cursor = this.input.selectionStart;
            const text = this.input.value;
            // Overtype logic
            if (text[cursor] === ']') {
                e.preventDefault();
                this.input.setSelectionRange(cursor + 1, cursor + 1);
            }
        }
    }
    // Moved text modification logic here
    handleInput(e) {
        if (!this.checkEnabled())
            return;
        if (this.isComposing)
            return;
        if (!this.input)
            return;
        // Skip logic if we are deleting content
        if (this.isDeleting)
            return;
        if (e && e.inputType && e.inputType.startsWith('delete'))
            return;
        const cursor = this.input.selectionStart;
        const text = this.input.value;
        const charBefore = text[cursor - 1];
        const charAfter = text[cursor];
        let val = text;
        let newCursor = cursor;
        let needsUpdate = false;
        // Case A: Enforce 'SPACE' after '['
        if (charBefore === '[') {
            if (charAfter !== ' ') {
                val = text.slice(0, cursor) + ' ' + text.slice(cursor);
                newCursor = cursor + 1;
                needsUpdate = true;
            }
        }
        // Case B: Enforce 'SPACE' before ']'
        // Note: usage pattern slightly differs. Usually triggers when typing before marker.
        // If cursor is at ...|], ensure space before.
        // Tricky part: if I type 'a' into ... |], it becomes ...a|]. Space preserved.
        // If I paste 'text' into ...|], it becomes ...text|]. Need check.
        else if (charAfter === ']') {
            if (charBefore !== ' ') {
                val = text.slice(0, cursor) + ' ' + text.slice(cursor);
                // Keep cursor after the inserted space (relative to text content)
                // text|] -> text |] . Cursor should stay after text.
                // So we don't change cursor relative offset? 
                // Actually, if we insert space at cursor, cursor naturally moves +1 if we rewrite value?
                // No, value rewrite resets cursor to end usually, so we must set it.
                // Inserting at cursor: newCursor = cursor + 1.
                newCursor = cursor + 1;
                needsUpdate = true;
            }
        }
        if (needsUpdate) {
            this.input.value = val;
            this.input.setSelectionRange(newCursor, newCursor);
        }
    }
    onSelectionChange() {
        if (!this.checkEnabled())
            return;
        if (!this.input || document.activeElement !== this.input)
            return;
        if (this.input.selectionStart !== this.input.selectionEnd)
            return;
        if (this.isDeleting)
            return;
        if (this.isComposing)
            return; // Don't jump cursor while composing
        // Only handle CURSOR ADJUSTMENT here. No text changes.
        const cursor = this.input.selectionStart;
        const text = this.input.value;
        const charBefore = text[cursor - 1];
        const charAfter = text[cursor];
        // console.log(`[DEBUG] SelChange: Cursor=${cursor}, CharBefore='${charBefore}', CharAfter='${charAfter}'`);
        let newCursor = cursor;
        let needsMove = false;
        // Case A: Cursor touching '[' -> Push Right
        if (charBefore === '[') {
            // We assume space exists (handled by onInput). 
            // If space exists, move to it.
            if (charAfter === ' ') {
                newCursor = cursor + 1;
                needsMove = true;
            }
        }
        // Case B: Cursor touching ']' -> Ensure Padding
        // If user clicks/moves to `...|]`, ensure `... | ]` so typing doesn't break AC.
        else if (charAfter === ']') {
            const val = this.input.value;
            let k = cursor - 1;
            let spaceCount = 0;
            while (k >= 0 && val[k] === ' ') {
                spaceCount++;
                k--;
            }
            if (spaceCount < 2) {
                // Insert needed spaces
                const needed = 2 - spaceCount;
                const spaces = ' '.repeat(needed);
                // Use execCommand to preserve Undo
                // Note: onSelectionChange shouldn't typically loop if we check conditions carefully.
                // But inserting text changes selection, triggering this again. 
                // We must be careful.
                // However, inserted text will shift ']' right.
                // New cursor will be AFTER inserted text.
                // "tag|]" -> insert "  " -> "tag  |]"
                // New charAfter is ']', charBefore is ' '.
                // Next trigger: spaceCount=2. No action. 
                // We want cursor at middle? "tag | ]"
                const success = document.execCommand('insertText', false, spaces);
                if (success) {
                    // Move cursor back by 1 (center)
                    // "tag  |]" -> "tag | ]"
                    const newPos = this.input.selectionStart - 1;
                    this.input.setSelectionRange(newPos, newPos);
                }
            }
            else {
                // If already 2 spaces: "tag  |]" (cursor at 5, ] at 5)
                // Check if we are "tag | ]" (cursor at 4, ] at 5)
                // If cursor is AT ']', and we have spaces.
                // "tag  |]" -> Push Left to "tag | ]"?
                // Yes, pushing left to the "Safe Spot" is good.
                if (charBefore === ' ') {
                    // But we checked spaceCount scanning backwards.
                    // If we are at `tag  |]`, spaceCount=2.
                    // We prefer `tag | ]`.
                    // So pull left.
                    newCursor = cursor - 1;
                    needsMove = true;
                }
            }
        }
        if (needsMove) {
            this.input.setSelectionRange(newCursor, newCursor);
        }
    }
    insertText(textToInsert, cursorOffset) {
        if (!this.input)
            return;
        // Use execCommand to preserve Undo history
        // Note: 'insertText' is technically deprecated but is the only reliable way 
        // to handle Undo stack integration in vanilla JS across browsers.
        const success = document.execCommand('insertText', false, textToInsert);
        if (!success) {
            // Fallback for environments where execCommand fails (rare for textareas)
            const start = this.input.selectionStart;
            const end = this.input.selectionEnd;
            const text = this.input.value;
            this.input.value = text.substring(0, start) + textToInsert + text.substring(end);
            this.input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        // Adjust cursor position to the desired offset within the inserted text
        // execCommand places cursor at the end of insertion by default.
        // We need to move it back if cursorOffset is not the full length.
        const newPos = this.input.selectionStart - (textToInsert.length - cursorOffset);
        this.input.setSelectionRange(newPos, newPos);
    }
}
//# sourceMappingURL=input_handler.js.map