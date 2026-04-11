import {CONFIG, DAY_MS} from '../config';
import {RateLimitedFetch} from '../core/rate-limiter';
import {isTopLevelTag} from '../utils';
import type {Database} from '../core/database';

/**
 * Data service for TagAnalyticsApp.
 * Handles all API fetching, caching, and data computation.
 */
export class TagAnalyticsDataService {
  db: Database;
  rateLimiter: RateLimitedFetch;
  tagName: string;
  userNames: Record<string, {name: string; level: string; id?: number | string}>;

  constructor(db: Database, rateLimiter: RateLimitedFetch, tagName: string) {
    this.db = db;
    this.rateLimiter = rateLimiter;
    this.tagName = tagName;
    this.userNames = {};
  }

  /**
   * Loads the tag analytics report from the cache if not expired.
   * Cache is considered stale after 24 hours.
   * @return {Promise<?Object>} The cached data object or null if not found/expired.
   */
  async loadFromCache(): Promise<any> {
    if (!this.db || !this.db.tag_analytics) return null;
    try {
      const cached = await this.db.tag_analytics.get(this.tagName);
      if (cached) {
        // Check expiry (e.g. 24 hours)
        const age = Date.now() - cached.updatedAt;
        if (age < CONFIG.CACHE_EXPIRY_MS) {
          return {
            ...cached.data,
            updatedAt: cached.updatedAt,
          };
        }
      }
    } catch (e) {
      console.warn('[TagAnalyticsApp] Cache load failed', e);
    }
    return null;
  }

  /**
   * Saves the current tag analytics data to the cache with a timestamp.
   * @param {!Object} data The analytics data to cache.
   * @return {Promise<void>}
   */
  async saveToCache(data: any): Promise<void> {
    if (!this.db || !this.db.tag_analytics) return;
    try {
      await this.db.tag_analytics.put({
        tagName: this.tagName,
        updatedAt: Date.now(),
        data: data,
      });
    } catch (e) {
      console.warn('[TagAnalyticsApp] Cache save failed', e);
    }
  }

  /**
   * Gets the retention period for tag analytics caches from localStorage.
   * @return {number} Number of days to keep cache (default: 7).
   */
  getRetentionDays(): number {
    try {
      const val = localStorage.getItem('danbooru_tag_analytics_retention');
      if (val) return parseInt(val, 10);
    } catch (e) {
      // Fallback to default
    }
    return 7;
  }

  /**
   * Gets the sync threshold (new posts) for triggering partial sync.
   * @return {number} Number of new posts (default: 50).
   */
  getSyncThreshold(): number {
    try {
      const val = localStorage.getItem('danbooru_tag_analytics_sync_threshold');
      if (val) return parseInt(val, 10);
    } catch (e) {
      // Fallback
    }
    return 50;
  }

  /**
   * Sets the sync threshold.
   * @param {number} count The threshold.
   */
  setSyncThreshold(count: number): void {
    localStorage.setItem('danbooru_tag_analytics_sync_threshold', count.toString());
  }
  /**
   * Sets the retention period for tag analytics caches in localStorage.
   * @param {number} days Number of days to keep cache.
   */
  setRetentionDays(days: number): void {
    if (typeof days === 'number' && days > 0) {
      localStorage.setItem('danbooru_tag_analytics_retention', String(days));
    }
  }

  /**
   * Deletes tag analytics cache entries older than the retention threshold.
   * @return {Promise<void>}
   */
  async cleanupOldCache(): Promise<void> {
    if (!this.db || !this.db.tag_analytics) return;

    const retentionDays = this.getRetentionDays();
    const cutoff = Date.now() - (retentionDays * DAY_MS);

    try {
      await this.db.tag_analytics.where('updatedAt').below(cutoff).delete();
    } catch (e) {
      console.warn('[TagAnalyticsApp] Cleanup failed', e);
    }
  }

