import {SyncManager} from './sync-manager';
import {getLocalDataByShard} from '../db';
import {GM_getValue, GM_setValue} from '$';

const KEY_DIRTY_SHARDS = 'dta_dirty_shards'; // Array of shard indices (0-9)
const KEY_LAST_ACTIVITY = 'dta_last_activity_ts'; // Timestamp

export class AutoSyncManager {
  private static syncTimeout: any = null;

  /**
   * Initializes the Auto-Sync Manager.
   * Should be called once on script startup (main.ts).
   * Checks if there are pending syncs from a previous session (e.g. after reload).
   */
  static init() {
    this.checkPendingSync();
  }

  /**
   * Notifies the manager that data has changed for a specific Post ID.
   * Marks the corresponding shard as dirty and resets the debounce timer.
   *
   * @param postId The ID of the post that changed.
   */
  static notifyChange(postId: number | string) {
    const pidStr = postId.toString();
    const shardIdx = SyncManager.getShardIndex(pidStr);

    // 1. Update Dirty Shards
    const dirtyShards = this.getDirtyShards();
    if (!dirtyShards.includes(shardIdx)) {
      dirtyShards.push(shardIdx);
      GM_setValue(KEY_DIRTY_SHARDS, dirtyShards);
    }

    // 2. Update Last Activity
    const now = Date.now();
    GM_setValue(KEY_LAST_ACTIVITY, now);

    // 3. Reset Timer
    if (this.syncTimeout) clearTimeout(this.syncTimeout);
    this.scheduleSync(5000);
  }

  /**
   * Checks if a sync is pending from before reload.
   */
  private static checkPendingSync() {
    const dirtyShards = this.getDirtyShards();
    if (dirtyShards.length === 0) return;

    const lastActive = GM_getValue(KEY_LAST_ACTIVITY, 0);
    const now = Date.now();
    const elapsed = now - lastActive;
    const DEBOUNCE_TIME = 5000;

    if (elapsed >= DEBOUNCE_TIME) {
      // Timer already expired while we were gone -> Sync Immediately

      this.executeSync();
    } else {
      // Timer still running -> Resume wait
      const remaining = DEBOUNCE_TIME - elapsed;

      this.scheduleSync(remaining);
    }
  }

  private static scheduleSync(delayMs: number) {
    this.syncTimeout = setTimeout(() => this.executeSync(), delayMs);
  }

  private static async executeSync() {
    const dirtyShards = this.getDirtyShards();
    if (dirtyShards.length === 0) return;

    for (const shardIdx of dirtyShards) {
      try {
        // Get fresh data from DB
        const localData = await getLocalDataByShard(shardIdx);
        // Silent Sync: Do not prompt user if token is missing
        await SyncManager.syncShard(shardIdx, localData, true);
      } catch (e) {
        console.error(`❌ AutoSync Failed for Shard ${shardIdx}:`, e);
      }
    }

    // Cleanup
    GM_setValue(KEY_DIRTY_SHARDS, []);
  }

  private static getDirtyShards(): number[] {
    return GM_getValue(KEY_DIRTY_SHARDS, []);
  }
}
