import Dexie, {type Table} from 'dexie';

// --- 1.5 Database (Dexie.js) ---
/**
 * Dexie.js database for caching Danbooru Grass data.
 * Manages schema versions and data persistence.
 * @extends Dexie
 */
export class Database extends Dexie {
  uploads!: Table<any>;
  approvals!: Table<any>;
  notes!: Table<any>;
  posts!: Table<any>;
  piestats!: Table<any>;
  completed_years!: Table<any>;
  approvals_detail!: Table<any>;
  hourly_stats!: Table<any>;
  tag_analytics!: Table<any>;
  grass_settings!: Table<any>;

  /**
   * Initializes the database with defined schemas.
   */
  constructor() {
    super('DanbooruGrassDB');

    // [v1] Existing schema (used up to v3.1) - For Grass feature
    // Do not modify. (Legacy)
    this.version(1).stores({
      uploads: 'id, userId, date, count', // id: [userId]_[date]
      approvals: 'id, userId, date, count',
      notes: 'id, userId, date, count'
    });

    // [v2] New schema (v4.0 update) - Analytics feature added
    // Keep existing tables, define new 'posts' table.
    this.version(2).stores({
      // 1. Keep existing tables (Grass)
      uploads: 'id, userId, date, count',
      approvals: 'id, userId, date, count',
      notes: 'id, userId, date, count',

      // 2. Add new table (Analytics)
      // Index description:
      // PK: id (Post ID is unique global)
      // no: User-specific sequence (1-based index)
      posts: 'id, uploader_id, no, created_at, score, rating, tag_count_general'
    });

    // [v3] Stats Cache
    // Cache expensive aggregations (Pie Charts)
    // PK: [key+userId] (Compound key for uniqueness per user per metric)
    this.version(3).stores({
      uploads: 'id, userId, date, count',
      approvals: 'id, userId, date, count',
      notes: 'id, userId, date, count',
      posts: 'id, uploader_id, no, created_at, score, rating, tag_count_general',
      piestats: '[key+userId], userId, updated_at'
    });

    // [v4] Completed Years Cache
    // Tracks if a full year data has been successfully fetched/synced.
    // PK: [userId+metric+year] (Compound key)
    this.version(4).stores({
      uploads: 'id, userId, date, count',
      approvals: 'id, userId, date, count',
      notes: 'id, userId, date, count',
      posts: 'id, uploader_id, no, created_at, score, rating, tag_count_general', // Analytics
      piestats: '[key+userId], userId, updated_at', // Pie Stats
      completed_years: 'id, userId, metric, year', // Full Year Cache Status
      approvals_detail: 'id, userId', // Detailed Post IDs for Approvals
      hourly_stats: 'id, userId, metric, year' // Hourly aggregation (24 rows/year)
    });

    // [v5] Bubble Chart Data
    // PK: [userId+copyright]
    this.version(5).stores({
      uploads: 'id, userId, date, count',
      approvals: 'id, userId, date, count',
      notes: 'id, userId, date, count',
      posts: 'id, uploader_id, no, created_at, score, rating, tag_count_general',
      piestats: '[key+userId], userId, updated_at',
      completed_years: 'id, userId, metric, year',
      approvals_detail: 'id, userId',
      hourly_stats: 'id, userId, metric, year',
      bubble_data: '[userId+copyright], userId, copyright, updated_at'
    });

    // [v6] Tag Analytics Cache
    this.version(6).stores({
      uploads: 'id, userId, date, count',
      approvals: 'id, userId, date, count',
      notes: 'id, userId, date, count',
      posts: 'id, uploader_id, no, created_at, score, rating, tag_count_general',
      piestats: '[key+userId], userId, updated_at',
      completed_years: 'id, userId, metric, year',
      approvals_detail: 'id, userId',
      hourly_stats: 'id, userId, metric, year',
      bubble_data: '[userId+copyright], userId, copyright, updated_at',
      tag_analytics: 'tagName, updatedAt'
    });

    // [v7] Per-User GrassApp Layout Settings
    this.version(7).stores({
      uploads: 'id, userId, date, count',
      approvals: 'id, userId, date, count',
      notes: 'id, userId, date, count',
      posts: 'id, uploader_id, no, created_at, score, rating, tag_count_general',
      piestats: '[key+userId], userId, updated_at',
      completed_years: 'id, userId, metric, year',
      approvals_detail: 'id, userId',
      hourly_stats: 'id, userId, metric, year',
      bubble_data: '[userId+copyright], userId, copyright, updated_at',
      tag_analytics: 'tagName, updatedAt',
      grass_settings: 'userId' // PK: userId
    });

    // [v8] Remove Bubble Chart Data
    this.version(8).stores({
      bubble_data: null
    });
  }
}
