export declare class SmartInputHandler {
    private input;
    private isBound;
    private checkEnabled;
    private isDeleting;
    constructor(selector: string, checkEnabled: () => boolean);
    private init;
    private onKeyDown;
    private onSelectionChange;
    private insertText;
}
