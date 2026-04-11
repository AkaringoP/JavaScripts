import {DataManager} from './data-manager';
import type {ApiItem} from './data-manager';
import type {RateLimitedFetch} from './rate-limiter';
import {CONFIG} from '../config';
import {isTopLevelTag, getBestThumbnailUrl} from '../utils';
import type {TargetUser, DistributionItem, SyncProgress, ScatterDataPoint, TagCloudItem, CreatedTagItem, UserStatsRecord} from '../types';

/** Summary statistics for a user's upload history. */
export interface SummaryStats {
  maxUploads: number;
  maxDate: string;
  firstUploadDate: Date | null;
  lastUploadDate: Date | null;
  count1Year: number;
  maxUploads1Year: number;
  maxDate1Year: string;
  maxStreak: number;
  maxStreakStart: string | null;
  maxStreakEnd: string | null;
  activeDays: number;
}

/** A milestone post entry. */
export interface MilestoneEntry {
  type: string;
  post: any;
  index: number;
}

/** Monthly upload count entry. */
export interface MonthlyStatEntry {
  date: string;
  count: number;
  label: string;
}

/** A user promotion event parsed from feedbacks. */
export interface PromotionEvent {
  date: Date;
  role: string;
  rawBody: string;
}

/** A user level change event parsed from mod_actions. */
export interface LevelChangeEvent {
  date: Date;
  fromLevel: string;
  toLevel: string;
  isPromotion: boolean;
}

/** A lightweight milestone entry for the timeline (date only, no thumbnail). */
export interface TimelineMilestone {
  index: number;
  date: Date;
}

/**
 * Input counts for Untagged translation inclusion-exclusion formula.
 * See PLAN.md §9 for derivation and TC-A~E in test/translation-distribution.test.ts.
 */
export interface UntaggedTranslationCounts {
  /** |user:X *_text| — all posts with any _text tag */
  t: number;
  /** |user:X english_text| = |T ∩ E| (english_text ⊆ T) */
  a: number;
  /** |user:X *_text translation_request| = |T ∩ R| */
  b: number;
  /** |user:X *_text translated| = |T ∩ TR| */
  c: number;
  /** |user:X english_text translation_request| = |T ∩ E ∩ R| */
  ab: number;
  /** |user:X english_text translated| = |T ∩ E ∩ TR| */
  ac: number;
}

/**
 * Computes Untagged translation count via inclusion-exclusion:
 *   Untagged = max(0, t − a − b − c + ab + ac)
 *
 * Assumption (Assumption-1): |R ∩ TR| ≈ 0 (translation_request and translated
 * are mutually exclusive states). Necessary because |T ∩ R ∩ TR| requires a
 * 3-tag query which exceeds the Member(Blue) 2-tag limit.
 *
 * See PLAN.md §9 for full derivation.
 */
export function computeUntaggedTranslation(counts: UntaggedTranslationCounts): number {
  const {t, a, b, c, ab, ac} = counts;
  return Math.max(0, t - a - b - c + ab + ac);
}

/**
 * Builds the 6 subqueries for Untagged inclusion-exclusion calculation plus the
 * BC intersection query used for Assumption-1 runtime monitoring. All queries
 * use ≤2 real tags so they work on Member(Blue) accounts.
 */
export function buildUntaggedTranslationQueries(normalizedName: string): {
  t: string;
  a: string;
  b: string;
  c: string;
  ab: string;
  ac: string;
  bc: string;
} {
  const u = `user:${normalizedName}`;
  return {
    t: `${u} *_text`,
    a: `${u} english_text`,
    b: `${u} *_text translation_request`,
    c: `${u} *_text translated`,
    ab: `${u} english_text translation_request`,
    ac: `${u} english_text translated`,
    bc: `${u} translation_request translated`,
  };
}

/**
 * AnalyticsDataManager: Handles heavy data fetching for full history.
 */
export class AnalyticsDataManager extends DataManager {
  static isGlobalSyncing: boolean = false;
  static syncProgress: SyncProgress = { current: 0, total: 0, message: '' };
  static onProgressCallback: ((current: number, total: number, message?: string) => void) | null = null;

  /**
   * @param {Database} db The Dexie database instance.
   * @param {RateLimitedFetch=} rateLimiter Optional shared rate limiter.
   */
  constructor(db: any, rateLimiter?: RateLimitedFetch | null) {
    super(db, rateLimiter ?? null);
  }

  /**
   * Centrally selects the most appropriate thumbnail URL for a post.
   * Prioritizes high-quality WebP variants (720x720 or 360x360) for performance.
   * @param {Object} post The post data object from Danbooru API.
   * @return {string} The selected thumbnail URL.
   */
  /**
   * Fetches a thumbnail URL with built-in retry logic for handling rate limits.
   * Implements exponential backoff on 429 status codes.
   * @param {string} tags The tag string to search for.
   * @param {number=} retries Number of allowed retries (default: 3).
   * @param {number=} delay Initial delay in ms before retry (default: 2000).
   * @return {Promise<string>} The preview URL or an empty string if not found or failed.
   */
  async fetchThumbnailWithRetry(tags: string, retries: number = 3, delay: number = 2000): Promise<string> {
    const url = `/posts.json?tags=${encodeURIComponent(tags)}&limit=1&only=preview_file_url,variants,rating`;
    for (let i = 0; i < retries; i++) {
      try {
        const resp = await this.rateLimiter.fetch(url);
        if (resp.status === 429) {
          await new Promise(r => setTimeout(r, delay + Math.random() * 2000));
          delay *= 2;
          continue;
        }
        if (resp.status === 422) return ''; // Unprocessable query — no point retrying
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (Array.isArray(data) && data.length > 0) {
          return getBestThumbnailUrl(data[0]);
        }
        return '';
      } catch (e: unknown) {
        if (i === retries - 1) {
          console.warn(`[Analytics] Failed thumb fetch after ${retries} tries: ${tags}`, e);
          return '';
        }
        await new Promise(r => setTimeout(r, delay));
      }
    }
    return '';
  }

  /**
   * Retrieves synchronization statistics for a specific user from the local database.
   * @param {!Object} userInfo The user's information object.
   * @return {Promise<{count: number, lastSync: ?string}>} Object containing post count and last sync date.
   */
  async getSyncStats(userInfo: TargetUser): Promise<{count: number; lastSync: string | null}> {
    const uploaderId = parseInt(userInfo.id ?? '0');
    if (!uploaderId) return { count: 0, lastSync: null };

    const count = await this.db.posts.where('uploader_id').equals(uploaderId).count();
    const lastEntry = await this.db.posts.orderBy('created_at').last();

    return {
      count,
      lastSync: lastEntry ? lastEntry.created_at : null // Approximate
    };
  }

  /**
   * Calculates summary statistics including max uploads, streaks, and active days.
   * Iterates through all synced posts for the user to determine the most active day and longest upload streak.
   * @param {!Object} userInfo The user's information object.
   * @return {Promise<{maxUploads: number, maxDate: string, firstUploadDate: ?Date, lastUploadDate: ?Date, count1Year: number, maxUploads1Year: number, maxDate1Year: string, maxStreak: number, maxStreakStart: ?string, maxStreakEnd: ?string, activeDays: number}>} Summary stats.
   */
  async getSummaryStats(userInfo: TargetUser): Promise<SummaryStats> {
    const uploaderId = parseInt(userInfo.id ?? '0');
    if (!uploaderId) return { maxUploads: 0, maxDate: 'N/A', firstUploadDate: null, lastUploadDate: null } as SummaryStats;

    const historyAll: Record<string, number> = {};
    const history1Year: Record<string, number> = {};
    let firstUploadDate: Date | null = null;
    let lastUploadDate: Date | null = null;

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    let count1Year = 0;
    let totalCount = 0;

    // Cursor iteration: processes one record at a time to avoid loading all posts into memory
    await this.db.posts.where('uploader_id').equals(uploaderId).each((p: ApiItem) => {
      totalCount++;
      const dStr = p['created_at'].split('T')[0];
      historyAll[dStr] = (historyAll[dStr] || 0) + 1;

      const d = new Date(p.created_at);
      if (!firstUploadDate || d < firstUploadDate) {
        firstUploadDate = d;
      }
      if (!lastUploadDate || d > lastUploadDate) {
        lastUploadDate = d;
      }

      if (d >= oneYearAgo) {
        history1Year[dStr] = (history1Year[dStr] || 0) + 1;
        count1Year++;
      }
    });

    if (totalCount === 0) return { maxUploads: 0, maxDate: 'N/A', firstUploadDate: null, lastUploadDate: null } as SummaryStats;

    let maxUploads = 0;
    let maxDate = 'N/A';

    const sortedDates = Object.keys(historyAll).sort();
    const activeDays = sortedDates.length;

    for (const [date, count] of Object.entries(historyAll)) {
      if ((count as number) > maxUploads) {
        maxUploads = count as number;
        maxDate = date;
      }
    }

    let maxStreak = 0;
    let maxStreakStart: string | null = null;
    let maxStreakEnd: string | null = null;

    let currentStreak = 0;
    let currentStreakStart: string | null = null;
    let lastDateObj: Date | null = null;

    for (const dateStr of sortedDates) {
      const d = new Date(dateStr);
      d.setHours(0, 0, 0, 0);
      if (!lastDateObj) {
        currentStreak = 1;
        currentStreakStart = dateStr;
      } else {
        const diffTime = (d as any) - (lastDateObj as any);
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          currentStreak++;
        } else if (diffDays > 1) {
          currentStreak = 1;
          currentStreakStart = dateStr;
        }
      }
      if (currentStreak > maxStreak) {
        maxStreak = currentStreak;
        maxStreakStart = currentStreakStart;
        maxStreakEnd = dateStr;
      }
      lastDateObj = d;
    }

    let maxUploads1Year = 0;
    let maxDate1Year = 'N/A';
    for (const [date, count] of Object.entries(history1Year)) {
      if ((count as number) > maxUploads1Year) {
        maxUploads1Year = count as number;
        maxDate1Year = date;
      }
    }

