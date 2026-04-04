import {CONFIG} from '../config';
import type {Metric, SettingsData} from '../types';

/**
 * Manages user settings and persistence using localStorage.
 */
export class SettingsManager {
  key: string;
  defaults: SettingsData;
  settings: SettingsData;

  /**
   * Initializes the SettingsManager, loading existing settings or defaults.
   */
  constructor() {
    /**
     * The key used to store settings in localStorage.
     * @type {string}
     */
    this.key = CONFIG.STORAGE_PREFIX + 'settings';
    /**
     * Default settings values.
     * @type {Object}
     */
    this.defaults = {
      theme: 'light',
      thresholds: {
        uploads: [1, 10, 25, 50],
        approvals: [10, 50, 100, 150],
        notes: [1, 10, 20, 30],
      },
      rememberedModes: {}, // userId -> mode
    };
    /**
     * The currently loaded settings.
     * @type {Object}
     */
    this.settings = this.load();
  }

  /**
   * Loads settings from localStorage.
   * Includes migration for legacy settings keys and deep merges with defaults.
   * @return {!Object} The loaded settings object.
   * @private
   */
  load(): SettingsData {
    try {
      const s = localStorage.getItem(this.key);
      const saved = s ? JSON.parse(s) : {};

      // Migration: remembered_modes -> rememberedModes
      if (saved.remembered_modes && !saved.rememberedModes) {
        saved.rememberedModes = saved.remembered_modes;
        delete saved.remembered_modes;
      }

      // Deep merge defaults with saved
      return {
        ...this.defaults,
        ...saved,
        thresholds: {
          ...this.defaults.thresholds,
          ...(saved.thresholds || {})
        },
        rememberedModes: {
          ...(saved.rememberedModes || {})
        },
      };
    } catch (e) {
      console.error('[Danbooru Grass] Error loading settings, using defaults:', e);
      return this.defaults;
    }
  }

  /**
   * Saves new settings to localStorage.
   * @param {Object} newSettings Partial settings to update.
   */
  save(newSettings: Partial<SettingsData>): void {
    this.settings = {
      ...this.settings,
      ...newSettings
    };
    localStorage.setItem(this.key, JSON.stringify(this.settings));
  }

  /**
   * Gets the current theme key, falling back to 'light' if invalid.
   * @return {string} The theme key.
   */
  getTheme(): string {
    const t = this.settings.theme;
    return CONFIG.THEMES[t] ? t : 'light';
  }

  /**
   * Gets thresholds for a specific metric.
   * @param {string} metric The metric to retrieve thresholds for ('uploads', 'approvals', or 'notes').
   * @return {!Array<number>} An array of 4 threshold integers.
   */
  getThresholds(metric: Metric): number[] {
    return this.settings.thresholds[metric] ||
      this.defaults.thresholds[metric] || [1, 5, 10, 20];
  }

  /**
   * Sets thresholds for a specific metric and saves them.
   * @param {string} metric 'uploads', 'approvals', or 'notes'.
   * @param {Array<number>} values Array of 4 threshold integers.
   */
  setThresholds(metric: Metric, values: number[]): void {
    const newThresholds = {
      ...this.settings.thresholds,
      [metric]: values
    };
    this.save({
      thresholds: newThresholds
    });
  }

  /**
   * Gets the current grass color palette index (0-3).
   */
  getGrassIndex(): number {
    const idx = (this.settings as any).grassIndex;
    return typeof idx === 'number' && idx >= 0 && idx <= 3 ? idx : 0;
  }

  /**
   * Sets the grass color palette index and saves.
   */
  setGrassIndex(index: number): void {
    this.save({grassIndex: Math.max(0, Math.min(3, index))} as any);
  }

  /**
   * Resolves the active levels array for a theme, considering grassOptions and grassIndex.
   */
  resolveLevels(theme: any): string[] {
    const defaultLevels = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
    if (theme.grassOptions && theme.grassOptions.length > 0) {
      const idx = this.getGrassIndex();
      const option = theme.grassOptions[idx] || theme.grassOptions[0];
      return option.levels;
    }
    return theme.levels || defaultLevels;
  }

  /**
   * Applies the selected theme to CSS variables on the document root.
   * Updates background, text colors, and contribution graph levels.
   * @param {string} themeKey The key of the theme to apply (e.g., 'midnight').
   */
  applyTheme(themeKey: string): void {
    const theme = CONFIG.THEMES[themeKey] || CONFIG.THEMES.light;
    const root = document.querySelector(':root') as HTMLElement | null;
    if (root) {
      root.style.setProperty('--grass-bg', theme.bg);
      root.style.setProperty('--grass-empty-cell', theme.empty);
      root.style.setProperty('--grass-text', theme.text);
      root.style.setProperty(
        '--grass-scrollbar-thumb',
        theme.scrollbar || '#d0d7de'
      );
      // Apply Level Colors using grassOptions
      const levels = this.resolveLevels(theme);
      levels.forEach((color, i) => {
        root.style.setProperty(`--grass-level-${i}`, color);
      });
    }
    this.save({
      theme: themeKey
    });

    // Notify listeners (e.g. graph-renderer) to re-render with new colors
    window.dispatchEvent(new CustomEvent('DanbooruInsights:ThemeChanged', {
      detail: {themeKey}
    }));
  }

  /**
   * Gets the last used mode for a specific user.
   * @param {string} userId The ID of the user.
   * @return {string|null} The mode ('uploads', 'approvals', 'notes') or null if not found.
   */
  getLastMode(userId: string): string | null {
    return this.settings.rememberedModes[userId] || null;
  }

  /**
   * Sets the last used mode for a specific user and saves it.
   * @param {string} userId The ID of the user.
   * @param {string} mode The mode ('uploads', 'approvals', 'notes').
   */
  setLastMode(userId: string, mode: string): void {
    const newModes = {
      ...this.settings.rememberedModes,
      [userId]: mode
    };
    this.save({
      rememberedModes: newModes
    });
  }

  /**
   * Gets the sync threshold (max diff allowed to skip sync).
   * @return {number} Threshold (default 5).
   */
  getSyncThreshold(): number {
    return typeof this.settings.syncThreshold === 'number' ? this.settings.syncThreshold : 5;
  }

  /**
   * Sets the sync threshold.
   * @param {number} val
   */
  setSyncThreshold(val: number): void {
    this.save({
      syncThreshold: parseInt(val as any, 10)
    });
  }
}
