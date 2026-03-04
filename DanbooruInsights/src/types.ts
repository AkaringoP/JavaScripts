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
