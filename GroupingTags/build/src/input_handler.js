export class SmartInputHandler {
    input = null;
    isBound = false;
    checkEnabled;
    isDeleting = false;
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
        this.input.addEventListener('keydown', (e) => this.onKeyDown(e));
        this.input.addEventListener('keyup', () => { this.isDeleting = false; }); // Reset safety
        document.addEventListener('selectionchange', () => this.onSelectionChange());
        this.isBound = true;
        console.log('SmartInputHandler: Initialized.');
    }
    onKeyDown(e) {
        if (!this.checkEnabled())
            return;
        // Track deletion
        if (e.key === 'Backspace' || e.key === 'Delete') {
            this.isDeleting = true;
            // Delay reset slightly or rely on keyup/selection logic
            // We'll reset it in selectionChange or keyup.
        }
        else {
            this.isDeleting = false;
        }
        if (e.key === '[') {
            const cursor = this.input.selectionStart;
            const text = this.input.value;
            const charBefore = text[cursor - 1];
            if (charBefore && /\S/.test(charBefore)) {
                e.preventDefault();
                this.insertText('[  ]', 2);
            }
        }
        else if (e.key === ']') {
            const cursor = this.input.selectionStart;
            const text = this.input.value;
            if (text[cursor] === ']') {
                e.preventDefault();
                this.input.setSelectionRange(cursor + 1, cursor + 1);
            }
        }
    }
    onSelectionChange() {
        if (!this.checkEnabled())
            return;
        if (!this.input || document.activeElement !== this.input)
            return;
        // SKIP enforcement if we are actively deleting
        // This allows the user to backspace the 'gap' and then the bracket.
        if (this.isDeleting)
            return;
        const cursor = this.input.selectionStart;
        const text = this.input.value;
        const charBefore = text[cursor - 1];
        const charAfter = text[cursor];
        let newText = text;
        let newCursor = cursor;
        let needsUpdate = false;
        // Case A: '['
        if (charBefore === '[') {
            if (charAfter !== ' ') {
                newText = text.slice(0, cursor) + ' ' + text.slice(cursor);
                newCursor = cursor + 1;
                needsUpdate = true;
            }
            else {
                // Ensure cursor is NOT directly touching '[' (Padding Check)
                // If cursor is at ...[| ... we want ...[ |...
                // But wait, if charAfter is ' ', we are at ...[| ...
                // So we just move cursor right.
                newCursor = cursor + 1;
                this.input.setSelectionRange(newCursor, newCursor);
                return;
            }
        }
        // Case B: ']'
        else if (charAfter === ']') {
            if (charBefore !== ' ') {
                newText = text.slice(0, cursor) + ' ' + text.slice(cursor);
                needsUpdate = true;
            }
            else {
                newCursor = cursor - 1;
                this.input.setSelectionRange(newCursor, newCursor);
                return;
            }
        }
        if (needsUpdate) {
            this.input.value = newText;
            this.input.setSelectionRange(newCursor, newCursor);
            this.input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
    insertText(textToInsert, cursorOffset) {
        if (!this.input)
            return;
        const start = this.input.selectionStart;
        const end = this.input.selectionEnd;
        const text = this.input.value;
        this.input.value = text.substring(0, start) + textToInsert + text.substring(end);
        this.input.setSelectionRange(start + cursorOffset, start + cursorOffset);
        this.input.dispatchEvent(new Event('input', { bubbles: true }));
    }
}
//# sourceMappingURL=input_handler.js.map