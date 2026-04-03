// Shared interfaces and type aliases for DanbooruInsights.

/** A color theme definition for the contribution graph. */
export interface Theme {
  name: string;
  bg: string;
  empty: string;
  text: string;
  /** Five-step color ramp for contribution levels (lightest → darkest). */
  levels?: string[];
  /** Custom scrollbar thumb color. */
  scrollbar?: string;
}

/** Threshold values for each contribution metric. */
export interface ThresholdMap {
  uploads: number[];
  approvals: number[];
  notes: number[];
}

/** Persisted user settings stored in localStorage. */
export interface SettingsData {
  theme: string;
  thresholds: ThresholdMap;
  /** Maps userId → last used metric mode. */
  rememberedModes: Record<string, string>;
  /** Max post-count diff allowed before triggering an automatic sync. */
  syncThreshold?: number;
}

/** Contribution metric identifier. */
export type Metric = 'uploads' | 'approvals' | 'notes';

/** Target user profile extracted from the DOM. */
export interface TargetUser {
  name: string;
  normalizedName: string;
  id: string | null;
  created_at: string;
  joinDate: Date;
  level_string: string | null;
}

/** Aggregated metric data for a single year. */
export interface MetricData {
  /** Maps ISO date strings (YYYY-MM-DD) to post counts. */
  daily: Record<string, number>;
  /** Post counts indexed by hour-of-day (0–23). */
  hourly: number[];
}

/** Danbooru post media variant (modern API). */
export interface PostVariant {
  type: string;
  url: string;
  file_ext: string;
  width?: number;
  height?: number;
}

/** GrassApp layout settings persisted per user. */
export interface GrassSettings {
  userId: string;
  width?: number;
  xOffset?: number;
  updated_at: string;
}

/** Distribution chart item (character, copyright, hair, breasts, etc.). */
export interface DistributionItem {
  name: string;
  tagName?: string;
  originalTag?: string;
  count: number;
  frequency: number;
  thumb: string | null;
  isOther: boolean;
  color?: string;
}

/** Sync progress state for AnalyticsDataManager. */
export interface SyncProgress {
  current: number;
  total: number;
  message: string;
}

/** CalHeatmap datum bound to SVG rect elements. */
export interface CalHeatmapDatum {
  /** Unix timestamp in milliseconds. */
  t: number;
  /** Contribution count (null if no data). */
  v: number | null;
}

/** Scatter plot data point. */
export interface ScatterDataPoint {
  id: number;
  /** Date timestamp. */
  d: number;
  /** Score. */
  s: number;
  /** General tag count. */
  t: number;
  /** Rating (g/s/q/e). */
  r: string;
}

/** Danbooru rating code. */
export type Rating = 'g' | 's' | 'q' | 'e';

/** Daily count record for uploads/approvals/notes tables. */
export interface DailyCountRecord {
  /** Composite key: `${userId}_${date}`. */
  id: string;
  userId: string;
  date: string;
  count: number;
}

/** Completed year cache record. */
export interface CompletedYearRecord {
  id: string;
  userId: string;
  metric: string;
  year: number;
}

/** Approval detail record. */
export interface ApprovalDetailRecord {
  id: number;
  userId: string;
}

/** Hourly stats cache record. */
export interface HourlyStatRecord {
  id: string;
  userId: string;
  metric: string;
  year: number;
}

/** Full post record stored in the `posts` IndexedDB table. */
export interface PostRecord {
  id: number;
  uploader_id: number;
  /** User-scoped sequence number (1-based, per uploader_id). */
  no: number;
  created_at: string;
  score: number;
  rating: string;
  tag_count_general: number;
  approver_id?: number;
  uploader_name?: string;
  uploader_level?: string;
  approver_name?: string;
  approver_level?: string;
  variants?: PostVariant[];
  preview_file_url?: string;
  file_url?: string;
  tag_string_copyright?: string;
  tag_string_character?: string;
}

/** Cached pie chart statistics record in the `piestats` table. */
export interface PieStatRecord {
  key: string;
  userId: string | number;
  data: unknown;
  updated_at: string;
}

/** Monthly post count history entry. */
export interface HistoryEntry {
  /** Date string in YYYY-MM-DD format (always first of month). */
  date: string;
  count: number;
  cumulative: number;
}

/** User ranking entry for tag analytics leaderboards. */
export interface UserRanking {
  id: string | number;
  count: number;
  rank?: number;
  name?: string;
  level?: string | null;
}

/** Milestone post entry. */
export interface MilestoneEntry {
  milestone: number;
  post: {
    id: number;
    created_at: string;
    uploader_id: number;
    uploader_name?: string;
    uploader_level?: string;
    approver_id?: number;
    approver_name?: string;
    rating: string;
    score: number;
    variants?: PostVariant[];
    preview_file_url?: string;
    file_url?: string;
  };
}

/** A single tag cloud entry with name and frequency. */
export interface TagCloudItem {
  /** Display name (underscores replaced with spaces). */
  name: string;
  /** Raw tag name for URL construction. */
  tagName: string;
  /** Co-occurrence frequency (0..1) from related_tag API. */
  frequency: number;
  /** Estimated post count (frequency × total query posts). */
  count: number;
}

/** Cached tag analytics report stored in the `tag_analytics` table. */
export interface TagAnalyticsReport {
  tagName: string;
  updatedAt: number;
  data: TagAnalyticsMeta;
}

/** Complete tag analytics metadata. */
export interface TagAnalyticsMeta {
  name: string;
  /** Category ID: 1=Artist, 3=Copyright, 4=Character. */
  category: number;
  post_count: number;
  created_at: string;
  updatedAt: number;
  _isCached?: boolean;
  firstPost?: PostRecord;
  hundredthPost?: PostRecord;
  timeToHundred?: number;
  historyData: HistoryEntry[];
  precalculatedMilestones: MilestoneEntry[];
  rankings: {
    uploader: {allTime: UserRanking[]; year: UserRanking[]; first100: UserRanking[]};
    approver: {allTime: UserRanking[]; year: UserRanking[]; first100: UserRanking[]};
  };
  statusCounts: Record<string, number>;
  ratingCounts: Record<string, number>;
  commentaryCounts?: Record<string, number>;
  copyrightCounts?: Record<string, number>;
  characterCounts?: Record<string, number>;
  latestPost?: PostRecord;
  trendingPost?: PostRecord;
  trendingPostNSFW?: PostRecord;
  newPostCount?: number;
}