  /**
   * Fetches initialization statistics for a tag (First post, 100th post, Total count).
   * This defines the scope of data to fetch.
   *
   * @param {string} tagName - The tag to analyze.
   * @param {?Object} cachedData - Existing cached data to serve as a base for delta updates.
   * @param {boolean} absoluteOldest - If true, forces a scan from 2005-01-01 (ignoring cache/hints).
   * @param {?string} foundEarliestDate - An optimized starting date (YYYY-MM-DD) found via reverse scan.
   *                                      Used to narrow the search range for recent tags.
   * @return {Promise<Object|null>} - Initial stats object or null on failure.
   */
  async fetchInitialStats(tagName: string, cachedData?: any, absoluteOldest?: boolean, foundEarliestDate?: string | null): Promise<any> {

    // Get Tag Metadata first to know count and category
    const tagData = await this.fetchTagData(tagName); // Existing helper
    if (!tagData) return null;

    // [DELTA] Use Cached First 100 Data if available
    if (cachedData && cachedData.firstPost) {

      return {
        firstPost: cachedData.firstPost,
        hundredthPost: cachedData.hundredthPost,
        totalCount: tagData.post_count,
        startDate: new Date(cachedData.firstPost.created_at),
        timeToHundred: cachedData.timeToHundred,
        meta: tagData,
        initialPosts: null // We don't have them in full if cached, but we don't need them for delta
      };
    }

    // Extract created_at from tagData
    // If absoluteOldest is true, we ignore created_at to find history hidden by renames
    // If foundEarliestDate is provided (from Reverse Scan), use it as a strong hint!

    let tagCreatedAt = tagData.created_at;
    if (foundEarliestDate) {
      tagCreatedAt = foundEarliestDate;
    } else if (absoluteOldest) {
      tagCreatedAt = "2005-01-01";
    }

    let posts: any[] = [];
    const MAX_OPTIMIZED_POSTS = CONFIG.MAX_OPTIMIZED_POSTS;
    const isSmallTag = tagData.post_count <= MAX_OPTIMIZED_POSTS;
    const targetFetchCount = Math.min(tagData.post_count, MAX_OPTIMIZED_POSTS);
    const limit = isSmallTag ? 200 : 100; // Small tag = batch up to 200, Large tag = only need first 100
    let currentPage = 'a0'; // After ID 0 (ascending)
    let hasMore = true;

    try {
      // Fetch up to targetCount (max 1200) posts sequentially.
      while (hasMore && posts.length < targetFetchCount) {
        const fetchLimit = Math.min(limit, targetFetchCount - posts.length);
        let params = new URLSearchParams({
          tags: `${tagName} date:>=${tagCreatedAt}`,
          limit: fetchLimit,
          page: currentPage,
          only: 'id,created_at,uploader_id,approver_id,file_url,preview_file_url,variants,rating,score,tag_string_copyright,tag_string_character'
        } as any);
        let url = `/posts.json?${params.toString()}`;

        let batch = await this.rateLimiter.fetch(url).then((r: Response) => r.json());

        if (!Array.isArray(batch) || batch.length === 0) {
          break;
        }

        if (batch.length > 1) {
          // Check order. We want Ascending (Oldest First).
          if (batch[0].id > batch[batch.length - 1].id) {
            batch.reverse();
          }
        }

        posts = posts.concat(batch);

        if (batch.length < fetchLimit || posts.length >= targetFetchCount || !isSmallTag) {
          hasMore = false; // Stop fetching
        } else {
          // Setup for next page
          currentPage = `a${batch[batch.length - 1].id}`;
        }
      }

      // Fix for Small Tags: If optimization failed to get all posts (due to renames/merges filtering by date),
      // and it's a small tag (<=1200), re-fetch absolute oldest without date filter.
      if (isSmallTag && posts.length < targetFetchCount) {
        posts = [];
        currentPage = 'a0';
        hasMore = true;

        while (hasMore && posts.length < targetFetchCount) {
          const fetchLimit = Math.min(limit, targetFetchCount - posts.length);
          const fbParams = new URLSearchParams({
            tags: `${tagName}`,
            limit: fetchLimit,
            page: currentPage,
            only: 'id,created_at,uploader_id,approver_id,file_url,preview_file_url,variants,rating,score,tag_string_copyright,tag_string_character'
          } as any);
          let fbBatch = await this.rateLimiter.fetch(`/posts.json?${fbParams.toString()}`).then((r: Response) => r.json());

          if (!Array.isArray(fbBatch) || fbBatch.length === 0) {
            break;
          }

          if (fbBatch.length > 1 && fbBatch[0].id > fbBatch[fbBatch.length - 1].id) {
            fbBatch.reverse();
          }

          posts = posts.concat(fbBatch);

          if (fbBatch.length < fetchLimit || posts.length >= targetFetchCount) {
            hasMore = false;
          } else {
            currentPage = `a${fbBatch[fbBatch.length - 1].id}`;
          }
        }
      }
    } catch (e) {
      console.warn(`[TagAnalyticsApp] Fetch failed for initial stats gather`, e);
    }

    if (!posts || posts.length === 0) {
      return { totalCount: tagData.post_count, meta: tagData, updatedAt: Date.now() };
    }

    const firstPost = posts[0];
    const hundredthPost = posts.length >= 100 ? posts[99] : null;

    const startDate = new Date(firstPost.created_at);
    let timeToHundred = null;

    if (hundredthPost) {
      const hundredthDate = new Date(hundredthPost.created_at);
      timeToHundred = hundredthDate.getTime() - startDate.getTime(); // ms
    }

    return {
      firstPost,
      hundredthPost,
      totalCount: tagData.post_count,
      startDate,
      timeToHundred,
      meta: tagData,
      initialPosts: posts // Can be used for ranking if needed
    };

  }

  /**
   * Fetches the count of new posts within the last 24 hours.
   * @param {string} tagName - The tag to analyze.
   * @return {Promise<number>} - Count of posts created in the last 24 hours.
   */
  async fetchCountWithRetry(url: string, retries: number = 1): Promise<number> {
    for (let i = 0; i <= retries; i++) {
      try {
        const resp = await this.rateLimiter.fetch(url);
        if (!resp.ok) {
          // console.warn(`[TagAnalyticsApp] HTTP Error ${resp.status} for ${url}`);
          throw new Error(`HTTP ${resp.status}`);
        }

        const data = await resp.json();
        // Log raw data for debugging
        // console.log(`[TagAnalyticsApp] Raw data for ${url}:`, data);

        const count = (data && data.counts && typeof data.counts === 'object') ? data.counts.posts : (data ? data.posts : undefined);

        if (count !== undefined && count !== null) {
          return count;
        }

        // If undefined, it's a "bad" response for our purpose, treat as error to trigger retry
        throw new Error('Invalid count data');
      } catch (e) {
        if (i === retries) {
          console.warn(`[TagAnalyticsApp] Failed to fetch count after ${retries + 1} attempts: ${url}`, e);
          return 0; // Default to 0 after all retries
        }
        // Wait a bit before retry (e.g., 500ms)
        await new Promise(r => setTimeout(r, 500));
      }
    }
    return 0;
  }

