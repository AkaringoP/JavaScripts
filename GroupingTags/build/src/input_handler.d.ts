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
export declare class SmartInputHandler {
    private input;
    private isBound;
    private checkEnabled;
    private isDeleting;
    private isComposing;
    constructor(selector: string, checkEnabled: () => boolean);
    private init;
    private onKeyDown;
    private handleInput;
    private onSelectionChange;
    private insertText;
}
