/**
 * @fileoverview Sync Manager
 * Handles the synchronization logic between local IndexedDB and remote Gist storage.
 * Implements data sharding, compression, and smart merging.
 */
import { PostTagData } from '../types';
export declare class SyncManager {
    /**
     * Calculates the shard index (0-9) based on the Post ID.
     * Uses the last digit of the numeric ID.
     * @param postId - The Danbooru Post ID.
     * @returns {number} The shard index (0-9).
     */
    static getShardIndex(postId: string): number;
    /**
     * Synchronizes a specific data shard with the Gist.
     * 1. Downloads the latest shard file from Gist.
     * 2. Decompresses and sanitizes the data.
     * 3. Merges local changes into the remote data (Last-Write-Wins based on `updatedAt`).
     * 4. Uploads the merged data back to Gist if changes occurred.
     *
     * @param shardIndex - The index of the shard to sync (0-9).
     * @param localShardData - The local data for this shard.
     * @param silent - If true, suppresses auth warnings.
     */
    static syncShard(shardIndex: number, localShardData: Record<string, PostTagData>, silent?: boolean): Promise<void>;
}