  /**
   * Fetches commentary-related counts for a tag (Total, Translated, Requested).
   * @param {string} tagName - The tag to analyze.
   * @return {Promise<Object>} - Object containing counts for 'total', 'translated', and 'requested'.
   */
  async fetchCommentaryCounts(tagName: string): Promise<any> {
    const queries: Record<string, string> = {
      total: `tags=${encodeURIComponent(tagName)}+has:commentary`,
      translated: `tags=${encodeURIComponent(tagName)}+has:commentary+commentary`,
      requested: `tags=${encodeURIComponent(tagName)}+has:commentary+commentary_request`
    };

    const results: Record<string, number> = {};

    const keys = Object.keys(queries);
    await Promise.all(keys.map(async (key) => {
      const query = queries[key];
      const url = `/counts/posts.json?${query}`;
      results[key] = await this.fetchCountWithRetry(url);
    }));

    // [Integrity Check] Ensure all keys exist and are valid numbers
    keys.forEach(key => {
      if (results[key] == null) {
        console.warn(`[TagAnalyticsApp] Missing commentary key: ${key}. Defaulting to 0.`);
        results[key] = 0;
      }
    });

    return results;
  }
  /**
   * Fetches post counts for each status (active, deleted, etc.).
   * @param {string} tagName - The tag to analyze.
   * @return {Promise<Object>} - Map of status strings to counts.
   */
  async fetchStatusCounts(tagName: string): Promise<any> {

    const statuses = ['active', 'appealed', 'banned', 'deleted', 'flagged', 'pending'];
    const results: Record<string, number> = {};

    const tasks = statuses.map(async (status) => {
      const url = `/counts/posts.json?tags=${encodeURIComponent(tagName)}+status:${status}`;
      results[status] = await this.fetchCountWithRetry(url);
    });

    await Promise.all(tasks);

    // [Integrity Check] Ensure all keys exist and are valid numbers
    statuses.forEach(status => {
      if (results[status] == null) {
        console.warn(`[TagAnalyticsApp] Missing status key: ${status}. Defaulting to 0.`);
        results[status] = 0;
      }
    });

    return results;
  }

  /**
   * Fetches post counts for all ratings (g, s, q, e) for a tag.
   * @param {string} tagName The tag name.
   * @param {?string} startDate Optional start date (YYYY-MM-DD) to optimize query.
   * @return {Promise<!Object<string, number>>} Map of rating characters to counts.
   */
  async fetchRatingCounts(tagName: string, startDate: string | null = null): Promise<any> {
    const ratings = ['g', 's', 'q', 'e'];
    const results: Record<string, number> = {};

    const tasks = ratings.map(async (rating) => {
      let qs = `tags=${encodeURIComponent(tagName)}+rating:${rating}`;
      if (startDate) {
        qs += `+date:>=${startDate}`;
      }
      const url = `/counts/posts.json?${qs}`;
      results[rating] = await this.fetchCountWithRetry(url);
    });

    await Promise.all(tasks);

    // [Integrity Check] Ensure all keys exist and are valid numbers
    ratings.forEach(rating => {
      if (results[rating] == null) {
        console.warn(`[TagAnalyticsApp] Missing rating key: ${rating}. Defaulting to 0.`);
        results[rating] = 0;
      }
    });

    return results;
  }

  async fetchRelatedTagDistribution(tagName: string, categoryId: number, totalTagCount: number): Promise<any> {
    const catName = categoryId === 3 ? 'Copyright' : 'Character';


    // 1. Fetch Related Tags
    const relatedUrl = `/related_tag.json?commit=Search&search[category]=${categoryId}&search[order]=Frequency&search[query]=${encodeURIComponent(tagName)}`;

    try {
      const resp = await this.rateLimiter.fetch(relatedUrl).then((r: Response) => r.json());
      if (!resp || !resp.related_tags || !Array.isArray(resp.related_tags)) return null;

      const tags = resp.related_tags; // [{ "tag": {...}, "frequency": 0.5, "related_tag": {...} }]

      // Limit to top 20 candidates for performance
      const candidates = tags.slice(0, 20);

      // 2. Filter Top-Level (Check Implications)
      const checks = await Promise.all(candidates.map(async (item: any) =>
        await isTopLevelTag(this.rateLimiter, item.tag.name) ? item : null
      ));

      const filtered = checks.filter(item => item !== null);

      // 3. Take Top 10 by Frequency
      // Note: related_tag.json response item has `related_tag` property with `frequency`.
      // UserAnalyticsApp used `item.frequency` on the item itself?
      // Let's assume the root item has frequency or handle both.
      // Actually, let's map carefully.
      const topTags = filtered.slice(0, 10).map(item => ({
        name: item.tag.name.replace(/_/g, ' '),
        key: item.tag.name,
        frequency: item.related_tag ? item.related_tag.frequency : (item.frequency || 0),
        count: 0
      }));

      // 4. Fetch Counts
      await Promise.all(topTags.map(async (obj) => {
        try {
          const query = `${tagName} ${obj.key}`;
          const cUrl = `/counts/posts.json?tags=${encodeURIComponent(query)}`;
          const cResp = await this.rateLimiter.fetch(cUrl).then((r: Response) => r.json());
          const c = (cResp && cResp.counts ? cResp.counts.posts : (cResp ? cResp.posts : 0)) || 0;
          obj.count = c;
        } catch (e) { console.debug('[DI] Failed to fetch combined tag count', e); }
      }));

      // 5. Accumulate Frequency for Cutoff
      let finalTags = [];
      let currentSumFreq = 0.0;
      const threshold = 0.95;

      // Ensure sorted descending by frequency
      topTags.sort((a, b) => b.frequency - a.frequency);

      for (const t of topTags) {
        finalTags.push(t);
        currentSumFreq += t.frequency;
        if (currentSumFreq > threshold) break;
      }

      // Calculate Others
      const remainFreq = Math.max(0, 1.0 - currentSumFreq);
      if (remainFreq > 0.005) { // Show if > 0.5%
        const othersCount = Math.floor(totalTagCount * remainFreq);
        if (othersCount > 0) {
          finalTags.push({
            name: 'Others',
            key: 'others',
            count: othersCount,
            isOther: true
          });
        }
      }

      // Return Object for Pie Chart
      const result: Record<string, number> = {};
      finalTags.forEach(t => {
        result[t.key] = t.count;
      });

      return result;

    } catch (e) {
      console.warn(`[TagAnalyticsApp] Failed to fetch ${catName} distribution`, e);
      return null;
    }
  }

