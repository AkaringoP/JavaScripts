export declare class AutoSyncManager {
    private static syncTimeout;
    /**
     * Initializes the Auto-Sync Manager.
     * Should be called once on script startup (main.ts).
     * Checks if there are pending syncs from a previous session (e.g. after reload).
     */
    static init(): void;
    /**
     * Notifies the manager that data has changed for a specific Post ID.
     * Marks the corresponding shard as dirty and resets the debounce timer.
     *
     * @param postId The ID of the post that changed.
     */
    static notifyChange(postId: number | string): void;
    /**
     * Checks if a sync is pending from before reload.
     */
    private static checkPendingSync;
    private static scheduleSync;
    private static executeSync;
    private static getDirtyShards;
}
