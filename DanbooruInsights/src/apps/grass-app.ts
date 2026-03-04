import {DataManager} from '../core/data-manager';
import {GraphRenderer} from '../ui/graph-renderer';
import type {Database} from '../core/database';
import type {SettingsManager} from '../core/settings';
import type {ProfileContext} from '../core/profile-context';
import type {Metric} from '../types';

/**
 * GrassApp: Encapsulates the contribution graph visualization logic.
 * Manages data fetching, processing, and rendering of the GitHub-style grass graph.
 */
export class GrassApp {
  db: Database;
  settings: SettingsManager;
  context: ProfileContext;

  /**
   * Initializes the GrassApp default instance.
   * @param {Database} db - The shared Dexie database instance.
   * @param {SettingsManager} settings - The settings manager instance.
   * @param {ProfileContext} context - The current profile context containing target user info.
   */
  constructor(db: Database, settings: SettingsManager, context: ProfileContext) {
    this.db = db;
    this.settings = settings;
    this.context = context;
  }

  /**
   * Main entry point to execute the contribution graph logic.
   * Handles UI injection, data loading, and interactive rendering.
   * @return {Promise<void>} Resolves when the initial render is complete.
   */
  async run() {

    const context = this.context;

    const dataManager = new DataManager(this.db);
    // We pass the Shared Settings instance to GraphRenderer
    const renderer = new GraphRenderer(this.settings, this.db);

    const userId = context.targetUser.id || context.targetUser.name;
    const injected = await renderer.injectSkeleton(dataManager, userId);
    if (!injected) {
      return;
    }

    let currentYear = new Date().getFullYear();
    let currentMetric: Metric = (this.settings.getLastMode(userId) || 'uploads') as Metric;

    const joinYear = context.targetUser.joinDate.getFullYear();
    const years = [];
    const startYear = Math.max(joinYear, 2005);
    for (let y = currentYear; y >= startYear; y--) years.push(y);

    const updateView = async () => {
      let availableYears = [...years]; // Default full list

      // Filter years for Approvals based on promotion date (UI Only)
      if (currentMetric === 'approvals') {
        const promoDate = await dataManager.fetchPromotionDate(context.targetUser.name);
        if (promoDate) {
          const promoYear = parseInt(promoDate.slice(0, 4), 10);
          availableYears = availableYears.filter(y => y >= promoYear);
          // Safety: If currentYear is older than promoYear, switch to promoYear
          if (currentYear < promoYear) {
            currentYear = promoYear;

          }
        }
      }



      const onYearChange = (y: number) => {
        currentYear = y;
        updateView();
      };

      renderer.setLoading(true);
      try {
        // Initial render for layout
        await renderer.renderGraph(
          {},
          currentYear,
          currentMetric,
          context.targetUser,
          availableYears,
          onYearChange,
          async () => {
            renderer.setLoading(true);
            await dataManager.clearCache(currentMetric, context.targetUser);
            updateView();
          }
        );

        renderer.updateControls(
          availableYears,
          currentYear,
          currentMetric,
          onYearChange,
          (newMetric) => {
            currentMetric = newMetric as Metric;
            // Save the new mode preference
            this.settings.setLastMode(userId, currentMetric);
            updateView();
          },
          /* onRefresh */
          async () => {
            renderer.setLoading(true);
            await dataManager.clearCache(currentMetric, context.targetUser);
            updateView();
          },
        );

        const onProgress = (count: number) => {
          renderer.setLoading(true, `Fetching... ${count} items`);
        };

        const data = await dataManager.getMetricData(
          currentMetric,
          context.targetUser,
          currentYear,
          onProgress
        );

        await renderer.renderGraph(
          data,
          currentYear,
          currentMetric,
          context.targetUser,
          availableYears,
          onYearChange,
          async () => {
            renderer.setLoading(true);
            await dataManager.clearCache(currentMetric, context.targetUser);
            updateView();
          }
        );
      } catch (e) {
        console.error(e);
        renderer.renderError(e.message || 'Unknown error occurred', () =>
          updateView()
        );
      } finally {
        renderer.setLoading(false);
      }
    };

    // Initial Load
    updateView();
  }
}
