import * as d3 from 'd3';
import {CONFIG} from '../config';
import {RateLimitedFetch} from '../core/rate-limiter';
import {isTopLevelTag, escapeHtml, getBestThumbnailUrl} from '../utils';
import type {Database} from '../core/database';
import type {SettingsManager} from '../core/settings';
import {TagAnalyticsDataService} from './tag-analytics-data';
import {TagAnalyticsChartRenderer} from './tag-analytics-charts';
import {dashboardFooterHtml} from '../ui/dashboard-footer';

export class TagAnalyticsApp {
  db: Database;
  settings: SettingsManager;
  tagName: string;
  rateLimiter: RateLimitedFetch;
  dataService: TagAnalyticsDataService;
  isFetching: boolean;
  chartRenderer: TagAnalyticsChartRenderer;

  /**
   * Initializes the TagAnalyticsApp.
   * @param {!Database} db The Dexie database instance.
   * @param {!SettingsManager} settings The settings manager instance.
   * @param {string} tagName The name of the tag to analyze.
   */
  constructor(db: Database, settings: SettingsManager, tagName: string, rateLimiter?: RateLimitedFetch) {
    this.db = db;
    this.settings = settings;
    this.tagName = tagName;
    const rl = CONFIG.RATE_LIMITER;
    this.rateLimiter = rateLimiter ?? new RateLimitedFetch(rl.concurrency, rl.jitter, rl.rps);
    this.dataService = new TagAnalyticsDataService(db, this.rateLimiter, tagName);
    this.chartRenderer = new TagAnalyticsChartRenderer();
    this.isFetching = false;
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
      const tagData = await this.dataService.fetchTagData(this.tagName);
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
        const isStale = age >= CONFIG.CACHE_EXPIRY_MS;
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
      this.dataService.cleanupOldCache();

      // [CACHE] Check Cache First
      const cachedData = await this.dataService.loadFromCache();
      let runDelta = false;
      let baseData = null;

      if (cachedData) {
        // Determine if Partial Sync is needed
        // Conditions:
        // 1. Time-based (Retention period expired? No, retention is for DELETION. Sync is for Update.)
        //    Actually, previous logic was: if record.updatedAt > 24h -> Partial Sync.
        // 2. Count-based: New posts >= Threshold

        const age = Date.now() - cachedData.updatedAt;
        const isTimeExpired = age >= CONFIG.CACHE_EXPIRY_MS;

        let postCountDiff = 0;
        try {
          const currentTagData = await this.dataService.fetchTagData(tagName);
          if (currentTagData) {
            const currentTotal = currentTagData.post_count;
            const cachedTotal = cachedData.post_count || 0;
            postCountDiff = Math.max(0, currentTotal - cachedTotal);
          }
        } catch (e) { console.warn("Failed to check post count diff", e); }

        const threshold = this.dataService.getSyncThreshold();
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
            const newPostCount24h = await this.dataService.fetchNewPostCount(tagName);

            const [latestPost, trendingPost, trendingPostNSFW] = await Promise.all([
              this.dataService.fetchLatestPost(tagName),
              this.dataService.fetchTrendingPost(tagName, false),
              this.dataService.fetchTrendingPost(tagName, true)
            ]);

            cachedData.latestPost = latestPost;
            cachedData.trendingPost = trendingPost;
            cachedData.trendingPostNSFW = trendingPostNSFW;
            cachedData.newPostCount = newPostCount24h;

            this.dataService.saveToCache(cachedData);
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
      const initialStats = await this.dataService.fetchInitialStats(tagName, baseData);

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
      const MAX_OPTIMIZED_POSTS = CONFIG.MAX_OPTIMIZED_POSTS;
      if (initialPosts && totalCount <= MAX_OPTIMIZED_POSTS && initialPosts.length >= totalCount) {

        this.injectAnalyticsButton(null, 0, "Calculating history... (0%)");

        // 2. Calculate History Locally
        const historyData = this.dataService.calculateHistoryFromPosts(initialPosts);

        // 3. Extract Milestones Locally
        const targets = this.dataService.getMilestoneTargets(totalCount);
        const milestones: {milestone: number; post: any}[] = [];
        targets.forEach(target => {
          const index = target - 1;
          if (initialPosts[index]) {
            milestones.push({ milestone: target, post: initialPosts[index] });
          }
        });

        // 4. Calculate Ratings & Rankings Locally
        this.injectAnalyticsButton(null, 15, "Calculating rankings... (15%)");
        const localStatsAllTime = this.dataService.calculateLocalStats(initialPosts);

        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const yearPosts = initialPosts.filter((p: any) => p.created_at && new Date(p.created_at) >= oneYearAgo);
        const localStatsYear = this.dataService.calculateLocalStats(yearPosts);

        const localStatsFirst100 = this.dataService.calculateLocalStats(initialPosts.slice(0, 100));

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
          trackSmall('Fetching status', this.dataService.fetchStatusCounts(tagName)),
          trackSmall('Fetching latest post', this.dataService.fetchLatestPost(tagName)),
          trackSmall('Finding trending post', this.dataService.fetchTrendingPost(tagName, false)),
          trackSmall('Finding trending NSFW', this.dataService.fetchTrendingPost(tagName, true)),
          trackSmall('Counting new posts', this.dataService.fetchNewPostCount(tagName)),
          trackSmall('Analyzing commentary', this.dataService.fetchCommentaryCounts(tagName)),
          this.dataService.backfillUploaderNames(initialPosts) // Ensure ALL posts have names backfilled
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
          const u = this.dataService.userNames[r.id];
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
                await isTopLevelTag(this.dataService.rateLimiter, tag) ? [tag, count] : null
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
        this.dataService.saveToCache(meta); // Save Small Tag Data

        const finalTime = performance.now();
        console.log(`[TagAnalytics] [Small Tag Optimization] Finished analysis for tag: ${tagName} (Category: ${meta.category}, Count: ${totalCount}) in ${(finalTime - t0).toFixed(2)}ms`);

        this.toggleModal(true);
        this.renderDashboard(meta);
        return;
      }

      // 2. Fetch Monthly Counts (History) & Milestones & Status/Rating Counts in parallel


      const milestoneTargets = this.dataService.getMilestoneTargets(totalCount);

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
      const statusPromise = measure('Status Counts', this.dataService.fetchStatusCounts(tagName));
      // const ratingPromise = measure('Rating Counts', this.dataService.fetchRatingCounts(tagName)); // Removed from Phase 1
      const latestPromise = measure('Latest Post', this.dataService.fetchLatestPost(tagName));
      const newPostPromise = measure('New Post Count', this.dataService.fetchNewPostCount(tagName));
      const trendingPromise = measure('Trending Post (SFW)', this.dataService.fetchTrendingPost(tagName, false));
      const trendingNsfwPromise = measure('Trending Post (NSFW)', this.dataService.fetchTrendingPost(tagName, true));

      // [OPTIMIZATION] Related Tags (Copyright/Character) - Queue immediately
      // Category 1=Artist, 3=Copyright, 4=Character
      let copyrightPromise = Promise.resolve(null);
      let characterPromise = Promise.resolve(null);

      if (meta.category === 1) { // Artist -> Fetch Copyright & Character
        copyrightPromise = measure('Related Copyrights', this.dataService.fetchRelatedTagDistribution(tagName, 3, totalCount));
        characterPromise = measure('Related Characters', this.dataService.fetchRelatedTagDistribution(tagName, 4, totalCount));
      } else if (meta.category === 3) { // Copyright -> Fetch Character
        characterPromise = measure('Related Characters', this.dataService.fetchRelatedTagDistribution(tagName, 4, totalCount));
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
        { id: 'commentary', label: 'Analyzing commentary status...', promise: measure('Commentary Status', this.dataService.fetchCommentaryCounts(tagName)) }
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

      const rankingPromise = this.dataService.fetchRankingsAndResolve(tagName, dateStr1Y, dateStrTomorrow, measure);

      let historyPromise, milestonesPromise, first100StatsPromise;

      if (runDelta && baseData) {
        // [DELTA] History
        const lastHistory = baseData.historyData[baseData.historyData.length - 1];
        const lastDate = lastHistory ? new Date(lastHistory.date) : startDate;
        const deltaStart = new Date(lastDate);
        deltaStart.setDate(deltaStart.getDate() - 7);

        historyPromise = this.dataService.fetchHistoryDelta(tagName, deltaStart, startDate)
          .then(delta => this.dataService.mergeHistory(baseData.historyData, delta));

        // [DELTA] Milestones
        milestonesPromise = historyPromise.then(fullHistory => {
          return this.dataService.fetchMilestonesDelta(tagName, totalCount, baseData.precalculatedMilestones, fullHistory)
            .then(delta => this.dataService.mergeMilestones(baseData.precalculatedMilestones, delta));
        });

        // [DELTA] First 100 Ranking
        if (baseData.rankings && baseData.rankings.uploader && baseData.rankings.uploader.first100) {
          (initialStats as any).first100Stats = {
            uploaderRanking: baseData.rankings.uploader.first100,
            approverRanking: baseData.rankings.approver.first100
          };
          first100StatsPromise = Promise.resolve((initialStats as any).first100Stats);
        } else {
          first100StatsPromise = Promise.resolve(this.dataService.calculateLocalStats(initialPosts || []));
        }

      } else {
        // [FULL]
        historyPromise = measure('Full History (Monthly)', this.dataService.fetchMonthlyCounts(tagName, startDate));
      }

      // Chain Backward Scan
      historyPromise = historyPromise.then(async (monthlyData: any) => {
        const forwardTotal = (monthlyData && monthlyData.length > 0) ? monthlyData[monthlyData.length - 1].cumulative : 0;
        let referenceTotal = meta.post_count;

        if (monthlyData.historyCutoff) {
          try {
            const cutoffUrl = `/counts/posts.json?tags=${encodeURIComponent(tagName)}+status:any+date:<${encodeURIComponent(monthlyData.historyCutoff)}`;
            const r = await this.rateLimiter.fetch(cutoffUrl).then((res: Response) => res.json());
            referenceTotal = (r && r.counts ? r.counts.posts : (r ? r.posts : 0)) || 0;
          } catch (e) {
            console.warn("Failed to fetch cutoff total, falling back to meta.post_count", e);
          }
        }


        console.log(`[TagAnalyticsApp] Reverse Scan Check: ForwardTotal=${forwardTotal}, ReferenceTotal=${referenceTotal}, NeedScan=${forwardTotal < referenceTotal}`);

        if (forwardTotal < referenceTotal && !runDelta) { // Disable Reverse Scan on Partial Sync
          this.injectAnalyticsButton(null, undefined, "Scanning history backwards...");
          const backwardResult = await this.dataService.fetchHistoryBackwards(tagName, startDate, referenceTotal, forwardTotal);

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

            const realInitialStats = await this.dataService.fetchInitialStats(tagName, null, true, earliestDateFound);
            if (realInitialStats) {
              firstPost = realInitialStats.firstPost;
              hundredthPost = realInitialStats.hundredthPost;
              timeToHundred = realInitialStats.timeToHundred;

              if (realInitialStats.initialPosts && realInitialStats.initialPosts.length > 0) {
                console.log('[TagAnalytics] Recalculating First 100 Rankings for older posts...');
                const newStats = this.dataService.calculateLocalStats(realInitialStats.initialPosts);
                realFirst100Stats = await this.dataService.resolveFirst100Names(newStats).catch(e => {
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
          return this.dataService.fetchMilestones(tagName, monthlyData || [], milestoneTargets);
        });
      }

      if (!first100StatsPromise) {
        first100StatsPromise = Promise.resolve(this.dataService.calculateLocalStats(initialPosts || []));
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
            return this.dataService.resolveFirst100Names(stats);
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
      const ratingCounts = await measure('Rating Counts', this.dataService.fetchRatingCounts(tagName, minDateStr));

      // --- 6. Backward History Scan --- (MOVED TO historyPromise CHAIN ABOVE)
      // The historyData and milestones returned from Promise.all are already fully corrected.

      console.timeEnd('TagAnalytics:Total');


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
      this.dataService.saveToCache(meta); // Save Full Tag Data
      this.toggleModal(true);
      this.renderDashboard(meta);
    } finally {
      this.isFetching = false;
    }
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

    const currentDays = this.dataService.getRetentionDays();
    const currentThreshold = this.dataService.getSyncThreshold();

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
        this.dataService.setRetentionDays(days);
        this.dataService.setSyncThreshold(threshold);

        popover.remove();
        document.removeEventListener('click', closeHandler);
        alert(`Settings Saved:\n- Retention: ${days} days\n- Sync Threshold: ${threshold} posts\n\nCleaning up old data now...`);
        this.dataService.cleanupOldCache(); // Run cleanup immediately
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
          <div style="background: white; border-radius: 8px; width: 80%; max-width: 800px; max-height: 90vh; position: relative; display: flex; flex-direction: column;">
              <button id="tag-analytics-close" style="position: absolute; top: 10px; right: 10px; background: none; border: none; font-size: 1.5rem; cursor: pointer; z-index: 10;">&times;</button>
              <div id="tag-analytics-content" style="padding: 20px; overflow-y: auto; flex: 1; min-height: 0; -webkit-overflow-scrolling: touch;">
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

    // Close on browser back button (mobile-friendly)
    window.addEventListener('popstate', () => {
      if (modal.style.display !== 'none' && history.state?.diModalOpen !== 'tag-analytics-modal') {
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

    if (show) {
      // Push history state for back button support
      if (history.state?.diModalOpen !== 'tag-analytics-modal') {
        history.pushState({diModalOpen: 'tag-analytics-modal'}, '', location.href);
      }
      modal.style.display = "flex";
      document.body.style.overflow = "hidden";
      const closeBtn = document.getElementById("tag-analytics-close");
      if (closeBtn) closeBtn.focus();
    } else {
      // If history state still belongs to us, route through history.back().
      // The popstate listener will re-enter this branch with state cleared.
      if (history.state?.diModalOpen === 'tag-analytics-modal') {
        history.back();
        return;
      }
      modal.style.display = "none";
      document.body.style.overflow = "";
      this.chartRenderer.cleanup();
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
   * Builds the dashboard header HTML: tag name, category badge, dates, NSFW toggle.
   */
  private buildDashboardHeader(tagData: any, titleColor: string, categoryLabel: string): string {
    return `
      <div class="di-tag-header" style="border-bottom: 1px solid #eee; padding-bottom: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end;">
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
    `;
  }

  /**
   * Builds the main grid HTML: Summary card (totals, trending thumbnails) +
   * Distribution card (pie chart tabs).
   */
  private buildMainGrid(tagData: any): string {
    const totalUploads = tagData.historyData && tagData.historyData.length > 0
      ? tagData.historyData.reduce((a: number, b: any) => a + b.count, 0).toLocaleString()
      : '0';

    const latestPostHtml = tagData.latestPost ? `
      <div class="di-nsfw-monitor di-hover-translate-up" data-rating="${tagData.latestPost.rating}" style="display: flex; flex-direction: column; align-items: center; width: 80px; flex-shrink: 0;">
         <div style="border: 1px solid #ddd; padding: 2px; border-radius: 4px; background: #fff; width: 100%; aspect-ratio: 1/1; display: flex; align-items: center; justify-content: center; overflow: hidden;">
            <a href="/posts/${tagData.latestPost.id}" target="_blank" style="display: block; width: 100%; height: 100%;">
                <img src="${getBestThumbnailUrl(tagData.latestPost)}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null;this.src='/favicon.ico';this.style.objectFit='contain';this.style.padding='4px';">
            </a>
         </div>
         <div style="font-size: 0.8em; font-weight: bold; color: #555; margin-top: 5px;">Latest</div>
         <div style="font-size: 0.7em; color: #999;">${tagData.latestPost.created_at.split('T')[0]}</div>
      </div>
    ` : '';

    const trendingSfwHtml = tagData.trendingPost ? `
      <div id="trending-post-sfw" class="di-nsfw-monitor di-hover-translate-up" data-rating="${tagData.trendingPost.rating}" style="display: flex; flex-direction: column; align-items: center; width: 80px; flex-shrink: 0;">
         <div style="border: 1px solid #ffd700; padding: 2px; border-radius: 4px; background: #fff; width: 100%; aspect-ratio: 1/1; display: flex; align-items: center; justify-content: center; overflow: hidden; box-shadow: 0 0 5px rgba(255, 215, 0, 0.3);">
            <a href="/posts/${tagData.trendingPost.id}" target="_blank" style="display: block; width: 100%; height: 100%;">
                  <img src="${getBestThumbnailUrl(tagData.trendingPost)}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null;this.src='/favicon.ico';this.style.objectFit='contain';this.style.padding='4px';">
            </a>
         </div>
         <div style="font-size: 0.75em; font-weight: bold; color: #e0a800; margin-top: 5px;">Trending(3d)</div>
         <div style="font-size: 0.7em; color: #999;">Score: ${tagData.trendingPost.score}</div>
      </div>
    ` : '';

    const trendingNsfwHtml = tagData.trendingPostNSFW ? `
      <div id="trending-post-nsfw" class="di-nsfw-monitor di-hover-translate-up" data-rating="${tagData.trendingPostNSFW.rating}" style="display: none; flex-direction: column; align-items: center; width: 80px; flex-shrink: 0;">
         <div style="border: 1px solid #ff4444; padding: 2px; border-radius: 4px; background: #fff; width: 100%; aspect-ratio: 1/1; display: flex; align-items: center; justify-content: center; overflow: hidden; box-shadow: 0 0 5px rgba(255, 0, 0, 0.3);">
            <a href="/posts/${tagData.trendingPostNSFW.id}" target="_blank" style="display: block; width: 100%; height: 100%;">
                  <img src="${getBestThumbnailUrl(tagData.trendingPostNSFW)}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null;this.src='/favicon.ico';this.style.objectFit='contain';this.style.padding='4px';">
            </a>
         </div>
         <div style="font-size: 0.75em; font-weight: bold; color: #cc0000; margin-top: 5px;">Trending(NSFW)</div>
         <div style="font-size: 0.7em; color: #999;">Score: ${tagData.trendingPostNSFW.score}</div>
      </div>
    ` : '';

    const extraPieTabsHtml = `
      ${tagData.copyrightCounts ? `<button class="di-pie-tab" data-type="copyright">Copyright</button>` : ''}
      ${tagData.characterCounts ? `<button class="di-pie-tab" data-type="character">Character</button>` : ''}
      ${tagData.commentaryCounts ? `<button class="di-pie-tab" data-type="commentary">Commentary</button>` : ''}
    `;

    return `
      <!-- Main Grid: Summary & Distribution -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 30px;">
           <!-- Summary Card -->
           <div class="di-card di-flex-col-between" style="min-height: 180px; position: relative;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                  <div>
                      <div style="font-size: 0.9em; color: #666; font-weight: bold; margin-bottom: 5px;">Total Uploads</div>
                      <div style="font-size: 2.2em; font-weight: bold; color: #007bff; line-height: 1.1;">${totalUploads}</div>
                      <div style="font-size: 0.8em; color: #28a745; margin-top: 5px;">
                          +${tagData.newPostCount || 0} <span style="color: #999; font-weight: normal;">(24h)</span>
                      </div>
                  </div>
                  <!-- Right Side: Latest & Trending -->
                  <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end;">
                      ${latestPostHtml}
                      ${trendingSfwHtml}
                      ${trendingNsfwHtml}
                  </div>
              </div>
           </div>

           <!-- Distribution Card -->
           <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; min-height: 180px; position: relative; display: flex; flex-direction: column;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                 <div style="font-size: 0.9em; color: #666; font-weight: bold;">Distribution</div>
                 <div class="pie-tabs" style="display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end;">
                    <button class="di-pie-tab active" data-type="status">Status</button>
                    <button class="di-pie-tab" data-type="rating">Rating</button>
                    ${extraPieTabsHtml}
                 </div>
              </div>
              <div id="status-pie-chart-wrapper" style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; opacity: 0; transition: opacity 0.5s;">
                 <div id="status-pie-chart" style="width: 120px; height: 120px; flex-shrink: 0;"></div>
                 <div id="status-pie-legend" style="margin-left: 15px; font-size: 0.75em; flex: 1; min-width: 140px; max-height: 140px; overflow-y: auto; padding-right: 10px;"></div>
              </div>
              <div id="status-pie-loading" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #888; font-size: 0.8em;">Loading data...</div>
           </div>
      </div>
    `;
  }

  /**
   * Builds the user rankings section HTML: uploader/approver tab bar + ranking columns.
   */
  private buildRankingsSection(tagData: any): string {
    if (!tagData.rankings) return '';
    console.log('[TagAnalytics] renderDashboard - Initial Render - hundredthPost:', tagData.hundredthPost);
    const hundredthPostId = tagData.hundredthPost ? tagData.hundredthPost.id : null;
    return `
      <div style="margin-bottom: 30px;">
           <div style="border-bottom: 2px solid #eee; margin-bottom: 15px; display: flex; gap: 20px; align-items: center;">
              <h3 style="margin: 0; padding-bottom: 10px; font-size: 1.2em; color: #444; border-bottom: 3px solid #007bff; margin-bottom: -2px;">User Rankings</h3>
              <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                  <button class="rank-tab active" data-role="uploader" style="border: none; background: none; font-weight: bold; color: #007bff; cursor: pointer; padding: 5px 10px;">Uploaders</button>
                  <button class="rank-tab" data-role="approver" style="border: none; background: none; font-weight: normal; color: #888; cursor: pointer; padding: 5px 10px;">Approvers</button>
              </div>
           </div>
           <div id="ranking-container" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
              ${this.chartRenderer.renderRankingColumn('All-time', tagData.rankings.uploader.allTime, 'uploader', tagData.name, this.dataService.userNames)}
              ${this.chartRenderer.renderRankingColumn('Last 1 Year', tagData.rankings.uploader.year, 'uploader', tagData.name, this.dataService.userNames)}
              ${this.chartRenderer.renderRankingColumn('First 100 Post', tagData.rankings.uploader.first100, 'uploader', tagData.name, this.dataService.userNames, hundredthPostId)}
           </div>
      </div>
    `;
  }

  /**
   * Builds the bottom sections HTML: milestones container + charts container.
   */
  private buildBottomSections(): string {
    return `
      <!-- Milestones Container -->
      <div id="tag-analytics-milestones" style="margin-bottom: 30px; display:none;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px;">
              <h2 style="color: #444; border-left: 4px solid #ffc107; padding-left: 10px; margin: 0;">Milestones</h2>
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
      ${this.buildDashboardHeader(tagData, titleColor, categoryLabel)}
      ${this.buildMainGrid(tagData)}
      ${this.buildRankingsSection(tagData)}
      ${this.buildBottomSections()}
      ${dashboardFooterHtml()}
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
      this.chartRenderer.renderHistoryCharts(data, this.tagName, tagData.precalculatedMilestones);

      // Milestones Logic
      const milestonesContainer = document.getElementById('tag-analytics-milestones');
      if (milestonesContainer) {
        milestonesContainer.style.display = 'block';

        // Use totalCount from meta (tagData)
        const targets = this.dataService.getMilestoneTargets(tagData.post_count);
        const nextTarget = this.dataService.getNextMilestoneTarget(tagData.post_count);
        const nextInfo = {totalPosts: tagData.post_count, nextTarget};

        if (tagData.precalculatedMilestones) {
          this.chartRenderer.renderMilestones(tagData.precalculatedMilestones, () => this.updateNsfwVisibility(), nextInfo);
        } else {
          // Pass tagName, totalCount, targets
          this.dataService.fetchMilestones(tagData.name, [], targets).then((milestonePosts: any) => {
            this.chartRenderer.renderMilestones(milestonePosts, () => this.updateNsfwVisibility(), nextInfo);
          });
        }
      }
      // Pie Chart Initial Render & Tab Switching
      if (tagData.statusCounts && tagData.ratingCounts) {
        const type = 'status'; // Initial type
        this.chartRenderer.renderPieChart(type, tagData);

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
            this.chartRenderer.renderPieChart(newType ?? 'status', tagData);
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

            this.chartRenderer.updateRankingTabs(role ?? 'uploader', tagData, this.dataService.userNames);
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

}
