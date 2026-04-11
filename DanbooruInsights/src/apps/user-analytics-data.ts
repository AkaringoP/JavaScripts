import {AnalyticsDataManager} from '../core/analytics-data-manager';
import type {Database} from '../core/database';
import type {ProfileContext} from '../core/profile-context';

/** Processed pie chart slice used for D3 rendering. */
export interface PieSlice {
  value: number;
  label: string;
  color: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: any; // DistributionItem | StatusItem | RatingItem
}

/**
 * Data service for UserAnalyticsApp.
 * Handles data fetching and coordination with AnalyticsDataManager.
 */
export class UserAnalyticsDataService {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Fetches all dashboard data in parallel.
   * @param context The profile context.
   * @return All data needed for the dashboard.
   */
  async fetchDashboardData(context: ProfileContext) {
    const dataManager = new AnalyticsDataManager(this.db);
    // context.targetUser is guaranteed non-null when called from UserAnalyticsApp
    // (main.ts validates via isValidProfile() before instantiation).
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const user = context.targetUser!;

    // NSFW State for milestones
    const nsfwKey = 'danbooru_grass_nsfw_enabled';
    const isNsfwEnabled = localStorage.getItem(nsfwKey) === 'true';

    // 1. Fetch Summary Stats first (Local DB) to get starting date for optimizations
    const summaryStats = await dataManager.getSummaryStats(user);
    const { firstUploadDate } = summaryStats;

    const [
      stats,
      total,
      distributions,
      topPosts,
      recentPopularPosts,
      randomPosts,
      milestones1k,
      scatterData,
      levelChanges,
      timelineMilestones,
      tagCloudGeneral,
      userStats,
      needsBackfill
    ] = await Promise.all([
      dataManager.getSyncStats(user),
      dataManager.getTotalPostCount(user),
      Promise.all([
        dataManager.getStatusDistribution(user, firstUploadDate),
        dataManager.getRatingDistribution(user, firstUploadDate), // Optimized with date range
        dataManager.getCharacterDistribution(user),
        dataManager.getCopyrightDistribution(user),
        dataManager.getFavCopyrightDistribution(user),
        dataManager.getBreastsDistribution(user),
        dataManager.getHairLengthDistribution(user),
        dataManager.getHairColorDistribution(user),
        dataManager.getGenderDistribution(user),
        dataManager.getCommentaryDistribution(user),
        dataManager.getTranslationDistribution(user)
      ]).then(([status, rating, char, copy, favCopy, breasts, hairL, hairC, gender, commentary, translation]) => ({
        status, rating, character: char, copyright: copy, fav_copyright: favCopy, breasts, hair_length: hairL, hair_color: hairC, gender, commentary, translation
      })),
      dataManager.getTopPostsByType(user),
      dataManager.getRecentPopularPosts(user),
      dataManager.getRandomPosts(user),
      dataManager.getMilestones(user, isNsfwEnabled, 1000),
      dataManager.getScatterData(user),
      dataManager.getLevelChangeHistory(user),
      dataManager.getTimelineMilestones(user),
      dataManager.getTagCloudData(user, 0), // General category pre-fetch
      dataManager.getUserStats(user),
      dataManager.needsPostMetadataBackfill(user)
    ]);

    return {
      stats,
      total,
      summaryStats,
      distributions,
      topPosts,
      recentPopularPosts,
      randomPosts,
      milestones1k,
      scatterData,
      levelChanges,
      timelineMilestones,
      tagCloudGeneral,
      userStats,
      needsBackfill,
      dataManager
    };
  }
}