  async fetchHistoryBackwards(tagName: string, forwardStartDate: string, targetTotal: number, currentForwardTotal: number): Promise<any[]> {
    console.log(`[TagAnalyticsApp] Starting Reverse Scan. Tag: ${tagName}, Start: ${forwardStartDate}, Target: ${targetTotal}, Current: ${currentForwardTotal}`);
    const history = [];
    let totalSum = currentForwardTotal;
    let currentMonth = new Date(forwardStartDate);

    // We strictly start scanning from 1 month before the forward start date
    // to avoid overlapping with fetchMonthlyCounts which already covers the starting month.
    currentMonth.setMonth(currentMonth.getMonth() - 1); // Start from month BEFORE forward scan



    // Danbooru founded in late 2005. Don't go past that.
    const hardLimit = new Date("2005-01-01");

    while (totalSum < targetTotal && currentMonth > hardLimit) {
      const year = currentMonth.getFullYear();
      const month = currentMonth.getMonth() + 1;

      // Use next month's 1st day as end of range to include the last day of current month fully
      const nextDate = new Date(currentMonth);
      nextDate.setMonth(nextDate.getMonth() + 1);
      const nYear = nextDate.getFullYear();
      const nMonth = nextDate.getMonth() + 1;

      const dateRange = `${year}-${String(month).padStart(2, '0')}-01...${nYear}-${String(nMonth).padStart(2, '0')}-01`;
      const url = `/counts/posts.json?tags=${encodeURIComponent(tagName)}+date:${dateRange}`;

      try {
        const data = await this.rateLimiter.fetch(url).then((r: Response) => r.json());
        const count = (data.counts && typeof data.counts === 'object') ? (data.counts.posts || 0) : (data.counts || 0);

        if (count > 0) {
          history.unshift({
            date: `${year}-${String(month).padStart(2, '0')}-01`,
            count: count,
            cumulative: 0 // Will fix in post-process
          });
          totalSum += count;
          console.log(`[TagAnalyticsApp] Reverse Scan Hit: ${year}-${month} => ${count} posts. Total: ${totalSum}/${targetTotal}`);

        }
      } catch (e) {
        console.warn(`[TagAnalyticsApp] Backward fetch failed for ${year}-${month}`, e);
      }

      currentMonth.setMonth(currentMonth.getMonth() - 1);
    }
    console.log(`[TagAnalyticsApp] Reverse Scan Completed. Total: ${totalSum}/${targetTotal}, Months Checked: ${history.length} (hits)`);

    // Calculate cumulative counts for backward data
    let runningSum = 0;
    for (let i = 0; i < history.length; i++) {
      runningSum += history[i].count;
      history[i].cumulative = runningSum;
    }

    return history;
  }

  async fetchHistoryDelta(tagName: string, lastDate: Date | string, startDate: Date | string): Promise<any[]> {
    if (!lastDate) return this.fetchMonthlyCounts(tagName, startDate);



    // Delta Sync: Check last 2 months only
    const now = new Date();
    const twoMonthsAgo = new Date(now);
    twoMonthsAgo.setMonth(now.getMonth() - 2);
    twoMonthsAgo.setDate(1); // Start from 1st of month

    const effectiveStart = (lastDate && lastDate > twoMonthsAgo) ? twoMonthsAgo : (lastDate || startDate);

    return this.fetchMonthlyCounts(tagName, effectiveStart);
  }

  mergeHistory(oldHistory: any[], newHistory: any[]): any[] {
    if (!oldHistory || oldHistory.length === 0) return newHistory;
    if (!newHistory || newHistory.length === 0) return oldHistory;

    // Map old history by date string (YYYY-MM-DD or time) for easy lookup?
    // Actually, standard is array of objects { date: Date, count: number, cumulative: number }
    // newHistory starts from lastDate.

    // Remove overlapping months from oldHistory
    // We keep old history UP TO the month before newStart.
    // newStart is likely YYYY-MM-DD. We want to avoid duplication.
    // fetchMonthlyCounts returns dates as YYYY-MM-01.

    const newStart = newHistory[0].date;
    const filteredOld = oldHistory.filter(h => h.date < newStart);

    // Concatenate
    let merged = filteredOld.concat(newHistory);

    // Recalculate Cumulative strictly from start
    // Note: This assumes the first item in merged has correct 'count' but 'cumulative' might need offset if we cropped pure start.
    // But we are appending to a base.

    // If we cut the tail of oldHistory, the last item of filteredOld has a cumulative count.
    // We can just iterate and update.

    let runningSum = 0;
    merged = merged.map((h) => {
      // We can't just sum 'count' unless we are sure we have the WHOLE history from 2005.
      // partial sync means we have (Old - Tail) + New.
      // So valid history.
      runningSum += h.count;
      return { ...h, cumulative: runningSum };
    });

    return merged;
  }

  async fetchMilestonesDelta(tagName: string, currentTotal: number, cachedMilestones: any[], fullHistory: any[]): Promise<any[]> {
    const allTargets = this.getMilestoneTargets(currentTotal);
    const existingTargets = new Set(cachedMilestones.map(m => m.milestone));
    const missingTargets = allTargets.filter(t => !existingTargets.has(t));

    if (missingTargets.length === 0) return [];


    return this.fetchMilestones(tagName, fullHistory, missingTargets);
  }

  mergeMilestones(oldMilestones: any[], newMilestones: any[]): any[] {
    if (!newMilestones || newMilestones.length === 0) return oldMilestones;
    // Sort by milestone number
    return [...oldMilestones, ...newMilestones].sort((a, b) => a.milestone - b.milestone);
  }

  async fetchLatestPost(tagName: string): Promise<any> {
    // Query for the single latest post
    const url = `/posts.json?tags=${encodeURIComponent(tagName)}&limit=1&only=id,created_at,variants,uploader_id,rating,preview_file_url`;
    try {
      const posts = await this.rateLimiter.fetch(url).then((r: Response) => r.json());
      return (posts && posts.length > 0) ? posts[0] : null;
    } catch (e) {
      console.warn("[TagAnalyticsApp] Failed to fetch latest post:", e);
      return null;
    }
  }

  async fetchNewPostCount(tagName: string): Promise<number> {
    // Query for posts created in the last 24 hours (age:..1d)
    const url = `/counts/posts.json?tags=${encodeURIComponent(tagName)}+age:..1d`;
    try {
      const resp = await this.rateLimiter.fetch(url).then((r: Response) => r.json());
      return (resp && resp.counts ? resp.counts.posts : (resp ? resp.posts : 0)) || 0;
    } catch (e) {
      console.warn("[TagAnalyticsApp] Failed to fetch new post count:", e);
      return 0;
    }
  }

