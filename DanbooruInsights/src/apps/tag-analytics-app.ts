import * as d3 from 'd3';
import {CONFIG} from '../config';
import {AnalyticsDataManager} from '../core/analytics-data-manager';
import {RateLimitedFetch} from '../core/rate-limiter';
import {isTopLevelTag, escapeHtml} from '../utils';
import type {Database} from '../core/database';
import type {SettingsManager} from '../core/settings';

export class TagAnalyticsApp {
  [key: string]: any;

  db: Database;
  settings: SettingsManager;
  tagName: string;
  isMilestoneExpanded: boolean;
  resizeObserver: ResizeObserver | null;
  resizeTimeout: ReturnType<typeof setTimeout> | null;
  currentData: any;
  currentMilestones: any;
  userNames: Record<string, any>;

  /**
   * Initializes the TagAnalyticsApp.
   * @param {!Database} db The Dexie database instance.
   * @param {!SettingsManager} settings The settings manager instance.
   * @param {string} tagName The name of the tag to analyze.
   */
  constructor(db: Database, settings: SettingsManager, tagName: string) {
    this.db = db;
    this.settings = settings;
    this.tagName = tagName;
    const rl = CONFIG.RATE_LIMITER;
    this.rateLimiter = new RateLimitedFetch(rl.concurrency, rl.jitter, rl.rps);
    this.isMilestoneExpanded = false;
    this.resizeObserver = null;
    this.resizeTimeout = null;
    this.currentData = null;
    this.currentMilestones = null;
    this.userNames = {}; // Initialize user name map to avoid TypeErrors
    this.isFetching = false;
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
        if (age < 24 * 60 * 60 * 1000) {
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
    const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

    try {
      await this.db.tag_analytics.where('updatedAt').below(cutoff).delete();
    } catch (e) {
      console.warn('[TagAnalyticsApp] Cleanup failed', e);
    }
  }

  /**
   * Main execution method for Tag Analytics.
   * Orchestrates the entire process of data fetching, caching, and UI rendering.
   *
   * Flow:
   * 1. Checks and cleans up old cache (retention policy).
   * 2. Loads data from IndexedDB cache.
   * 3. Determines if a Partial Sync is needed based on:
   *    - Time elapsed since last update (> 24h).
   *    - Significant increase in post count.
   * 4. If Sync is needed or Cache is missing:
   *    - Fetches initial stats (first 100 posts, metadata).
   *    - handling for small tags (<= 100 posts) vs large tags.
   *    - Parallel fetching of volatile data (status, trending, etc.).
   *    - History backfilling for large tags.
   * 5. Updates the UI and saves the fresh data to cache.
   *
   * @return {Promise<void>} Resolves when the analytics process is complete.
   */
  async run(): Promise<void> {
    if (!this.tagName) return;

    // Early validation: check if this is a real tag with a valid category.
    // Wiki pages like "help:home" are not Danbooru tags and should be silently ignored.
    try {
      const tagData = await this.fetchTagData(this.tagName);
      const validCategories = [1, 3, 4]; // 1=Artist, 3=Copyright, 4=Character
      if (!tagData || !validCategories.includes(tagData.category)) {
        return;
      }
    } catch (e) {
      return; // On network error, silently skip
    }

    // Only inject the button in idle state — no data fetching until user clicks
    this.injectAnalyticsButton(null);

    // Show sync status from cache (IndexedDB read only, no API calls)
    // Read raw DB entry directly to distinguish "no cache" vs "stale cache",
    // since loadFromCache() returns null for both cases when expired.
    try {
      const rawCache = (this.db && this.db.tag_analytics)
        ? await this.db.tag_analytics.get(this.tagName)
        : null;
      const statusLabel = document.getElementById("tag-analytics-status");
      if (!statusLabel) return;

      if (rawCache) {
        const age = Date.now() - rawCache.updatedAt;
        const isStale = age >= 24 * 60 * 60 * 1000;
        const date = new Date(rawCache.updatedAt).toLocaleDateString();

        if (isStale) {
          statusLabel.textContent = `Updated: ${date} · Sync needed`;
          statusLabel.style.color = '#d73a49';
        } else {
          statusLabel.textContent = `Updated: ${date}`;
          statusLabel.style.color = '#28a745';
        }
      } else {
        statusLabel.textContent = 'Sync needed';
        statusLabel.style.color = '#d73a49';
      }
      statusLabel.style.display = 'inline';
    } catch (e) {
      // Status display is non-critical, ignore errors
    }
  }

  /**
   * Updates the status label to show the last updated date in green.
   * Called after a successful fetch to restore the label hidden by injectAnalyticsButton.
   * @param {number} updatedAt - Timestamp of the update.
   */
  _showUpdatedStatus(updatedAt: number): void {
    const statusLabel = document.getElementById("tag-analytics-status");
    if (!statusLabel) return;
    const date = new Date(updatedAt).toLocaleDateString();
    statusLabel.textContent = `Updated: ${date}`;
    statusLabel.style.color = '#28a745';
    statusLabel.style.display = 'inline';
  }

  /**
   * Performs the full data fetch and renders the modal when complete.
   * Triggered by the user clicking the analytics button.
   * Contains the original run() fetch logic.
   * @return {Promise<void>}
   */
  async _fetchAndRender(): Promise<void> {
    const tagName = this.tagName;
    if (!tagName || this.isFetching) return;

    this.isFetching = true;

    try {
      // [IMMEDIATE UI] Show button in loading state
      this.injectAnalyticsButton(null, 0, "Waiting...");

      // 0. Auto-Cleanup Old Records (>7 days)
      this.cleanupOldCache();

      // [CACHE] Check Cache First
      const cachedData = await this.loadFromCache();
      let runDelta = false;
      let baseData = null;

      if (cachedData) {
        // Determine if Partial Sync is needed
        // Conditions:
        // 1. Time-based (Retention period expired? No, retention is for DELETION. Sync is for Update.)
        //    Actually, previous logic was: if record.updatedAt > 24h -> Partial Sync.
        // 2. Count-based: New posts >= Threshold

        const age = Date.now() - cachedData.updatedAt;
        const isTimeExpired = age >= 24 * 60 * 60 * 1000;

        let postCountDiff = 0;
        try {
          const currentTagData = await this.fetchTagData(tagName);
          if (currentTagData) {
            const currentTotal = currentTagData.post_count;
            const cachedTotal = cachedData.post_count || 0;
            postCountDiff = Math.max(0, currentTotal - cachedTotal);
          }
        } catch (e) { console.warn("Failed to check post count diff", e); }

        const threshold = this.getSyncThreshold();
        const isCountThresholdMet = postCountDiff >= threshold;

        if (isTimeExpired || isCountThresholdMet) {
          console.log(`[TagAnalyticsApp] Partial Sync Triggered. TimeExpired=${isTimeExpired} (${(age / 3600000).toFixed(1)}h), CountThreshold=${isCountThresholdMet} (${postCountDiff} >= ${threshold})`);
          baseData = cachedData;
          runDelta = true;
        } else {
          // Use Cache
          cachedData._isCached = true;
          // Refactored flow:
          // 1. Load Cache.
          // 2. Check Sync Criteria (Time or Count).
          // 3. If Sync needed -> Set runDelta=true, baseData=cache. Proceed to fetch loop.
          // 4. If Sync NOT needed -> Update Volatile -> Save -> Open Modal.

          try {
            // Fetch 24h count for UI
            const newPostCount24h = await this.fetchNewPostCount(tagName);

            const [latestPost, trendingPost, trendingPostNSFW] = await Promise.all([
              this.fetchLatestPost(tagName),
              this.fetchTrendingPost(tagName, false),
              this.fetchTrendingPost(tagName, true)
            ]);

            cachedData.latestPost = latestPost;
            cachedData.trendingPost = trendingPost;
            cachedData.trendingPostNSFW = trendingPostNSFW;
            cachedData.newPostCount = newPostCount24h;

            this.saveToCache(cachedData);
          } catch (e) {
            console.warn("[TagAnalyticsApp] Failed to update volatile data for cache:", e);
          }

          this.injectAnalyticsButton(cachedData);
          this._showUpdatedStatus(cachedData.updatedAt);
          this.toggleModal(true);
          this.renderDashboard(cachedData);
          return;
        }
      }

      // If we are here, either No Cache OR Partial Sync triggered.


      // 1. Fetch Initial Stats (Top 100, Metadata, First/Last Date)
      const t0 = performance.now();
      this.rateLimiter.requestCounter = 0; // Reset counter
      const startReq = this.rateLimiter.getRequestCount();

      const initialStats = await this.fetchInitialStats(tagName, baseData);

      void performance.now();
      void (this.rateLimiter.getRequestCount() - startReq);


      if (!initialStats || initialStats.totalCount === 0) {
        console.warn(`[TagAnalyticsApp] Could not fetch initial stats for tag: "${tagName}"`);
        return;
      }

      let {
        firstPost,
        hundredthPost,
        totalCount,
        startDate,
        timeToHundred,
        meta,
        initialPosts
      } = initialStats;

      // Variable to hold updated First 100 Stats if backward scan happens
      let realFirst100Stats = null;

      meta.updatedAt = Date.now();

      // Check Category & Inject Button
      // 0=General, 1=Artist, 3=Copyright, 4=Character, 5=Meta
      const validCategories = [1, 3, 4];
      const categoryMap: Record<number, string> = { 0: 'General', 1: 'Artist', 3: 'Copyright', 4: 'Character', 5: 'Meta' };
      void (categoryMap[meta.category] || `Unknown(${meta.category})`);

      if (validCategories.includes(meta.category)) {
        this.injectAnalyticsButton(meta);
      } else {
        // Remove button if it was injected but category is invalid
        const btn = document.getElementById("tag-analytics-btn");
        if (btn) btn.remove();
        const status = document.getElementById("tag-analytics-status");
        if (status) status.remove();
        return; // Stop if not valid category
      }



      // OPTIMIZATION: Small Tag Handling (<= 1200 posts)
      const MAX_OPTIMIZED_POSTS = 1200;
      if (initialPosts && totalCount <= MAX_OPTIMIZED_POSTS && initialPosts.length >= totalCount) {

        this.injectAnalyticsButton(null, 0, "Calculating history... (0%)");

        // 2. Calculate History Locally
        const historyData = this.calculateHistoryFromPosts(initialPosts);

        // 3. Extract Milestones Locally
        const targets = this.getMilestoneTargets(totalCount);
        const milestones: {milestone: number; post: any}[] = [];
        targets.forEach(target => {
          const index = target - 1;
          if (initialPosts[index]) {
            milestones.push({ milestone: target, post: initialPosts[index] });
          }
        });

        // 4. Calculate Ratings & Rankings Locally
        this.injectAnalyticsButton(null, 15, "Calculating rankings... (15%)");
        const localStatsAllTime = this.calculateLocalStats(initialPosts);

        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const yearPosts = initialPosts.filter((p: any) => p.created_at && new Date(p.created_at) >= oneYearAgo);
        const localStatsYear = this.calculateLocalStats(yearPosts);

        const localStatsFirst100 = this.calculateLocalStats(initialPosts.slice(0, 100));

        // 5. Parallel Data Fetching (Volatile & Status)
        // Note: backfillUploaderNames is CRITICAL for showing names instead of IDs
        this.injectAnalyticsButton(null, 25, "Fetching stats... (25%)");
        let smallTagFetched = 0;
        const smallTagTotalFetches = 6;
        const trackSmall = (label: string, promise: Promise<any>) => promise.then((res: any) => {
          smallTagFetched++;
          const pct = 25 + Math.round((smallTagFetched / smallTagTotalFetches) * 55);
          this.injectAnalyticsButton(null, pct, `${label}... (${pct}%)`);
          return res;
        });

        const [statusCounts, latestPost, trendingPost, trendingPostNSFW, newPostCount, commentaryCounts] = await Promise.all([
          trackSmall('Fetching status', this.fetchStatusCounts(tagName)),
          trackSmall('Fetching latest post', this.fetchLatestPost(tagName)),
          trackSmall('Finding trending post', this.fetchTrendingPost(tagName, false)),
          trackSmall('Finding trending NSFW', this.fetchTrendingPost(tagName, true)),
          trackSmall('Counting new posts', this.fetchNewPostCount(tagName)),
          trackSmall('Analyzing commentary', this.fetchCommentaryCounts(tagName)),
          this.backfillUploaderNames(initialPosts) // Ensure ALL posts have names backfilled
        ]);

        // Attach Data
        meta.historyData = historyData;
        meta.firstPost = firstPost;
        meta.hundredthPost = hundredthPost;
        meta.timeToHundred = timeToHundred;
        meta.statusCounts = statusCounts;
        meta.commentaryCounts = commentaryCounts;
        meta.ratingCounts = localStatsAllTime.ratingCounts;
        meta.precalculatedMilestones = milestones;
        meta.latestPost = latestPost;
        meta.newPostCount = newPostCount;

        // Trending (Local Fallback if parallel fetch fails, though we use the API result here for consistency)
        meta.trendingPost = trendingPost;
        meta.trendingPostNSFW = trendingPostNSFW;

        // 6. Map User IDs to Names in Local Rankings
        const mapNames = (ranking: any[]) => ranking.map((r: any) => {
          const u = this.userNames[r.id];
          return {
            ...r,
            name: (u ? u.name : null) || `user_${r.id}`,
            level: u ? u.level : null
          };
        });

        meta.rankings = {
          uploader: {
            allTime: mapNames(localStatsAllTime.uploaderRanking),
            year: mapNames(localStatsYear.uploaderRanking),
            first100: mapNames(localStatsFirst100.uploaderRanking)
          },
          approver: {
            allTime: mapNames(localStatsAllTime.approverRanking),
            year: mapNames(localStatsYear.approverRanking),
            first100: mapNames(localStatsFirst100.approverRanking)
          }
        };

        // 7. Calculate Related Tag Distribution Locally
        // Artist (1) -> Copyright + Character, Copyright (3) -> Character only
        this.injectAnalyticsButton(null, 85, "Analyzing tag distribution... (85%)");
        if (meta.category === 1 || meta.category === 3) {
          const copyrightMap: Record<string, number> = {};
          const characterMap: Record<string, number> = {};

          initialPosts.forEach((p: any) => {
            if (p.tag_string_copyright) {
              p.tag_string_copyright.split(' ').forEach((tag: string) => {
                if (tag) copyrightMap[tag] = (copyrightMap[tag] || 0) + 1;
              });
            }
            if (p.tag_string_character) {
              p.tag_string_character.split(' ').forEach((tag: string) => {
                if (tag) characterMap[tag] = (characterMap[tag] || 0) + 1;
              });
            }
          });

          if (meta.category === 1) {
            // Copyright: filter sub-copyrights out via isTopLevelTag
            const copyrightCandidates = Object.entries(copyrightMap)
              .sort((a, b) => (b[1] as number) - (a[1] as number))
              .slice(0, 20);

            const filteredCopyright = (await Promise.all(
              copyrightCandidates.map(async ([tag, count]) =>
                await isTopLevelTag(this.rateLimiter, tag) ? [tag, count] : null
              )
            )).filter(e => e !== null);

            meta.copyrightCounts = {};
            (filteredCopyright as any[]).slice(0, 10).forEach(([name, count]) => {
              meta.copyrightCounts[name] = count;
            });
          }

          // Character: take top 10 directly (no implication filtering needed)
          meta.characterCounts = {};
          Object.entries(characterMap)
            .sort((a, b) => (b[1] as number) - (a[1] as number))
            .slice(0, 10)
            .forEach(([name, count]) => {
              meta.characterCounts[name] = count;
            });
        }

        this.injectAnalyticsButton(meta, 100, ""); // Clear status
        this._showUpdatedStatus(meta.updatedAt);
        this.saveToCache(meta); // Save Small Tag Data

        const finalTime = performance.now();
        console.log(`[TagAnalytics] [Small Tag Optimization] Finished analysis for tag: ${tagName} (Category: ${meta.category}, Count: ${totalCount}) in ${(finalTime - t0).toFixed(2)}ms`);

        this.toggleModal(true);
        this.renderDashboard(meta);
        return;
      }

      // 2. Fetch Monthly Counts (History) & Milestones & Status/Rating Counts in parallel


      void performance.now();
      const startReq2 = this.rateLimiter.getRequestCount();

      const milestoneTargets = this.getMilestoneTargets(totalCount);

      const now = new Date();
      const oneYearAgoDate = new Date(now);
      oneYearAgoDate.setFullYear(oneYearAgoDate.getFullYear() - 1);

      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const dateStr1Y = oneYearAgoDate.toISOString().split('T')[0];
      const dateStrTomorrow = tomorrow.toISOString().split('T')[0];

      // Helper for granular logging
      const measure = (label: string, promise: Promise<any>) => {
        const start = performance.now();
        return promise.then((res: any) => {
          console.log(`[TagAnalytics] [Task] Finished: ${label} (${(performance.now() - start).toFixed(2)}ms)`);
          return res;
        });
      };

      // [DEBUG] Start Total Timer

      // [DEBUG] Start Total Timer
      console.time('TagAnalytics:Total');
      console.log(`[TagAnalytics] Starting analysis for tag: ${tagName} (Category: ${meta.category}, Count: ${totalCount})`);

      // [OPTIMIZATION] Start Quick Stats FIRST (so they get queue priority over the heavy history fetch)
      console.log('[TagAnalytics] [Group 1] Queueing Quick Stats (Status, Rating, Latest, Trending, Related)...');
      const tGroup1Start = performance.now();
      const statusPromise = measure('Status Counts', this.fetchStatusCounts(tagName));
      // const ratingPromise = measure('Rating Counts', this.fetchRatingCounts(tagName)); // Removed from Phase 1
      const latestPromise = measure('Latest Post', this.fetchLatestPost(tagName));
      const newPostPromise = measure('New Post Count', this.fetchNewPostCount(tagName));
      const trendingPromise = measure('Trending Post (SFW)', this.fetchTrendingPost(tagName, false));
      const trendingNsfwPromise = measure('Trending Post (NSFW)', this.fetchTrendingPost(tagName, true));

      // [OPTIMIZATION] Related Tags (Copyright/Character) - Queue immediately
      // Category 1=Artist, 3=Copyright, 4=Character
      let copyrightPromise = Promise.resolve(null);
      let characterPromise = Promise.resolve(null);

      if (meta.category === 1) { // Artist -> Fetch Copyright & Character
        copyrightPromise = measure('Related Copyrights', this.fetchRelatedTagDistribution(tagName, 3, totalCount));
        characterPromise = measure('Related Characters', this.fetchRelatedTagDistribution(tagName, 4, totalCount));
      } else if (meta.category === 3) { // Copyright -> Fetch Character
        characterPromise = measure('Related Characters', this.fetchRelatedTagDistribution(tagName, 4, totalCount));
      }

      // [OPTIMIZATION] Rankings Moved to Phase 2
      // console.log('[TagAnalytics] [Group 2] Queueing Ranking & User Resolution...');
      // const rankingPromise = ... (Moved)



      // --- [PHASE 1] QUICK STATS EXECUTION ---
      const quickTasks = [
        { id: 'status', label: 'Analyzing post status...', promise: statusPromise },
        // { id: 'rating', label: 'Calculating rating distribution...', promise: ratingPromise }, // Removed
        { id: 'latest', label: 'Fetching latest info...', promise: latestPromise },
        { id: 'new_count', label: 'Counting new posts...', promise: newPostPromise },
        { id: 'trending', label: 'Finding trending posts...', promise: trendingPromise },
        { id: 'trending_nsfw', label: 'Finding trending NSFW...', promise: trendingNsfwPromise },
        { id: 'related_copy', label: 'Analyzing related copyrights...', promise: copyrightPromise },
        { id: 'related_char', label: 'Analyzing related characters...', promise: characterPromise },
        { id: 'commentary', label: 'Analyzing commentary status...', promise: measure('Commentary Status', this.fetchCommentaryCounts(tagName)) }
      ];

      // --- [PHASE 2] HEAVY STATS DEFINITION (But delayed execution logic handled by promise creation timing) ---
      // Note: rankingPromise is an async IIFE that starts immediately when defined above.
      // Ideally, we want to delay its START until Phase 1 is done?
      // The user said: "Group 2 is just independent... Group 1 finishes then Group 3 (History) starts".
      // Actually, rankingPromise creation above ALREADY started it.
      // To truly optimize queue, we should move the creation of heavy promises HERE, after Phase 1 await.
      // BUT, let's stick to the structure:
      // We will identify them here.

      // We need to move the CREATION of historyPromise and rankingPromise to AFTER Phase 1 if we want to strictly serialize it.
      // However, the rate limiter handles concurrency.
      // The user wants: Quick Stats DONE -> Then start History & Rankings.
      // So I need to move the DEFINITION of rankingPromise and historyPromise blocks down?
      // Yes.

      // Let's execute Phase 1 first.

      // Progress Tracker Initialization
      let completedCount = 0;
      // We don't know total tasks yet because Phase 2 isn't defined.
      // Let's estimate or update dynamically.
      // Phase 1 has 8 tasks. Phase 2 has 4 tasks (Rank, History, Milestone, Resolve). Total 12.
      const totalEstimatedTasks = 12;

      this.injectAnalyticsButton(null, 0, "Initializing...");

      // Helper to wrap promise with progress update
      const trackProgress = (task: {id: string; label: string; promise: Promise<any>}) => {
        return task.promise.then((res: any) => {
          completedCount++;
          const pct = Math.round((completedCount / totalEstimatedTasks) * 100);
          this.injectAnalyticsButton(null, pct, `${task.label} ${pct}%`);
          return res;
        });
      };

      console.log('[TagAnalytics] [Phase 1] Executing Quick Stats...');
      const quickResults = await Promise.all(quickTasks.map(trackProgress));

      // Extract Phase 1 Results
      const [
        statusCounts,
        // ratingCounts, // Removed
        latestPost,
        newPostCount,
        trendingPost,
        trendingPostNSFW,
        copyrightCounts,
        characterCounts,
        commentaryCounts
      ] = quickResults;

      console.log(`[TagAnalytics] [Phase 1] Finished Quick Stats in ${(performance.now() - tGroup1Start).toFixed(2)}ms`);

      // --- [PHASE 2] HEAVY STATS EXECUTION ---
      console.log('[TagAnalytics] [Phase 2] Starting Rankings & History...');

      const rankingPromise = this.fetchRankingsAndResolve(tagName, dateStr1Y, dateStrTomorrow, measure);

      let historyPromise, milestonesPromise, first100StatsPromise;

      if (runDelta && baseData) {
        // [DELTA] History
        const lastHistory = baseData.historyData[baseData.historyData.length - 1];
        const lastDate = lastHistory ? new Date(lastHistory.date) : startDate;
        const deltaStart = new Date(lastDate);
        deltaStart.setDate(deltaStart.getDate() - 7);

        historyPromise = this.fetchHistoryDelta(tagName, deltaStart, startDate)
          .then(delta => this.mergeHistory(baseData.historyData, delta));

        // [DELTA] Milestones
        milestonesPromise = historyPromise.then(fullHistory => {
          return this.fetchMilestonesDelta(tagName, totalCount, baseData.precalculatedMilestones, fullHistory)
            .then(delta => this.mergeMilestones(baseData.precalculatedMilestones, delta));
        });

        // [DELTA] First 100 Ranking
        if (baseData.rankings && baseData.rankings.uploader && baseData.rankings.uploader.first100) {
          (initialStats as any).first100Stats = {
            uploaderRanking: baseData.rankings.uploader.first100,
            approverRanking: baseData.rankings.approver.first100
          };
          first100StatsPromise = Promise.resolve((initialStats as any).first100Stats);
        } else {
          first100StatsPromise = Promise.resolve(this.calculateLocalStats(initialPosts || []));
        }

      } else {
        // [FULL]
        historyPromise = measure('Full History (Monthly)', this.fetchMonthlyCounts(tagName, startDate));
      }

      // Chain Backward Scan
      historyPromise = historyPromise.then(async (monthlyData: any) => {
        const forwardTotal = (monthlyData && monthlyData.length > 0) ? monthlyData[monthlyData.length - 1].cumulative : 0;
        let referenceTotal = meta.post_count;

        if (monthlyData.historyCutoff) {
          try {
            const cutoffUrl = `/counts/posts.json?tags=${encodeURIComponent(tagName)}+date:<${encodeURIComponent(monthlyData.historyCutoff)}`;
            const r = await this.rateLimiter.fetch(cutoffUrl).then((res: Response) => res.json());
            referenceTotal = (r && r.counts ? r.counts.posts : (r ? r.posts : 0)) || 0;
          } catch (e) {
            console.warn("Failed to fetch cutoff total, falling back to meta.post_count", e);
          }
        }


        console.log(`[TagAnalyticsApp] Reverse Scan Check: ForwardTotal=${forwardTotal}, ReferenceTotal=${referenceTotal}, NeedScan=${forwardTotal < referenceTotal}`);

        if (forwardTotal < referenceTotal && !runDelta) { // Disable Reverse Scan on Partial Sync
          this.injectAnalyticsButton(null, undefined, "Scanning history backwards...");
          const backwardResult = await this.fetchHistoryBackwards(tagName, startDate, referenceTotal, forwardTotal);

          if (backwardResult.length > 0) {
            const backwardShift = backwardResult[backwardResult.length - 1].cumulative;
            const adjustedForward = monthlyData.map((h: any) => ({
              ...h,
              cumulative: h.cumulative + backwardShift
            }));
            const fullHistory = [...backwardResult, ...adjustedForward];

            // If reverse scan happened, we likely found an earlier start date than metadata suggested.
            // We should use that to find the TRUE first post efficiently without scanning from 2005.
            const earliestDateFound = backwardResult[0].date;

            const realInitialStats = await this.fetchInitialStats(tagName, null, true, earliestDateFound);
            if (realInitialStats) {
              firstPost = realInitialStats.firstPost;
              hundredthPost = realInitialStats.hundredthPost;
              timeToHundred = realInitialStats.timeToHundred;

              if (realInitialStats.initialPosts && realInitialStats.initialPosts.length > 0) {
                console.log('[TagAnalytics] Recalculating First 100 Rankings for older posts...');
                const newStats = this.calculateLocalStats(realInitialStats.initialPosts);
                realFirst100Stats = await this.resolveFirst100Names(newStats).catch(e => {
                  console.warn('[TagAnalytics] Failed to resolve names for older posts', e);
                  return newStats;
                });
              }
            }
            return fullHistory;
          }
        }
        return monthlyData;
      });

      // Milestones Chain
      if (!milestonesPromise) {
        milestonesPromise = historyPromise.then((monthlyData: any) => {
          return this.fetchMilestones(tagName, monthlyData || [], milestoneTargets);
        });
      }

      if (!first100StatsPromise) {
        first100StatsPromise = Promise.resolve(this.calculateLocalStats(initialPosts || []));
      }

      // Phase 2 Task List
      const heavyTasks = [
        { id: 'rankings_full', label: 'Fetching & resolving rankings...', promise: rankingPromise },
        { id: 'history', label: 'Analyzing monthly trends...', promise: historyPromise },
        { id: 'milestones', label: 'Checking milestones...', promise: milestonesPromise },
        {
          id: 'resolve_names',
          label: 'Resolving usernames...',
          promise: first100StatsPromise.then(stats => {
            if (runDelta && baseData && baseData.rankings && baseData.rankings.uploader.first100) return stats;
            return this.resolveFirst100Names(stats);
          })
        }
      ];

      console.log('[TagAnalytics] [Phase 2] Awaiting Heavy Stats...');
      const heavyResults = await Promise.all(heavyTasks.map(trackProgress));

      // Extract results
      let [
        resolvedRankings,
        historyData,
        milestones,
        first100Stats
      ] = heavyResults;

      // [FIX] Override First 100 Stats if backward scan updated them
      if (realFirst100Stats) {
        console.log('[TagAnalytics] Applying updated First 100 Rankings from backward scan.');
        first100Stats = realFirst100Stats;
      }

      console.log(`[TagAnalytics] [Group 1] Finished Quick Stats (approx) in ${(performance.now() - tGroup1Start).toFixed(2)}ms (Note: includes wait for longest item)`);
      console.log('[TagAnalytics] All parallel tasks completed.');

      // Extract resolved rankings
      const {
        uploaderAll, approverAll, uploaderYear, approverYear
      } = resolvedRankings;

      // --- [PHASE 3] DEFERRED COUNTS (Optimized with Date Range) ---
      // Now we have `first100Stats.startDate` or derive from historyData
      const minDate = (first100Stats && first100Stats.startDate) ? first100Stats.startDate : (historyData && historyData.length > 0 ? new Date(historyData[0].date) : new Date('2005-01-01'));
      const minDateStr = minDate.toISOString().split('T')[0];

      console.log(`[TagAnalytics] [Phase 3] Starting Deferred Counts (Rating) with startDate: ${minDateStr}`);
      const ratingCounts = await measure('Rating Counts', this.fetchRatingCounts(tagName, minDateStr));

      // --- 6. Backward History Scan --- (MOVED TO historyPromise CHAIN ABOVE)
      // The historyData and milestones returned from Promise.all are already fully corrected.

      console.timeEnd('TagAnalytics:Total');
      void performance.now();
      void (this.rateLimiter.getRequestCount() - startReq2);


      // Conditional Fetch for Copyright/Character - REMOVED (Moved to Start)
      // The variables 'copyrightCounts' and 'characterCounts' are already populated from Promise.all above.

      // Attach fetched data to meta
      meta.statusCounts = statusCounts;
      meta.ratingCounts = ratingCounts;
      meta.latestPost = latestPost;
      meta.newPostCount = newPostCount;
      meta.trendingPost = trendingPost;
      meta.trendingPostNSFW = trendingPostNSFW;
      meta.copyrightCounts = copyrightCounts;
      meta.characterCounts = characterCounts;
      meta.commentaryCounts = commentaryCounts;
      meta.historyData = historyData;
      meta.precalculatedMilestones = milestones;
      meta.firstPost = firstPost; // Ensure this is passed
      meta.hundredthPost = hundredthPost; // Ensure this is passed

      meta.rankings = {
        uploader: {
          allTime: uploaderAll,
          year: uploaderYear,
          first100: first100Stats.uploaderRanking
        },
        approver: {
          allTime: approverAll,
          year: approverYear,
          first100: first100Stats.approverRanking
        }
      };

      // Update Button state (Activation) and open modal
      this.injectAnalyticsButton(meta, 100, "");
      this._showUpdatedStatus(meta.updatedAt);
      this.saveToCache(meta); // Save Full Tag Data
      this.toggleModal(true);
      this.renderDashboard(meta);
    } finally {
      this.isFetching = false;
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
    const MAX_OPTIMIZED_POSTS = 1200;
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
  async _fetchNewPostCountV1(tagName: string): Promise<number> {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const url = `/counts/posts.json?tags=${encodeURIComponent(tagName)}+date:>=${yesterday}`;
    return this.rateLimiter.fetch(url).then((r: Response) => r.json()).then((d: any) => d.counts.posts).catch(() => 0);
  }

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
        } catch (e) { }
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
    void now.getFullYear();
    void now.getMonth();

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
      void `${nextY}-${String(nextM).padStart(2, '0')}`;

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
        tags: `${tagName} date:${task.queryDate}` // Correct: date must be in tags
      });
      const url = `/counts/posts.json?${params.toString()}`;

