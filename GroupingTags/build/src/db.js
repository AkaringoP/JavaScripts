const DB_NAME = 'GroupingTagsDB';
const DB_VERSION = 1;
const STORE_NAME = 'post_tags';
let dbPromise = null;
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
export const savePostTagData = async (data) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(data);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
};
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
//# sourceMappingURL=db.js.map