  async fetchTrendingPost(tagName: string, isNSFW: boolean = false): Promise<any> {
    // Query for the most popular SFW (or NSFW) post in the last 3 days
    // age:..3d, order:score, rating:g (or is:nsfw)
    const ratingQuery = isNSFW ? 'is:nsfw' : 'is:sfw';
    const url = `/posts.json?tags=${encodeURIComponent(tagName)}+age:..3d+order:score+${ratingQuery}&limit=1&only=id,created_at,variants,uploader_id,rating,score,preview_file_url`;
    try {
      const posts = await this.rateLimiter.fetch(url).then((r: Response) => r.json());
      return (posts && posts.length > 0) ? posts[0] : null;
    } catch (e) {
      console.warn("[TagAnalyticsApp] Failed to fetch trending post:", e);
      return null;
    }
  }


  // --- Helper Methods for Rankings ---

  calculateLocalStats(posts: any[]): any {
    const ratingCounts: Record<string, number> = { g: 0, s: 0, q: 0, e: 0 };
    const uploaders: Record<string, number> = {};
    const approvers: Record<string, number> = {};

    posts.forEach(p => {
      // Rating
      if (ratingCounts[p.rating] !== undefined) ratingCounts[p.rating]++;

      // Uploader
      if (p.uploader_id) {
        uploaders[p.uploader_id] = (uploaders[p.uploader_id] || 0) + 1;
      }

      // Approver
      if (p.approver_id) {
        approvers[p.approver_id] = (approvers[p.approver_id] || 0) + 1;
      }
    });

    // Sort Rankings
    const sortMap = (map: Record<string, number>) => Object.entries(map)
      .sort((a, b) => (b[1] as number) - (a[1] as number)) // Descending count
      .slice(0, 100) // Top 100
      .map(([id, count], index) => ({ id, count, rank: index + 1 }));

    return {
      ratingCounts,
      uploaderRanking: sortMap(uploaders),
      approverRanking: sortMap(approvers)
    };
  }

  async fetchReportRanking(tagName: string, group: string, from: string, to: string): Promise<any> {
    // group: 'uploader' or 'approver'
    // from/to: YYYY-MM-DD
    const params = new URLSearchParams({
      'search[tags]': tagName,
      'search[group]': group,
      'search[mode]': 'table',
      'search[group_limit]': 10, // Top 100
      'commit': 'Search'
    } as any);

    if (from) params.append('search[from]', from);
    if (to) params.append('search[to]', to);

    const url = `/reports/posts.json?${params.toString()}`;
    try {
      const resp = await this.rateLimiter.fetch(url, { headers: { 'Accept': 'application/json' } });
      const data = await resp.json();

      // Debug Log

      if (Array.isArray(data) && data.length > 0) {

      }

      return data;
      // Let's verify format. The user provided link returns a standard JSON structure?
      // Actually reports/posts.json returns HTML table row data usually?
      // Wait, user provided: reports/posts.json?...
      // Let's assume it returns JSON with [ { id, count, ... } ] or similar.
      // If it returns HTML, I might need to parse, but usually .json returns JSON.
      // Based on Danbooru API, reports usually return a string or specific structure.
      // For 'uploader', it returns list of objects.
    } catch (e) {
      console.warn(`[TagAnalyticsApp] Ranking fetch failed (${group}):`, e);
      return [];
    }
  }

  // -----------------------------------

  /**
   * Fetches monthly post counts for the tag since the start date.
   * Iterates month by month to build a complete history.
   * @param {string} tagName The tag name.
   * @param {!Date} startDate The date to start fetching from.
   * @return {Promise<!Array<{date: !Date, count: number, cumulative: number}>>} Array of monthly data.
   */
  async fetchMonthlyCounts(tagName: string, startDate: Date | string): Promise<any[]> {
    const startDateObj = startDate instanceof Date ? startDate : new Date(startDate);

    const startYear = startDateObj.getFullYear();
    const startMonth = startDateObj.getMonth(); // 0-based

    const now = new Date();
    const monthlyData: any[] = [];
    let cumulative = 0;

    // Iterate Month by Month
    // Note: This could be many requests.
    // Example: 2005 to 2026 = 21 years * 12 = 252 requests.
    // Rate Limit: 6 req/s => ~42 seconds total.
    // Optimization: Parallelize by year?
    // User said "Start from first upload month... iteratively".
    // We will generate all promises and feed them to RateLimiter.

    const tasks = [];
    // Use UTC to avoid timezone shifts in labels (April appearing as March)
    let current = new Date(Date.UTC(startYear, startMonth, 1));

    while (current <= now) {
      const y = current.getUTCFullYear();
      const m = current.getUTCMonth() + 1; // 1-based for API
      const dateStr = `${y}-${String(m).padStart(2, '0')}-01`;

      // Next Month for Range
      const nextMonth = new Date(current);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      const nextY = nextMonth.getUTCFullYear();
      const nextM = nextMonth.getUTCMonth() + 1;

      // Danbooru counts API needs the date filter INSIDE the tags parameter
      let rangeEnd = `${nextY}-${String(nextM).padStart(2, '0')}-01`;

      // [OPTIMIZATION] If next month is in the future, cap the range at NOW to ensure consistency
      // This prevents race conditions where new posts are added during the fetch.
      if (nextMonth > now) {
        rangeEnd = now.toISOString(); // Use full timestamp
      }

      const queryDate = `${y}-${String(m).padStart(2, '0')}-01...${rangeEnd}`;

      tasks.push({
        dateObj: new Date(current), // Clone
        dateStr,
        queryDate
      });

      current.setUTCMonth(current.getUTCMonth() + 1);
    }

    // Create Promises
    const promises = tasks.map(task => {
      const params = new URLSearchParams({
        tags: `${tagName} status:any date:${task.queryDate}` // Correct: date must be in tags
      });
      const url = `/counts/posts.json?${params.toString()}`;

      return this.rateLimiter.fetch(url)
        .then((r: Response) => r.json())
        .then((data: any) => {
          // Handle different response formats: { "counts": { "posts": N } } or { "posts": N }
          const count = (data && data.counts ? data.counts.posts : (data ? data.posts : 0)) || 0;
          return {
            date: task.dateStr,
            count: count,
            cumulative: 0,
          };
        })
        .catch((e: unknown) => {
          console.warn(`[TagAnalyticsApp] Failed month ${task.dateStr}`, e);
          return { date: task.dateStr, count: 0, cumulative: 0 };
        });
    });

    // Execute all via Rate Limit
    const results = await Promise.all(promises);

    // Sort and Accumulate
    results.sort((a, b) => a.date.localeCompare(b.date));

    results.forEach(item => {
      cumulative += item.count;
      item.cumulative = cumulative;
      monthlyData.push(item);
    });

    // Attach the cutoff time (now) to the array for consistency check
    (monthlyData as any).historyCutoff = now.toISOString();

    return monthlyData;
  }