      return this.rateLimiter.fetch(url)
        .then((r: Response) => r.json())
        .then((data: any) => {
          // Handle different response formats: { "counts": { "posts": N } } or { "posts": N }
          const count = (data && data.counts ? data.counts.posts : (data ? data.posts : 0)) || 0;
          return {
            date: task.dateStr,
            count: count
          };
        })
        .catch((e: unknown) => {
          console.warn(`[TagAnalyticsApp] Failed month ${task.dateStr}`, e);
          return { date: task.dateStr, count: 0 };
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
          tags: `${tagName} date:>${prevDateStr} order:id`,
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
   * Injects header controls (Settings, Reset) into the UI.
   * @param {!Element} container The container element.
   */
  injectHeaderControls(container: HTMLElement): void {
    if (document.getElementById("tag-analytics-controls-container")) return;

    const wrapper = document.createElement("span");
    wrapper.id = "tag-analytics-controls-container";
    container.appendChild(wrapper);

    // 1. Settings Button (Gear)
    const settingsBtn = document.createElement("span");
    settingsBtn.id = "tag-analytics-settings-btn";
    settingsBtn.innerHTML = '⚙️';
    settingsBtn.style.cursor = 'pointer';
    settingsBtn.style.marginLeft = '6px';
    settingsBtn.style.fontSize = '12px';
    settingsBtn.style.verticalAlign = 'middle';
    settingsBtn.title = 'Configure Data Retention';

    settingsBtn.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.showSettingsPopover(settingsBtn);
    };

    wrapper.appendChild(settingsBtn);

    // 2. Reset Button (Trash)
    const resetBtn = document.createElement("span");
    resetBtn.id = "tag-analytics-reset-btn";
    resetBtn.innerHTML = '🗑️';
    resetBtn.style.cursor = 'pointer';
    resetBtn.style.marginLeft = '8px';
    resetBtn.style.fontSize = '12px';
    resetBtn.style.verticalAlign = 'middle';
    resetBtn.title = 'Reset Data & Re-fetch';

    resetBtn.onclick = async (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (confirm(`Are you sure you want to reset the analytics data for "${this.tagName}"?\nThis will clear the local cache and fetch fresh data.`)) {
        if (this.db && this.db.tag_analytics) {
          try {
            await this.db.tag_analytics.delete(this.tagName);
            console.log(`[TagAnalyticsApp] Deleted cache for ${this.tagName}`);
            // Close existing modal to prevent conflicts or stale state
            this.toggleModal(false);
            // Re-fetch immediately since user explicitly requested reset
            this._fetchAndRender();
          } catch (err) {
            console.error('[TagAnalyticsApp] Failed to delete cache:', err);
            alert('Failed to reset data. Check console for details.');
          }
        }
      }
    };

    wrapper.appendChild(resetBtn);
  }

  /**
   * Shows the settings popover for data retention.
   * @param {!Element} target The button element that triggered the popover.
   */
  showSettingsPopover(target: HTMLElement): void {
    // Remove existing
    const existing = document.getElementById('tag-analytics-settings-popover');
    if (existing) existing.remove();

    const currentDays = this.getRetentionDays();
    const currentThreshold = this.getSyncThreshold();

    const popover = document.createElement('div');
    popover.id = 'tag-analytics-settings-popover';
    popover.style.position = 'absolute';
    popover.style.zIndex = '11001';
    popover.style.background = '#fff';
    popover.style.border = '1px solid #ccc';
    popover.style.borderRadius = '6px';
    popover.style.padding = '12px';
    popover.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
    popover.style.fontSize = '11px';
    popover.style.color = '#333';
    popover.style.width = '260px';

    // Position logic
    const rect = target.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    popover.style.top = `${rect.top + scrollTop}px`;
    popover.style.left = `${rect.right + scrollLeft + 10}px`;

    popover.innerHTML = `
  <div style="margin-bottom:8px; line-height:1.4;">
    <strong>Data Retention Period</strong><br>
    Records older than this (days) will be deleted.
  </div>
  <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
     <input type="number" id="retention-days-input" value="${currentDays}" min="1" step="1" style="width:60px; padding:3px; border:1px solid #ddd; border-radius:3px; background:#fff; color:#333;">
     <span>days</span>
  </div>

  <div style="margin-bottom:8px; line-height:1.4; border-top:1px solid #eee; padding-top:8px;">
    <strong>Sync Threshold</strong><br>
    Run partial sync if new posts exceed this count.
  </div>
  <div style="display:flex; align-items:center; justify-content:space-between;">
     <input type="number" id="sync-threshold-input" value="${currentThreshold}" min="1" step="1" style="width:60px; padding:3px; border:1px solid #ddd; border-radius:3px; background:#fff; color:#333;">
     <button id="retention-save-btn" style="background:none; border:1px solid #28a745; color:#28a745; border-radius:4px; cursor:pointer; padding:2px 8px; font-size:11px;">✅ Save</button>
  </div>
`;

    document.body.appendChild(popover);

    // Close on click outside
    const closeHandler = (e: MouseEvent) => {
      if (!popover.contains(e.target as Node) && e.target !== target) {
        popover.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);

    // Save Handler
    const saveBtn = popover.querySelector('#retention-save-btn');
    (saveBtn as HTMLElement).onclick = () => {
      const daysInput = popover.querySelector('#retention-days-input');
      const thresholdInput = popover.querySelector('#sync-threshold-input');

      const days = parseInt((daysInput as HTMLInputElement).value, 10);
      const threshold = parseInt((thresholdInput as HTMLInputElement).value, 10);

      if (!isNaN(days) && days > 0 && !isNaN(threshold) && threshold > 0) {
        this.setRetentionDays(days);
        this.setSyncThreshold(threshold);

        popover.remove();
        document.removeEventListener('click', closeHandler);
        alert(`Settings Saved:\n- Retention: ${days} days\n- Sync Threshold: ${threshold} posts\n\nCleaning up old data now...`);
        this.cleanupOldCache(); // Run cleanup immediately
      } else {
        alert('Please enter valid positive numbers.');
      }
    };
  }

  /**
   *Injecsts the main analytics button into the page header.
   * Updates the button state (loading/ready) based on data availability.
   * @param {?Object} tagData The analytics data object.
   * @param {number=} progress The loading progress percentage.
   * @param {string=} statusText Optional text to display next to the button.
   */
  injectAnalyticsButton(tagData: any, progress?: number, statusText?: string): void {
    let title = document.querySelector("#c-wiki-pages #a-show h1, #c-artists #a-show h1, #tag-show #posts h1, #tag-list h1");

    // Fallback: Try finding container via post-count (common in modern Danbooru layouts)
    if (!title) {
      const postCount = document.querySelector('.post-count, span[class*="post-count"]');
      if (postCount && postCount.parentElement) {
        title = postCount.parentElement;
      }
    }

    if (!title) {
      console.warn("[TagAnalyticsApp] Could not find a suitable title element for button injection.");
      return;
    }

    // Check if button already exists to avoid duplicates, but allow updating it
    let btn = document.getElementById("tag-analytics-btn");
    const isNew = !btn;

    if (isNew) {
      btn = document.createElement("button");
      btn.id = "tag-analytics-btn";
      btn.setAttribute('aria-label', 'View tag analytics dashboard');
      btn.style.marginLeft = "10px";
      btn.style.border = "none";
      btn.style.background = "transparent";
      btn.style.fontSize = "1.5rem";
      btn.style.verticalAlign = "middle";

      btn.innerHTML = `
        <div class="icon-container" style="
            display: inline-flex; 
            align-items: center; 
            justify-content: center; 
            width: 32px; 
            height: 32px; 
            background: #eef; 
            border-radius: 6px; 
            border: 1px solid #ccf;
            transition: all 0.2s;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#007bff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="20" x2="18" y2="10"></line>
                <line x1="12" y1="20" x2="12" y2="4"></line>
                <line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
        </div>
      `;
      title.appendChild(btn);
    }

    // Status Label Logic
    let statusLabel = document.getElementById("tag-analytics-status");
    if (!statusLabel) {
      statusLabel = document.createElement("span");
      statusLabel.id = "tag-analytics-status";
      statusLabel.style.marginLeft = "10px";
      statusLabel.style.fontSize = "14px";
      statusLabel.style.color = "#888";
      statusLabel.style.verticalAlign = "middle";
      statusLabel.style.fontFamily = "sans-serif";

      // Insert after button
      if (btn && btn.nextSibling) {
        btn.parentNode?.insertBefore(statusLabel, btn.nextSibling);
      } else if (btn) {
        btn.parentNode?.appendChild(statusLabel);
      }
    }

    if (statusText) {
      statusLabel.textContent = statusText;
      statusLabel.style.display = "inline";
    } else {
      statusLabel.textContent = "";
      statusLabel.style.display = "none";
    }

    if (!btn) return;

    const isReady = tagData && !!(tagData.historyData && tagData.precalculatedMilestones && tagData.statusCounts && tagData.ratingCounts);
    const iconContainer = btn.querySelector(".icon-container");

    if (isReady) {
      // Ready: data is available, open modal on click
      btn.style.cursor = "pointer";
      btn.title = "View Tag Analytics";
      if (iconContainer) {
        (iconContainer as HTMLElement).style.opacity = "1";
        (iconContainer as HTMLElement).style.filter = "none";
      }
      btn.onclick = () => {
        this.toggleModal(true);
        this.renderDashboard(tagData);
      };
    } else if (this.isFetching) {
      // Loading: fetch in progress, block interaction
      btn.style.cursor = "wait";
      btn.title = `Analytics Data is loading... ${(progress ?? 0) > 0 ? progress + '%' : 'Please wait.'}`;
      if (iconContainer) {
        (iconContainer as HTMLElement).style.opacity = "0.5";
        (iconContainer as HTMLElement).style.filter = "grayscale(1)";
      }
      btn.onclick = () => {
        alert(`Report data is still being calculated (${progress ?? 0}%). It will be ready in a few seconds.`);
      };
    } else {
      // Idle: not yet fetched, click to start
      btn.style.cursor = "pointer";
      btn.title = "Load Tag Analytics (Click to start)";
      if (iconContainer) {
        (iconContainer as HTMLElement).style.opacity = "1";
        (iconContainer as HTMLElement).style.filter = "none";
      }
      btn.onclick = async () => {
        await this._fetchAndRender();
      };
    }
  }

  /**
   * Creates the modal overlay for the dashboard.
   */
  createModal(): void {
    if (document.getElementById("tag-analytics-modal")) return;

    const modal = document.createElement("div");
    modal.id = "tag-analytics-modal";
    modal.style.display = "none";
    modal.style.position = "fixed";
    modal.style.top = "0";
    modal.style.left = "0";
    modal.style.width = "100%";
    modal.style.height = "100%";
    modal.style.backgroundColor = "rgba(0,0,0,0.5)";
    modal.style.zIndex = "10000";
    modal.style.justifyContent = "center";
    modal.style.alignItems = "center";

    modal.innerHTML = `
          <div style="background: white; padding: 20px; border-radius: 8px; width: 80%; max-width: 800px; max-height: 90vh; overflow-y: auto; position: relative;">
              <button id="tag-analytics-close" style="position: absolute; top: 10px; right: 10px; background: none; border: none; font-size: 1.5rem; cursor: pointer;">&times;</button>
              <div id="tag-analytics-content">
                  <h2>Loading...</h2>
              </div>
          </div>
      `;

    document.body.appendChild(modal);

    // Close handlers
    const closeBtn = document.getElementById("tag-analytics-close");
    if (closeBtn) closeBtn.onclick = () => this.toggleModal(false);
    modal.onclick = (e) => {
      if (e.target === modal) this.toggleModal(false);
    };

    // Keyboard: close on Escape
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modal.style.display !== 'none') {
        this.toggleModal(false);
      }
    });
  }

  /**
   * Toggles the visibility of the dashboard modal.
   * @param {boolean} show Whether to show or hide the modal.
   */
  toggleModal(show: boolean): void {
    if (!document.getElementById("tag-analytics-modal")) {
      this.createModal();
    }
    const modal = document.getElementById("tag-analytics-modal");
    if (!modal) return;
    modal.style.display = show ? "flex" : "none";
    if (show) {
      document.body.style.overflow = "hidden";
      const closeBtn = document.getElementById("tag-analytics-close");
      if (closeBtn) closeBtn.focus();
    } else {
      document.body.style.overflow = "";
      if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
        this.resizeTimeout = null;
      }
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
      // Remove any lingering area chart tooltips appended to body
      d3.select('body').selectAll('.tag-analytics-tooltip').remove();
    }
  }

  /**
   * Updates the visibility of NSFW content based on user settings.
   * Toggles blur/opacity on marked elements.
   */
  updateNsfwVisibility(): void {
    const isNsfwEnabled = localStorage.getItem('tag_analytics_nsfw_enabled') === 'true';
    const items = document.querySelectorAll('.di-nsfw-monitor');

    items.forEach(item => {
      const rating = item.getAttribute('data-rating');

      if (isNsfwEnabled) {
        // NSFW Enabled: Show everything
        // item.style.display = 'flex'; // No need to toggle display if we only touch image
        const img = item.querySelector('img');
        if (img) {
          img.style.filter = 'none';
          img.style.opacity = '1';
        }
      } else {
        // NSFW Disabled: Hide 'q' and 'e' thumbnails
        if (rating === 'q' || rating === 'e') {
          // item.style.display = 'none'; // Don't hide the card
          const img = item.querySelector('img');
          if (img) {
            img.style.filter = 'blur(10px) grayscale(100%)';
            img.style.opacity = '0.3';
          }
        } else {
          // Safe content: Ensure visible
          const img = item.querySelector('img');
          if (img) {
            img.style.filter = 'none';
            img.style.opacity = '1';
          }
        }
      }
    });

    // Update Checkbox State if it exists
    const cb = document.getElementById('tag-analytics-nsfw-toggle');
    if (cb) (cb as HTMLInputElement).checked = isNsfwEnabled;

    // Toggle Trending Post Visibility
    const trendingSFW = document.getElementById('trending-post-sfw');
    const trendingNSFW = document.getElementById('trending-post-nsfw');

    if (isNsfwEnabled) {
      if (trendingSFW) trendingSFW.style.display = 'none';
      if (trendingNSFW) trendingNSFW.style.display = 'flex';
    } else {
      if (trendingSFW) trendingSFW.style.display = 'flex';
      if (trendingNSFW) trendingNSFW.style.display = 'none';
    }
  }

  /**
   * Renders the full analytics dashboard into the modal.
   *
   * Layout Overview:
   * - Header: Tag name, category, created/updated dates, NSFW toggle.
   * - Main Grid (2 columns on large screens):
   *   1. Summary Card: Total uploads, 24h trend, latest/trending posts thumbnails.
   *   2. Distribution Card: Pie chart with tabs (Status, Rating, etc.) and legend.
   * - User Rankings: Uploader and Approver leaderboards.
   * - History Graph: Monthly uploads bar chart.
   * - Milestone Cards (if any).
   *
   * @param {!Object} tagData The complete analytics data to render.
   */
  renderDashboard(tagData: any): void {
    if (!document.getElementById("tag-analytics-modal")) {
      this.createModal();
    }


    const content = document.getElementById("tag-analytics-content");
    if (!content) return;
    const categoryMap: Record<number, string> = {
      1: 'Artist',
      3: 'Copyright',
      4: 'Character'
    };
    const categoryLabel = categoryMap[tagData.category] || 'Unknown';

    const colorMap: Record<number, string> = {
      1: '#c00004', // Artist - Red
      3: '#a800aa',    // Copyright - Purple/Magenta
      4: '#00ab2c'  // Character - Green
    };
    const titleColor = colorMap[tagData.category] || '#333';

    content.innerHTML = `
      <div style="border-bottom: 1px solid #eee; padding-bottom: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end;">
          <div>
              <h2 style="margin: 0 0 5px 0; color: ${titleColor};">${escapeHtml(tagData.name.replace(/_/g, ' '))}</h2>
              <div style="display: flex; align-items: center; gap: 10px;">
                  <span style="background: #eee; padding: 2px 8px; border-radius: 4px; font-size: 0.8em; color: #555;">${categoryLabel}</span>
                  <span style="font-size: 0.9em; color: #777;">Created: ${tagData.created_at ? new Date(tagData.created_at).toLocaleDateString('en-CA') : 'N/A'}</span>
                  <span style="font-size: 0.9em; color: #777; border-left: 1px solid #ddd; padding-left: 10px; display: flex; align-items: center;" id="tag-updated-at">
                      Updated: ${tagData.updatedAt ? new Date(tagData.updatedAt).toLocaleDateString('en-CA') : 'N/A'}
                      <span id="tag-settings-anchor" style="display: inline-flex; align-items: center; margin-left: 5px;"></span>
                  </span>
              </div>
          </div>
          <div>
              <label style="display: flex; align-items: center; font-size: 0.9em; color: #555; cursor: pointer; user-select: none;">
                  <input type="checkbox" id="tag-analytics-nsfw-toggle" style="margin-right: 6px;">
                  Enable NSFW
              </label>
          </div>
      </div>
      
      
      <!-- Main Grid: Summary & Distribution -->


      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 30px;">
           <!-- Summary Card -->
           <div class="di-card di-flex-col-between" style="min-height: 180px; position: relative;">
              <!-- ... (Summary content) ... -->
              <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                  <div>
                      <div style="font-size: 0.9em; color: #666; font-weight: bold; margin-bottom: 5px;">Total Uploads</div>
                      <div style="font-size: 2.2em; font-weight: bold; color: #007bff; line-height: 1.1;">
                          ${tagData.historyData && tagData.historyData.length > 0 ? tagData.historyData.reduce((a: number, b: any) => a + b.count, 0).toLocaleString() : '0'}
                      </div>
                      <div style="font-size: 0.8em; color: #28a745; margin-top: 5px;">
                          +${tagData.newPostCount || 0} <span style="color: #999; font-weight: normal;">(24h)</span>
                      </div>
                  </div>
                  
              
              <!-- Right Side: Latest & Trending -->
              <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end;">
                   <!-- Latest Post -->
                   ${tagData.latestPost ? `
               <div class="di-nsfw-monitor di-hover-translate-up" data-rating="${tagData.latestPost.rating}" style="display: flex; flex-direction: column; align-items: center; width: 80px; flex-shrink: 0;">
                  <div style="border: 1px solid #ddd; padding: 2px; border-radius: 4px; background: #fff; width: 100%; aspect-ratio: 1/1; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                     <a href="/posts/${tagData.latestPost.id}" target="_blank" style="display: block; width: 100%; height: 100%;">
                         <img src="${AnalyticsDataManager.getBestThumbnailUrl(tagData.latestPost)}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null;this.src='/favicon.ico';this.style.objectFit='contain';this.style.padding='4px';">
                     </a>
                  </div>
                  <div style="font-size: 0.8em; font-weight: bold; color: #555; margin-top: 5px;">Latest</div>
                  <div style="font-size: 0.7em; color: #999;">${tagData.latestPost.created_at.split('T')[0]}</div>
               </div>
               ` : ''}

                       <!-- Trending Post (SFW) -->
                       ${tagData.trendingPost ? `
                   <div id="trending-post-sfw" class="di-nsfw-monitor di-hover-translate-up" data-rating="${tagData.trendingPost.rating}" style="display: flex; flex-direction: column; align-items: center; width: 80px; flex-shrink: 0;">
                      <div style="border: 1px solid #ffd700; padding: 2px; border-radius: 4px; background: #fff; width: 100%; aspect-ratio: 1/1; display: flex; align-items: center; justify-content: center; overflow: hidden; box-shadow: 0 0 5px rgba(255, 215, 0, 0.3);">
                         <a href="/posts/${tagData.trendingPost.id}" target="_blank" style="display: block; width: 100%; height: 100%;">
                               <img src="${AnalyticsDataManager.getBestThumbnailUrl(tagData.trendingPost)}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null;this.src='/favicon.ico';this.style.objectFit='contain';this.style.padding='4px';">
                         </a>
                      </div>
                      <div style="font-size: 0.75em; font-weight: bold; color: #e0a800; margin-top: 5px;">Trending(3d)</div>
                      <div style="font-size: 0.7em; color: #999;">Score: ${tagData.trendingPost.score}</div>
                   </div>
                  ` : ''}

                       <!-- Trending Post (NSFW) -->
                       ${tagData.trendingPostNSFW ? `
                   <div id="trending-post-nsfw" class="di-nsfw-monitor di-hover-translate-up" data-rating="${tagData.trendingPostNSFW.rating}" style="display: none; flex-direction: column; align-items: center; width: 80px; flex-shrink: 0;">
                      <div style="border: 1px solid #ff4444; padding: 2px; border-radius: 4px; background: #fff; width: 100%; aspect-ratio: 1/1; display: flex; align-items: center; justify-content: center; overflow: hidden; box-shadow: 0 0 5px rgba(255, 0, 0, 0.3);">
                         <a href="/posts/${tagData.trendingPostNSFW.id}" target="_blank" style="display: block; width: 100%; height: 100%;">
                               <img src="${AnalyticsDataManager.getBestThumbnailUrl(tagData.trendingPostNSFW)}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null;this.src='/favicon.ico';this.style.objectFit='contain';this.style.padding='4px';">
                         </a>
                      </div>
                      <div style="font-size: 0.75em; font-weight: bold; color: #cc0000; margin-top: 5px;">Trending(NSFW)</div>
                      <div style="font-size: 0.7em; color: #999;">Score: ${tagData.trendingPostNSFW.score}</div>
                   </div>
                  ` : ''}
              </div>
          </div>

              <!-- Spacer if needed, or remove bottom part -->
           </div>

           <!-- Distribution Card -->
           <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; min-height: 180px; position: relative; display: flex; flex-direction: column;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                 <div style="font-size: 0.9em; color: #666; font-weight: bold;">Distribution</div>
                 <!-- Pie Chart Tabs:
                      - Uses 'Pill' style for better visual distinction.
                      - 'flex-wrap: wrap' ensures tabs don't overflow on small screens.
                      - Active tab styling is handled via CSS classes (.active) to prevent layout shifts.
                 -->
                 <div class="pie-tabs" style="display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end;">
                    <button class="di-pie-tab active" data-type="status">Status</button>
                    <button class="di-pie-tab" data-type="rating">Rating</button>
                    ${tagData.copyrightCounts ? `<button class="di-pie-tab" data-type="copyright">Copyright</button>` : ''}
                    ${tagData.characterCounts ? `<button class="di-pie-tab" data-type="character">Character</button>` : ''}
                    ${tagData.commentaryCounts ? `<button class="di-pie-tab" data-type="commentary">Commentary</button>` : ''}
                 </div>
              </div>
              <div id="status-pie-chart-wrapper" style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; opacity: 0; transition: opacity 0.5s;">
                 <div id="status-pie-chart" style="width: 120px; height: 120px; flex-shrink: 0;"></div>
                 <div id="status-pie-legend" style="margin-left: 15px; font-size: 0.75em; flex: 1; min-width: 140px; max-height: 140px; overflow-y: auto; padding-right: 10px;"></div>
              </div>
              <div id="status-pie-loading" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #888; font-size: 0.8em;">Loading data...</div>
           </div>
      </div>
      <!-- User Rankings Section -->
      ${tagData.rankings ? `
      <div style="margin-bottom: 30px;">
           <div style="border-bottom: 2px solid #eee; margin-bottom: 15px; display: flex; gap: 20px; align-items: center;">
              <h3 style="margin: 0; padding-bottom: 10px; font-size: 1.2em; color: #444; border-bottom: 3px solid #007bff; margin-bottom: -2px;">User Rankings</h3>
              <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                  <button class="rank-tab active" data-role="uploader" style="border: none; background: none; font-weight: bold; color: #007bff; cursor: pointer; padding: 5px 10px;">Uploaders</button>
                  <button class="rank-tab" data-role="approver" style="border: none; background: none; font-weight: normal; color: #888; cursor: pointer; padding: 5px 10px;">Approvers</button>
              </div>
           </div>
           
           <div id="ranking-container" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
              ${(() => {
          console.log('[TagAnalytics] renderDashboard - Initial Render - hundredthPost:', tagData.hundredthPost);
          return '';
        })()}
              ${this.renderRankingColumn('All-time', tagData.rankings.uploader.allTime, 'uploader', tagData.name)}
              ${this.renderRankingColumn('Last 1 Year', tagData.rankings.uploader.year, 'uploader', tagData.name)}
              ${this.renderRankingColumn('First 100 Post', tagData.rankings.uploader.first100, 'uploader', tagData.name, tagData.hundredthPost ? tagData.hundredthPost.id : null)}
           </div>
      </div>
      ` : ''}

          <!-- Milestones Container -->
          <div id="tag-analytics-milestones" style="margin-bottom: 30px; display:none;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px;">
                  <h2 style="color: #444; border-left: 4px solid #ffc107; padding-left: 10px; margin: 0;">
                      Milestones
                  </h2>
                  <button id="tag-milestones-toggle" style="background:none; border:none; color:#007bff; cursor:pointer; font-size:0.9em; display:none;">Show More</button>
              </div>
              <div id="milestones-loading" style="color:#888; text-align:center; padding:20px;">Checking milestones...</div>
              <div id="tag-milestones-grid-container" class="milestones-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 15px; max-height: 120px; overflow: hidden; transition: max-height 0.3s ease;"></div>
          </div>

          <!-- Charts Container -->
          <div id="tag-analytics-charts" style="margin-bottom: 30px;">
              <h2 style="color: #444; border-left: 4px solid #007bff; padding-left: 10px; margin-bottom: 15px;">Post History</h2>
              <div id="chart-loading" style="color: #888; text-align: center; padding: 20px;">Loading History Data...</div>
              <div id="history-chart-monthly" style="width: 100%; height: 300px; margin-bottom: 20px;"></div>
              <div id="history-chart-cumulative" style="width: 100%; height: 300px;"></div>
          </div>
      `;

    // Inject Header Controls (Settings, Reset)
    const anchor = document.getElementById('tag-settings-anchor');
    if (anchor) this.injectHeaderControls(anchor);

    // NSFW Logic
    const nsfwCheck = document.getElementById('tag-analytics-nsfw-toggle');
    if (nsfwCheck) {
      (nsfwCheck as HTMLInputElement).checked = localStorage.getItem('tag_analytics_nsfw_enabled') === 'true';
      nsfwCheck.onchange = (e) => {
        localStorage.setItem('tag_analytics_nsfw_enabled', (e.target as HTMLInputElement).checked.toString());
        this.updateNsfwVisibility();
      };
      // Apply initial state
      this.updateNsfwVisibility();
    }

    // Use Pre-fetched Data
    const data = tagData.historyData || [];
    const loading = document.getElementById("chart-loading");
    if (loading) loading.style.display = 'none';

    if (data && data.length > 0) {
      this.renderHistoryCharts(data, tagData.precalculatedMilestones);

      // Milestones Logic
      const milestonesContainer = document.getElementById('tag-analytics-milestones');
      if (milestonesContainer) {
        milestonesContainer.style.display = 'block';

        // Use totalCount from meta (tagData)
        const targets = this.getMilestoneTargets(tagData.post_count);

        if (tagData.precalculatedMilestones) {
          this.renderMilestones(tagData.precalculatedMilestones);
        } else {
          // Pass tagName, totalCount, targets
          this.fetchMilestonePosts(tagData.name, tagData.post_count, targets).then((milestonePosts: any) => {
            this.renderMilestones(milestonePosts);
          });
        }
      }
      // Pie Chart Initial Render & Tab Switching
      if (tagData.statusCounts && tagData.ratingCounts) {
        const type = 'status'; // Initial type
        this.renderPieChart(type, tagData);

        const tabs = document.querySelectorAll('.di-pie-tab');
        tabs.forEach(tab => {
          (tab as HTMLElement).onclick = () => {
            const newType = tab.getAttribute('data-type');
            tabs.forEach(t => {
              t.classList.remove('active');
              (t as HTMLElement).style.background = ''; // Clear inline style to let CSS take over
              (t as HTMLElement).style.color = ''; // Clear inline color
            });
            tab.classList.add('active');
            // Don't set inline style for active, let CSS .active handle it
            this.renderPieChart(newType ?? 'status', tagData);
          };
        });

        // Ranking Tabs Logic
        const rankTabs = document.querySelectorAll('.rank-tab');
        rankTabs.forEach(tab => {
          (tab as HTMLElement).onclick = () => {
            const role = tab.getAttribute('data-role');
            rankTabs.forEach(t => {
              t.classList.remove('active');
              (t as HTMLElement).style.fontWeight = 'normal';
              (t as HTMLElement).style.color = '#888';
            });
            tab.classList.add('active');
            (tab as HTMLElement).style.fontWeight = 'bold';
            (tab as HTMLElement).style.color = '#007bff';

            this.updateRankingTabs(role ?? 'uploader', tagData);
          };
        });
      }

    } else {
      if (loading) {
        loading.textContent = "No history data available.";
        loading.style.display = 'block';
      }
    }
  }


  /**
   * Renders a D3.js pie chart for the specified data type.
   * Handles data preparation, SVG rendering, tooltips, legend generation, and click interactions.
   *
   * @param {string} type - The type of data to render ('status', 'rating', 'copyright', 'character', 'commentary').
   * @param {Object} tagData - The full tag data object containing counts and other metadata.
   */
  renderPieChart(type: string, tagData: any): void {
    const container = document.getElementById('status-pie-chart');
    const legendContainer = document.getElementById('status-pie-legend');
    const loading = document.getElementById('status-pie-loading');
    const wrapper = document.getElementById('status-pie-chart-wrapper');

    if (!container || !tagData) return;

    let counts = null;
    if (type === 'status') counts = tagData.statusCounts;
    else if (type === 'rating') counts = tagData.ratingCounts;
    else if (type === 'copyright') counts = tagData.copyrightCounts;
    else if (type === 'character') counts = tagData.characterCounts;
    else if (type === 'commentary') {
      // Transform Commentary Counts
      const c = tagData.commentaryCounts;
      const translated = c.translated || 0;
      const requested = c.requested || 0;
      const total = c.total || 0;
      const untagged = Math.max(0, total - (translated + requested)); // Avoid negative

      counts = {
        'commentary': translated,
        'commentary_request': requested,
        'has:comments -commentary -commentary_request': untagged
      };
    }
    if (!counts) return;

    const ratingLabels: Record<string, string> = { 'g': 'General', 's': 'Sensitive', 'q': 'Questionable', 'e': 'Explicit' };

    // Safe Data Mapping
    const data = Object.entries(counts).map(([key, count]) => {
      let name = key;
      if (type === 'status') name = key.charAt(0).toUpperCase() + key.slice(1);
      else if (type === 'rating') name = ratingLabels[key] || key;
      else if (type === 'commentary') {
        if (key === 'commentary') name = 'Commentary';
        else if (key === 'commentary_request') name = 'Requested';
        else if (key === 'has:comments -commentary -commentary_request') name = 'Untagged';
      }
      else name = key.replace(/_/g, ' ');

      if (key === 'others') name = 'Others';

      // Ensure count is a number and valid
      const validCount = Number(count);
      return {
        name: name,
        count: isNaN(validCount) ? 0 : validCount,
        key: key
      };
    }).filter(d => d.count > 0)
      .sort((a, b) => {
        if (a.key === 'others') return 1;
        if (b.key === 'others') return -1;
        return b.count - a.count;
      }); // Sort by count desc, but others last

    if (data.length === 0) {
      if (loading) {
        loading.style.display = 'block';
        loading.textContent = `No ${type} data available.`;
      }
      if (wrapper) wrapper.style.opacity = '0';
      return;
    }

    if (loading) loading.style.display = 'none';
    if (wrapper) wrapper.style.opacity = '1';

    const width = 120;
    const height = 120;
    const radius = (Math.min(width, height) / 2) - 8; // Reduced for hover space

    // Colors
    const statusColors: Record<string, string> = {
      'active': '#28a745', 'deleted': '#dc3545', 'pending': '#ffc107',
      'flagged': '#fd7e14', 'banned': '#6c757d', 'appealed': '#007bff'
    };
    const ratingColors: Record<string, string> = {
      'g': '#28a745', 's': '#fd7e14', 'q': '#6f42c1', 'e': '#dc3545'
    };
    // Dynamic colors for tags
    const ordinalColor = d3.scaleOrdinal(d3.schemeCategory10);

    const getColor = (key: string) => {
      if (type === 'status') return statusColors[key] || '#999';
      if (type === 'rating') return ratingColors[key] || '#999';
      if (type === 'commentary') {
        if (key === 'commentary') return '#007bff'; // Blue
        if (key === 'commentary_request') return '#ffc107';    // Yellow/Orange
        if (key === 'has:comments -commentary -commentary_request') return '#6c757d';   // Grey
      }
      if (key === 'others') return '#888'; // Grey for Others
      return ordinalColor(key);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pie = (d3.pie() as any).value((d: any) => d.count).sort(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arc = (d3.arc() as any).innerRadius(radius * 0.4).outerRadius(radius);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arcHover = (d3.arc() as any).innerRadius(radius * 0.4).outerRadius(radius * 1.1);

    // Select existing SVG or create new one
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let svg: any = d3.select(container).select('svg');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let g: any;

    if (svg.empty()) {
      svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height);
      g = svg.append('g')
        .attr('transform', `translate(${width / 2},${height / 2})`);
    } else {
      g = svg.select('g');
    }

    // Tooltip (Global)
    const tooltip = d3.select("body").selectAll(".tag-pie-tooltip").data([0]).join("div")
      .attr("class", "tag-pie-tooltip")
      .style("position", "absolute")
      .style("background", "rgba(30, 30, 30, 0.9)")
      .style("color", "#fff")
      .style("padding", "5px 10px")
      .style("border-radius", "4px")
      .style("font-size", "11px")
      .style("pointer-events", "none")
      .style("z-index", "2147483647")
      .style("opacity", "0")
      .style("box-shadow", "0 2px 5px rgba(0,0,0,0.2)");

    const totalValue = d3.sum(data, (d: any) => d.count);
    const arcs = pie(data);

    // JOIN
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const path = g.selectAll('path')
      .data(arcs, (d: any) => d.data.key); // Use key for stable updates

    // EXIT
    path.exit()
      .transition().duration(500)
      .attrTween('d', function (this: any, d: any) {
        const start = d.startAngle;
        const end = d.endAngle;
        const i = d3.interpolate(start, end);
        return function (t: number) {
          // Create a temp object for arc, do NOT modify d in place
          return arc({ ...d, startAngle: i(t) }) || "";
        };
      })
      .remove();

    // UPDATE
    path.transition().duration(500)
      .attrTween('d', function (this: any, d: any) {
        const prev = this._current || { startAngle: 0, endAngle: 0, padAngle: 0 };
        const i = d3.interpolate(prev, d);
        const self = this;
        return function (t: number) {
          const val = i(t);
          self._current = val;
          return arc(val) || "";
        };
      })
      .attr('fill', (d: any) => getColor(d.data.key));

    // ENTER
    path.enter()
      .append('path')
      .attr('fill', (d: any) => getColor(d.data.key))
      .attr('stroke', '#fff')
      .style('stroke-width', '1px')
      .style('opacity', 0.8)
      .style('cursor', 'pointer')
      .transition().duration(500)
      .attrTween('d', function (this: any, d: any) {
        const i = d3.interpolate({ startAngle: 0, endAngle: 0, padAngle: 0 }, d);
        const self = this;
        return function (t: number) {
          const val = i(t);
          self._current = val;
          return arc(val) || "";
        };
      });

    // RE-ATTACH EVENTS (Merge Enter + Update)
    g.selectAll('path')
      .on('mouseover', function (this: any, event: any, d: any) {
        d3.select(this).transition().duration(200).attr('d', arcHover).style('opacity', 1);
        const percent = Math.round((d.data.count / totalValue) * 100);
        tooltip.transition().duration(200).style('opacity', 1);
        tooltip.html(`<strong>${escapeHtml(d.data.name)}</strong>: ${d.data.count.toLocaleString()} (${percent}%)`)
          .style('left', (event.pageX + 10) + 'px')
          .style('top', (event.pageY - 20) + 'px');
      })
      .on('mousemove', function (this: any, event: any) {
        tooltip.style('left', (event.pageX + 10) + 'px')
          .style('top', (event.pageY - 20) + 'px');
      })
      .on('mouseout', function (this: any) {
        d3.select(this).transition().duration(200).attr('d', arc).style('opacity', 0.8);
        tooltip.transition().duration(200).style('opacity', 0);
      })
      .on('click', (_event: any, d: any) => {
        if (d.data.key === 'others') return;

        let query = '';
        if (type === 'status') {
          query = `${this.tagName} status:${d.data.key}`;
        } else if (type === 'rating') {
          query = `${this.tagName} rating:${d.data.key}`;
        } else {
          // Copyright/Character/Commentary
          query = `${this.tagName} ${d.data.key}`;
        }
        const url = `/posts?tags=${encodeURIComponent(query)}`;
        window.open(url, '_blank');
      });

    // Legend
    if (legendContainer) {
      legendContainer.innerHTML = '';
      data.forEach(d => {
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.marginBottom = '2px';
        item.style.whiteSpace = 'nowrap';

        const colorBox = document.createElement('div');
        colorBox.style.width = '10px';
        colorBox.style.height = '10px';
        colorBox.style.backgroundColor = getColor(d.key);
        colorBox.style.marginRight = '5px';
        colorBox.style.borderRadius = '2px';

        const label = document.createElement('a');
        let query = '';

        if (type === 'status') {
          query = `${this.tagName} status:${d.key}`;
        } else if (type === 'rating') {
          query = `${this.tagName} rating:${d.key}`;
        } else {
          // Copyright/Character: Just the tag name? Or AND logic?
          // "tagName relatedTag"
          if (d.key === 'others') {
            // Others not clickable or what? 
            // Maybe disable link.
          } else {
            query = `${this.tagName} ${d.key}`;
          }
        }

        if (d.key !== 'others') {
          label.href = `/posts?tags=${encodeURIComponent(query)}`;
          label.target = '_blank';
          label.style.cursor = 'pointer';
          label.classList.add('di-hover-text-primary');
        } else {
          label.style.cursor = 'default';
        }

        label.textContent = `${d.name} (${d.count.toLocaleString()})`;
        label.style.textDecoration = 'none';
        label.style.color = '#555';
        label.style.transition = 'color 0.2s';

        item.appendChild(colorBox);
        item.appendChild(label);
        legendContainer.appendChild(item);
      });
    }
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

    let step = 100;
    if (total < 2500) step = 100;
    else if (total < 5000) step = 250;
    else if (total < 10000) step = 500;
    else if (total < 25000) step = 1000;
    else if (total < 50000) step = 2500;
    else if (total < 100000) step = 5000;
    else if (total < 250000) step = 10000;
    else if (total < 500000) step = 25000;
    else if (total < 1000000) step = 50000;
    else if (total < 2500000) step = 100000;
    else if (total < 5000000) step = 250000;
    else step = 500000;

    for (let i = step; i <= total; i += step) {
      milestones.add(i);
    }

    const res = Array.from(milestones).sort((a, b) => a - b);

    return res;
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

  /**
   * Renders the milestones grid.
   * @param {!Array<{milestone: number, post: ?Object}>} milestonePosts The list of milestone data.
   */
  renderMilestones(milestonePosts: any[]): void {
    const grid = document.querySelector('#tag-analytics-milestones .milestones-grid');
    const toggleBtn = document.getElementById('tag-milestones-toggle');
    const loading = document.querySelector('#milestones-loading');
    if (loading) (loading as HTMLElement).style.display = 'none';
    if (!grid) return;

    grid.innerHTML = '';

    if (milestonePosts.length === 0) {
      grid.innerHTML = '<div style="color:#888; grid-column:1/-1; text-align:center;">No milestones found.</div>';
      if (toggleBtn) toggleBtn.style.display = 'none';
      return;
    }

    // Show toggle if many items
    if (toggleBtn && milestonePosts.length > 6) {
      toggleBtn.style.display = 'block';
      toggleBtn.textContent = this.isMilestoneExpanded ? 'Show Less' : 'Show More';
      (grid as HTMLElement).style.maxHeight = this.isMilestoneExpanded ? '2000px' : '120px';

      toggleBtn.onclick = () => {
        this.isMilestoneExpanded = !this.isMilestoneExpanded;
        (grid as HTMLElement).style.maxHeight = this.isMilestoneExpanded ? '2000px' : '120px';
        toggleBtn.textContent = this.isMilestoneExpanded ? 'Show Less' : 'Show More';
      };
    } else if (toggleBtn) {
      toggleBtn.style.display = 'none';
      (grid as HTMLElement).style.maxHeight = 'none';
    }

    milestonePosts.forEach(item => {
      const m = item.milestone;
      const p = item.post;

      let label = `#${m}`;
      if (m === 1) label = 'First';
      else if (m >= 1000000) {
        const val = m / 1000000;
        label = `${Number.isInteger(val) ? val : val.toFixed(1).replace(/\.0$/, '')} M`;
      } else if (m >= 1000) {
        const val = m / 1000;
        label = `${val} k`;
      }

      const dateStr = new Date(p.created_at).toISOString().slice(0, 10);
      const thumbUrl = AnalyticsDataManager.getBestThumbnailUrl(p);
      const uploaderName = p.uploader_name || `User ${p.uploader_id}`;

      const card = document.createElement('div');
      card.className = 'di-milestone-card di-nsfw-monitor';
      card.setAttribute('data-rating', p.rating);
      card.style.background = '#fff';
      card.style.border = '1px solid #ddd';
      card.style.borderRadius = '8px';
      card.style.padding = '10px';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
      card.classList.add('di-hover-translate-up');

      card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
                <div>
                    <div style="font-size: 0.8em; color: #888; margin-bottom: 3px; text-transform: uppercase;">#${p.id}</div>
                    <a href="/posts/${p.id}" target="_blank" class="di-milestone-link" style="font-weight: bold; font-size: 1.2em; color: #007bff; text-decoration: none; display: block; margin-bottom: 3px;">${label}</a>
                    <div style="font-size: 0.85em; color: #555;">${dateStr}</div>
                </div>
                <a href="/posts/${p.id}" target="_blank" style="width: 50px; height: 50px; border-radius: 4px; overflow: hidden; flex-shrink: 0; background: #eee; margin-left: 10px;">
                    <img src="${thumbUrl}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null;this.src='/favicon.ico';this.style.objectFit='contain';this.style.padding='4px';">
                </a>
            </div>
            <div style="font-size: 0.8em; color: #888; word-break: break-all; line-height: 1.2;">
                <a href="/users/${p.uploader_id}" target="_blank" class="${this.getLevelClass(p.uploader_level)}" style="text-decoration: none;">${escapeHtml(uploaderName)}</a>
            </div>
        `;

      const link = card.querySelector('.di-milestone-link');
      if (link) link.classList.add('di-hover-underline');

      grid.appendChild(card);
    });

    // Apply NSFW Settings
    this.updateNsfwVisibility();
  }


  /**
   * Renders both the monthly bar chart and cumulative area chart.
   * @param {!Array<{date: string, count: number, cumulative: number}>} data The history data.
   * @param {!Array<Object>=} milestones Optional pre-calculated milestones for display.
   */
  renderHistoryCharts(data: any[], milestones?: any[]): void {
    if (!(window as any).d3) {
      console.error("D3.js not loaded");
      return;
    }

    this.currentMilestones = milestones;

    // Sanitize Data: Ensure all dates are strings YYYY-MM-DD
    const chartData = data.map(d => {
      let dateStr = d.date;
      if (d.date instanceof Date) {
        dateStr = d.date.toISOString().slice(0, 10);
      }
      return {
        ...d,
        date: dateStr
      };
    });

    this.currentData = chartData;

    // 1. Monthly Bar Chart (Scrollable)
    this.renderBarChart(chartData, "#history-chart-monthly", "Monthly Posts", milestones);

    // 2. Cumulative Line/Area Chart (Fit to width, usually readable as line)
    this.renderAreaChart(chartData, "#history-chart-cumulative", "Cumulative Posts");

    // Responsive Resize Handling
    if (!this.resizeObserver) {
      const modalContent = document.querySelector("#tag-analytics-content")?.parentElement;
      if (modalContent) {
        this.resizeObserver = new ResizeObserver(() => {
          if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
          this.resizeTimeout = setTimeout(() => {
            if (this.currentData && document.getElementById("history-chart-monthly")) {
              // Re-render using stored sanitized data
              this.renderBarChart(this.currentData, "#history-chart-monthly", "Monthly Posts", this.currentMilestones);
              this.renderAreaChart(this.currentData, "#history-chart-cumulative", "Cumulative Posts");
            }
          }, 100);
        });
        this.resizeObserver.observe(modalContent);
      }
    }
  }

  /**
   * Renders a bar chart using D3.js.
   * @param {!Array<{date: string, count: number}>} data The data to render.
   * @param {string} selector The CSS selector for the container.
   * @param {string} title The title of the chart.
   * @param {!Array<Object>=} milestones Optional milestones to overlay.
   */
  renderBarChart(data: any[], selector: string, title: string, milestones?: any[]): void {
    const container = document.querySelector(selector) as HTMLElement;
    if (!container) return;
    container.innerHTML = ""; // Clear

    // Structure:
    // Container (Flex Column)
    //  -> Title (Static)
    //  -> ScrollWrapper (Overflow Auto)
    //      -> SVG

    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.height = '100%';

    // 1. Static Title
    const titleEl = document.createElement("div");
    titleEl.textContent = title;
    titleEl.style.fontSize = "14px";
    titleEl.style.fontWeight = "bold";
    titleEl.style.color = "#444";
    titleEl.style.marginBottom = "5px";
    titleEl.style.textAlign = "left"; // Left aligned
    titleEl.style.borderLeft = "4px solid #007bff";
    titleEl.style.paddingLeft = "10px";
    container.appendChild(titleEl);

    // 2. Main Wrapper (Flexbox to separate Fixed Y and Scrollable Content)
    const mainWrapper = document.createElement("div");
    mainWrapper.className = "chart-flex-wrapper";
    mainWrapper.style.display = "flex";
    mainWrapper.style.width = "100%";
    mainWrapper.style.position = "relative";
    container.appendChild(mainWrapper);

    // Dedicated space for fixed Y-Axis
    const yAxisContainer = document.createElement("div");
    yAxisContainer.className = "y-axis-container";
    yAxisContainer.style.width = "45px"; // Fixed width
    yAxisContainer.style.flexShrink = "0";
    yAxisContainer.style.background = "#fff";
    yAxisContainer.style.zIndex = "5";
    mainWrapper.appendChild(yAxisContainer);

    // Scrollable Content
    const scrollWrapper = document.createElement("div");
    scrollWrapper.className = "scroll-wrapper";
    scrollWrapper.style.flex = "1";
    scrollWrapper.style.overflowX = 'auto'; // Horizontal scroll
    scrollWrapper.style.overflowY = 'hidden';
    mainWrapper.appendChild(scrollWrapper);

    // Calculate flexible width
    const barWidth = 20; // px
    const margin = { top: 20, right: 30, bottom: 40, left: 10 }; // Small left margin for scrollable part
    const yAxisMargin = { top: 20, right: 0, bottom: 40, left: 40 };

    // visible container width
    const containerWidth = mainWrapper.clientWidth - 45;
    // required width for all bars
    const calculatedWidth = data.length * barWidth;

    // Final SVG width
    const width = Math.max(containerWidth, calculatedWidth + margin.left + margin.right);
    const height = 300;

    // Render Y-Axis SVG (Fixed)
    const yAxisSvg = d3.select(yAxisContainer)
      .append("svg")
      .attr("width", 45)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(${yAxisMargin.left},${yAxisMargin.top})`);

    // Render Content SVG (Scrollable)
    const svg = d3.select(scrollWrapper)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
      // Handle both Date objects (old cache/calc) and strings (new fetch). Use Local Time YYYY-MM-DD
      .domain(data.map(d => {
        if (d.date instanceof Date) return d.date.toLocaleDateString('en-CA');
        return d.date; // already YYYY-MM-DD string
      }))
      .range([0, width - margin.left - margin.right])
      .padding(0.2);

    const y = d3.scaleLinear()
      .domain([0, d3.max(data, d => d.count)])
      .nice()
      .range([height - margin.top - margin.bottom, 0]);

    // Render Y Axis into Fixed SVG
    yAxisSvg.call(d3.axisLeft(y).ticks(8));

    // 3. Grid Lines (Horizontal) - Render in scrollable area for context
    svg.append("g")
      .attr("class", "grid")
      .attr("stroke-opacity", 0.05)
      .call(d3.axisLeft(y)
        .ticks(8)
        .tickSize(-(width - margin.left - margin.right))
        .tickFormat(() => "")
      )
      .call(g => g.select(".domain").remove());

    // 4. Clickable Monthly Overlays (Full height clickable area)
    const overlayGroups = svg.append("g").attr("class", "monthly-overlays");
    data.forEach(d => {
      // d.date can be "YYYY-MM-DD" string or Date object
      const dateStr = (d.date instanceof Date) ? d.date.toLocaleDateString('en-CA') : d.date;
      const dateObj = (d.date instanceof Date) ? d.date : new Date(dateStr);

      const nextDate = new Date(dateObj);
      nextDate.setMonth(nextDate.getMonth() + 1);
      const nextDateStr = nextDate.toLocaleDateString('en-CA');

      const dateRange = `${dateStr}...${nextDateStr}`;
      const searchUrl = `/posts?tags=${encodeURIComponent(this.tagName)}+date:${dateRange}`;

      const colWidth = x.step();
      // Use the string date key for x-scale lookup
      const colX = (x(dateStr) ?? 0) - (x.step() - x.bandwidth()) / 2;

      overlayGroups.append("rect")
        .attr("x", colX)
        .attr("y", 0)
        .attr("width", colWidth)
        .attr("height", height - margin.top - margin.bottom)
        .attr("fill", "transparent")
        .style("cursor", "pointer")
        .style("pointer-events", "all") // Ensure it captures events
        .on("mouseover", function () {
          d3.select(this).attr("fill", "rgba(0, 123, 255, 0.05)");
          // Highlight Bar
          const bar = svg.select(`.monthly-bar-${dateStr}`); // Use string date for class
          if (bar.node()) bar.attr("fill", "#2e7d32"); // Darker/Vivid Green (Matches screenshot)
        })
        .on("mouseout", function () {
          d3.select(this).attr("fill", "transparent");
          // Reset Bar
          const bar = svg.select(`.monthly-bar-${dateStr}`); // Use string date for class
          if (bar.node()) bar.attr("fill", "#69b3a2"); // Original Green
        })
        .on("click", () => {
          window.open(searchUrl, '_blank');
        })
        .append("title")
        .text(`${dateStr}\nCount: ${d.count.toLocaleString()}`);
    });

    // 4. Bars
    svg.selectAll("rect.monthly-bar")
      .data(data)
      .enter()
      .append("rect")
      // d.date might be Date or String. Use safe conversion.
      .attr("class", (d: any) => `monthly-bar monthly-bar-${(d.date instanceof Date) ? d.date.toLocaleDateString('en-CA') : d.date}`)
      .attr("x", (d: any) => x((d.date instanceof Date) ? d.date.toLocaleDateString('en-CA') : d.date) ?? 0)
      .attr("y", (d: any) => y(d.count))
      .attr("width", x.bandwidth())
      .attr("height", (d: any) => height - margin.top - margin.bottom - y(d.count))
      .attr("fill", "#69b3a2")
      .style("pointer-events", "none") // Let clicks pass through to overlays
      .append("title")
      .text((d: any) => `${(d.date instanceof Date) ? d.date.toLocaleDateString('en-CA') : d.date}: ${d.count} posts`);

    // 5. Render Stars (Milestones) - Render AFTER bars and overlays
    if (milestones && milestones.length > 0) {
      // Group milestones by month for stacking
      const milestonesByMonth: Record<string, any[]> = {};
      milestones.forEach((m: any) => {
        // Filter milestones: show only #1 and multiples of 1000
        if (!m.post) return;
        if (m.milestone !== 1 && m.milestone % 1000 !== 0) return;

        const pDate = new Date(m.post.created_at);
        // Use local date methods to match fetchMonthlyCounts buckets
        const mKey = `${pDate.getFullYear()}-${String(pDate.getMonth() + 1).padStart(2, '0')}-01`; // Match string format
        if (!milestonesByMonth[mKey]) milestonesByMonth[mKey] = [];
        milestonesByMonth[mKey].push(m);
      });

      const starGroups = svg.append("g").attr("class", "di-milestone-stars");

      data.forEach((d) => {
        // Use local date methods for consistent matching
        const mKey = (d.date instanceof Date) ? d.date.toISOString().slice(0, 10) : d.date;
        const monthMilestones = milestonesByMonth[mKey];

        if (monthMilestones) {
          const bx = (x(d.date) ?? 0) + x.bandwidth() / 2;

          monthMilestones.forEach((m: any, si: number) => {
            // Position stars inside the plot area, stacking downwards
            const starY = 12 + (si * 14);

            let fill = '#ffd700';
            let stroke = '#b8860b';
            let animClass = '';
            let fontSize = '12px';

            // m.milestone is the target number (1, 1000, 2000...)
            if (m.milestone === 1) {
              fill = '#00e676'; // Green for #1
              stroke = '#00a050';
            } else if (m.milestone % 10000 === 0) {
              fill = '#ffb300'; // Deep Gold
              animClass = 'star-shiny';
              fontSize = '15px';
            }

            const star = starGroups.append("a")
              .attr("href", `${window.location.origin}/posts/${m.post.id}`)
              .attr("target", "_blank")
              .style("text-decoration", "none")
              .append("text")
              .attr("class", animClass)
              .attr("x", bx)
              .attr("y", starY)
              .attr("text-anchor", "middle")
              .attr("dominant-baseline", "central")
              .attr("font-size", fontSize)
              .attr("fill", fill)
              .attr("stroke", stroke)
              .attr("stroke-width", "0.5")
              .style("cursor", "pointer")
              .style("filter", "drop-shadow(0px 1px 1px rgba(0,0,0,0.3))")
              .style("pointer-events", "all")
              .text("★");

            star.append("title")
              .text(`Milestone #${m.milestone} (${new Date(m.post.created_at).toLocaleDateString()})`);
          });
        }
      });
    }

    // X Axis
    const xAxis = d3.axisBottom(x)
      .tickValues(x.domain().filter(d => new Date(d).getMonth() === 0)) // Parse string to Date for month check
      .tickFormat(d => d3.timeFormat("%Y")(new Date(d))); // Parse string to Date for formatting

    svg.append("g")
      .attr("transform", `translate(0,${height - margin.top - margin.bottom})`)
      .call(xAxis);

    // Scroll to end (Present) logic - do after render
    setTimeout(() => {
      if (scrollWrapper) scrollWrapper.scrollLeft = scrollWrapper.scrollWidth;
    }, 50);
  }

  /**
   * Renders a cumulative area chart using D3.js.
   * @param {!Array<{date: string, count: number, cumulative: number}>} data The data to render.
   * @param {string} selector The CSS selector for the container.
   * @param {string} title The title of the chart.
   */
  renderAreaChart(data: any[], selector: string, title: string) {
    const container = document.querySelector(selector) as HTMLElement | null;
    if (!container) return;
    container.innerHTML = "";

    // Ensure container is positioned for absolute tooltip logic if used relative
    // But we will use body for tooltip to avoid clipping
    container.style.position = 'relative';

    // 1. Static Title
    const titleEl = document.createElement("div");
    titleEl.textContent = title;
    titleEl.style.fontSize = "14px";
    titleEl.style.fontWeight = "bold";
    titleEl.style.color = "#444";
    titleEl.style.marginBottom = "5px";
    titleEl.style.textAlign = "left"; // Left aligned
    titleEl.style.borderLeft = "4px solid #007bff";
    titleEl.style.paddingLeft = "10px";
    container.appendChild(titleEl);

    const width = container.getBoundingClientRect().width;
    const margin = { top: 30, right: 30, bottom: 40, left: 50 };

    if (width <= margin.left + margin.right) {
      console.warn("[TagAnalyticsApp] Container too narrow for chart, skipping render.");
      return;
    }

    const height = 300;

    const svg = d3.select(selector)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleTime()
      .domain(d3.extent(data, (d: any) => new Date(d.date)) as [Date, Date])
      .range([0, width - margin.left - margin.right]);

    const y = d3.scaleLinear()
      .domain([0, d3.max(data, (d: any) => d.cumulative) ?? 0])
      .nice()
      .range([height - margin.top - margin.bottom, 0]);

    // Area
    svg.append("path")
      .datum(data)
      .attr("fill", "#cce5df")
      .attr("stroke", "#69b3a2")
      .attr("stroke-width", 1.5)
      .attr("d", (d3.area() as any)
        .x((d: any) => x(new Date(d.date)))
        .y0(y(0))
        .y1((d: any) => y(d.cumulative))
      );

    // X Axis
    svg.append("g")
      .attr("transform", `translate(0,${height - margin.top - margin.bottom})`)
      .call(d3.axisBottom(x)
        .tickFormat(d => {
          // D3 time scale uses Date objects for ticks.
          // We want YYYY-MM-DD local string if possible, or just YYYY if not enough space?
          // Actually user asked for YYYY-MM-DD.
          // But for Axis labels, YYYY is usually better for long history.
          // Let's stick to YYYY for Axis as per original code, but Tooltip MUST be YYYY-MM-DD.
          return d3.timeFormat("%Y")(d as Date);
        }));

    // Y Axis
    svg.append("g").call(d3.axisLeft(y));

    // Title - MOVED TO HTML ABOVE

    // --- Interactive Tooltip ---

    // Focus indicator (Circle + Line)
    const focus = svg.append("g")
      .attr("class", "focus")
      .style("display", "none");

    focus.append("circle")
      .attr("r", 5)
      .attr("fill", "#69b3a2")
      .attr("stroke", "#fff")
      .attr("stroke-width", 2);

    // Detailed Tooltip - Append to BODY to avoid clipping
    // Remove existing if any
    d3.select("body").selectAll(".tag-analytics-tooltip").remove();

    const tooltip = d3.select("body")
      .append("div")
      .attr("class", "tag-analytics-tooltip")
      .style("position", "absolute")
      .style("z-index", "11000") // Corrected Z-Index (Higher than modal)
      .style("background", "rgba(0, 0, 0, 0.8)")
      .style("color", "#fff")
      .style("padding", "8px")
      .style("border-radius", "4px")
      .style("font-size", "12px")
      .style("pointer-events", "none")
      .style("opacity", 0)
      .style("transition", "opacity 0.2s");

    // Overlay recto to capture events
    svg.append("rect")
      .attr("class", "overlay")
      .attr("width", width - margin.left - margin.right)
      .attr("height", height - margin.top - margin.bottom)
      .style("fill", "none")
      .style("pointer-events", "all")
      .on("mouseover", () => {
        focus.style("display", null);
        tooltip.style("opacity", 1);
      })
      .on("mouseout", () => {
        focus.style("display", "none");
        tooltip.style("opacity", 0);
      })
      .on("mousemove", (event) => {
        try {
          const bisectDate = d3.bisector((d: any) => new Date(d.date)).left;
          // Use pointer relative to SVG g element (which has margins)
          // But event is relative to page or viewport? 
          // d3.pointer(event) returns [x, y] relative to current element
          const [mx] = d3.pointer(event);
          const x0 = x.invert(mx);

          const i = bisectDate(data, x0, 1);
          const d0 = data[i - 1];
          const d1 = data[i];

          let d = d0;
          if (d1 && d0) {
            const date0 = new Date(d0.date);
            const date1 = new Date(d1.date);
            d = ((x0 as any) - date0.getTime() > date1.getTime() - (x0 as any)) ? d1 : d0;
          } else if (d1) {
            d = d1;
          }

          if (!d) return;

          const dateObj = new Date(d.date);
          const dateStr = dateObj.toLocaleDateString('en-CA');

          focus.attr("transform", `translate(${x(dateObj)},${y(d.cumulative)})`);

          // Smart layout for tooltip
          let left = event.pageX + 15;
          let top = event.pageY - 28;

          if (left + 150 > document.documentElement.clientWidth) {
            left = event.pageX - 160;
          }

          tooltip
            .html(`<strong>${dateStr}</strong><br>Cumulative: ${d.cumulative.toLocaleString()}`)
            .style("left", left + "px")
            .style("top", top + "px");
        } catch (e) {
          // console.warn(e);
        }
      });
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

  async fetchTagData(tagName: string): Promise<any> {
    try {
      // use name_matches to find the exact tag
      const url = `/tags.json?search[name_matches]=${encodeURIComponent(tagName)}`;
      const resp = await fetch(url).then(r => r.json());

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

  renderRankingColumn(title: string, data: any[], role: string, tagName: string, limitId: string | number | null = null): string {
    if (!data || data.length === 0) {
      return `
          <div class="di-card-sm">
              <h4 style="margin: 0 0 10px 0; font-size: 0.9em; color: #555; text-align: center; border-bottom: 1px solid #ddd; padding-bottom: 5px;">${title}</h4>
              <div style="text-align: center; color: #999; font-size: 0.8em; padding: 20px 0;">No Data</div>
          </div>`;
    }

    const maxCount = Math.max(...data.map((u: any) => u.count || u.post_count || 0));

    const list = data.slice(0, 10).map((u: any, i: number) => {
      let nameHtml = 'Unknown';
      const name = u.name || `user_${u.id} `;
      // Normalize name: replace spaces with underscores for search query
      const normalizedName = name.replace(/ /g, '_');

      // Level Lookup: Check object first, then instance cache (ID -> Object), then instance cache (Name -> Object)
      const userCached = this.userNames[String(u.id)] || this.userNames[name];
      const level = u.level || (userCached && typeof userCached === 'object' ? userCached.level : null);
      const userClass = this.getLevelClass(level);

      let query = '';
      if (role && tagName) {
        // user:name+tag or approver:name+tag
        // "uploader" -> "user", "approver" -> "approver"
        const queryRole = role === 'uploader' ? 'user' : role;
        query = `${queryRole}:${normalizedName} ${tagName} `;
        if (limitId) {
          query += `id:..${limitId} `;
        }
      }

      const safeName = escapeHtml(name);
      if (query) {
        nameHtml = `<a href="/posts?tags=${encodeURIComponent(query)}" target="_blank" class="di-ranking-username ${userClass}" style="text-decoration: none;">${safeName}</a>`;
      } else if (u.id) {
        // Fallback
        nameHtml = `<a href="/users/${u.id}" target="_blank" class="di-ranking-username ${userClass}" style="text-decoration: none;">${safeName}</a>`;
      } else {
        nameHtml = `<span class="di-ranking-username ${userClass}" style="cursor: default;">${safeName}</span>`;
      }

      const count = u.count || u.post_count || 0;
      const percentage = maxCount > 0 ? (count / maxCount) * 100 : 0;

      return `
          <div style="display: flex; justify-content: space-between; font-size: 0.85em; padding: 3px 5px; border-bottom: 1px solid #f5f5f5; background: linear-gradient(90deg, rgba(0,0,0,0.06) ${percentage}%, transparent ${percentage}%);">
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px;" title="${safeName}">${i + 1}. ${nameHtml}</span>
              <span style="color: #666; font-weight: bold;">${count}</span>
          </div>`;
    }).join('');

    return `
      <div class="di-card-sm">
          <h4 style="margin: 0 0 10px 0; font-size: 0.9em; color: #555; text-align: center; border-bottom: 1px solid #ddd; padding-bottom: 5px;">${title}</h4>
          <div>${list}</div>
      </div>`;
  }

  getLevelClass(level: string | null): string {
    if (!level) return 'user-member';
    const l = level.toLowerCase();
    if (l.includes('admin') || l.includes('owner')) return 'user-admin';
    if (l.includes('moderator')) return 'user-moderator';
    if (l.includes('builder') || l.includes('contributor') || l.includes('approver')) return 'user-builder';
    if (l.includes('platinum')) return 'user-platinum';
    if (l.includes('gold')) return 'user-gold';
    if (l.includes('member')) return 'user-member';
    return 'user-member';
  }

  updateRankingTabs(role: string, tagData: any): void {
    const container = document.getElementById('ranking-container');
    if (!container || !tagData.rankings || !tagData.rankings[role]) return;

    const rData = tagData.rankings[role];
    console.log('[TagAnalytics] updateRankingTabs - hundredthPost:', tagData.hundredthPost);
    const limitId = tagData.hundredthPost ? tagData.hundredthPost.id : null;

    container.innerHTML = `
          ${this.renderRankingColumn('All-time', rData.allTime, role, tagData.name)}
          ${this.renderRankingColumn('Last 1 Year', rData.year, role, tagData.name)}
          ${this.renderRankingColumn('First 100 Post', rData.first100, role, tagData.name, limitId)}
`;
  }
}
