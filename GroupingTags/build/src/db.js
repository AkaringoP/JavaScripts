const DB_NAME = 'GroupingTagsDB';
const DB_VERSION = 1;
const STORE_NAME = 'post_tags';
let dbPromise = null;
/**
 * Opens a connection to the IndexedDB database.
 * Implements a Singleton pattern to reuse the `dbPromise` unless connection is lost.
 *
 * @returns A Promise resolving to the `IDBDatabase` instance.
 */
export const openDB = () => {
    if (dbPromise)
        return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'postId' });
            }
        };
        request.onsuccess = (event) => {
            const db = event.target.result;
            // Handle connection closing (optional but good practice)
            db.onclose = () => {
                dbPromise = null;
            };
            resolve(db);
        };
        request.onerror = (event) => {
            dbPromise = null; // Clear promise on error so we can retry
            reject(event.target.error);
        };
    });
    return dbPromise;
};
/**
 * Saves or updates post tag data in the database.
 *
 * @param data The `PostTagData` object containing groups and metadata.
 */
export const savePostTagData = async (data) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(data);
        request.onsuccess = () => {
            // Dynamic Import to avoid cycle if possible, but AutoSyncManager depends on DB? 
            // AutoSyncManager depends on SyncManager -> DB. 
            // DB -> AutoSyncManager.
            // Circular dependency is risky. Let's use dynamic import.
            import('./core/auto-sync').then(({ AutoSyncManager }) => {
                AutoSyncManager.notifyChange(data.postId);
            });
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
};
/**
 * Retrieves tag data for a specific post.
 *
 * @param postId The ID of the post.
 * @returns The `PostTagData` if found, otherwise `undefined`.
 */
export const getPostTagData = async (postId) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(postId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};
/**
 * Deletes the tag data for a specific post.
 *
 * @param postId The ID of the post to delete.
 */
export const deletePostTagData = async (postId) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(postId);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
};
/**
 * Retrieves all data belonging to a specific shard (0-9).
 * Used for synchronization.
 */
export async function getLocalDataByShard(shardIndex) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll(); // Get ALL data (IDB cursors might be better for huge datasets)
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const allData = request.result;
            const shardData = {};
            allData.forEach(item => {
                // Check last digit of PostID
                const pidStr = item.postId.toString();
                const lastChar = pidStr.slice(-1);
                const idx = parseInt(lastChar, 10);
                if (idx === shardIndex) {
                    shardData[pidStr] = item;
                }
            });
            resolve(shardData);
        };
    });
}
//# sourceMappingURL=db.js.map