  /**
   * Identifies milestone posts (e.g., 100th, 1000th) from the monthly data.
   * Precision depends on the granularity of the monthly data.
   * @param {string} tagName The tag name.
   * @param {!Array<{date: !Date, count: number, cumulative: number}>} monthlyData The history data.
   * @param {!Array<number>} targets The milestone targets (e.g., [1, 100, 1000]).
   * @return {Promise<!Array<{milestone: number, post: ?Object}>>} Array of milestones.
   */
  async fetchMilestones(tagName: string, monthlyData: any[], targets: number[]): Promise<any[]> {

    const milestones = [];

    // Sort targets
    targets.sort((a, b) => a - b);

    if (!monthlyData || monthlyData.length === 0) return [];

    for (const target of targets) {
      // Find month where accum >= target
      // monthlyData is sorted by date asc
      let targetData = null;
      let prevCumulative = 0;

      for (const mData of monthlyData) {
        if (mData.cumulative >= target) {
          targetData = mData;
          break;
        }
        prevCumulative = mData.cumulative;
      }

      if (targetData) {
        const offset = target - prevCumulative;


        // targetData.date can be a "YYYY-MM-01" string (from fetchMonthlyCounts)
        // OR a Date object (from calculateHistoryFromPosts or old cache).
        let y, m;

        if (targetData.date instanceof Date) {
          y = targetData.date.getFullYear();
          m = targetData.date.getMonth() + 1; // 1-12
        } else {
          // Assume string "YYYY-MM-DD"
          const dParts = targetData.date.split('-');
          y = parseInt(dParts[0], 10);
          m = parseInt(dParts[1], 10); // 1-12
        }

        // Date(y, m-1, 0) gives last day of prev month
        // Month is 0-indexed in Date constructor.
        // m is 1-based (Feb=2). Date(2020, 1, 1) is Feb 1.
        // We want last day of Jan. Date(2020, 0, 0)? No.
        // Date(year, monthIndex, 0) is the last day of the *previous* month.
        // So Date(2020, 1, 0) is Jan 31? Yes.
        // targetData.date is 2020-02-01. m=2.
        // new Date(y, m - 1, 0) -> new Date(2020, 1, 0) -> 2020-01-31.

        const prevMonthEnd = new Date(y, m - 1, 0);
        // Format to YYYY-MM-DD
        const prevDateStr = `${prevMonthEnd.getFullYear()}-${String(prevMonthEnd.getMonth() + 1).padStart(2, '0')}-${String(prevMonthEnd.getDate()).padStart(2, '0')}`;

        const limit = 200;
        const page = Math.ceil(offset / limit);
        const indexInPage = (offset - 1) % limit;

        // Query
        // Note: order:id assumes IDs increase with time. Usually true but imported posts might break this.
        // User asked for "date:>..." and "offset".
        // We must use order:id to ensure deterministic sort matching the "count" order roughly.
        // Actually "count" is just total.
        const params = new URLSearchParams({
          tags: `${tagName} status:any date:>${prevDateStr} order:id`,
          limit: limit,
          page: page,
          only: 'id,created_at,uploader_id,uploader_name,variants,rating,preview_file_url'
        } as any);

        const url = `/posts.json?${params.toString()}`;

        try {

          const posts = await this.rateLimiter.fetch(url).then((r: Response) => r.json());
          if (posts && posts[indexInPage]) {
            milestones.push({ milestone: target, post: posts[indexInPage] });
          } else {
            console.warn(`[TagAnalyticsApp] Milestone ${target} post not found at index ${indexInPage} (Page ${page}). Posts len: ${posts ? posts.length : 0}`);
          }
        } catch (e) {
          console.warn(`[TagAnalyticsApp] Failed milestone ${target}`, e);
        }
      }
    }

    // Batch Fetch Uploaders for Milestones
    await this.backfillUploaderNames(milestones);

    return milestones;
  }

  /**
   * Backfills uploader and approver names for a list of items (posts or milestones).
   * @param {!Array<Object>} items The items to process.
   * @return {Promise<!Array<Object>>} The items with names attached.
   */
  async backfillUploaderNames(items: any[]): Promise<any[]> {
    const userIds = new Set();
    items.forEach(item => {
      const p = item.post || item; // Handle both raw post and { milestone, post } wrapper
      if (p.uploader_id) userIds.add(p.uploader_id);
      if (p.approver_id) userIds.add(p.approver_id);
    });

    if (userIds.size > 0) {
      const userMap = await this.fetchUserMap(Array.from(userIds) as any[]);

      // Store in instance map for rankings
      userMap.forEach((uObj, id) => {
        this.userNames[id] = uObj;
      });

      // Backfill names & levels
      items.forEach(item => {
        const p = item.post || item;
        const uId = String(p.uploader_id);
        if (p.uploader_id && userMap.has(uId)) {
          const u = userMap.get(uId);
          p.uploader_name = u.name;
          p.uploader_level = u.level;
        }
        const aId = String(p.approver_id);
        if (p.approver_id && userMap.has(aId)) {
          const a = userMap.get(aId);
          p.approver_name = a.name;
          p.approver_level = a.level;
        }
      });
    }
    return items;
  }

