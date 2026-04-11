import {CONFIG} from '../config';
import {RateLimitedFetch} from './rate-limiter';
import type {Metric, MetricData, TargetUser, GrassSettings} from '../types';

/** A daily count entry stored in IndexedDB. */
interface DailyEntry {
  id: string;
  userId: string;
  date: string;
  count: number;
}

/** An approval detail entry stored in IndexedDB. */
interface ApprovalDetailEntry {
  id: string;
  userId: string;
  post_list: number[];
}

/** An hourly stats entry stored in IndexedDB. */
interface HourlyStatEntry {
  id: string;
  userId: string;
  metric: Metric;
  year: number;
  hour: number;
  count: number;
}

/** A raw API item with dynamic shape from Danbooru endpoints. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ApiItem = Record<string, any>;

/**
 * Handles API requests and caching via Dexie.js.
 */
export class DataManager {
  baseUrl: string;
  // Dexie instance typed as any: dynamic schema accessed via table names at runtime
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  rateLimiter: RateLimitedFetch;

  /**
   * Initializes the DataManager.
   * @param {Database} db The Dexie database instance.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(db: any, rateLimiter: RateLimitedFetch | null = null) {
    this.baseUrl = window.location.origin;
    this.db = db;
    // Allow passing shared rate limiter, fallback to default if missing (though app should pass it)
    const rl = CONFIG.RATE_LIMITER;
    this.rateLimiter = rateLimiter || new RateLimitedFetch(rl.concurrency, rl.jitter, rl.rps);
  }

  /**
   * Fetches detail data for a single post (for hover preview cards). Uses a
   * minimal `only` parameter and returns the raw API response object.
   *
   * @param postId The post ID
   * @return The raw API post object, or null on failure
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async fetchPostDetails(postId: number): Promise<any | null> {
    try {
      const url = `/posts/${postId}.json?only=id,created_at,score,fav_count,rating,variants,preview_file_url,tag_string_artist,tag_string_copyright,tag_string_character`;
      const resp = await this.rateLimiter.fetch(url);
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data && data.id) return data;
    } catch (e) {
      console.warn(`[fetchPostDetails] failed for post ${postId}:`, e);
    }
    return null;
  }

  /**
   * Retrieves cached statistics for a given user and key.
   * @param {string} key The unique key for the stats (e.g., 'rating_dist').
   * @param {string|number} userId The user's ID.
   * @return {Promise<unknown>} The cached data or null if not found.
   */
  async getStats(key: string, userId: string | number): Promise<unknown> {
    try {
      const record = await this.db.piestats.get({ key, userId });
      if (record) {
        // Optional: Check expiration if we wanted strictly time-based,
        // but user said "expire on full reset", so we effectively trust cache until reset.
        return record.data;
      }
      return null;
    } catch (e: unknown) {
      console.warn('Failed to load stats cache', e);
      return null;
    }
  }

  /**
   * Saves statistics to the cache.
   * @param {string} key The unique key for the stats.
   * @param {string|number} userId The user's ID.
   * @param {unknown} data The data to cache.
   * @return {Promise<void>}
   */
  async saveStats(key: string, userId: string | number, data: unknown): Promise<void> {
    try {
      await this.db.piestats.put({
        key,
        userId,
        data,
        updated_at: new Date().toISOString()
      });
    } catch (e: unknown) {
      console.warn('Failed to save stats cache', e);
    }
  }

  /**
   * Retrieves GrassApp layout settings for a specific user.
   * @param {string|number} userId The user's ID.
   * @return {Promise<GrassSettings|null>} The settings (width, xOffset) or null.
   */
  async getGrassSettings(userId: string | number): Promise<GrassSettings | null> {
    if (!userId) return null;
    try {
      return await this.db.grass_settings.get(userId.toString());
    } catch (e: unknown) {
      console.warn('Failed to load grass settings', e);
      return null;
    }
  }

