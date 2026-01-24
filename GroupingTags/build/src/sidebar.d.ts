/**
 * SidebarInjector
 *
 * Injects "Bottle Cap" style visual indicators into the sidebar tag list.
 * Allows users to quickly view and manage groups without entering the "Edit" mode.
 *
 * **Features**:
 * - **Caps**: Shows a colored circle for single groups, or a stacked indicator for multiple groups.
 * - **Ghost Buttons**: Shows a transparent button on hover for ungrouped tags to allow quick creation.
 * - **Pill Menu**: Clicking a cap opens a floating menu to toggle groups or create new ones.
 * - **Animations**: Smooth expand/collapse effects for the menu.
 */
export declare class SidebarInjector {
    private checkEnabled;
    constructor(checkEnabled: () => boolean);
    private injectStyles;
    private allGroups;
    private init;
    private injectIndicators;
    private originalParents;
    /**
     * Restores the default Danbooru sidebar view by moving list items back to their original locations.
     * Also restores visibility of hidden lists and headers.
     */
    private renderDefaultView;
    private renderGroupView;
    private createButton;
    private toggleGroupMenu;
    private syncTimeout;
    private triggerAutoSync;
}