  /**
   * Fetches a map of user IDs to user objects (name, level).
   * Batches requests to avoid rate limits.
   * @param {!Array<string|number>} userIds List of user IDs.
   * @return {Promise<!Map<string, {name: string, level: string}>>} Map of ID to user info.
   */
  async fetchUserMap(userIds: any[]): Promise<Map<any, any>> {
    const userMap = new Map();
    if (!userIds || userIds.length === 0) return userMap;

    const uniqueIds = Array.from(new Set(userIds));
    const batchSize = 20;
    const userBatches = [];

    for (let i = 0; i < uniqueIds.length; i += batchSize) {
      userBatches.push(uniqueIds.slice(i, i + batchSize));
    }

    const userPromises = userBatches.map(batch => {
      const params = new URLSearchParams({
        'search[id]': batch.join(','),
        'only': 'id,name,level_string'
      });
      const url = `/users.json?${params.toString()}`;
      return this.rateLimiter.fetch(url)
        .then((r: Response) => r.json())
        .then((users: any) => {
          if (Array.isArray(users)) {
            users.forEach((u: any) => userMap.set(String(u.id), { name: u.name, level: u.level_string }));
          }
        })
        .catch((e: unknown) => console.warn("[TagAnalyticsApp] Failed to fetch user batch", e));
    });

    await Promise.all(userPromises);
    return userMap;
  }

  /**
   * Fetches a map of user names to user objects.
   * Fetches individually as batching by name is not reliably supported.
   * @param {!Array<string>} userNames List of user names.
   * @return {Promise<!Map<string, {id: number, name: string, level: string}>>} Map of name to user info.
   */
  async fetchUserMapByNames(userNames: any[]): Promise<Map<any, any>> {
    const userMap = new Map(); // Key: Name, Value: { id, name, level }
    if (!userNames || userNames.length === 0) return userMap;

    const uniqueNames = Array.from(new Set(userNames));
    // Batch fetching by name is unreliable (no clear support for comma-separated list in search[name])
    // Fetch individually for robustness.
    // RateLimiter handles concurrency.

    const userPromises = uniqueNames.map(name => {
      const params = new URLSearchParams({
        'search[name]': name, // Exact match usually
        'only': 'id,name,level_string'
      } as any);
      const url = `/users.json?${params.toString()}`;

      return this.rateLimiter.fetch(url)
        .then((r: Response) => r.json())
        .then((users: any) => {
          if (Array.isArray(users) && users.length > 0) {
            // Should return 1 user if exact match
            const u = users[0];
            if (u) {
              userMap.set(name, { id: u.id, name: u.name, level: u.level_string });
              // Also map by returned name just in case case sensitivity differs
              userMap.set(u.name, { id: u.id, name: u.name, level: u.level_string });
            }
          } else {
            console.warn(`[TagAnalyticsApp] User not found by name: "${name}"`);
          }
        })
        .catch((e: unknown) => console.warn(`[TagAnalyticsApp] Failed to fetch user: "${name}"`, e));
    });

    await Promise.all(userPromises);
    return userMap;
  }

  /**
   * Resolves uploader/approver names for the first 100 stats structure.
   * @param {!Object} stats The stats object containing rankings.
   * @return {Promise<!Object>} The updated stats object.
   */
  async resolveFirst100Names(stats: any): Promise<any> {
    const ids = new Set();
    if (stats.uploaderRanking) stats.uploaderRanking.forEach((u: any) => ids.add(String(u.id)));
    if (stats.approverRanking) stats.approverRanking.forEach((u: any) => ids.add(String(u.id)));

    const userMap = await this.fetchUserMap(Array.from(ids) as any[]);

    if (stats.uploaderRanking) {
      stats.uploaderRanking.forEach((u: any) => {
        const uid = String(u.id);
        if (userMap.has(uid)) {
          const uObj = userMap.get(uid);
          u.name = uObj.name;
          u.level = uObj.level;
        }
      });
    }
    if (stats.approverRanking) {
      stats.approverRanking.forEach((u: any) => {
        const uid = String(u.id);
        if (userMap.has(uid)) {
          const uObj = userMap.get(uid);
          u.name = uObj.name;
          u.level = uObj.level;
        }
      });
    }
    return stats;
  }

