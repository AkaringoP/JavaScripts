import Dexie, {type Table} from 'dexie';
import type {
  DailyCountRecord,
  PostRecord,
  PieStatRecord,
  CompletedYearRecord,
  ApprovalDetailRecord,
  HourlyStatRecord,
  TagAnalyticsReport,
  GrassSettings,
} from '../types';

// --- 1.5 Database (Dexie.js) ---
/**
 * Dexie.js database for caching Danbooru Grass data.
 * Manages schema versions and data persistence.
 * @extends Dexie
 */
export class Database extends Dexie {
  uploads!: Table<DailyCountRecord, string>;
  approvals!: Table<DailyCountRecord, string>;
  notes!: Table<DailyCountRecord, string>;
  posts!: Table<PostRecord, number>;
  piestats!: Table<PieStatRecord, [string, string | number]>;
  completed_years!: Table<CompletedYearRecord, string>;
  approvals_detail!: Table<ApprovalDetailRecord, number>;
  hourly_stats!: Table<HourlyStatRecord, string>;
  tag_analytics!: Table<TagAnalyticsReport, string>;
  grass_settings!: Table<GrassSettings, string>;

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

    // [v9] Add compound indexes to posts table for efficient per-user queries
    // [uploader_id+no]    — getMilestones: look up milestone posts by user-scoped sequence number
    // [uploader_id+score] — getTopScorePost: index-based sort by score per user
    this.version(9).stores({
      posts: 'id, uploader_id, no, created_at, score, rating, tag_count_general, [uploader_id+no], [uploader_id+score]'
    });
  }
}
