import { PostTagData } from './types';
/**
 * Opens a connection to the IndexedDB database.
 * Implements a Singleton pattern to reuse the `dbPromise` unless connection is lost.
 *
 * @returns A Promise resolving to the `IDBDatabase` instance.
 */
export declare const openDB: () => Promise<IDBDatabase>;
/**
 * Saves or updates post tag data in the database.
 *
 * @param data The `PostTagData` object containing groups and metadata.
 */
export declare const savePostTagData: (data: PostTagData) => Promise<void>;
/**
 * Retrieves tag data for a specific post.
 *
 * @param postId The ID of the post.
 * @returns The `PostTagData` if found, otherwise `undefined`.
 */
export declare const getPostTagData: (postId: number) => Promise<PostTagData | undefined>;
/**
 * Deletes the tag data for a specific post.
 *
 * @param postId The ID of the post to delete.
 */
export declare const deletePostTagData: (postId: number) => Promise<void>;
/**
 * Retrieves all data belonging to a specific shard (0-9).
 * Used for synchronization.
 */
export declare function getLocalDataByShard(shardIndex: number): Promise<Record<string, PostTagData>>;
