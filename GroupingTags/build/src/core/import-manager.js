import { AuthManager } from './auth';
import { sanitizeShardData } from './security';
import * as LZString from 'lz-string';
import { gmFetch } from './network';
export class ImportManager {
    // 1. Fetch External Gist & Parse
    static async fetchExternalGist(targetGistId) {
        // Authenticate if possible to avoid rate limits
        const token = await AuthManager.getToken();
        const response = await gmFetch(`https://api.github.com/gists/${targetGistId}`, {
            headers: token ? { "Authorization": `token ${token}` } : {}
        });
        if (!response.ok)
            throw new Error("Gist not found");
        const json = await response.json();
        // Collect data from all files (tags_0 ~ tags_9)
        let allRemoteData = {};
        for (const [fileName, fileNode] of Object.entries(json.files)) {
            if (fileName.startsWith('tags_') && fileNode.content) {
                try {
                    const decompressed = LZString.decompressFromUTF16(fileNode.content);
                    const rawData = JSON.parse(decompressed || "{}");
                    // 🚨 Security Sanitization
                    const cleanData = sanitizeShardData(rawData);
                    // Merge into result
                    Object.assign(allRemoteData, cleanData);
                }
                catch (e) {
                    console.warn(`File parse failed: ${fileName}`, e);
                }
            }
        }
        return allRemoteData;
    }
    // 2. Compare with Local DB (Diffing)
    static compareWithLocal(localData, remoteData) {
        const results = [];
        for (const [postId, remotePost] of Object.entries(remoteData)) {
            const localPost = localData[postId];
            // Case 1: New Data (Add)
            if (!localPost) {
                results.push({ postId, status: 'NEW', remote: remotePost });
                continue;
            }
            // Case 2: Deep Compare
            const isSame = this.isDeepEqual(localPost.groups, remotePost.groups);
            if (isSame) {
                // Case 3: Same Data (Ignore)
            }
            else {
                // Case 4: Conflict (Ask User)
                results.push({ postId, status: 'CONFLICT', local: localPost, remote: remotePost });
            }
        }
        return results;
    }
    // Simple Deep Equal Helper
    static isDeepEqual(obj1, obj2) {
        // Use canonical JSON stringify for comparison (keys sorted?)
        // Actually, simple JSON stringify might depend on key insertion order.
        // For arrays (tags), we should sort them first?
        // The sanitizer or DB saver doesn't enforce sorting tags.
        // Let's rely on simple stringify for now, but ideally we normalize.
        // But since `reconstructTags` or UI usage usually sorts? No?
        // Let's implement a better compare if needed, but for now simple stringify.
        return JSON.stringify(obj1) === JSON.stringify(obj2);
    }
}
// Logic: Smart Merge (Union)
export function mergeGroups(localGroups, remoteGroups) {
    const merged = { ...localGroups };
    for (const [groupName, remoteTags] of Object.entries(remoteGroups)) {
        // 1. Group not in local -> Add
        if (!merged[groupName]) {
            merged[groupName] = remoteTags;
            continue;
        }
        // 2. Group exists -> Union
        const localTags = merged[groupName];
        // Set for uniqueness + Sort
        const unionTags = Array.from(new Set([...localTags, ...remoteTags])).sort();
        merged[groupName] = unionTags;
    }
    return merged;
}
//# sourceMappingURL=import-manager.js.map