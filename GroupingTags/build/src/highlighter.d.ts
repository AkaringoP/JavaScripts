/**
 * SyntaxHighlighter
 * Textarea 뒤에 색칠된 Backdrop을 겹쳐서 그룹 문법(Name[...])을 강조하는 클래스
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
