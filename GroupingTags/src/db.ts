import { PostTagData } from './types';

const DB_NAME = 'GroupingTagsDB';
const DB_VERSION = 1;
const STORE_NAME = 'post_tags';

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Opens a connection to the IndexedDB database.
 * Implements a Singleton pattern to reuse the `dbPromise` unless connection is lost.
 * 
 * @returns A Promise resolving to the `IDBDatabase` instance.
 */
export const openDB = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'postId' });
            }
        };

        request.onsuccess = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            // Handle connection closing (optional but good practice)
            db.onclose = () => {
                dbPromise = null;
            };

            resolve(db);
        };

        request.onerror = (event) => {
            dbPromise = null; // Clear promise on error so we can retry
            reject((event.target as IDBOpenDBRequest).error);
        };
    });

    return dbPromise;
};

/**
 * Saves or updates post tag data in the database.
 * 
 * @param data The `PostTagData` object containing groups and metadata.
 */
export const savePostTagData = async (data: PostTagData): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(data);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
};

/**
 * Retrieves tag data for a specific post.
 * 
 * @param postId The ID of the post.
 * @returns The `PostTagData` if found, otherwise `undefined`.
 */
export const getPostTagData = async (postId: number): Promise<PostTagData | undefined> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(postId);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Deletes the tag data for a specific post.
 * 
 * @param postId The ID of the post to delete.
 */
export const deletePostTagData = async (postId: number): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(postId);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
};