  /**
   * Saves GrassApp layout settings for a specific user.
   * @param {string|number} userId The user's ID.
   * @param {Record<string, unknown>} settings The settings to save.
   * @return {Promise<void>}
   */
  async saveGrassSettings(userId: string | number, settings: Record<string, unknown>): Promise<void> {
    if (!userId) return;
    try {
      await this.db.grass_settings.put({
        userId: userId.toString(),
        ...settings,
        updated_at: new Date().toISOString()
      });
    } catch (e: unknown) {
      console.warn('Failed to save grass settings', e);
    }
  }

  /**
   * Checks if a year is already marked as complete for a specific user and metric.
   * @param {string} userId
   * @param {Metric} metric
   * @param {number} year
   * @return {Promise<boolean>}
   */
  async checkYearCompletion(userId: string, metric: Metric, year: number): Promise<boolean> {
    const id = `${userId}_${metric}_${year}`;
    try {
      const record = await this.db.completed_years.get(id);
      return !!record;
    } catch (e: unknown) {
      console.warn('Failed to check completion status', e);
      return false;
    }
  }

  /**
   * Marks a year as complete for a specific user and metric.
   * @param {string} userId
   * @param {Metric} metric
   * @param {number} year
   */
  async markYearComplete(userId: string, metric: Metric, year: number): Promise<void> {
    try {
      await this.db.completed_years.put({
        id: `${userId}_${metric}_${year}`,
        userId,
        metric,
        year,
        timestamp: Date.now()
      });

    } catch (e: unknown) {
      console.warn('Failed to mark year complete', e);
    }
  }

