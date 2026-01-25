/**
 * Security Sanitizer
 * Role: Removes malicious code, special characters, and prototype pollution attempts from external data.
 */

// Permitted string patterns (Whitelist)
// Group Names: Strict Whitelist (Alphanumeric, underscores, hyphens, parentheses, whitespace)
// User wants strict control here to prevent confusion or XSS vectors in group labels.
const SAFE_GROUP_REGEX = /^[a-zA-Z0-9_\-\(\)\s]+$/;

// Tags: Broad Whitelist (Allow anything except Spaces and Control Characters)
// Danbooru tags cannot contain spaces (used as delimiter).
// They CAN contain special chars: < > * + = \ | ` : . ( ) etc. (proven by screenshot)
// Since we use 'textContent' for display (verified in sidebar.ts), these are safe from XSS.
// We only block Control Characters (0-31, 127) and Spaces.
const SAFE_TAG_REGEX = /^[^\s\x00-\x1F\x7F]+$/;

// Forbidden keys (Prototype Pollution)
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function sanitizeShardData(rawData: any): any {
  // 1. Basic Structure Check
  if (!rawData || typeof rawData !== 'object') {
    console.warn('⚠️ Security Warning: Invalid data format');
    return {};
  }

  const cleanData: any = {};

  // 2. Iterate Data (Per PostID)
  for (const [postId, postData] of Object.entries(rawData)) {
    // PostID Check (Digits only)
    if (!/^\d+$/.test(postId)) continue;

    const safePost: any = {
      updatedAt: 0, // Normalized to camalCase
      groups: {},
    };

    // Check if postData is object
    if (!postData || typeof postData !== 'object') continue;
    const pData = postData as any;

    // updatedAt Check (Number)
    // Support snake_case from cloud (updated_at) mapping to local camelCase (updatedAt)
    const ts = pData.updatedAt || pData.updated_at;
    if (typeof ts === 'number') {
      safePost.updatedAt = ts;
    }

    // isImported Flag (boolean)
    // Support snake_case (is_imported) -> local camelCase (isImported)
    const isImp =
      pData.isImported !== undefined ? pData.isImported : pData.is_imported;
    if (typeof isImp === 'boolean') {
      safePost.isImported = isImp;
    }

    // 3. Group Data Deep Inspection (Critical!)
    if (pData.groups && typeof pData.groups === 'object') {
      for (const [groupName, tags] of Object.entries(pData.groups)) {
        // [Defense 1] Prototype Pollution Block
        if (FORBIDDEN_KEYS.has(groupName)) {
          console.warn(
            `🚨 Security Warning: Polluted key detected (${groupName})`,
          );
          continue;
        }

        // [Defense 2] Group Name Whitelist (Strict Mode)
        if (!SAFE_GROUP_REGEX.test(groupName)) {
          console.warn(
            `⚠️ Security Warning: Invalid characters in group name (${groupName})`,
          );
          continue; // Skip entire group
        }

        // [Defense 3] Tag List Inspection (Broad Mode)
        if (Array.isArray(tags)) {
          const cleanTags = tags.filter(
            (tag: any) => typeof tag === 'string' && SAFE_TAG_REGEX.test(tag),
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
