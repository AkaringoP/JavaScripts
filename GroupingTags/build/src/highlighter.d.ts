export declare class SyntaxHighlighter {
    private input;
    private container;
    private backdrop;
    private highlights;
    private isBound;
    constructor(selector: string);
    private init;
    private injectStyles;
    private syncStyles;
    private syncScroll;
    private update;
    private escapeHtml;
    private stringToColor;
}