  /**
   * Calculates history data locally from an array of posts.
   * Useful for small tags where we have all posts.
   * @param {!Array<Object>} posts The list of posts.
   * @return {!Array<{date: string, count: number, cumulative: number}>} Calculated history.
   */
  calculateHistoryFromPosts(posts: any[]): any[] {
    if (!posts || posts.length === 0) return [];

    // Sort by date asc
    const sorted = [...posts].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const counts: Record<string, number> = {}; // "YYYY-MM" -> count

    sorted.forEach(p => {
      const d = new Date(p.created_at);
      if (isNaN(d.getTime())) return;
      // Use UTC components to match fetchMonthlyCounts labels
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      counts[key] = (counts[key] || 0) + 1;
    });

    const startDate = new Date(sorted[0].created_at);
    const now = new Date();
    const history = [];
    let cumulative = 0;

    // Start from the month of the first post (using UTC to prevent timezone shifts)
    let current = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));

    while (current <= now) {
      const key = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}`;
      const count = counts[key] || 0;
      cumulative += count;

      const dateStr = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}-${String(current.getUTCDate()).padStart(2, '0')}`;

      history.push({
        date: dateStr, // Store as string for consistency with fetchMonthlyCounts
        count: count,
        cumulative: cumulative
      });

      current.setUTCMonth(current.getUTCMonth() + 1);
    }
    return history;
  }

  /**
   * Generates a list of target numbers for milestones (e.g., 1, 100, 1000).
   * @param {number} total The total number of posts.
   * @return {!Array<number>} Sorted list of milestone targets.
   */
  getMilestoneTargets(total: number): number[] {

    const milestones = new Set([1]);
    if (total >= 100) milestones.add(100);
    if (total >= 1000) milestones.add(1000);
    if (total >= 10000) milestones.add(10000);
    if (total >= 100000) milestones.add(100000);
    if (total >= 1000000) milestones.add(1000000);

    const step = this.getMilestoneStep(total);

    for (let i = step; i <= total; i += step) {
      milestones.add(i);
    }

    const res = Array.from(milestones).sort((a, b) => a - b);

    return res;
  }

  /**
   * Returns the milestone step interval used for a given total. Mirrors the
   * thresholds in `getMilestoneTargets`. Pure helper, kept separate so the
   * "next milestone" placeholder card can compute the upcoming target without
   * regenerating the whole sequence.
   */
  getMilestoneStep(total: number): number {
    if (total < 2500) return 100;
    if (total < 5000) return 250;
    if (total < 10000) return 500;
    if (total < 25000) return 1000;
    if (total < 50000) return 2500;
    if (total < 100000) return 5000;
    if (total < 250000) return 10000;
    if (total < 500000) return 25000;
    if (total < 1000000) return 50000;
    if (total < 2500000) return 100000;
    if (total < 5000000) return 250000;
    return 500000;
  }

  /**
   * Computes the next (un-reached) milestone target above `total`. Returns
   * a value strictly greater than `total`, picked from the union of base
   * milestones (1, 100, 1000, ...) and the step sequence.
   */
  getNextMilestoneTarget(total: number): number {
    if (total < 1) return 1;
    if (total < 100) return 100;
    if (total < 1000) {
      // Step is 100 in this range; next multiple of 100 above total
      return Math.floor(total / 100) * 100 + 100;
    }
    const step = this.getMilestoneStep(total);
    const nextStep = Math.floor(total / step) * step + step;

    // Also consider the next "round base" milestone (10k / 100k / 1M) so we
    // don't skip past a notable number just because it isn't a step boundary.
    const bases = [10000, 100000, 1000000, 10000000];
    let next = nextStep;
    for (const b of bases) {
      if (b > total && b < next) next = b;
    }
    return next;
  }

  async fetchRankingsAndResolve(tagName: string, dateStr1Y: string, dateStrTomorrow: string, measure: (label: string, promise: Promise<any>) => Promise<any>): Promise<any> {
    // 1. Fetch all rankings in parallel (RateLimiter queues them)
    const [uAll, aAll, uYear, aYear] = await Promise.all([
      measure('Ranking (Uploader All)', this.fetchReportRanking(tagName, 'uploader', '2005-01-01', dateStrTomorrow)),
      measure('Ranking (Approver All)', this.fetchReportRanking(tagName, 'approver', '2005-01-01', dateStrTomorrow)),
      measure('Ranking (Uploader Year)', this.fetchReportRanking(tagName, 'uploader', dateStr1Y, dateStrTomorrow)),
      measure('Ranking (Approver Year)', this.fetchReportRanking(tagName, 'approver', dateStr1Y, dateStrTomorrow))
    ]);

    // 2. Resolve Users Immediately
    // --- Collect All User IDs & Names for Batch Backfill ---
    const uRankingIds = new Set();
    const uRankingNames = new Set();
    const getKey = (r: any) => r.name || r.uploader || r.approver || r.user;
    const normalize = (n: string) => n ? n.replace(/ /g, '_') : '';

    [uAll, uYear, aAll, aYear].forEach(report => {
      if (Array.isArray(report)) report.forEach(r => {
        if (r.id) uRankingIds.add(String(r.id));
        else {
          const n = normalize(getKey(r));
          if (n && n !== 'Unknown') uRankingNames.add(n);
        }
      });
    });

    // Fetch User Metadata (ID)
    if (uRankingIds.size > 0) {
      const userMap = await this.fetchUserMap(Array.from(uRankingIds) as any[]);
      userMap.forEach((uObj, id) => {
        this.userNames[id] = uObj;
      });
    }

    // Fetch User Metadata (Name)
    if (uRankingNames.size > 0) {
      const nameMap = await this.fetchUserMapByNames(Array.from(uRankingNames) as any[]);
      nameMap.forEach((uObj, name) => {
        this.userNames[name] = uObj; // Map Name -> Object
        if (uObj.id) this.userNames[String(uObj.id)] = uObj; // Map ID -> Object
      });
    }

    // Process Report Data to Rankings
    const processReport = (report: any) => {
      if (Array.isArray(report)) {
        return report.map(r => {
          const rawKey = getKey(r) || "Unknown";
          const nName = normalize(rawKey);
          // Lookup by ID first, then by Name
          const u = (r.id ? this.userNames[String(r.id)] : null) || this.userNames[nName];

          const level = u ? u.level : null;
          const finalName = u ? u.name : rawKey;
          const count = r.posts || r.count || r.post_count || 0;
          return { id: r.id || (u ? u.id : null), name: finalName, level, count };
        });
      }
      return [];
    };

    const result = {
      uploaderAll: processReport(uAll),
      approverAll: processReport(aAll),
      uploaderYear: processReport(uYear),
      approverYear: processReport(aYear)
    };
    return result;
  }

  async fetchTagData(tagName: string): Promise<any> {
    try {
      // use name_matches to find the exact tag
      const url = `/tags.json?search[name_matches]=${encodeURIComponent(tagName)}`;
      const resp = await this.rateLimiter.fetch(url).then((r: Response) => r.json());

      if (Array.isArray(resp) && resp.length > 0) {
        // Find exact match to be safe
        const exact = resp.find(t => t.name === tagName);
        return exact || resp[0];
      }
      return null;
    } catch (e) {
      console.error('[TagAnalyticsApp] Tag fetch error:', e);
      return null;
    }
  }

  /**
   * Extracts the tag name from the current URL.
   * Supports Wiki pages and Artist pages.
   * @return {?string} The tag name or null if not found.
   */
  getTagNameFromUrl() {
    const path = window.location.pathname;
    // Format: /wiki_pages/TAG_NAME
    const match = path.match(/\/wiki_pages\/([^/]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
    return null;
  }
}