    return {
      maxUploads,
      maxDate,
      firstUploadDate,
      lastUploadDate,
      count1Year,
      maxUploads1Year,
      maxDate1Year,
      maxStreak,
      maxStreakStart,
      maxStreakEnd,
      activeDays
    };
  }

  /**
   * Retrieves milestone posts (e.g., 1st, 100th, 1000th) based on local sequence.
   * Automatically adjusts step size based on total post count if 'auto' is selected.
   * @param {!Object} userInfo The user's information object.
   * @param {boolean=} isNsfwEnabled Whether to fetch thumbnails for all posts regardless of rating.
   * @param {(string|number)=} customStep Step interval ('auto' or a number).
   * @return {Promise<!Array<{type: string, post: !Object, index: number}>>} List of milestone posts.
   */
  /**
   * Builds the milestone target sequence (numeric values only) for a given
   * total post count and step mode. Used by both `getMilestones` (to look up
   * cached posts at those target positions) and `getNextMilestone` (to find
   * the smallest target above the current total). Pure / no DB access.
   */
  buildMilestoneTargets(total: number, customStep: 'auto' | 'repdigit' | number): number[] {
    let targets: number[] = [];

    if (customStep === 'repdigit') {
      // Repdigit milestones: 111, 222, ..., 999, 1111, ..., 9999, 11111, ...
      targets.push(1);
      if (total >= 11) targets.push(11);
      for (let digits = 3; digits <= 6; digits++) {
        for (let d = 1; d <= 9; d++) {
          const num = parseInt(String(d).repeat(digits));
          if (num <= total) targets.push(num);
        }
      }
    } else if (customStep !== 'auto' && typeof customStep === 'number') {
      const step = customStep as number;
      targets.push(1);
      for (let i = step; i <= total; i += step) {
        targets.push(i);
      }
    } else {
      // Case 1: Small (< 1,500) -> 1, 100, 200...
      if (total < 1500) {
        targets.push(1);
        for (let i = 100; i <= total; i += 100) {
          targets.push(i);
        }
      }
      // Case 2: Medium (1,500 ~ 10,000) -> 1, 100, 500, 1000, 1500, 2000...
      else if (total <= 10000) {
        targets.push(1);
        if (total >= 100) targets.push(100);
        for (let i = 500; i <= total; i += 500) {
          targets.push(i);
        }
      }
      // Case 4: Huge (> 100,000) -> 1, 100, 1000, 5000, 10000, ... (Step 5000)
      else if (total > 100000) {
        targets.push(1);
        if (total >= 100) targets.push(100);
        if (total >= 1000) targets.push(1000);
        for (let i = 5000; i <= total; i += 5000) {
          targets.push(i);
        }
      }
      // Case 3: Very Large (> 50,000) -> 1, 100, 1000, 2500, 5000, ... (Step 2500)
      else if (total > 50000) {
        targets.push(1);
        if (total >= 100) targets.push(100);
        if (total >= 1000) targets.push(1000);
        for (let i = 2500; i <= total; i += 2500) {
          targets.push(i);
        }
      }
      // Case 2: Large (> 10,000) -> 1, 100, 1000, 2000...
      else {
        targets.push(1);
        if (total >= 100) targets.push(100);
        for (let i = 1000; i <= total; i += 1000) {
          targets.push(i);
        }
      }
    }

    return [...new Set(targets)].sort((a, b) => a - b);
  }

  /**
   * Computes the next (un-reached) milestone target above `total`. Used by
   * the placeholder card at the end of the milestones grid. Returns null if
   * the mode genuinely has no next value (it shouldn't, but kept defensive).
   */
  getNextMilestone(total: number, customStep: 'auto' | 'repdigit' | number): number | null {
    if (customStep === 'repdigit') {
      // Repdigits below 11: 1 → 11 → 111 → 222 → ... → 999 → 1111 → ...
      if (total < 1) return 1;
      if (total < 11) return 11;
      for (let digits = 3; digits <= 7; digits++) {
        for (let d = 1; d <= 9; d++) {
          const num = parseInt(String(d).repeat(digits));
          if (num > total) return num;
        }
      }
      return null;
    }

    if (customStep !== 'auto' && typeof customStep === 'number') {
      const step = customStep;
      if (total < 1) return 1;
      // Next multiple of step strictly greater than total
      return Math.floor(total / step) * step + step;
    }

    // Auto mode — pick the step the same way buildMilestoneTargets would
    // for the *next* count and find the smallest milestone > total.
    if (total < 1) return 1;
    if (total < 100) return 100;
    let step: number;
    if (total < 1500) step = 100;
    else if (total <= 10000) step = 500;
    else if (total <= 50000) step = 1000;
    else if (total <= 100000) step = 2500;
    else step = 5000;
    return Math.floor(total / step) * step + step;
  }

  async getMilestones(userInfo: TargetUser, isNsfwEnabled: boolean = false, customStep: 'auto' | 'repdigit' | number = 'auto'): Promise<MilestoneEntry[]> {
    const uploaderId = parseInt(userInfo.id ?? '0');
    if (!uploaderId) return [];

    const total = await this.db.posts.where('uploader_id').equals(uploaderId).count();
    if (total === 0) return [];

    const targets = this.buildMilestoneTargets(total, customStep);

    // Use compound index [uploader_id+no] to fetch only this user's posts at the target positions
    const matches: ApiItem[] = await this.db.posts
      .where('[uploader_id+no]').anyOf(targets.map((no: number) => [uploaderId, no]))
      .toArray();

    // NEW: Fetch missing thumbnails for Safety logic
    // We want to show thumbnails for Safe(s) or General(g) posts.
    // OR if NSFW is enabled, show all.
    // If we don't have 'preview_file_url' locally (old sync), we fetch it now.
    const missingIds: number[] = [];
    matches.forEach(p => {
      const isSafe = (p.rating === 's' || p.rating === 'g');
      const shouldFetch = isNsfwEnabled || isSafe;
      if (shouldFetch && (!p.variants || p.variants.length === 0)) {
        missingIds.push(p.id);
      }
    });

    if (missingIds.length > 0) {
      try {
        // Chunk requests if too many
        const chunkSize = 100;
        for (let i = 0; i < missingIds.length; i += chunkSize) {
          const chunk = missingIds.slice(i, i + chunkSize);
          const idsStr = chunk.join(',');
          const url = `${this.baseUrl}/posts.json?tags=id:${idsStr}&limit=100&only=id,variants,rating,preview_file_url`;

          const res = await this.rateLimiter.fetch(url);
          if (res.ok) {
            const fetchedItems = await res.json();
            // Update local matches objects
            fetchedItems.forEach((item: ApiItem) => {
              const local = matches.find((m: ApiItem) => m['id'] === item['id']);
              if (local) {
                local.variants = item.variants;
                local.preview_file_url = item.preview_file_url;
                // Ensure rating matches just in case
                local.rating = item.rating;

                // Update DB for persistence (no need for bulkPut if we do it here)
                this.db.posts.update(local.id, {
                  variants: item.variants,
                  preview_file_url: item.preview_file_url,
                  rating: item.rating
                }).catch((e: unknown) => console.error("Failed to update post", local['id'], e));
              }
            });
          }
        }
      } catch (e: unknown) {
        console.warn("[Danbooru Grass] Failed to fetch missing milestone thumbnails", e);
      }
    }

    // Map back to result structure
    // Create lookup
    const map = new Map(matches.map(p => [p.no, p]));

    const results: MilestoneEntry[] = [];

    targets.forEach(t => {
      // Just push specific targets
      const p = map.get(t);
      if (p) {
        // Label logic
        let label = `#${t.toLocaleString()}`;
        if (t >= 1000 && t % 1000 === 0) label = `${t / 1000} k`;
        // Repdigit label: show the number itself (e.g. "111", "2222")
        const tStr = String(t);
        if (tStr.length >= 3 && tStr.split('').every(c => c === tStr[0])) label = tStr;
        if (t === 1) label = 'First';

        results.push({ type: label, post: p, index: t });
      }
    });

    // Let's sort strictly by Index ASC.
    results.sort((a, b) => a.index - b.index);

    return results;
  }


  /**
   * Aggregates post counts by month from the local IndexedDB.
   * Handles linear timeline generation by filling gaps with 0-count months.
   * @param {!Object} userInfo The user's information object.
   * @param {?Date=} minDate Optional start date to ensure the timeline begins at a specific point.
   * @return {Promise<!Array<{date: string, count: number, label: string}>>} Array of monthly stats.
   */
  async getMonthlyStats(userInfo: TargetUser, minDate: Date | null = null): Promise<MonthlyStatEntry[]> {
    const uploaderId = parseInt(userInfo.id ?? '0');
    if (!uploaderId) return [];

    const counts: Record<string, number> = {}; // "2023-01": 5

    // Streaming iteration to avoid memory spikes
    await this.db.posts.where('uploader_id').equals(uploaderId).each((post: ApiItem) => {
      if (!post['created_at']) return;
      // created_at is likely ISO string "2023-01-01T..."
      const month = post['created_at'].substring(0, 7); // "YYYY-MM"
      counts[month] = (counts[month] || 0) + 1;
    });

    // Convert to array and Fill Gaps for Linear timeline
    let results: MonthlyStatEntry[] = [];
    const keys = Object.keys(counts).sort();

    if (keys.length > 0) {
      let startKey = keys[0];
      const endKey = keys[keys.length - 1];

      // Extend start date if minDate is provided and earlier
      if (minDate) {
        const mY = minDate.getFullYear();
        const mM = minDate.getMonth() + 1;
        const mKey = `${mY}-${String(mM).padStart(2, '0')}`;
        if (mKey < startKey) startKey = mKey;
      }

      let [y, m] = startKey.split('-').map(Number);
      const [endY, endM] = endKey.split('-').map(Number);

      // Loop until we pass endYear/endMonth
      while (y < endY || (y === endY && m <= endM)) {
        const k = `${y}-${String(m).padStart(2, '0')}`;
        results.push({
          date: k,
          count: counts[k] || 0,
          label: k
        });

        m++;
        if (m > 12) {
          m = 1;
          y++;
        }
      }
    } else {
      // No data
      results = [];
    }

    return results;
  }

  /**
   * Fetches rating distribution report from Danbooru's /reports/posts.json endpoint.
   * @param {!Object} userInfo The user's information object.
   * @return {Promise<!Array<{rating: string, count: number, label: string}>>} Rating distribution array.
   */
  /**
   * Fetches post counts for each status (active, deleted, etc.).
   * @param {!Object} userInfo The user's information object.
   * @param {?string|Date} startDate Optional start date to optimize query range.
   * @return {Promise<!Array<{name: string, count: number, label: string}>>} Status distribution.
   */
  async getStatusDistribution(userInfo: TargetUser, startDate: string | Date | null = null): Promise<{name: string; count: number; label: string}[]> {
    if (!userInfo.name) return [];

    const normalizedName = userInfo.name.replace(/ /g, '_');
    const statuses = ['active', 'appealed', 'banned', 'deleted', 'flagged', 'pending'];

    const tasks = statuses.map(async (status) => {
      try {
        let tagQuery = `user:${normalizedName} status:${status}`;
        if (startDate) {
          const dateStr = (startDate instanceof Date) ? startDate.toISOString().split('T')[0] : startDate;
          tagQuery += ` date:>=${dateStr}`;
        }

        const params = new URLSearchParams({ tags: tagQuery });
        const url = `/counts/posts.json?${params.toString()}`;

        const resp = await this.rateLimiter.fetch(url);
        let count = 0;
        if (resp.ok) {
          const data = await resp.json();
          count = (data && data.counts ? data.counts.posts : (data ? data.posts : 0)) || 0;
        }

        return {
          name: status,
          count: count,
          label: status.charAt(0).toUpperCase() + status.slice(1)
        };
      } catch (e: unknown) {
        console.warn(`[Danbooru Grass] Failed to fetch count for status:${status}`, e);
        return { name: status, count: 0, label: status.charAt(0).toUpperCase() + status.slice(1) };
      }
    });

    return Promise.all(tasks);
  }

  /**
   * Fetches rating distribution report from Danbooru's /counts/posts.json endpoint.
   * Uses parallel requests for each rating to ensure accuracy (including 'general').
   * @param {!Object} userInfo The user's information object.
   * @param {?string|Date} startDate Optional start date to optimize query range.
   * @return {Promise<!Array<{rating: string, count: number, label: string}>>} Rating distribution array.
   */
  async getRatingDistribution(userInfo: TargetUser, startDate: string | Date | null = null): Promise<{rating: string; count: number; label: string}[]> {
    if (!userInfo.name) return [];

    const normalizedName = userInfo.name.replace(/ /g, '_');
    const ratings = ['g', 's', 'q', 'e'];
    const labelMap: Record<string, string> = {
      'g': 'General',
      's': 'Sensitive',
      'q': 'Questionable',
      'e': 'Explicit'
    };

    const tasks = ratings.map(async (rating) => {
      try {
        let tagQuery = `user:${normalizedName} rating:${rating}`;
        if (startDate) {
          const dateStr = (startDate instanceof Date) ? startDate.toISOString().split('T')[0] : startDate;
          tagQuery += ` date:>=${dateStr}`;
        }

        const params = new URLSearchParams({
          tags: tagQuery
        });
        const url = `/counts/posts.json?${params.toString()}`;

        const resp = await this.rateLimiter.fetch(url);
        if (!resp.ok) return { rating, count: 0, label: labelMap[rating] };

        const data = await resp.json();
        const count = (data && data.counts ? data.counts.posts : (data ? data.posts : 0)) || 0;

        return {
          rating: rating,
          count: count,
          label: labelMap[rating]
        };
      } catch (e: unknown) {
        console.warn(`[Danbooru Grass] Failed to fetch count for rating:${rating}`, e);
        return { rating, count: 0, label: labelMap[rating] };
      }
    });

    try {
      const results = await Promise.all(tasks);
      return results;
    } catch (e: unknown) {
      console.error('[Danbooru Grass] Failed to fetch rating distribution', e);
      return [];
    }
  }

  /**
   * Fetches tag cloud data for a user from the related tags API.
   * Selects top 30 tags by cosine similarity (relevance to the user),
   * then sorts by frequency for font size mapping.
   * Results are cached in the piestats table with a `tag_cloud_` prefix.
   *
   * @param userInfo The target user.
   * @param categoryId Danbooru tag category (0=General, 1=Artist, 3=Copyright, 4=Character).
   * @return Tag cloud items sorted by frequency descending.
   */
  async getTagCloudData(userInfo: TargetUser, categoryId: number): Promise<TagCloudItem[]> {
    if (!userInfo.name) return [];

    const categoryNames: Record<number, string> = {0: 'general', 1: 'artist', 3: 'copyright', 4: 'character'};
    const catName = categoryNames[categoryId] || `cat${categoryId}`;
    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = `tag_cloud_${catName}`;

    // Check cache
    if (uploaderId) {
      const cached = await this.getStats(cacheKey, uploaderId);
      if (cached) return cached as TagCloudItem[];
    }

    const normalizedName = userInfo.name.replace(/ /g, '_');
    // General: select by Cosine similarity (user-characteristic tags)
    // Others: select by Frequency (most common tags)
    const order = categoryId === 0 ? 'Cosine' : 'Frequency';
    const url = `/related_tag.json?commit=Search&search[category]=${categoryId}&search[order]=${order}&search[query]=user:${encodeURIComponent(normalizedName)}`;

    try {
      const resp = await this.rateLimiter.fetch(url).then(r => r.json());
      if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags)) return [];

      const queryPostCount: number = resp.post_count || 0;

      // Select top 30, then sort by frequency for font size mapping
      const items: TagCloudItem[] = resp.related_tags
        .slice(0, 30)
        .map((item: any) => ({
          name: item.tag.name.replace(/_/g, ' '),
          tagName: item.tag.name,
          frequency: item.frequency,
          count: Math.round(item.frequency * queryPostCount),
        }))
        .sort((a: TagCloudItem, b: TagCloudItem) => b.frequency - a.frequency);

      if (uploaderId) await this.saveStats(cacheKey, uploaderId, items);
      return items;
    } catch (e: unknown) {
      console.debug('[DI] Failed to fetch tag cloud data', e);
      return [];
    }
  }

  /**
   * Parses NNTBot forum post body to extract "New General Tags" created by a target user.
   * Exported as static for testability.
   *
   * DText format:
   *   [td][[tag name]] "»":[/posts?tags=...] [/td]
   *   [td]"Username":[/users/12345][/td]
   *
   * @param body The DText body of a forum post.
   * @param targetUser The username to filter by (case-insensitive).
   * @param reportDate The date of the report (YYYY-MM-DD).
   * @return Array of {tagName, reportDate} for tags created by the target user.
   */
  static parseNewGeneralTags(
    body: string,
    targetUser: string,
    reportDate: string,
  ): {tagName: string; reportDate: string}[] {
    const results: {tagName: string; reportDate: string}[] = [];
    const userLower = targetUser.toLowerCase();

    // Find "New General Tags" section
    const sectionStart = body.indexOf('New General Tags');
    if (sectionStart === -1) return results;

    // Find next section header (h4. or h5.) to limit scope
    const afterSection = body.slice(sectionStart);
    const nextSectionMatch = afterSection.slice(20).search(/\bh[45]\.\s/);
    const sectionBody = nextSectionMatch >= 0
      ? afterSection.slice(0, nextSectionMatch + 20)
      : afterSection;

    // Extract rows: look for [td][[tag_name]]...[/td] followed by [td]"Username":...
    // Match pairs of consecutive [tr]...[/tr] blocks
    const rowRegex = /\[td\]\[\[(.+?)\]\].*?\[\/td\]\s*\[td\](.*?)\[\/td\]/g;
    let match;
    while ((match = rowRegex.exec(sectionBody)) !== null) {
      const tagDisplay = match[1]; // e.g. "gyaru v" or "mite (idolmaster)"
      const updaterCell = match[2]; // e.g. "AkaringoP":[/users/701499]

      // Check if target user is in the updater cell (case-insensitive)
      if (updaterCell.toLowerCase().includes(userLower)) {
        // Convert display name to raw tag name (spaces → underscores)
        const tagName = tagDisplay.trim().replace(/ /g, '_');
        results.push({tagName, reportDate});
      }
    }

    return results;
  }

  /**
   * Fetches tags created by a user from NNTBot forum reports.
   * Automatically searches previous usernames via user_name_change_requests API.
   * Results are enriched with current tag status and alias info.
   *
   * @param userInfo The target user.
   * @param onProgress Optional progress callback for UI updates.
   * @return Created tag items sorted by post count descending.
   */
  async getCreatedTags(
    userInfo: TargetUser,
    onProgress?: (message: string) => void,
  ): Promise<CreatedTagItem[]> {
    if (!userInfo.name) return [];

    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'created_tags';

    // Check cache
    if (uploaderId) {
      const cached = await this.getStats(cacheKey, uploaderId);
      if (cached) return cached as CreatedTagItem[];
    }

    const report = onProgress || (() => {});

    try {
      // Step 0: Collect all usernames (current + previous)
      const userNames: string[] = [userInfo.name];
      if (uploaderId) {
        report('Checking previous usernames...');
        try {
          const ncUrl = `/user_name_change_requests.json?search[user_id]=${uploaderId}&limit=500`;
          const ncResp = await this.rateLimiter.fetch(ncUrl).then(r => r.json());
          if (Array.isArray(ncResp)) {
            for (const nc of ncResp) {
              if (nc.original_name && !userNames.includes(nc.original_name)) {
                userNames.push(nc.original_name);
              }
            }
          }
        } catch { /* proceed with current name only */ }
      }

      // Step 1: Fetch forum posts for each username
      const rawTags: {tagName: string; reportDate: string}[] = [];
      const seenTags = new Set<string>();

      for (let ni = 0; ni < userNames.length; ni++) {
        const name = userNames[ni];
        report(`Searching reports for ${name}... (${ni + 1}/${userNames.length})`);

        const searchQuery = `tag report ${name}`;
        const url = `/forum_posts.json?search[body_matches]=${encodeURIComponent(searchQuery)}&limit=500`;
        const posts = await this.rateLimiter.fetch(url).then(r => r.json());

        if (!Array.isArray(posts)) continue;

        for (const post of posts) {
          const body: string = post.body || '';
          const dateMatch = body.match(/Daily Report \((\d{4}-\d{2}-\d{2})\)/);
          const reportDate = dateMatch ? dateMatch[1] : (post.created_at || '').slice(0, 10);

          const parsed = AnalyticsDataManager.parseNewGeneralTags(body, name, reportDate);
          for (const tag of parsed) {
            if (!seenTags.has(tag.tagName)) {
              seenTags.add(tag.tagName);
              rawTags.push(tag);
            }
          }
        }
      }

      if (rawTags.length === 0) return [];

      report(`Found ${rawTags.length} tags. Fetching current status...`);

      // Step 2: Batch fetch current tag status
      const tagNames = rawTags.map(t => t.tagName);
      const tagStatusMap = new Map<string, {postCount: number; isDeprecated: boolean}>();

      for (let i = 0; i < tagNames.length; i += 100) {
        const batch = tagNames.slice(i, i + 100);
        report(`Fetching tag status... (${Math.min(i + 100, tagNames.length)}/${tagNames.length})`);
        const tagsUrl = `/tags.json?search[name_comma]=${encodeURIComponent(batch.join(','))}&only=name,post_count,is_deprecated&limit=500`;
        const tagsResp = await this.rateLimiter.fetch(tagsUrl).then(r => r.json());
        if (Array.isArray(tagsResp)) {
          for (const t of tagsResp) {
            tagStatusMap.set(t.name, {
              postCount: t.post_count || 0,
              isDeprecated: t.is_deprecated || false,
            });
          }
        }
      }

      // Step 3: Check aliases (only for post_count=0 tags — aliased tags have posts moved)
      const emptyTagNames = tagNames.filter(name => {
        const status = tagStatusMap.get(name);
        return !status || status.postCount === 0;
      });

      report(`Checking aliases for ${emptyTagNames.length} empty tags...`);
      const aliasMap = new Map<string, string>();
      let aliasChecked = 0;

      await this.mapConcurrent(emptyTagNames, 5, async (name: string) => {
        try {
          const aliasUrl = `/tag_aliases.json?search[antecedent_name]=${encodeURIComponent(name)}&search[status]=active&limit=1`;
          const aliasResp = await this.rateLimiter.fetch(aliasUrl).then(r => r.json());
          if (Array.isArray(aliasResp) && aliasResp.length > 0) {
            aliasMap.set(name, aliasResp[0].consequent_name);
          }
        } catch { /* skip */ }
        aliasChecked++;
        if (aliasChecked % 10 === 0 || aliasChecked === emptyTagNames.length) {
          report(`Checking aliases... (${aliasChecked}/${emptyTagNames.length})`);
        }
        return null;
      });

      // Step 4: Fetch post counts for aliased tags (consequent tag's count)
      const aliasedNames = Array.from(aliasMap.values());
      const aliasPostCounts = new Map<string, number>();
      if (aliasedNames.length > 0) {
        report(`Fetching aliased tag counts...`);
        for (let i = 0; i < aliasedNames.length; i += 100) {
          const batch = aliasedNames.slice(i, i + 100);
          const tagsUrl = `/tags.json?search[name_comma]=${encodeURIComponent(batch.join(','))}&only=name,post_count&limit=500`;
          const tagsResp = await this.rateLimiter.fetch(tagsUrl).then(r => r.json());
          if (Array.isArray(tagsResp)) {
            for (const t of tagsResp) {
              aliasPostCounts.set(t.name, t.post_count || 0);
            }
          }
        }
      }

      report('Finalizing...');

      // Step 5: Assemble results
      const items: CreatedTagItem[] = rawTags.map(raw => {
        const status = tagStatusMap.get(raw.tagName);
        const alias = aliasMap.get(raw.tagName) || null;
        // For aliased tags, show the consequent tag's post count
        const postCount = alias
          ? (aliasPostCounts.get(alias) ?? 0)
          : (status?.postCount ?? 0);
        return {
          tagName: raw.tagName,
          displayName: raw.tagName.replace(/_/g, ' '),
          postCount,
          isDeprecated: status?.isDeprecated ?? false,
          aliasedTo: alias,
          reportDate: raw.reportDate,
        };
      });

      // Sort by post count descending
      items.sort((a, b) => b.postCount - a.postCount);

      if (uploaderId) await this.saveStats(cacheKey, uploaderId, items);
      return items;
    } catch (e: unknown) {
      console.debug('[DI] Failed to fetch created tags', e);
      return [];
    }
  }

  /**
   * Fetches character distribution using Danbooru's related tags API.
   * Processes top 10 characters and fetches their specific uploader counts concurrently.
   * @param {!Object} userInfo The user's information object.
   * @param {boolean=} forceRefresh Whether to skip cache and force a new fetch.
   * @param {?function(string)=} reportSubStatus Optional callback for progress updates.
   * @return {Promise<!Array<{name: string, count: number, frequency: number, isOther: boolean}>>} Character distribution.
   */
  async getCharacterDistribution(userInfo: TargetUser, forceRefresh: boolean = false, reportSubStatus: ((msg: string) => void) | null = null): Promise<DistributionItem[]> {
    if (!userInfo.name) return [];
    if (reportSubStatus) reportSubStatus(`Fetching Character Distribution...`);
    const uploaderId = parseInt(userInfo.id || '0'); // Need ID for cache key
    const cacheKey = 'character_dist';

    if (!forceRefresh && uploaderId) {
      const cached = await this.getStats(cacheKey, uploaderId);
      if (cached) return cached as DistributionItem[];
    }

    const normalizedName = userInfo.name.replace(/ /g, '_');
    const url = `/related_tag.json?commit=Search&search[category]=4&search[order]=Frequency&search[query]=user:${encodeURIComponent(normalizedName)}`;

    try {
      const resp = await this.rateLimiter.fetch(url).then(r => r.json());

      if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags)) return [];

      const tags = resp.related_tags;

      // Limit to Top 10
      const itemsToProcess = tags.slice(0, 10);

      const top10 = itemsToProcess.map((item: ApiItem) => ({
        name: item.tag.name.replace(/_/g, ' '),
        tagName: item.tag.name,
        count: 0,
        frequency: item.frequency,
        thumb: null,
        isOther: false,
        _item: item
      }));

      // Fetch Counts Concurrent
      await this.mapConcurrent(top10, 3, async (obj) => {
        const tagName = obj.tagName;
        if (reportSubStatus) reportSubStatus(`Fetching Count: ${obj.name}`);
        try {
          const countUrl = `/counts/posts.json?tags=${encodeURIComponent(`user:${normalizedName} ${tagName}`)}`;
          const countResp = await this.rateLimiter.fetch(countUrl).then(r => r.json());
          const c = countResp.counts && countResp.counts.posts ? countResp.counts.posts : 0;
          obj.count = c || obj._item.tag.post_count;
        } catch (_e: unknown) { console.debug('[DI] Failed to fetch user tag count', _e); }
        delete obj._item;
      });

      const sumFreq = top10.reduce((acc: number, curr: {frequency: number}) => acc + curr.frequency, 0);
      const otherFreq = 1.0 - sumFreq;

      if (otherFreq > 0.001) {
        top10.push({
          name: 'Others',
          tagName: '',
          count: 0,
          frequency: otherFreq,
          thumb: '',
          isOther: true
        });
      }

      if (uploaderId) await this.saveStats(cacheKey, uploaderId, top10);

      // Lazy Load Thumbnails
      await this.enrichThumbnails(cacheKey, uploaderId, top10, userInfo, reportSubStatus);

      return top10;

    } catch (e: unknown) {
      console.warn('[Danbooru Grass] Failed to fetch character distribution', e);
      return [];
    }
  }

  /**
   * Fetches Copyright distribution from related_tag.json.
   * Filters out sub-copyrights by checking tag_implications.
   * @param {Object} userInfo The user's info object.
   * @param {boolean} [forceRefresh=false] Whether to bypass cache.
   * @return {Promise<Array<{name: string, count: number, frequency: number, isOther: boolean}>>}
   */
  async getCopyrightDistribution(userInfo: TargetUser, forceRefresh: boolean = false, reportSubStatus: ((msg: string) => void) | null = null): Promise<DistributionItem[]> {
    if (!userInfo.name) return [];
    if (reportSubStatus) reportSubStatus(`Fetching Copyright Distribution...`);
    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'copyright_dist';

    if (!forceRefresh && uploaderId) {
      const cached = await this.getStats(cacheKey, uploaderId);
      if (cached) return cached as DistributionItem[];
    }

    const normalizedName = userInfo.name.replace(/ /g, '_');
    const url = `/related_tag.json?commit=Search&search[category]=3&search[order]=Frequency&search[query]=user:${encodeURIComponent(normalizedName)}`;

    try {
      const resp = await this.rateLimiter.fetch(url).then(r => r.json());
      if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags)) return [];

      let tags = resp.related_tags;

      // Limit to Top 20 Candidates for filtering performance
      const candidates = tags.slice(0, 20);

      // Concurrent Filter checks - Limit 2
      const filteredResults = await this.mapConcurrent(candidates, 2, async (item) =>
        await isTopLevelTag(this.rateLimiter, item.tag.name) ? item : null
      );
      const filtered = filteredResults.filter(item => item !== null);

      // Concurrent Fetch Data for Top 10 - Limit 5
      const top10: any[] = filtered.slice(0, 10).map(item => ({
        name: item.tag.name.replace(/_/g, ' '),
        tagName: item.tag.name,
        count: 0,
        frequency: item.frequency,
        thumb: null,
        isOther: false,
        _item: item
      }));

      await this.mapConcurrent(top10, 3, async (obj) => {
        const tagName = obj.tagName;
        if (reportSubStatus) reportSubStatus(`Fetching Count: ${obj.name}`);
        try {
          const countUrl = `/counts/posts.json?tags=${encodeURIComponent(`user:${normalizedName} ${tagName}`)}`;
          const countResp = await this.rateLimiter.fetch(countUrl).then(r => r.json());
          const c = countResp.counts && countResp.counts.posts ? countResp.counts.posts : 0;
          obj.count = c || obj._item.tag.post_count;
        } catch (_e: unknown) { console.debug('[DI] Failed to fetch user tag count', _e); }
        delete obj._item;
      });

      const sumFreq = top10.reduce((acc: number, curr: {frequency: number}) => acc + curr.frequency, 0);
      const otherFreq = 1.0 - sumFreq;

      if (otherFreq > 0.001) {
        top10.push({
          name: 'Others',
          tagName: '',
          count: 0,
          frequency: otherFreq,
          thumb: '',
          isOther: true
        });
      }

      if (uploaderId) await this.saveStats(cacheKey, uploaderId, top10);

      // Lazy Load
      await this.enrichThumbnails(cacheKey, uploaderId, top10, userInfo, reportSubStatus);

      return top10;

    } catch (e: unknown) {
      console.warn('[Danbooru Grass] Failed to fetch copyright distribution', e);
      return [];
    }
  }

  /**
   * Helper for concurrent processing with limit.
   * @param {Array} items Items to process.
   * @param {number} concurrency Max concurrent tasks.
   * @param {Function} fn Async function to run on each item.
   * @param {number} [delayMs=250] Delay between iterations per worker.
   * @return {Promise<Array>} Results array.
   */
  async mapConcurrent(items: any[], concurrency: number, fn: (item: any) => Promise<any>, delayMs: number = 50): Promise<any[]> {
    const results = new Array(items.length);
    let index = 0;
    const next = async () => {
      while (index < items.length) {
        const i = index++;
        results[i] = await fn(items[i]);
        // Minimal stagger delay — RateLimitedFetch handles actual rate limiting
        if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      }
    }
    await Promise.all(Array.from({ length: concurrency }, next));
    return results;
  }

  /**
   * Fetches Favorite Copyright distribution.
   * Uses ordfav:{user} to find favorites.
   * @param {Object} userInfo The user's info object.
   * @param {boolean} [forceRefresh=false] Whether to bypass cache.
   * @return {Promise<Array>}
   */
  async getFavCopyrightDistribution(userInfo: TargetUser, forceRefresh: boolean = false, reportSubStatus: ((msg: string) => void) | null = null): Promise<DistributionItem[]> {
    if (!userInfo.name) return [];
    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'fav_copyright_dist';

    if (!forceRefresh && uploaderId) {
      const cached = await this.getStats(cacheKey, uploaderId);
      if (cached) return cached as DistributionItem[];
    }

    const normalizedName = userInfo.name.replace(/ /g, '_');
    const url = `/related_tag.json?commit=Search&search[category]=3&search[order]=Frequency&search[query]=ordfav:${encodeURIComponent(normalizedName)}`;

    try {
      const resp = await this.rateLimiter.fetch(url).then(r => r.json());
      if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags)) return [];

      let tags = resp.related_tags;
      const candidates = tags.slice(0, 20);

      // Concurrent Filter checks (Sub-copyright) - Limit 5
      const filteredResults = await this.mapConcurrent(candidates, 2, async (item) => {
        const tagName = item.tag.name;
        const impUrl = `/tag_implications.json?search[antecedent_name_matches]=${encodeURIComponent(tagName)}`;
        try {
          const imps = await this.rateLimiter.fetch(impUrl).then(r => r.json());
          if (Array.isArray(imps) && imps.length > 0) return null;
          return item;
        } catch (e: unknown) { return item; }
      });

      const filtered = filteredResults.filter(item => item !== null);

      // 1. Return basic stats immediately (with null thumbs)
      // We still need to calculate frequencies and filter "Others"
      // But we skip the heavy "fetchThumbnailWithRetry" part in the initial critical path.

      // Concurrent Fetch Data for Top 10 - Limit 5
      // Modification: Do NOT await valid thumbs. Just structural data.
      const top10: any[] = filtered.slice(0, 10).map(item => {
        const tagName = item.tag.name;
        const displayName = tagName.replace(/_/g, ' ');

        // We still probably want the "User Count" if possible, but that requires a fetch too?
        // The original code did `fetch countUrl`. That is also a bottleneck?
        // Providing "approximate" counts (global post_count) might be misleading.
        // BUT replacing 10 sequential/parallel fetches is good.
        // Let's Keep the count fetching if it's fast enough or necessary?
        // User's plan said: "Load Chart (Shapes) first".
        // Pie chart NEEDS counts/frequencies for shapes.
        // User Count is needed for "Frequency" (User Count / Total User Posts).
        // So we MUST wait for counts.
        // But THUMBNAILS are only for tooltips/visuals. We can skip those.

        // So we will keep the 'mapConcurrent' for Counts, but remove Thumb fetch.
        return {
          name: displayName,
          tagName: tagName,
          count: 0, // Placeholder, will fill in mapConcurrent
          frequency: item.frequency,
          thumb: null, // Lazy Load
          isOther: false,
          _item: item // Temp storage
        };
      });

      // Fill Counts Concurrently
      // We can re-use mapConcurrent to fill counts.
      await this.mapConcurrent(top10, 3, async (obj) => {
        const tagName = obj.tagName;
        if (reportSubStatus) reportSubStatus(`Fetching Count: ${obj.name}`);
        try {
          // Use fav: for counting (more standard), ordfav: for sorting/linking
          const countUrl = `/counts/posts.json?tags=${encodeURIComponent(`fav:${normalizedName} ${tagName}`)}`;
          const countResp = await this.rateLimiter.fetch(countUrl).then(r => r.json());
          const c = countResp.counts && countResp.counts.posts ? countResp.counts.posts : 0;
          // console.log(`[Danbooru Grass] Fav Count for ${tagName}: ${c} (URL: ${countUrl})`); // Debug
          obj.count = c;
        } catch (e: unknown) {
          console.warn('[Danbooru Grass] Count fetch failed', e);
        }
        delete obj._item;
      });

      const sumFreq = top10.reduce((acc: number, curr: {frequency: number}) => acc + curr.frequency, 0);
      const otherFreq = 1.0 - sumFreq;

      if (otherFreq > 0.001) {
        top10.push({
          name: 'Others',
          tagName: '',
          count: 0,
          frequency: otherFreq,
          thumb: '',
          isOther: true
        });
      }

      // Save Stats (Initial - without thumbs)
      if (uploaderId) await this.saveStats(cacheKey, uploaderId, top10);

      // TRIGGER LAZY LOADING FOR THUMBNAILS
      // We assume `reportSubStatus` can act as the "Update Callback" if we pass a special flag or function?
      // Actually, the caller (refreshAllStats) typically provides a status callback.
      // We need a way to tell the caller "Hey, data updated!".
      // The current structure doesn't support a "Data Updated" callback easily down here without changing signature.
      // UserAnalyticsApp passes `(msg) => ...`. That's just for status text.
      // We need a new callback or we piggyback.
      // Let's add a 4th argument `onDataUpdate` to the signature?
      // Or just leverage the fact that we return the object reference.
      // If we modify `top10` (objects) in place, the caller holds the reference.
      // But the caller needs to know WHEN to re-render.

      // For now, let's trigger the background fetch and let it save to DB.
      // The UI might need a "Listener" or we accept we need to pass a callback.
      // Let's modify the signature in the next step or assume generic event?
      // Let's simply fire-and-forget the enricher, and assume the UI will re-render if we tell it to?
      // We can pass `onDataUpdate` as a property of `reportSubStatus` if it's an object? No.

      // Let's call the internal enrich method.
      // We will need to pass the `onDataUpdate` callback from the UI layer.
      // For this refactor, I will add `onDataUpdate` to arguments.

      await this.enrichThumbnails(cacheKey, uploaderId, top10, userInfo, reportSubStatus);

      return top10;

    } catch (e: unknown) {
      console.warn('[Danbooru Grass] Failed to fetch fav copyright distribution', e);
      return [];
    }
  }

  /**
   * Fetches top posts per rating (G/S/Q/E) in parallel using API.
   * @param {!Object} userInfo The user's info object.
   * @return {!Promise<{g: ?Object, s: ?Object, q: ?Object, e: ?Object}>} Top post per rating.
   */
  async getTopPostsByType(userInfo: TargetUser): Promise<{g: any | null; s: any | null; q: any | null; e: any | null}> {
    if (!userInfo.name) return { g: null, s: null, q: null, e: null };

    // Helper for fetching 1 top post
    const fetchTop = async (ratingTag: string, extraQuery: string = ''): Promise<any | null> => {
      try {
        // Use tags=... order:score rating:x limit=1
        const normalizedName = userInfo.name.replace(/ /g, '_');
        const query = `user:${normalizedName} order:score rating:${ratingTag} ${extraQuery}`;
        const url = `/posts.json?tags=${encodeURIComponent(query)}&limit=1&only=id,preview_file_url,file_url,variants,rating,score,fav_count,created_at,tag_string_artist,tag_string_copyright,tag_string_character`;
        const resp = await this.rateLimiter.fetch(url).then(r => r.json());
        if (Array.isArray(resp) && resp.length > 0) {
          return resp[0];
        }
      } catch (e: unknown) {
        console.warn(`[Danbooru Grass] Failed to fetch top post for rating:${ratingTag}`, e);
      }
      return null;
    };

    const [g, s, q, e] = await Promise.all([
      fetchTop('g'),
      fetchTop('s'),
      fetchTop('q'),
      fetchTop('e'),
    ]);

    return { g, s, q, e };
  }

  /**
   * Fetches Recent Popular (age < 1w) posts for SFW and NSFW in parallel.
   * @param {!Object} userInfo The user's info object.
   * @return {!Promise<{sfw: ?Object, nsfw: ?Object}>} Recent popular post per SFW/NSFW.
   */
  async getRecentPopularPosts(userInfo: TargetUser): Promise<{sfw: any | null; nsfw: any | null}> {
    if (!userInfo.name) return { sfw: null, nsfw: null };

    const fetchTop = async (ratingTag: string): Promise<any | null> => {
      try {
        const normalizedName = userInfo.name.replace(/ /g, '_');
        const query = `user:${normalizedName} order:score ${ratingTag} age:<1w`;
        const url = `/posts.json?tags=${encodeURIComponent(query)}&limit=1&only=id,preview_file_url,file_url,variants,rating,score,fav_count,created_at,tag_string_artist,tag_string_copyright,tag_string_character`;
        const resp = await this.rateLimiter.fetch(url).then(r => r.json());
        if (Array.isArray(resp) && resp.length > 0) {
          return resp[0];
        }
      } catch (e: unknown) {
        console.warn(`[Danbooru Grass] Failed to fetch recent top post for ${ratingTag}`, e);
      }
      return null;
    };

    const [sfw, nsfw] = await Promise.all([
      fetchTop('is:sfw'),
      fetchTop('is:nsfw'),
    ]);

    return { sfw, nsfw };
  }

  /**
   * Fetches Random posts for SFW and NSFW in parallel.
   * @param {!Object} userInfo The user's info object.
   * @return {!Promise<{sfw: ?Object, nsfw: ?Object}>} Random post per SFW/NSFW.
   */
  async getRandomPosts(userInfo: TargetUser): Promise<{sfw: any | null; nsfw: any | null}> {
    if (!userInfo.name) return { sfw: null, nsfw: null };

    const fetchRandom = async (ratingTag: string): Promise<any | null> => {
      try {
        const normalizedName = userInfo.name.replace(/ /g, '_');
        const query = `user:${normalizedName} ${ratingTag}`;
        const url = `/posts/random.json?tags=${encodeURIComponent(query)}&only=id,preview_file_url,file_url,variants,rating,score,fav_count,created_at,tag_string_artist,tag_string_copyright,tag_string_character`;
        const resp = await this.rateLimiter.fetch(url).then(r => r.json());
        if (resp && resp.id) {
          return resp;
        }
      } catch (e: unknown) {
        console.warn(`[Danbooru Grass] Failed to fetch random post for ${ratingTag}`, e);
      }
      return null;
    };

    const [sfw, nsfw] = await Promise.all([
      fetchRandom('is:sfw'),
      fetchRandom('is:nsfw'),
    ]);

    return { sfw, nsfw };
  }

  /**
   * Gets the post with the highest score and fetches its details.
   * @param {Object} userInfo The user's info object.
   * @param {string} [filterMode='sfw'] 'sfw' | 'nsfw' | 'all'.
   * @return {Promise<Object|null>}
   */
  async getTopScorePost(userInfo: TargetUser, filterMode: string = 'sfw'): Promise<any | null> {
    const uploaderId = parseInt(userInfo.id ?? '0');
    if (!uploaderId) return null;

    // Use compound index [uploader_id+score] to traverse posts from highest score downward.
    // .reverse() on a between() range walks from the upper bound down, stopping at the first filter match.
    const ratingFilter =
      filterMode === 'sfw'
        ? (p: ApiItem) => p['rating'] === 'g' || p['rating'] === 's'
        : filterMode === 'nsfw'
          ? (p: ApiItem) => p['rating'] === 'q' || p['rating'] === 'e'
          : () => true;

    const topLocal = await (this.db.posts as any)
      .where('[uploader_id+score]')
      .between([uploaderId, -Infinity], [uploaderId, Infinity])
      .reverse()
      .filter(ratingFilter)
      .first();

    if (!topLocal) return null;

    // 2. Fetch details (thumbnail, fav_count)
    try {
      const url = `/posts/${topLocal.id}.json`;
      const details = await this.rateLimiter.fetch(url).then(r => r.json());
      if (details && details.id) {
        return details; // Return full API object
      }
    } catch (e: unknown) {
      console.warn('[Danbooru Grass] Failed to fetch top post details', e);
    }

    return topLocal; // Fallback to local data (might miss thumb/favs)
  }

  /**
   * Fetches data for Scatter Plot.
   * Returns minimal object array to save memory/time.
   * @param {Object} userInfo The user's info object.
   * @return {Promise<Array<{id: number, d: number, s: number, t: number, r: string}>>}
   */
  async getScatterData(userInfo: TargetUser): Promise<ScatterDataPoint[]> {
    const uploaderId = parseInt(userInfo.id ?? '0');
    if (!uploaderId) return [];

    const result: ScatterDataPoint[] = [];
    // Streaming iterate
    await this.db.posts.where('uploader_id').equals(uploaderId).each((post: ApiItem) => {
      if (!post['created_at']) return;
      // Use timestamps for faster plotting
      const d = new Date(post['created_at']).getTime();
      // Rating: g, s, q, e
      const r = post['rating'];
      const s = post['score'] || 0;
      const t = post['tag_count_general'] || 0;
      const dn = post['down_score'];
      const del = post['is_deleted'];
      const ban = post['is_banned'];

      result.push({ id: post['id'], d, s, t, r, dn, del, ban });
    });

    return result;
  }

  /**
   * Checks whether any of the user's cached posts are missing metadata fields
   * introduced after the initial schema (down_score / is_deleted / is_banned).
   * Uses a single localStorage flag to short-circuit on subsequent loads once
   * the backfill has fully completed for this user.
   */
  async needsPostMetadataBackfill(userInfo: TargetUser): Promise<boolean> {
    const uploaderId = parseInt(userInfo.id ?? '0');
    if (!uploaderId) return false;

    const flagKey = `di_post_metadata_v2_${uploaderId}`;
    if (localStorage.getItem(flagKey) === '1') return false;

    // Walk all posts and stop on the first one lacking any required metadata.
    // We cannot short-circuit on the first record by index order — a partial
    // (interrupted) backfill may have populated the earliest posts while
    // leaving later ones empty, so we must scan until we find a missing one.
    const missing = await this.db.posts
      .where('uploader_id')
      .equals(uploaderId)
      .filter((p: any) =>
        p.up_score === undefined ||
        p.down_score === undefined ||
        p.is_deleted === undefined ||
        p.is_banned === undefined
      )
      .first();

    if (missing === undefined) {
      localStorage.setItem(flagKey, '1');
      return false;
    }

    return true;
  }

  /**
   * Backfills the `down_score`, `is_deleted`, and `is_banned` fields on
   * existing post records for a user. Walks the user's posts in id-order
   * (cursor pagination) using a minimal `only` parameter so the request is
   * much lighter than a full re-sync. Updates the score field as well to
   * keep it in sync with up_score + down_score.
   *
   * @param userInfo Target user
   * @param onProgress Optional progress callback (current, total)
   */
  async backfillPostMetadata(
    userInfo: TargetUser,
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    const uploaderId = parseInt(userInfo.id ?? '0');
    if (!uploaderId) return;

    const flagKey = `di_post_metadata_v2_${uploaderId}`;

    // Pull all of this user's posts and find ones lacking any required field
    const allPosts: any[] = await this.db.posts.where('uploader_id').equals(uploaderId).toArray();
    const needsUpdate = allPosts.filter(p =>
      p.up_score === undefined ||
      p.down_score === undefined ||
      p.is_deleted === undefined ||
      p.is_banned === undefined
    );
    if (needsUpdate.length === 0) {
      localStorage.setItem(flagKey, '1');
      return;
    }

    const total = needsUpdate.length;
    let updated = 0;
    if (onProgress) onProgress(0, total);

    // Index by id for O(1) lookup during merge. Use a loop for minId to
    // avoid call-stack overflow on very large arrays (spread operator limit).
    const byId = new Map<number, any>();
    let minId = Infinity;
    for (const p of needsUpdate) {
      byId.set(p.id, p);
      if (p.id < minId) minId = p.id;
    }

    const normalizedName = userInfo.name.replace(/ /g, '_');
    const limit = 200;
    let lastId = minId - 1;
    let hasMore = true;

    while (hasMore && updated < total) {
      const params = new URLSearchParams({
        tags: `user:${normalizedName} status:any id:>${lastId} order:id`,
        limit: String(limit),
        only: 'id,up_score,down_score,is_deleted,is_banned'
      } as any);
      const url = `/posts.json?${params.toString()}`;

      let batch: any[];
      try {
        const resp = await this.rateLimiter.fetch(url);
        if (!resp.ok) {
          console.warn(`[Backfill] HTTP ${resp.status} — pausing backfill`);
          return;
        }
        batch = await resp.json();
      } catch (e) {
        console.warn('[Backfill] Fetch failed:', e);
        return; // Will retry on next dashboard open
      }

      if (!Array.isArray(batch) || batch.length === 0) {
        hasMore = false;
        break;
      }

      const updates: any[] = [];
      for (const p of batch) {
        const existing = byId.get(p.id);
        if (!existing) continue;

        const ds = p.down_score ?? 0;
        const us = p.up_score ?? 0;
        updates.push({
          ...existing,
          score: us + ds,
          up_score: us,
          down_score: ds,
          is_deleted: p.is_deleted ?? false,
          is_banned: p.is_banned ?? false,
        });
        updated++;
      }

      if (updates.length > 0) {
        await this.db.posts.bulkPut(updates);
        if (onProgress) onProgress(updated, total);
      }

      lastId = batch[batch.length - 1].id;
      if (batch.length < limit) {
        hasMore = false;
      }
    }

    if (updated >= total) {
      localStorage.setItem(flagKey, '1');
    }
  }

  /**
   * Fetches user-level aggregate counts (gentags<10 / tagcount<10) used by
   * the scatter plot Tag Count mode Y=10 click feature. Cached in the
   * `user_stats` table with a 24h expiry.
   *
   * @param userInfo Target user
   * @param force If true, ignore cache and refetch
   */
  async getUserStats(userInfo: TargetUser, force = false): Promise<{gentags_lt_10: number; tagcount_lt_10: number} | null> {
    const userId = userInfo.id;
    if (!userId) return null;

    if (!force) {
      const cached = await this.db.user_stats.get(userId);
      if (cached && Date.now() - cached.updated_at < 24 * 60 * 60 * 1000) {
        return {gentags_lt_10: cached.gentags_lt_10, tagcount_lt_10: cached.tagcount_lt_10};
      }
    }

    const normalizedName = userInfo.name.replace(/ /g, '_');
    const fetchCount = async (tagQuery: string): Promise<number> => {
      try {
        const params = new URLSearchParams({tags: tagQuery});
        const url = `/counts/posts.json?${params.toString()}`;
        const resp = await this.rateLimiter.fetch(url);
        if (!resp.ok) return 0;
        const data = await resp.json();
        return (data && data.counts ? data.counts.posts : (data ? data.posts : 0)) || 0;
      } catch (e) {
        console.warn(`[UserStats] count query failed for "${tagQuery}":`, e);
        return 0;
      }
    };

    const [gentags, tagcount] = await Promise.all([
      fetchCount(`user:${normalizedName} gentags:<10`),
      fetchCount(`user:${normalizedName} tagcount:<10`),
    ]);

    const record: UserStatsRecord = {
      userId,
      gentags_lt_10: gentags,
      tagcount_lt_10: tagcount,
      updated_at: Date.now(),
    };
    await this.db.user_stats.put(record);

    return {gentags_lt_10: gentags, tagcount_lt_10: tagcount};
  }

  /**
   * Fetches the date when the user was promoted to a level that can approve posts (Approver+).
   * @param {string} userName
   * @return {Promise<string|null>} ISO date string (YYYY-MM-DD) or null.
   */
  async fetchPromotionDate(userName: string): Promise<string | null> {
    const history = await this.getPromotionHistory({ name: userName });
    // Look for promotion to Approver, Admin, Moderator, etc.
    // Roles: Member -> Gold -> Platinum -> Builder -> Contributor -> Approver -> Moderator -> Admin
    // We look for the FIRST event where they reached 'Approver' level or higher.
    // Since it's hard to parse exact level order from text, we just look for 'Approver', 'Moderator', 'Admin'.
    // Actually, 'Builder' might also be relevant if we track that. But user asked for Approvals.
    // Let's assume 'Approver' or higher.

    // Simplified: Just find the earliest "Promoted to X" where X is Approver+.
    // But for safety, let's just use the logic: "When did they start approving?"
    // Better: Use the /user_feedbacks result to find "promoted to Approver".

    const targetRoles = ['Approver', 'Moderator', 'Admin'];
    const promoEvent = history.find(h => targetRoles.some(r => h.role.includes(r)));

    if (promoEvent) {
      return promoEvent.date.toISOString().slice(0, 10);
    }
    return null;
  }

  /**
   * Fetches promotion history from user feedbacks.
   * @param {Object} userInfo The user's info object.
   * @return {Promise<Array<{date: Date, role: string, rawBody: string}>>}
   */
  async getPromotionHistory(userInfo: {name: string}): Promise<PromotionEvent[]> {
    if (!userInfo.name) return [];
    try {
      const normalizedName = userInfo.name.replace(/ /g, '_');
      const url = `/user_feedbacks.json?commit=Search&search%5Bbody_matches%5D=promoted&search%5Buser_name%5D=${encodeURIComponent(normalizedName)}`;
      const feedbacks = await this.rateLimiter.fetch(url).then(r => r.json());

      if (!Array.isArray(feedbacks)) return [];

      return feedbacks.map(f => {
        // Parse Body: "promoted to a Builder level account"
        const match = f.body.match(/promoted to a (.+?) level/i);
        const role = match ? match[1] : 'Unknown';
        return {
          date: new Date(f.created_at),
          role: role,
          rawBody: f.body
        };
      }).filter(item => item.role !== 'Unknown').sort((a, b) => (a.date as any) - (b.date as any));
    } catch (e: unknown) {
      console.error('[Danbooru Grass] Failed to fetch promotions', e);
      return [];
    }
  }

  /**
   * Fetches user level change history from user_feedbacks API.
   * Handles both "from X to Y" and "to Y from X" body formats.
   * @param {!Object} userInfo The user's info object.
   * @return {!Promise<!Array<!LevelChangeEvent>>}
   */
  async getLevelChangeHistory(userInfo: TargetUser): Promise<LevelChangeEvent[]> {
    if (!userInfo.name) return [];
    const normalizedName = userInfo.name.replace(/ /g, '_');

    // Known Danbooru levels ordered by rank (lowest → highest)
    const LEVEL_HIERARCHY = [
      'Restricted', 'Member', 'Gold', 'Platinum',
      'Builder', 'Contributor', 'Janitor', 'Approver',
      'Moderator', 'Admin', 'Owner'
    ];
    const levelRank = new Map(LEVEL_HIERARCHY.map((l, i) => [l.toLowerCase(), i]));

    /**
     * Parses a feedback body into {fromLevel, toLevel, isPromotion} or null.
     * Extracts all known level names from text, then uses promotion/demotion
     * keyword + level hierarchy to determine from/to direction.
     */
    const parse = (body: string): {fromLevel: string; toLevel: string; isPromotion: boolean} | null => {
      // Find all known levels mentioned in the body (case-insensitive, unique)
      const found: string[] = [];
      const bodyLower = body.toLowerCase();
      for (const level of LEVEL_HIERARCHY) {
        if (bodyLower.includes(level.toLowerCase()) && !found.includes(level)) {
          found.push(level);
        }
      }
      if (found.length < 2) return null;

      // Determine promotion vs demotion from keywords
      const isPromotion = /promot/i.test(body);

      // Sort the two levels by hierarchy rank
      const sorted = found.slice(0, 2).sort((a, b) =>
        (levelRank.get(a.toLowerCase()) ?? 0) - (levelRank.get(b.toLowerCase()) ?? 0)
      );
      const [lower, higher] = sorted;

      // Promotion: lower → higher, Demotion: higher → lower
      return isPromotion
        ? {fromLevel: lower, toLevel: higher, isPromotion: true}
        : {fromLevel: higher, toLevel: lower, isPromotion: false};
    };

    try {
      const base = `/user_feedbacks.json?commit=Search&search[category]=neutral&search[user_name]=${encodeURIComponent(normalizedName)}`;
      const [promoted, demoted] = await Promise.all([
        this.rateLimiter.fetch(`${base}&search[body_matches]=promoted+to+from`).then(r => r.json()),
        this.rateLimiter.fetch(`${base}&search[body_matches]=demoted+to+from`).then(r => r.json()),
      ]);

      const all = [
        ...(Array.isArray(promoted) ? promoted : []),
        ...(Array.isArray(demoted) ? demoted : []),
      ];

      const events: LevelChangeEvent[] = [];
      for (const fb of all) {
        const body: string = fb.body || '';
        const parsed = parse(body);
        if (!parsed) continue;
        events.push({
          date: new Date(fb.created_at),
          fromLevel: parsed.fromLevel,
          toLevel: parsed.toLevel,
          isPromotion: parsed.isPromotion,
        });
      }

      // Sort oldest first, deduplicate by date+fromLevel+toLevel
      events.sort((a, b) => a.date.getTime() - b.date.getTime());
      const seen = new Set<string>();
      return events.filter(e => {
        const key = `${e.date.getTime()}-${e.fromLevel}-${e.toLevel}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } catch (e: unknown) {
      console.warn('[Danbooru Grass] Failed to fetch level change history', e);
      return [];
    }
  }

  /**
   * Fetches milestone posts for the timeline (100th, 1000th, 10000th, N*10000th).
   * Lightweight — no thumbnail fetch, date only.
   * @param {!Object} userInfo The user's info object.
   * @return {!Promise<!Array<!TimelineMilestone>>}
   */
  async getTimelineMilestones(userInfo: TargetUser): Promise<TimelineMilestone[]> {
    const uploaderId = parseInt(userInfo.id ?? '0');
    if (!uploaderId) return [];

    const total = await this.db.posts.where('uploader_id').equals(uploaderId).count();
    if (total === 0) return [];

    const targets: number[] = [];
    if (total >= 100) targets.push(100);
    if (total >= 1000) targets.push(1000);
    for (let i = 10000; i <= total; i += 10000) targets.push(i);

    if (targets.length === 0) return [];

    const matches: ApiItem[] = await this.db.posts
      .where('[uploader_id+no]').anyOf(targets.map(no => [uploaderId, no]))
      .toArray();

    const map = new Map(matches.map(p => [p.no, p]));

    return targets
      .map(t => {
        const p = map.get(t);
        if (!p || !p.created_at) return null;
        return {index: t, date: new Date(p.created_at)};
      })
      .filter(Boolean) as TimelineMilestone[];
  }

  /**
   * Fetches breast size distribution by checking specific tags.
   * @param {Object} userInfo The user's info object.
   * @param {boolean} [forceRefresh=false] Whether to bypass cache.
   * @return {Promise<Array>}
   */
  async getCommentaryDistribution(userInfo: TargetUser, forceRefresh: boolean = false, reportSubStatus: ((msg: string) => void) | null = null): Promise<DistributionItem[]> {
    if (!userInfo.name) return [];
    if (reportSubStatus) reportSubStatus(`Fetching Commentary Distribution...`);
    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'commentary_dist';

    if (!forceRefresh && uploaderId) {
      const cached = await this.getStats(cacheKey, uploaderId);
      if (cached) return cached as DistributionItem[];
    }

    const normalizedName = userInfo.name.replace(/ /g, '_');
    const categories = [
      {name: 'Commentary', tagName: 'commentary', query: `user:${normalizedName} commentary`, color: '#007bff'},
      {name: 'Requested', tagName: 'commentary_request', query: `user:${normalizedName} commentary_request`, color: '#ffc107'},
      {name: 'Untagged', tagName: 'untagged_commentary', query: `user:${normalizedName} has:commentary -commentary -commentary_request`, color: '#6c757d'},
    ];

    const results: DistributionItem[] = categories.map(cat => ({
      name: cat.name, tagName: cat.tagName, count: 0, frequency: 0, thumb: null, isOther: false, color: cat.color,
    }));

    await this.mapConcurrent(
      categories.map((cat, i) => ({...cat, idx: i})), 3,
      async (item) => {
        if (reportSubStatus) reportSubStatus(`Fetching Commentary: ${item.name}`);
        try {
          const url = `/counts/posts.json?tags=${encodeURIComponent(item.query)}`;
          const resp = await this.rateLimiter.fetch(url).then(r => r.json());
          if (resp?.counts?.posts) results[item.idx].count = resp.counts.posts;
        } catch (e: unknown) { console.debug('[DI] Failed to fetch commentary count', e); }
      },
    );

    const filtered = results.filter(r => r.count > 0);
    if (uploaderId) await this.saveStats(cacheKey, uploaderId, filtered);
    return filtered;
  }

  /**
   * Fetches translation distribution.
   */
  async getTranslationDistribution(userInfo: TargetUser, forceRefresh: boolean = false, reportSubStatus: ((msg: string) => void) | null = null): Promise<DistributionItem[]> {
    if (!userInfo.name) return [];
    if (reportSubStatus) reportSubStatus(`Fetching Translation Distribution...`);
    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'translation_dist';

    if (!forceRefresh && uploaderId) {
      const cached = await this.getStats(cacheKey, uploaderId);
      if (cached) return cached as DistributionItem[];
    }

    const normalizedName = userInfo.name.replace(/ /g, '_');
    const categories: Array<{
      name: string;
      tagName: string;
      query?: string;
      useInclusionExclusion?: boolean;
      color: string;
    }> = [
      {name: 'Translated', tagName: 'translated', query: `user:${normalizedName} translated`, color: '#28a745'},
      {name: 'Requested', tagName: 'translation_request', query: `user:${normalizedName} translation_request`, color: '#ffc107'},
      {name: 'Untagged', tagName: 'untagged_translation', useInclusionExclusion: true, color: '#6c757d'},
    ];

    const results: DistributionItem[] = categories.map(cat => ({
      name: cat.name, tagName: cat.tagName, count: 0, frequency: 0, thumb: null, isOther: false, color: cat.color,
    }));

    const fetchCount = async (query: string): Promise<number> => {
      try {
        const url = `/counts/posts.json?tags=${encodeURIComponent(query)}`;
        const resp = await this.rateLimiter.fetch(url).then(r => r.json());
        return (resp?.counts?.posts as number) ?? 0;
      } catch {
        return 0;
      }
    };

    await this.mapConcurrent(
      categories.map((cat, i) => ({...cat, idx: i})), 3,
      async (item) => {
        if (reportSubStatus) reportSubStatus(`Fetching Translation: ${item.name}`);
        try {
          if (item.useInclusionExclusion) {
            // Untagged via inclusion-exclusion: max(0, t − a − b − c + ab + ac).
            // See PLAN.md §9 for derivation. All 6 queries use ≤2 real tags
            // so they work on Member(Blue) accounts.
            const q = buildUntaggedTranslationQueries(normalizedName);
            const [t, a, b, c, ab, ac] = await Promise.all([
              fetchCount(q.t),
              fetchCount(q.a),
              fetchCount(q.b),
              fetchCount(q.c),
              fetchCount(q.ab),
              fetchCount(q.ac),
            ]);
            results[item.idx].count = computeUntaggedTranslation({t, a, b, c, ab, ac});

            // Assumption-1 runtime validation (monitoring only, does not affect result).
            // If |R ∩ TR| / t > 0.5%, the mutual exclusivity assumption is violated.
            fetchCount(q.bc).then(bc => {
              const ratio = bc / Math.max(1, t);
              if (ratio > 0.005) {
                console.warn(
                  `[DI] Assumption-1 violation for user:${normalizedName}: ` +
                  `|R∩TR|/|T| = ${(ratio * 100).toFixed(2)}% (threshold 0.5%, bc=${bc}, t=${t})`
                );
              }
            }).catch(() => { /* monitoring only */ });
          } else if (item.query) {
            const count = await fetchCount(item.query);
            if (count > 0) results[item.idx].count = count;
          }
        } catch (e: unknown) { console.debug('[DI] Failed to fetch translation count', e); }
      },
    );

    const filtered = results.filter(r => r.count > 0);
    if (uploaderId) await this.saveStats(cacheKey, uploaderId, filtered);
    return filtered;
  }

  /**
   * Fetches gender distribution.
   * @param {Object} userInfo The user's info object.
   * @param {boolean} [forceRefresh=false] Whether to bypass cache.
   * @return {Promise<Array>}
   */
  async getGenderDistribution(userInfo: TargetUser, forceRefresh: boolean = false, reportSubStatus: ((msg: string) => void) | null = null): Promise<DistributionItem[]> {
    if (!userInfo.name) return [];
    if (reportSubStatus) reportSubStatus(`Fetching Gender Distribution...`);
    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'gender_dist';

    if (!forceRefresh && uploaderId) {
      const cached = await this.getStats(cacheKey, uploaderId);
      if (cached) return cached as DistributionItem[];
    }

    const normalizedName = userInfo.name.replace(/ /g, '_');

    // `originalTag` preserves the semantic OR query for click navigation
    // (matches the conceptual count query). On Gold+ accounts this navigates to
    // the full union of girl/boy/other variants. On Member(Blue) accounts the
    // 6-tag query exceeds the 2-tag limit and Danbooru returns an error page —
    // consistent with Translation Untagged click behavior.
    const genderCategories: Array<{
      name: string;
      tagName: string;
      originalTag?: string;
      subQueries?: string[];
      query?: string;
      color: string;
    }> = [
      {
        name: 'Girl',
        tagName: 'girl',
        originalTag: '~1girl ~2girls ~3girls ~4girls ~5girls ~6+girls',
        subQueries: ['1girl', '2girls', '3girls', '4girls', '5girls', '6+girls'].map(
          tag => `user:${normalizedName} ${tag}`
        ),
        color: '#e91e63',
      },
      {
        name: 'Boy',
        tagName: 'boy',
        originalTag: '~1boy ~2boys ~3boys ~4boys ~5boys ~6+boys',
        subQueries: ['1boy', '2boys', '3boys', '4boys', '5boys', '6+boys'].map(
          tag => `user:${normalizedName} ${tag}`
        ),
        color: '#2196f3',
      },
      {
        name: 'Other',
        tagName: 'other',
        originalTag: '~1other ~2others ~3others ~4others ~5others ~6+others',
        subQueries: ['1other', '2others', '3others', '4others', '5others', '6+others'].map(
          tag => `user:${normalizedName} ${tag}`
        ),
        color: '#9c27b0',
      },
      {
        name: 'No Humans',
        tagName: 'no_humans',
        query: `user:${normalizedName} no_humans`,
        color: '#607d8b',
      },
    ];

    const results: DistributionItem[] = genderCategories.map(cat => ({
      name: cat.name,
      tagName: cat.tagName,
      originalTag: cat.originalTag,
      count: 0,
      frequency: 0,
      thumb: null,
      isOther: false,
      color: cat.color,
    }));

    await this.mapConcurrent(
      genderCategories.map((cat, i) => ({...cat, idx: i})),
      3,
      async (item) => {
        if (reportSubStatus) reportSubStatus(`Fetching Gender: ${item.name}`);
        try {
          if (item.subQueries) {
            const counts = await Promise.all(
              item.subQueries.map(async (q: string) => {
                try {
                  const url = `/counts/posts.json?tags=${encodeURIComponent(q)}`;
                  const resp = await this.rateLimiter.fetch(url).then(r => r.json());
                  return (resp?.counts?.posts as number) ?? 0;
                } catch {
                  return 0;
                }
              })
            );
            results[item.idx].count = counts.reduce((sum, n) => sum + n, 0);
          } else if (item.query) {
            const url = `/counts/posts.json?tags=${encodeURIComponent(item.query)}`;
            const resp = await this.rateLimiter.fetch(url).then(r => r.json());
            if (resp && resp.counts && typeof resp.counts.posts === 'number') {
              results[item.idx].count = resp.counts.posts;
            }
          }
        } catch (e: unknown) { console.debug('[DI] Failed to fetch gender count', e); }
      },
    );

    const filtered = results.filter(r => r.count > 0);
    if (uploaderId) await this.saveStats(cacheKey, uploaderId, filtered);
    return filtered;
  }

  /**
   * Fetches breasts size distribution.
   * @param {Object} userInfo The user's info object.
   * @param {boolean} [forceRefresh=false] Whether to bypass cache.
   * @return {Promise<Array>}
   */
  async getBreastsDistribution(userInfo: TargetUser, forceRefresh: boolean = false, reportSubStatus: ((msg: string) => void) | null = null): Promise<DistributionItem[]> {
    if (!userInfo.name) return [];
    if (reportSubStatus) reportSubStatus(`Fetching Breasts Distribution...`);
    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'breasts_dist';

    if (!forceRefresh && uploaderId) {
      const cached = await this.getStats(cacheKey, uploaderId);
      if (cached) return cached as DistributionItem[];
    }

    const normalizedName = userInfo.name.replace(/ /g, '_');
    const breastTags = [
      'flat_chest',
      'small_breasts',
      'medium_breasts',
      'large_breasts',
      'huge_breasts',
      'gigantic_breasts'
    ];

    // Use mapConcurrent from base class to fetch efficiently
    // But Lazy Load the thumbs
    const results = breastTags.map(tag => ({
      name: tag.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' '),
      tagName: tag,
      count: 0,
      frequency: 0,
      thumb: null,
      isOther: false
    }));

    // Calculate Counts
    await this.mapConcurrent(results, 3, async (obj) => {
      const tag = obj.tagName;
      if (reportSubStatus) reportSubStatus(`Fetching Breasts: ${obj.name}`);
      try {
        const uniqueTag = `user:${normalizedName} ${tag}`;
        const url = `/counts/posts.json?tags=${encodeURIComponent(uniqueTag)}`;
        const resp = await this.rateLimiter.fetch(url).then(r => r.json());
        let count = 0;
        if (resp && resp.counts && typeof resp.counts.posts === 'number') {
          count = resp.counts.posts;
        }
        obj.count = count;
      } catch (e: unknown) { console.debug('[DI] Failed to fetch breasts count', e); }
    });

    // Filter out zero counts
    const filtered = results.filter(r => r.count > 0).sort((a, b) => b.count - a.count);

    if (uploaderId) await this.saveStats(cacheKey, uploaderId, filtered);

    await this.enrichThumbnails(cacheKey, uploaderId, filtered, userInfo, reportSubStatus);

    return filtered;
  }

  /**
   * Fetches hair length distribution.
   * @param {Object} userInfo The user's info object.
   * @param {boolean} [forceRefresh=false] Whether to bypass cache.
   * @return {Promise<Array>}
   */
  async getHairLengthDistribution(userInfo: TargetUser, forceRefresh: boolean = false, reportSubStatus: ((msg: string) => void) | null = null): Promise<DistributionItem[]> {
    if (!userInfo.name) return [];
    if (reportSubStatus) reportSubStatus(`Fetching Hair Length Distribution...`);
    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'hair_length_dist';

    if (!forceRefresh && uploaderId) {
      const cached = await this.getStats(cacheKey, uploaderId);
      if (cached) return cached as DistributionItem[];
    }

    const normalizedName = userInfo.name.replace(/ /g, '_');
    const hairLengthTags = [
      '~bald ~bald_female',
      'very_short_hair',
      'short_hair',
      'medium_hair',
      'long_hair',
      'very_long_hair',
      'absurdly_long_hair'
    ];

    const results = hairLengthTags.map(tag => {
      let label = tag;
      if (tag.includes('~bald')) label = 'Bald';
      else label = tag.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');

      return {
        name: label,
        count: 0,
        frequency: 0,
        originalTag: tag,
        thumb: null,
        isOther: false
      };
    });

    await this.mapConcurrent(results, 3, async (obj) => {
      if (reportSubStatus) reportSubStatus(`Fetching Hair Length: ${obj.name}`);
      try {
        const uniqueTag = `user:${normalizedName} ${obj.originalTag}`;
        const url = `/counts/posts.json?tags=${encodeURIComponent(uniqueTag)}`;
        const resp = await this.rateLimiter.fetch(url).then(r => r.json());
        if (resp && resp.counts && typeof resp.counts.posts === 'number') {
          obj.count = resp.counts.posts;
        }
      } catch (e: unknown) { console.debug('[DI] Failed to fetch count', e); }
    });

    const filtered = results.filter(r => r.count > 0).sort((a, b) => b.count - a.count);
    if (uploaderId) await this.saveStats(cacheKey, uploaderId, filtered);

    await this.enrichThumbnails(cacheKey, uploaderId, filtered, userInfo, reportSubStatus);

    return filtered;
  }

  /**
   * Fetches hair color distribution.
   * @param {Object} userInfo The user's info object.
   * @param {boolean} [forceRefresh=false] Whether to bypass cache.
   * @return {Promise<Array>}
   */
  async getHairColorDistribution(userInfo: TargetUser, forceRefresh: boolean = false, reportSubStatus: ((msg: string) => void) | null = null): Promise<DistributionItem[]> {
    if (!userInfo.name) return [];
    if (reportSubStatus) reportSubStatus(`Fetching Hair Color Distribution...`);
    const uploaderId = parseInt(userInfo.id || '0');
    const cacheKey = 'hair_color_dist';

    if (!forceRefresh && uploaderId) {
      const cached = await this.getStats(cacheKey, uploaderId);
      if (cached) return cached as DistributionItem[];
    }

    const normalizedName = userInfo.name.replace(/ /g, '_');
    const hairColorMap = [
      { tag: 'black_hair', color: '#000000' },
      { tag: 'brown_hair', color: '#A52A2A' },
      { tag: 'blonde_hair', color: '#FFD700' },
      { tag: 'red_hair', color: '#FF0000' },
      { tag: 'orange_hair', color: '#FFA500' },
      { tag: 'pink_hair', color: '#FFC0CB' },
      { tag: 'purple_hair', color: '#800080' },
      { tag: 'green_hair', color: '#008000' },
      { tag: 'blue_hair', color: '#0000FF' },
      { tag: 'aqua_hair', color: '#00FFFF' },
      { tag: 'grey_hair', color: '#808080' },
      { tag: 'white_hair', color: '#FFFFFF' }
    ];

    const results = hairColorMap.map(item => ({
      name: item.tag.split('_')[0].charAt(0).toUpperCase() + item.tag.split('_')[0].slice(1) + ' Hair',
      count: 0,
      frequency: 0,
      color: item.color,
      originalTag: item.tag,
      thumb: null,
      isOther: false
    }));

    await this.mapConcurrent(results, 3, async (obj) => {
      if (reportSubStatus) reportSubStatus(`Fetching Hair Color: ${obj.name}`);
      try {
        const uniqueTag = `user:${normalizedName} ${obj.originalTag}`;
        const url = `/counts/posts.json?tags=${encodeURIComponent(uniqueTag)}`;
        const resp = await this.rateLimiter.fetch(url).then(r => r.json());
        if (resp && resp.counts && typeof resp.counts.posts === 'number') {
          obj.count = resp.counts.posts;
        }
      } catch (e: unknown) { console.debug('[DI] Failed to fetch count', e); }
    });

    const filtered = results.filter(r => r.count > 0).sort((a, b) => b.count - a.count);
    if (uploaderId) await this.saveStats(cacheKey, uploaderId, filtered);

    await this.enrichThumbnails(cacheKey, uploaderId, filtered, userInfo, reportSubStatus);

    return filtered;
  }

  async enrichThumbnails(cacheKey: string, uploaderId: number, items: DistributionItem[], userInfo: TargetUser, _statusCallback: ((msg: string) => void) | null = null): Promise<void> {
    let hasUpdates = false;
    const normalizedName = userInfo.name.replace(/ /g, '_');

    // Identify items needing thumbs
    // Explicitly check for null or empty string, but sometimes empty string means "tried and failed".
    // Let's assume null means "not yet fetched".
    const toFetch = items.filter(i => !i.isOther && !i.thumb);

    if (toFetch.length === 0) return;

    // Process in background


    await this.mapConcurrent(toFetch, 2, async (item) => {
      // Re-construct query based on cacheKey or item data?
      // "item" doesn't have the full query info derived in the parent function (e.g. hair_color map).
      // But we stored `tagName` or `originalTag` or `color`?
      // Character/Copyright/Breasts: `tagName` exists.
      // Hair Length: `originalTag`.
      // Hair Color: `originalTag`.

      // We need to standardize or deduce.
      let tagPart = item.tagName || item.originalTag;
      if (!tagPart && cacheKey === 'hair_color_dist') {
        // Infer from name? Vulnerable.
        // We should have saved originalTag.
        // In getHairColorDistribution, we updated to save `originalTag`.
      }

      if (!tagPart) return;

      // Construct Query
      // fav_copyright: search from user's favorites; others: from user's uploads
      let queryTags: string;
      if (cacheKey === 'fav_copyright_dist') {
        queryTags = `fav:${normalizedName} ${tagPart} rating:g order:score`;
      } else {
        queryTags = `user:${normalizedName} ${tagPart} order:score rating:g`;
      }

      // Special cases if any? No, mostly standard.

      const thumb = await this.fetchThumbnailWithRetry(queryTags);
      if (thumb) {
        item.thumb = thumb;
        hasUpdates = true;
        // Optional: Notify UI for incremental update?
        // For now, let's just save at end or batch?
      }
    });

    if (hasUpdates && uploaderId) {
      // Save updated stats
      await this.saveStats(cacheKey, uploaderId, items);

      // Notify UI
      // How? We need a global event or callback.
      // Dispatch a window event? "DanbooruInsights:DataUpdated"
      window.dispatchEvent(new CustomEvent('DanbooruInsights:DataUpdated', {
        detail: { contentType: cacheKey, userId: uploaderId, data: items }
      }));
    }
  }


  /**
   * helper to get robust total count.
   * @param {Object} userInfo The user's info object.
   * @return {Promise<number>}
   */
  async getTotalPostCount(userInfo: TargetUser): Promise<number> {
    if (!userInfo.name) return 0;
    try {
      // Method A: Exact Search Count (API)
      // Use tags=... order:score rating:x limit=1
      const normalizedName = userInfo.name.replace(/ /g, '_');
      const countUrl = `/counts/posts.json?tags=user:${encodeURIComponent(normalizedName)}`;
      const countData = await this.rateLimiter.fetch(countUrl).then(r => r.json());
      if (countData && typeof countData.counts === 'object' && typeof countData.counts.posts === 'number') {
        return countData.counts.posts;
      }
    } catch (e: unknown) {
      console.warn('[Danbooru Grass] Counts API failed:', e);
    }

    // Method B: Profile API Fallback
    try {
      const profileUrl = `/users/${userInfo.id}.json`;
      const profile = await this.rateLimiter.fetch(profileUrl).then(r => r.json());
      if (profile && typeof profile.post_upload_count === 'number') {
        return profile.post_upload_count;
      }
    } catch (_e2: unknown) { console.debug('[DI] Failed to fetch user profile', _e2); }

    // Method C: DOM Fallback
    try {
      const statsLink = document.querySelector(
        '#danbooru-grass-wrapper > div:nth-child(1) > table > tbody > tr:nth-child(6) > td > a:nth-child(1)'
      );
      if (statsLink) {
        return parseInt((statsLink.textContent ?? '').replace(/,/g, ''), 10);
      }
    } catch (_e3: unknown) { console.debug('[DI] Failed to parse DOM stats', _e3); }

    return 0; // Failed
  }

  /**
   * Syncs all posts for the user using parallel buffered fetching.
   * @param {Object} userInfo The user's info object.
   * @param {Function} onProgress Callback for progress updates (current, total).
   * @return {Promise<void>}
   */
  async syncAllPosts(userInfo: TargetUser, onProgress: (current: number, total: number, message?: string) => void): Promise<void> {
    if (!userInfo.id) {
      console.error('User ID required for sync');
      return;
    }

    const uploaderId = parseInt(userInfo.id ?? '0');

    // Global Sync Lock
    if (AnalyticsDataManager.isGlobalSyncing) {
      console.warn('[Danbooru Grass] Sync already in progress.');
      return;
    }
    AnalyticsDataManager.isGlobalSyncing = true;
    AnalyticsDataManager.syncProgress = { current: 0, total: 0, message: '' };
    AnalyticsDataManager.onProgressCallback = onProgress;

    // Helper to broadcast progress
    const reportProgress = (c: number, t: number, msg: string = '') => {
      AnalyticsDataManager.syncProgress = { current: c, total: t, message: msg };
      if (AnalyticsDataManager.onProgressCallback) {
        AnalyticsDataManager.onProgressCallback(c, t, msg);
      }
      if (onProgress) onProgress(c, t, msg);
    };

    try {

      // 1. Get total count
      let total = await this.getTotalPostCount(userInfo);


      // 2. Resume Check
      // Strategy: overlapping sync (1 month back) to catch updates (score/tags)
      const newestArr = await this.db.posts.where('uploader_id').equals(uploaderId).reverse().limit(1).toArray();
      let startId = 0;

      if (newestArr.length > 0) {
        const newest = newestArr[0];
        const newestDate = new Date(newest.created_at);
        const cutOffDate = new Date(newestDate);
        cutOffDate.setMonth(cutOffDate.getMonth() - 1);




        // Find the first post that is OLDER than cutOffDate to determine startId
        // Use .until() to stop iteration immediately after the first match
        let cutOffFound = false;
        await this.db.posts.where('uploader_id').equals(uploaderId).reverse()
          .until(() => cutOffFound)
          .each((p: ApiItem) => {
            if (new Date(p['created_at']) < cutOffDate) {
              startId = p['id'];
              cutOffFound = true;
            }
          });

        // fallback: if history is shorter than 1 month, startId stays 0 (Full Sync)
      }

      // Initialize currentNo based on startId
      // If startId is 0, we start counting from 0.
      // If startId > 0, we start counting from the number of posts we have UP TO that point.
      let currentNo = 0;
      if (startId > 0) {
        // Fix: Count ONLY this user's posts below startId
        // Using filter() on the collection because composite index might not exist for (id, uploader_id)
        currentNo = await this.db.posts.where('uploader_id').equals(uploaderId).filter((p: ApiItem) => p['id'] <= startId).count();

      } else {

      }



      // FIX: If total is 0 (Failed to fetch), we CANNOT assume "Already Synced".
      // We must assume "Unknown" and proceed to try and fetch new posts.
      // IF total > 0 (Success), then we check if current >= total.
      // BUT with the new overlapping logic, we almost ALWAYS want to sync at least the overlap.
      // So we relax the "Already synced" check if we have a valid startId > 0 (meaning we have history).
      // If startId > 0, we proceed to fetch updates.
      // If startId == 0 and current == total, then maybe we are really done?
      // Actually, user wants "Update". So if we calculated a startId, we should run.

      if (startId === 0 && total > 0 && currentNo >= total) {

        reportProgress(currentNo, total);
        return;
      }

      // If total is 0, we simply run blindly until empty. That's fine.


      // 3. Buffered Parallel Fetching Logic
      const limit = 200; // API Limit

      let pageOffset = 1;
      // 3. Worker Pool Logic (Rolling Window)
      const MAX_CONCURRENCY = 5;
      const WORKER_DELAY = 400; // 5 workers * 1 req / 0.4s = 12.5 req/s (Max)

      // Shared State
      let hasMore = true;

      // Ordered Commit State
      const buffer = new Map<number, ApiItem[]>(); // page -> items
      let nextExpectedPage = 1;

      const worker = async (workerId: number) => {
        // Staggered Start: Prevent initial burst
        if (workerId > 0) await new Promise(r => setTimeout(r, workerId * 200));

        while (hasMore) {
          // 1. Claim a page
          const currentPage = pageOffset++;

          try {
            const params = {
              limit,
              page: currentPage,
              'tags': `user:${userInfo.name.replace(/ /g, '_')} order:id id:>${startId}`,
              'only': 'id,uploader_id,created_at,up_score,down_score,is_deleted,is_banned,rating,tag_count_general,variants,preview_file_url'
            };
            const q = new URLSearchParams(params as any);
            const url = `/posts.json?${q.toString()}`;

            const pending = buffer.size;
            reportProgress(currentNo, total, `Fetching Page ${currentPage} (Pending: ${pending})...`);

            // Retry Logic
            let items: ApiItem[] | null = null;
            let attempts = 0;
            while (attempts < 3) {
              try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s Timeout

                const fetchResp = await this.rateLimiter.fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (!fetchResp.ok) throw new Error(`HTTP ${fetchResp.status}`);
                items = await fetchResp.json();
                break; // Success
              } catch (err: unknown) {
                attempts++;
                const errMsg = err instanceof Error ? err.message : String(err);
                const isServerErr = errMsg.includes('500') || errMsg.includes('502') || errMsg.includes('503') || errMsg.includes('504');
                console.warn(`[Worker ${workerId}] Page ${currentPage} attempt ${attempts} failed: ${errMsg}`);

                if (attempts >= 3 || !isServerErr) throw err; // Give up or fatal error

                // Backoff: 1s, 2s, 4s...
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempts - 1)));
              }
            }

            if (!items || items.length === 0) {
              hasMore = false; // Signal end
              return;
            }

            // 2. Buffer the result
            buffer.set(currentPage, items);

            // 3. Ordered Commit Loop (Check if we can save)
            while (buffer.has(nextExpectedPage)) {
              const batchItems = buffer.get(nextExpectedPage);
              buffer.delete(nextExpectedPage); // Remove from buffer

              if (batchItems && batchItems.length > 0) {
                // Assign Sequential Numbers
                const bulkData = batchItems.map((p) => {
                  const ds = (p as any).down_score ?? 0;
                  const us = (p as any).up_score ?? 0;
                  return {
                    id: p.id,
                    uploader_id: p.uploader_id,
                    created_at: p.created_at,
                    score: us + ds,
                    up_score: us,
                    down_score: ds,
                    is_deleted: (p as any).is_deleted ?? false,
                    is_banned: (p as any).is_banned ?? false,
                    rating: p.rating,
                    tag_count_general: p.tag_count_general,
                    variants: p.variants,
                    preview_file_url: p.preview_file_url,
                    no: ++currentNo
                  };
                });

                await this.db.posts.bulkPut(bulkData);

                // Update Progress
                // currentNo is now accurate (reset based on startId)
                reportProgress(currentNo, total > currentNo ? total : currentNo);
              }

              nextExpectedPage++;
            }

          } catch (e: unknown) {
            console.error(`[Worker ${workerId}] Page ${currentPage} failed`, e);
            hasMore = false;
          }

          // Rate Limit Sleep
          if (hasMore) {
            await new Promise(r => setTimeout(r, WORKER_DELAY));
          }
        }
      };

      // Ignite Workers
      const workers = [];
      for (let i = 0; i < MAX_CONCURRENCY; i++) {
        workers.push(worker(i));
      }

      await Promise.all(workers);

      // Save "Last Synced Date" metadata
      const lastSyncKey = `danbooru_grass_last_sync_${userInfo.id}`;
      localStorage.setItem(lastSyncKey, new Date().toISOString());

      // Mark post metadata backfill complete for full (fresh) syncs.
      // Incremental syncs only touch newer posts, so older posts may still
      // lack the metadata — in that case the backfill mechanism handles them.
      if (startId === 0) {
        localStorage.setItem(`di_post_metadata_v2_${uploaderId}`, '1');
      }

      // Auto-cleanup other users' stale data (older than 14 days)
      await this.cleanupStaleData(userInfo.id);

      // Signal UI: Processing Stats
      reportProgress(total, total, 'PREPARING');

      // Refresh all stats after sync
      // If startId was 0, it was a Full Sync; otherwise it's a Partial Sync
      await this.refreshAllStats(userInfo, startId === 0);

    } finally {
      AnalyticsDataManager.isGlobalSyncing = false;
      AnalyticsDataManager.onProgressCallback = null;
    }
  }

  /**
   * Quickly syncs all posts for small users (total ≤ 1200) using sequential
   * cursor-based pagination. Simpler and faster than the full worker-pool approach.
   * @param {TargetUser} userInfo The user's info object.
   * @param {Function=} onProgress Optional progress callback (current, total, message).
   * @return {Promise<void>}
   */
  async quickSyncAllPosts(userInfo: TargetUser, onProgress?: (current: number, total: number, msg?: string) => void): Promise<void> {
    if (!userInfo.id || !userInfo.name) return;

    if (AnalyticsDataManager.isGlobalSyncing) {
      console.warn('[Danbooru Grass] Sync already in progress.');
      return;
    }
    AnalyticsDataManager.isGlobalSyncing = true;
    AnalyticsDataManager.syncProgress = {current: 0, total: 0, message: ''};
    AnalyticsDataManager.onProgressCallback = onProgress || null;

    const reportProgress = (c: number, t: number, msg: string = '') => {
      AnalyticsDataManager.syncProgress = {current: c, total: t, message: msg};
      if (AnalyticsDataManager.onProgressCallback) {
        AnalyticsDataManager.onProgressCallback(c, t, msg);
      }
      if (onProgress) onProgress(c, t, msg);
    };

    try {
      const uploaderId = parseInt(userInfo.id ?? '0');
      const normalizedName = userInfo.name.replace(/ /g, '_');

      // 1. Get total count
      const total = await this.getTotalPostCount(userInfo);
      reportProgress(0, total, 'Fetching posts...');

      // 2. Clear existing posts for a clean re-fetch
      await this.db.posts.where('uploader_id').equals(uploaderId).delete();

      // 3. Sequential cursor-based fetch (ascending by ID, 200 per batch)
      const limit = 200;
      let page = 'a0';
      let hasMore = true;
      let no = 0;

      while (hasMore) {
        const params = new URLSearchParams({
          tags: `user:${normalizedName}`,
          limit: String(limit),
          page,
          only: 'id,uploader_id,created_at,up_score,down_score,is_deleted,is_banned,rating,tag_count_general,variants,preview_file_url'
        } as any);
        const url = `/posts.json?${params.toString()}`;

        reportProgress(no, total, `Fetching posts (${no}/${total})...`);

        let batch: ApiItem[] = await this.rateLimiter.fetch(url).then((r: Response) => r.json());

        if (!Array.isArray(batch) || batch.length === 0) {
          hasMore = false;
          break;
        }

        // Ensure ascending order (oldest first)
        if (batch.length > 1 && batch[0].id > batch[batch.length - 1].id) {
          batch.reverse();
        }

        // Store batch with sequential no values
        const bulkData = batch.map((p: ApiItem) => {
          const ds = (p as any).down_score ?? 0;
          const us = (p as any).up_score ?? 0;
          return {
            id: p.id,
            uploader_id: p.uploader_id,
            created_at: p.created_at,
            score: us + ds,
            up_score: us,
            down_score: ds,
            is_deleted: (p as any).is_deleted ?? false,
            is_banned: (p as any).is_banned ?? false,
            rating: p.rating,
            tag_count_general: p.tag_count_general,
            variants: p.variants,
            preview_file_url: p.preview_file_url,
            no: ++no
          };
        });

        await this.db.posts.bulkPut(bulkData);
        reportProgress(no, total);

        if (batch.length < limit) {
          hasMore = false;
        } else {
          page = `a${batch[batch.length - 1].id}`;
        }
      }

      // 4. Save last sync timestamp
      const lastSyncKey = `danbooru_grass_last_sync_${userInfo.id}`;
      localStorage.setItem(lastSyncKey, new Date().toISOString());

      // 4b. Mark post metadata backfill complete — quickSync writes all
      // fields directly from the API, so every post record now has the
      // new metadata (down_score, is_deleted, is_banned).
      localStorage.setItem(`di_post_metadata_v2_${uploaderId}`, '1');

      // 5. Cleanup stale data for other users
      await this.cleanupStaleData(userInfo.id);

      // 6. Signal UI: Processing Stats
      reportProgress(no, no, 'PREPARING');

      // 7. Refresh all stats (full sync)
      await this.refreshAllStats(userInfo, true);

    } finally {
      AnalyticsDataManager.isGlobalSyncing = false;
      AnalyticsDataManager.onProgressCallback = null;
    }
  }

  /**
   * Cleans up data for other users if they haven't been synced in 14 days.
   * @param {number|string} currentUserId - The ID of the currently active user (to skip).
   */
  async cleanupStaleData(currentUserId: number | string): Promise<void> {
    const currentId = typeof currentUserId === 'number' ? currentUserId : parseInt(currentUserId);
    const THRESHOLD = CONFIG.ANALYTICS_CLEANUP_THRESHOLD_MS;
    const now = new Date().getTime();

    try {
      // 1. Get all unique uploader_ids from DB
      // Dexie doesn't have a direct 'distinct' query efficiently without keys.
      // But we can iterate unique keys if indexed? 'uploader_id' is indexed.
      const allIds = await this.db.posts.orderBy('uploader_id').uniqueKeys();

      for (const uid of allIds) {
        if (uid === currentId) continue; // Skip current user

        const syncKey = `danbooru_grass_last_sync_${uid}`;
        const lastSyncStr = localStorage.getItem(syncKey);

        let shouldDelete = false;
        if (!lastSyncStr) {
          // No record? Treat as stale (or maybe very old format). Delete to be safe/clean?
          // Or maybe it's a new user not yet synced?
          // If it's in DB but has no sync date, it's zombie data.
          shouldDelete = true;
        } else {
          const lastDate = new Date(lastSyncStr).getTime();
          if (now - lastDate > THRESHOLD) {
            shouldDelete = true;
          }
        }

        if (shouldDelete) {

          await this.db.posts.where('uploader_id').equals(uid).delete();
          await this.db.piestats.where('userId').equals(uid).delete();

          localStorage.removeItem(syncKey);
        }
      }

      // Server bubble data cleanup removed
    } catch (e: unknown) {
      console.warn('[Danbooru Grass] Cleanup failed', e);
    }
  }

  /**
   * Refreshes all cached statistics for the user.
   * @param {Object} userInfo The user's info object.
   * @return {Promise<void>}
   */
  async refreshAllStats(userInfo: TargetUser, isFullSync: boolean = false): Promise<void> {

    const forceRefresh = true;
    try {
      await Promise.all([
        this.getRatingDistribution(userInfo),
        this.getCharacterDistribution(userInfo, forceRefresh, (msg) => {
          const { current, total } = AnalyticsDataManager.syncProgress;
          if (typeof AnalyticsDataManager.onProgressCallback === 'function') {
            AnalyticsDataManager.onProgressCallback(current, total, msg);
          }
        }),
        this.getCopyrightDistribution(userInfo, forceRefresh, (msg) => {
          const { current, total } = AnalyticsDataManager.syncProgress;
          if (typeof AnalyticsDataManager.onProgressCallback === 'function') {
            AnalyticsDataManager.onProgressCallback(current, total, msg);
          }
        }),
        this.getFavCopyrightDistribution(userInfo, forceRefresh),
        this.getBreastsDistribution(userInfo, forceRefresh, (msg) => {
          const { current, total } = AnalyticsDataManager.syncProgress;
          if (typeof AnalyticsDataManager.onProgressCallback === 'function') {
            AnalyticsDataManager.onProgressCallback(current, total, msg);
          }
        }),
        this.getHairLengthDistribution(userInfo, forceRefresh, (msg) => {
          const { current, total } = AnalyticsDataManager.syncProgress;
          if (typeof AnalyticsDataManager.onProgressCallback === 'function') {
            AnalyticsDataManager.onProgressCallback(current, total, msg);
          }
        }),
        this.getHairColorDistribution(userInfo, forceRefresh, (msg) => {
          const { current, total } = AnalyticsDataManager.syncProgress;
          if (typeof AnalyticsDataManager.onProgressCallback === 'function') {
            AnalyticsDataManager.onProgressCallback(current, total, msg);
          }
        }),
        // Always refresh Random Posts
        this.getRandomPosts(userInfo),
        // Refresh Popular Posts only on Full Sync
        ...(isFullSync ? [
          this.getTopPostsByType(userInfo),
          this.getRecentPopularPosts(userInfo),
          this.getTopScorePost(userInfo, 'sfw'),
          this.getTopScorePost(userInfo, 'nsfw')
        ] : [])
      ]);

    } catch (e: unknown) {
      console.warn('[Analytics] Failed to refresh stats', e);
    }
  }

  /**
   * Clears all analytics data for the specified user from local DB.
   * @param {Object} userInfo The user's info object.
   * @return {Promise<void>}
   */
  async clearUserData(userInfo: TargetUser): Promise<void> {
    if (!userInfo.id) return;
    const uploaderId = parseInt(userInfo.id ?? '0'); // For tables using Integers (API direct)
    // const userIdStr = String(userInfo.id); // Not used anymore for Analytics clean



    // 1. Delete posts (uploader_id is INT)
    await this.db.posts.where('uploader_id').equals(uploaderId).delete();

    // 2. Delete Pie Stats (userId is INT in updatePieStats)
    await this.db.piestats.where('userId').equals(uploaderId).delete();

    // 3. Delete Bubble Data (User Specific only, preserve Server cache)


    // Clear metadata (Last Sync Time)
    const lastSyncKey = `danbooru_grass_last_sync_${userInfo.id}`;
    localStorage.removeItem(lastSyncKey);


  }
}
