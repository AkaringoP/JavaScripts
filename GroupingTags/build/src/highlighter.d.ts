/**
 * SyntaxHighlighter
 *
 * Provides syntax highlighting for the `Group[ ... ]` syntax by overlaying a
 * customized "Backdrop" element behind the transparent Textarea.
 *
 * **Mechanism**:
 * 1. Creates a container wrapping the textarea.
 * 2. Inserts a backdrop div behind the textarea.
 * 3. Syncs font, size, padding, and scroll position perfectly.
 * 4. Parses the text and injects colored HTML spans into the backdrop.
 *
 * **Features**:
 * - **Phantom Mode**: Fades out the text and shows the backdrop when idle to provide beautiful highlighting without affecting typing performance.
 * - **Active Mode**: Shows the raw text while typing for maximum responsiveness.
 */
export declare class SyntaxHighlighter {
    private textarea;
    private container;
    private backdrop;
    private debounceTimer;
    private idleTimer;
    private readonly IDLE_DELAY;
    constructor(selector: string);
    private init;
    private injectStyles;
    private syncStyles;
    private syncScroll;
    private onInputDebounced;
    private resetIdleTimer;
    private activatePhantomMode;
    /**
     * Parsing Logic: Recursive / Stack-based for proper nesting
     */
    private update;
    private parseText;
}