  /**
   * Fetches metric data for a specific year, leveraging caching and efficient fetching strategies.
   * Supports 'uploads', 'approvals', and 'notes' metrics.
   *
   * @param {Metric} metric - The metric type ('uploads' | 'approvals' | 'notes').
   * @param {TargetUser} userInfo - The target user's profile information.
   * @param {number} year - The specific year to fetch data for (e.g., 2026).
   * @param {Function|null} [onProgress=null] - Optional callback for reporting fetch progress (count).
   * @return {Promise<MetricData>} Returns an object containing daily counts map and hourly distribution array.
   */
  async getMetricData(metric: Metric, userInfo: TargetUser, year: number, onProgress: ((count: number) => void) | null = null): Promise<MetricData> {
    try {
      // Determine fetch configuration
      let endpoint = '';
      let storeName = '';
      let dateKey = 'created_at';
      let idKey = '';
      const startDate = `${year}-01-01`;
      const endDate = `${year + 1}-01-01`;

      // Params common to all; typed as Record for dynamic key assignment
      const params: Record<string, unknown> = {
        limit: 200,
      };

      const normalizedName = (userInfo.name || '').replace(/ /g, '_');
      // Hourly Stats: Initialize empty
      let hourlyCounts = new Array<number>(24).fill(0);

      switch (metric) {
        case 'uploads':
          endpoint = '/posts.json';
          storeName = 'uploads';
          dateKey = 'created_at';
          idKey = 'uploader_id';
          params['only'] = 'uploader_id,created_at';
          break;
        case 'approvals':
          endpoint = '/post_approvals.json';
          storeName = 'approvals';
          dateKey = 'created_at';
          idKey = 'user_id';
          params['search[user_id]'] = userInfo.id;
          params['only'] = 'id,post_id,created_at';
          break;
        case 'notes':
          if (!userInfo.id) throw new Error('User ID required for Notes');
          endpoint = '/note_versions.json';
          storeName = 'notes';
          dateKey = 'created_at';
          idKey = 'updater_id';
          params['search[updater_id]'] = userInfo.id;
          params['only'] = 'updater_id,created_at';
          break;
        default:
          return {} as MetricData;
      }

      const table = this.db[storeName];
      const userIdVal = userInfo.id || userInfo.name;
      // const idPrefix = `${userIdVal}_`; // unused

      // [New] Check Completion Cache
      const isYearCompleteCache = await this.checkYearCompletion(userIdVal, metric, year);
      if (isYearCompleteCache) {

      }

      // 0. Integrity Check (Past Years Only - Uploads Only)
      // Fix for partial data persistence issues
      let forceFullFetch = false;

      if (!isYearCompleteCache && metric === 'uploads' && year < new Date().getFullYear()) {
        try {
          // normalizedName is already defined above
          // Align Remote check to strict year (Dec 31st) to match Local check
          const strictEndDate = `${year + 1}-01-01`;
          const checkRange = `${startDate}...${strictEndDate}`;
          const queryTags = `user:${normalizedName} date:${checkRange}`;

          // A. Remote Count
          const remoteCount = await this.fetchRemoteCount(queryTags);

          // B. Local Count
          // Align Local check to match Remote (wide) range
          const matchedEndDate = `${year}-12-31`;

          // Cursor iteration: sum counts without loading all records into memory
          let localCount = 0;
          await table.where('id')
            .between(
              `${userIdVal}_${startDate}`,
              `${userIdVal}_${matchedEndDate}\uffff`,
              true,
              true // Inclusive to match Remote's "..." behavior on Jan 1st
            )
            .each((cur: ApiItem) => { localCount += cur['count'] || 0; });

          // C. Compare (Strict)
          if (remoteCount !== localCount) {
            console.warn(`[Danbooru Grass] Data mismatch detected for ${year} (Remote: ${remoteCount}, Local: ${localCount}). Forcing full sync.`);

            // Safe Deletion: Strictly perform deletion up to Dec 31st of the current year.
            // Previously, using endDate (Jan 1st next year) + \uffff caused "2025-01-01" to be deleted
            // because "2025-01-01" < "2025-01-01\uffff".
            const deleteEndDate = `${year}-12-31`;

            // Force fetch from start
            await table.where('id')
              .between(
                `${userIdVal}_${startDate}`,
                `${userIdVal}_${deleteEndDate}\uffff`,
                true,
                true // Inclusive: Delete up to Dec 31st fully.
              ).delete();

            forceFullFetch = true; // Flag to skip "lastEntry" check below
          } else {
            // Data is good using 'lastEntry' Logic below
          }
        } catch (e: unknown) {
          console.warn('[Danbooru Grass] Integrity check failed (Network/API), proceeding with cache.', e);
        }
      }

      // 1. Check for latest cached date for this user in this year
      // We use the ID range to efficiently find the last entry for this user.
      // ID format: "UserId_YYYY-MM-DD"
      let fetchFromDate = null; // Default to null (Fetch ALL if no cache)

      // Query range for this specific year to see where we left off
      let lastEntry: ApiItem | null = null;
      let existingHourlyStats: Array<{hour: number; count: number}> = []; // Store existing hourly stats for delta merging

      if (!forceFullFetch && !isYearCompleteCache) {
        lastEntry = await table.where('id')
          .between(
            `${userIdVal}_${startDate}`,
            `${userIdVal}_${year}-12-31\uffff`,
            true,
            true
          )
          .last();

        // Load existing hourly stats for delta merge
        existingHourlyStats = await this.db.hourly_stats.where('id')
          .between(`${userIdVal}_${metric}_${year}_00`, `${userIdVal}_${metric}_${year}_24`, true, false)
          .toArray();

        // Populate current hourlyCounts from DB
        if (existingHourlyStats.length > 0) {
          existingHourlyStats.forEach(stat => {
            if (stat.hour >= 0 && stat.hour < 24) {
              hourlyCounts[stat.hour] = stat.count;
            }
          });
        }
      }

      if (lastEntry) {


        const lastDate = new Date(lastEntry['date']);
        const currentYear = new Date().getFullYear();

        // Check if this is a past year and we effectively have data up to the end
        const isYearComplete = year < currentYear;

        if (isYearComplete) {
          // If year is fully cached, DO NOT rollback 3 days.
          // Set to endDate so the optimization check passes.
          fetchFromDate = endDate;
        } else {
          // Normal Safety Buffer: Start fetching from 3 days prior
          lastDate.setDate(lastDate.getDate() - 3);
          const bufferDateStr = lastDate.toISOString().slice(0, 10);
          // Ensure we don't go before the year start IF using range queries
          // But for Approvals (no range), we just want the checkpoint.
          // For now, keeping logical consistency:
          // If fetching range-based, fetchFromDate needs to be valid.
          fetchFromDate = bufferDateStr;
        }
      }

      // Optimization: If cached up to Dec 31st of that year, and year is past, skip fetch.
      // Optimization Heuristic REMOVED.
      // Reason: It causes false positives when boundary data from the NEXT year (e.g., Jan 1st) exists.
      // We strictly rely on 'isYearCompleteCache' now.
      /*
      if (fetchFromDate && fetchFromDate >= endDate && year < new Date().getFullYear()) {


      } else {
      */
      {
        // Set API Params & Fetch Strategy
        let stopDate = null;
        const fetchDirection = 'desc';

        // hourlyCounts is already defined above

        // [Strategy B] Server-Side Range Filtering (Uploads, Notes, Approvals)
        // Use range query to strictly limit what the API returns.
        const rangeStart = fetchFromDate || startDate;
        const fetchRange = `${rangeStart}...${endDate}`;

        if (metric === 'uploads') {
          params['tags'] = `user:${normalizedName} date:${fetchRange}`;
        } else if (metric === 'notes') {
          params['search[created_at]'] = fetchRange;
        } else if (metric === 'approvals') {
          params['search[created_at]'] = fetchRange;
        }

        // Server limits the range, so we don't need client-side stopDate (redundant but harmless)
        stopDate = null;

        // 2. Fetch missing range
        if (!isYearCompleteCache) {


          // Pass explicit stopDate
          const items = await this.fetchAllPages(endpoint, params, stopDate, dateKey, fetchDirection, onProgress);


          // 3. Aggregate
          const dailyCounts: Record<string, {count: number; postList: number[]}> = {};

          items.forEach((item: ApiItem) => {
            const rawDate = item[dateKey] || item['created_at'];
            if (!rawDate) return;

            // Validation: Strict User ID Check
            if (
              userInfo.id &&
              item[idKey] &&
              String(item[idKey]) !== String(userInfo.id)
            ) {
              console.warn(`[Danbooru Grass] ID Mismatch! Expected: ${userInfo.id}, Got: ${item[idKey]}. Item Date: ${rawDate}`);
              return;
            }

            const dateStr = String(rawDate).slice(0, 10);
            if (!dailyCounts[dateStr]) {
              dailyCounts[dateStr] = { count: 0, postList: [] };
            }
            dailyCounts[dateStr].count += 1;
            if (item['post_id']) {
              dailyCounts[dateStr].postList.push(item['post_id']);
            }

            // Hourly Aggregation
            // Fix for Data Doubling:
            // We strictly only add to hourly_stats if the data is NEWER than what we already have.
            // Since existingHourlyStats (loaded from DB) already contains data up to lastEntry,
            // adding counts from the overlapped buffer period would double-count them.
            // Note: This effectively freezes the hourly distribution for the 'lastEntry' day (today)
            // until the next day, but this is preferable to corrupting the data with duplication.
            const isNewData = !lastEntry || String(rawDate).slice(0, 10) > lastEntry['date'];

            const itemDate = new Date(rawDate);
            const hour = itemDate.getHours();
            if (isNewData && !isNaN(hour) && hour >= 0 && hour < 24) {
              hourlyCounts[hour]++;
            }
          });

          // 4. Upsert into DB
          const bulkData: DailyEntry[] = [];
          const detailData: ApprovalDetailEntry[] = [];

          Object.entries(dailyCounts).forEach(([date, entry]) => {
            const id = `${userIdVal}_${date}`;
            bulkData.push({
              id,
              userId: userIdVal,
              date,
              count: entry.count,
            });

            if (metric === 'approvals') {
              detailData.push({
                id,
                userId: userIdVal,
                post_list: entry.postList,
              });
            }
          });

          // [Fix] Hourly Stats are already initialized from DB and incremented with new data.
          // We just need to save the current state of 'hourlyCounts' to the DB.
          const hourlyBulk: HourlyStatEntry[] = [];
          hourlyCounts.forEach((count, h) => {
            hourlyBulk.push({
              id: `${userIdVal}_${metric}_${year}_${String(h).padStart(2, '0')}`,
              userId: userIdVal,
              metric: metric,
              year: year,
              hour: h,
              count: count
            });
          });

          // Wrap all writes in a single transaction for atomicity
          await this.db.transaction('rw', [table, this.db.approvals_detail, this.db.hourly_stats], async () => {
            if (bulkData.length > 0) {
              await table.bulkPut(bulkData);
            }
            if (detailData.length > 0) {
              await this.db.approvals_detail.bulkPut(detailData);
            }
            await this.db.hourly_stats.bulkPut(hourlyBulk);
          });

          // Mark as complete if it's a past year
          if (year < new Date().getFullYear()) {
            await this.markYearComplete(userIdVal, metric, year);
          }
        }
      } // End else (fetch logic)


      // 5. Return Full Year Data from Cache
      const dataEndDate = `${year}-12-31`; // Strictly return data only for this year
      const fullYearData: DailyEntry[] = await table.where('id')
        .between(
          `${userIdVal}_${startDate}`,
          `${userIdVal}_${dataEndDate}\uffff`,
          true,
          true
        )
        .toArray();

      const resultMap: Record<string, number> = {};
      fullYearData.forEach((i) => resultMap[i.date] = i.count);

      // If cached complete, we need to load hourly stats from DB as we skipped the fetch block
      // (If not complete, we populated 'hourlyCounts' above during fetch/merge)
      // CHECK: If isYearCompleteCache is true, we must load.
      // If we fetched data (else block), hourlyCounts is already populated.
      if (isYearCompleteCache) {
        const cachedHourly: Array<{hour: number; count: number}> = await this.db.hourly_stats.where('id')
          .between(`${userIdVal}_${metric}_${year}_00`, `${userIdVal}_${metric}_${year}_24`, true, false)
          .toArray();

        // Reset and fill
        hourlyCounts = new Array<number>(24).fill(0);
        cachedHourly.forEach(stat => {
          if (stat.hour >= 0 && stat.hour < 24) {
            hourlyCounts[stat.hour] = stat.count;
          }
        });
      }

      return {daily: resultMap, hourly: hourlyCounts};

    } catch (e: unknown) {
      console.error('[Danbooru Grass] Data fetch failed:', e);
      throw e; // Propagate error to UI
    }
  }

