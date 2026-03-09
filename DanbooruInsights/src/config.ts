import type {Theme} from './types';

// --- Configuration & Constants ---
export const CONFIG: {
  STORAGE_PREFIX: string;
  CLEANUP_THRESHOLD_MS: number;
  RATE_LIMITER: {concurrency: number; jitter: [number, number]; rps: number};
  SELECTORS: {STATISTICS_SECTION: string};
  THEMES: Record<string, Theme>;
} = {
  STORAGE_PREFIX: 'danbooru_contrib_',
  CLEANUP_THRESHOLD_MS: 7 * 24 * 60 * 60 * 1000, // 7 Days
  RATE_LIMITER: {concurrency: 6, jitter: [100, 300], rps: 6},
  SELECTORS: {
    STATISTICS_SECTION: 'div.user-statistics',
  },
  THEMES: {
    // Light Schemes
    light: {
      name: 'Light',
      bg: '#ffffff',
      empty: '#ebedf0',
      text: '#24292f',
      levels: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39']
    },
    solarized_light: {
      name: 'Solarized Light',
      bg: '#fdf6e3',
      empty: '#eee8d5',
      text: '#586e75',
      scrollbar: '#93a1a1'
    },
    sakura: {
      name: 'Sakura',
      bg: '#fff0f5',
      empty: '#ffe0ea',
      text: '#24292f'
    },
    sunset: {
      name: 'Sunset',
      bg: '#fff5e6',
      empty: '#ffe0b2',
      text: '#24292f'
    },
    ice: {
      name: 'Ice',
      bg: '#e6fffb',
      empty: '#ffffff',
      text: '#006d75',
      scrollbar: '#5cdbd3'
    },
    aurora: {
      name: 'Aurora',
      bg: 'linear-gradient(135deg, #BAD1DE 0%, #ECECF5 100%)',
      empty: '#ffffff',
      text: '#2e3338',
      scrollbar: '#9FB5C6'
    },

    // Dark Schemes
    midnight: {
      name: 'Midnight',
      bg: '#000000',
      empty: '#222222',
      text: '#f0f6fc',
      levels: ['#222222', '#0e4429', '#006d32', '#26a641', '#39d353']
    },
    solarized_dark: {
      name: 'Solarized Dark',
      bg: '#002b36',
      empty: '#073642',
      text: '#93a1a1',
      scrollbar: '#586e75'
    },
    newspaper: {
      name: 'Newspaper',
      bg: '#f0f0f0',
      empty: '#dbdbdb',
      text: '#24292f',
      scrollbar: '#d0d7de'
    },
    ocean: {
      name: 'Ocean',
      bg: '#1b2a4e',
      empty: '#2b3d68',
      text: '#e6edf3'
    },
  },
};
