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
