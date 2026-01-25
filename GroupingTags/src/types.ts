/**
 * Represents the structure of tag grouping data stored in IndexedDB.
 */
export interface PostTagData {
  /** Primary Key: The ID of the post. */
  postId: number;
  /** Unix timestamp of the last update. */
  updatedAt: number;
  /** Flag to indicate if data was imported from an external source (default: false). */
  isImported?: boolean;
  /**
   * Map of Group Name to list of Tags.
   * key: Group Name (e.g., "Clothes")
   * value: Array of tags (e.g., ["shirt", "pants"])
   */
  groups: {
    [groupName: string]: string[];
  };
}

// Gist Manifest Structure
export interface GistManifest {
  schemaVersion: number; // e.g. 1
  lastSynced: number; // Unix Timestamp
  device: string; // e.g. "PC-Chrome"
  totalGroups: number; // Statistic
}

// Shard File Structure (Inside Gist)
export interface ShardData {
  [postId: string]: {
    updatedAt: number;
    isImported?: boolean;
    groups: Record<string, string[]>;
  };
}