  /**
   * Clears the cache for a specific metric and user.
   * @param {Metric} _metric 'uploads', 'approvals', or 'notes'.
   * @param {TargetUser} userInfo User info object.
   * @return {Promise<boolean>} True if successful.
   */
  async clearCache(_metric: Metric, userInfo: TargetUser): Promise<boolean> {
    try {
      const userIdVal = userInfo.id || userInfo.name;
      const tablesToClear = ['uploads', 'approvals', 'approvals_detail', 'notes', 'completed_years', 'hourly_stats'];



      for (const storeName of tablesToClear) {
        const table = this.db[storeName];
        // Delete all entries for this user in this store
        const items = await table.where('userId').equals(userIdVal).primaryKeys();
        if (items.length > 0) {
          await table.bulkDelete(items);

        }
      }

      return true;
    } catch (e: unknown) {
      console.error('[Danbooru Grass] Clear cache failed:', e);
      return false;
    }
  }


  /**
   * Fetches pages from an API endpoint until a stop condition is met.
   * Handles pagination and batching automatically.
   * @param {string} endpoint The API endpoint (e.g., '/posts.json').
   * @param {Record<string, unknown>} params Query parameters for the API.
   * @param {string|null} [stopDate=null] ISO Date string (YYYY-MM-DD). If encountered, stops fetching.
   * @param {string} [dateKey='created_at'] Key to check date against.
   * @param {string} [direction='desc'] Fetch direction ('desc' or 'asc').
   * @param {Function|null} [onProgress=null] Optional callback for reporting fetch progress (count).
   * @return {Promise<ApiItem[]>} List of all fetched items up to the stop condition.
   */
  async fetchAllPages(endpoint: string, params: Record<string, unknown>, stopDate: string | null = null, dateKey = 'created_at', direction = 'desc', onProgress: ((count: number) => void) | null = null): Promise<ApiItem[]> {
    let allItems: ApiItem[] = [];
    let page = 1;

    // [Modified] Dynamic Batch Size for Approvals
    const isApprovals = endpoint.includes('/post_approvals.json');
    const BATCH_SIZE = isApprovals ? 1 : 5;
    const DELAY_BETWEEN_BATCHES = 150;

    while (true) {
      const promises: Array<Promise<{page: number; data: ApiItem[]}>> = [];

      // 1. Prepare Batch Requests
      for (let i = 0; i < BATCH_SIZE; i++) {
        const currentPage = page + i;
        // URLSearchParams requires string values; params contains mixed types at runtime
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q = new URLSearchParams({
          ...params,
          page: currentPage
        } as unknown as Record<string, string>);
        const url = `${this.baseUrl}${endpoint}?${q.toString()}`;

        // [New] Fetch Task with Limit, Random Delay & Retry for Approvals
        const fetchTask = async (): Promise<{page: number; data: ApiItem[]}> => {
          // 1. Random Start Delay (Approvals Only)
          if (isApprovals) {
            const delay = Math.floor(Math.random() * 300) + 200; // 200~500ms
            await new Promise((r) => setTimeout(r, delay));
          }

          // 2. Retry Logic
          let attempt = 0;
          const backoff = [1000, 2000, 4000];

          while (true) {
            const resp = await this.rateLimiter.fetch(url);

            if (resp.status === 429 || resp.status >= 500) {
              if (attempt < backoff.length) {
                const waitMs = backoff[attempt];
                console.warn(`[Danbooru Grass] ${resp.status} on Page ${currentPage}. Retrying in ${waitMs}ms...`);
                await new Promise((r) => setTimeout(r, waitMs));
                attempt++;
                continue;
              } else {
                throw new Error(`HTTP ${resp.status} (Max Retries Exceeded)`);
              }
            }

            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            // Success
            return {
              page: currentPage,
              data: await resp.json()
            };
          }
        };

        promises.push(
          fetchTask().catch((e: unknown) => {
            console.error(`[Danbooru Grass] Critical Error on Page ${currentPage}:`, e);
            throw e; // Fail fast to prevent data corruption
          })
        );
      }

      // 2. Execute Batch
      const batchResults = await Promise.all(promises);

      // Sort results by page number to process in order
      batchResults.sort((a, b) => a.page - b.page);

      let finished = false;

      // 3. Process Results
      for (const res of batchResults) {
        const json = res.data;
        if (!Array.isArray(json) || json.length === 0) {
          finished = true;
          continue;
        }

        // Check for stopDate in this page
        if (stopDate) {
          for (const item of json) {
            const itemDate = (item[dateKey] || '').slice(0, 10);

            if (itemDate) {
              let shouldStop = false;
              if (direction === 'desc') {
                // Descending: Stop if item is OLDER (smaller) than stopDate
                if (itemDate < stopDate) shouldStop = true;
              } else {
                // Ascending: Stop if item is NEWER (larger) than stopDate
                if (itemDate > stopDate) shouldStop = true;
              }

              if (shouldStop) {
                finished = true;
                break; // Break item loop
              }
            }
            allItems.push(item);
          }
          if (finished) break; // Break page loop
        } else {
          allItems = allItems.concat(json);
        }

        if (onProgress) {
          onProgress(allItems.length);
        }

        if (json.length < (params['limit'] as number)) {
          finished = true;
        }
      }

      if (finished) break;

      page += BATCH_SIZE;
      if (page > 1000) {
        console.warn('[Danbooru Grass] Hit safety page limit.');
        break;
      }
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES));
    }
    return allItems;
  }

  /**
   * Fetches the promotion date (when user became Approver) if applicable.
   * @param {string} userName
   * @return {Promise<string|null>} Date string (YYYY-MM-DD) or null.
   */
  async fetchPromotionDate(userName: string): Promise<string | null> {
    try {
      // Cache Check (Simple in-memory or could use Settings)
      // For now, let's just fetch. It's rare.
      const encodedName = encodeURIComponent(userName);
      const url = `${this.baseUrl}/user_feedbacks.json?search[body_matches]=to+Approver&search[category]=neutral&search[hide_bans]=No&search[user_name]=${encodedName}&limit=1`;

      const resp = await this.rateLimiter.fetch(url);
      if (!resp.ok) return null;
      const json: ApiItem[] = await resp.json();

      if (Array.isArray(json) && json.length > 0) {
        return json[0]['created_at'] ? String(json[0]['created_at']).slice(0, 10) : null;
      }
      return null; // Not found (maybe invited differently or too old)
    } catch (e: unknown) {
      console.warn('Failed to fetch promotion date', e);
      return null;
    }
  }



  /**
   * Gets statistics about the cache usage across storage methods.
   * Calculates item counts and approximate byte sizes for IndexedDB and LocalStorage.
   * @return {Promise<{indexedDB: {count: number, size: number}, localStorage: {count: number, size: number}}>} Object containing count and size stats.
   */
  async getCacheStats(): Promise<{indexedDB: {count: number; size: number}; localStorage: {count: number; size: number}}> {
    const stats = {
      indexedDB: {
        count: 0,
        size: 0
      },
      localStorage: {
        count: 0,
        size: 0
      },
    };

    // 1. IndexedDB Stats
    try {
      const tables = ['uploads', 'approvals', 'notes'];
      for (const t of tables) {
        const c = await this.db[t].count();
        stats.indexedDB.count += c;
      }
      // Approximate size: navigator.storage (Origin total)
      if (navigator.storage && navigator.storage.estimate) {
        // StorageEstimate.usageDetails is non-standard; cast to access it
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const est = await navigator.storage.estimate() as any;
        if (est.usageDetails && est.usageDetails.indexedDB) {
          stats.indexedDB.size = est.usageDetails.indexedDB;
        } else {
          stats.indexedDB.size = est.usage; // Fallback to total origin usage
        }
      }
    } catch (e: unknown) {
      console.warn('Failed to get IDB stats', e);
    }

    // 2. LocalStorage Stats
    let lsCount = 0;
    let lsSize = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CONFIG.STORAGE_PREFIX)) {
        lsCount++;
        const val = localStorage.getItem(k);
        if (val) lsSize += (k.length + val.length) * 2;
      }
    }
    stats.localStorage.count = lsCount;
    stats.localStorage.size = lsSize;

    return stats;
  }

  /**
   * Fetches the total post count for a given tag query.
   * @param {string} tags Tag query string.
   * @return {Promise<number>} Total count.
   */
  async fetchRemoteCount(tags: string): Promise<number> {
    const url = `${this.baseUrl}/counts/posts.json?tags=${encodeURIComponent(tags)}`;
    const resp = await this.rateLimiter.fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json: ApiItem = await resp.json();
    return json['counts'] && typeof json['counts']['posts'] === 'number'
      ? json['counts']['posts']
      : 0;
  }


}
