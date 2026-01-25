/**
 * @fileoverview Sync Manager
 * Handles the synchronization logic between local IndexedDB and remote Gist storage.
 * Implements data sharding, compression, and smart merging.
 */

import {PostTagData} from '../types';
import {AuthManager} from './auth';
import {sanitizeShardData} from './security';
import * as LZString from 'lz-string';
import {gmFetch} from './network';

const API_BASE = 'https://api.github.com/gists';

export class SyncManager {
  /**
   * Calculates the shard index (0-9) based on the Post ID.
   * Uses the last digit of the numeric ID.
   * @param postId - The Danbooru Post ID.
   * @returns {number} The shard index (0-9).
   */
  static getShardIndex(postId: string): number {
    const lastChar = postId.slice(-1);
    const index = parseInt(lastChar, 10);
    return isNaN(index) ? 0 : index;
  }

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
  static async syncShard(
    shardIndex: number,
    localShardData: Record<string, PostTagData>,
    silent = false,
  ) {
    const token = await AuthManager.getToken(silent);
    if (!token && silent) {
      return;
    }

    const gistId = AuthManager.getGistId();

    if (!token || !gistId) throw new Error('Authentication missing');

    const fileName = `tags_${shardIndex}.json`;

    // 1. Fetch Latest from Gist (GET)
    const gistResponse = await gmFetch(`${API_BASE}/${gistId}`, {
      headers: {
        Authorization: `token ${token}`,
        'Cache-Control': 'no-cache',
      },
    });

    const gistJson = await gistResponse.json();
    const fileNode = gistJson.files[fileName];

    // 2. Decompress & Sanitize
    let cloudData: Record<string, any> = {};

    if (fileNode && fileNode.content) {
      try {
        const decompressed = LZString.decompressFromUTF16(fileNode.content);
        const rawJson = JSON.parse(decompressed || '{}');
        cloudData = sanitizeShardData(rawJson);
      } catch (e) {
        console.error('Data parse failed (Possibly corrupted)', e);
        cloudData = {};
      }
    }

    // 3. Merge (Smart Logic)
    const mergedData = {...cloudData};
    let hasChanges = false;

    for (const [postId, localPost] of Object.entries(localShardData)) {
      const cloudPost = cloudData[postId];
      const localPostForCloud = {...localPost};
      let shouldUpdate = false;

      if (!cloudPost) {
        shouldUpdate = true;
      } else {
        const cloudTs = cloudPost.updatedAt || 0;
        if (localPost.updatedAt > cloudTs) {
          shouldUpdate = true;
        }
      }

      if (shouldUpdate) {
        mergedData[postId] = localPostForCloud;
        hasChanges = true;
      }
    }

    if (!hasChanges) {
      return;
    }

    // 4. Compress & Upload (PATCH)
    const compressedPayload = LZString.compressToUTF16(
      JSON.stringify(mergedData),
    );

    await gmFetch(`${API_BASE}/${gistId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: {
          [fileName]: {content: compressedPayload},
        },
      }),
    });
  }
}
