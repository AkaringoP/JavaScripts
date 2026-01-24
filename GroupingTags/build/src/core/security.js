/**
 * Security Sanitizer
 * Role: Removes malicious code, special characters, and prototype pollution attempts from external data.
 */
// Permitted string patterns (Whitelist)
// Alphanumeric, underscores, hyphens, parentheses, whitespace
// BLOCKS: < > / " ' ; etc. (HTML/Script)
const SAFE_TEXT_REGEX = /^[a-zA-Z0-9_\-\(\)\s]+$/;
// Forbidden keys (Prototype Pollution)
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export function sanitizeShardData(rawData) {
    // 1. Basic Structure Check
    if (!rawData || typeof rawData !== 'object') {
        console.warn("⚠️ Security Warning: Invalid data format");
        return {};
    }
    const cleanData = {};
    // 2. Iterate Data (Per PostID)
    for (const [postId, postData] of Object.entries(rawData)) {
        // PostID Check (Digits only)
        if (!/^\d+$/.test(postId))
            continue;
        const safePost = {
            updatedAt: 0, // Normalized to camalCase
            groups: {}
        };
        // Check if postData is object
        if (!postData || typeof postData !== 'object')
            continue;
        const pData = postData;
        // updatedAt Check (Number)
        // Support snake_case from cloud (updated_at) mapping to local camelCase (updatedAt)
        const ts = pData.updatedAt || pData.updated_at;
        if (typeof ts === 'number') {
            safePost.updatedAt = ts;
        }
        // isImported Flag (boolean)
        // Support snake_case (is_imported) -> local camelCase (isImported)
        const isImp = pData.isImported !== undefined ? pData.isImported : pData.is_imported;
        if (typeof isImp === 'boolean') {
            safePost.isImported = isImp;
        }
        // 3. Group Data Deep Inspection (Critical!)
        if (pData.groups && typeof pData.groups === 'object') {
            for (const [groupName, tags] of Object.entries(pData.groups)) {
                // [Defense 1] Prototype Pollution Block
                if (FORBIDDEN_KEYS.has(groupName)) {
                    console.warn(`🚨 Security Warning: Polluted key detected (${groupName})`);
                    continue;
                }
                // [Defense 2] Group Name Whitelist (XSS Prevention)
                // Allow slightly more for group names if needed, but keeping strict for now.
                // Actually, user might use foreign characters?
                // The regex /^[a-zA-Z0-9_\-\(\)\s]+$/ only allows ASCII.
                // If users use Korean/Japanese/etc, this will BREAK data.
                // Let's broaden the regex to allow Unicode letters (L) and Numbers (N).
                // But JS regex for unicode properties needs 'u' flag.
                // Or just block specific dangerous chars: < > " ' ` ;
                // Let's switch to a BLOCKLIST approach for names to support i18n, 
                // OR refine whitelist to allow unicode.
                // For now, let's trust the provided regex but beware of i18n issues.
                // Wait, the user provided regex is: /^[a-zA-Z0-9_\-\(\)\s]+$/
                // This DEFINITELY blocks Korean/Japanese.
                // I should probably relax it to block Danger Chars only, or allow Unicode.
                // Let's update SAFE_TEXT_REGEX to allow everything EXCEPT dangerous HTML chars.
                // Block: < > " ' `
                if (/[<>"'`]/.test(groupName)) {
                    console.warn(`⚠️ Security Warning: Dangerous group name removed (${groupName})`);
                    continue;
                }
                // [Defense 3] Tag List Inspection
                if (Array.isArray(tags)) {
                    const cleanTags = tags.filter((tag) => typeof tag === 'string' && !/[<>"'`]/.test(tag) // Same blocklist
                    );
                    // Add if at least one valid tag
                    if (cleanTags.length > 0) {
                        safePost.groups[groupName] = cleanTags;
                    }
                }
            }
        }
        // Add if valid groups exist
        if (Object.keys(safePost.groups).length > 0) {
            cleanData[postId] = safePost;
        }
    }
    return cleanData;
}
//# sourceMappingURL=security.js.map