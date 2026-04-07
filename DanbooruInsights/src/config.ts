import type {Theme} from './types';

// --- Configuration & Constants ---
/** One day in milliseconds. */
export const DAY_MS = 86_400_000;

export const CONFIG: {
  STORAGE_PREFIX: string;
  CLEANUP_THRESHOLD_MS: number;
  MAX_OPTIMIZED_POSTS: number;
  REPORT_COOLDOWN_MS: number;
  ANALYTICS_CLEANUP_THRESHOLD_MS: number;
  CACHE_EXPIRY_MS: number;
  BACKOFF_DURATION_MS: number;
  RATE_LIMITER: {concurrency: number; jitter: [number, number]; rps: number};
  TAB_COORDINATOR: {channelName: string; heartbeatInterval: number; staleTimeout: number};
  SELECTORS: {STATISTICS_SECTION: string};
  THEMES: Record<string, Theme>;
} = {
  STORAGE_PREFIX: 'danbooru_contrib_',
  CLEANUP_THRESHOLD_MS: 7 * DAY_MS, // 7 Days
  /** Max posts for small-tag/quick-sync optimization path. */
  MAX_OPTIMIZED_POSTS: 1200,
  /** Cooldown between report queue requests (ms). */
  REPORT_COOLDOWN_MS: 3000,
  /** Retention threshold for analytics-data-manager cleanup (14 days). */
  ANALYTICS_CLEANUP_THRESHOLD_MS: 14 * DAY_MS,
  /** Cache expiry for tag_analytics and piestats (24 hours). */
  CACHE_EXPIRY_MS: DAY_MS,
  /** Duration (ms) to pause all requests after receiving a 429 response. */
  BACKOFF_DURATION_MS: 5000,
  RATE_LIMITER: {concurrency: 6, jitter: [0, 50], rps: 6},
  TAB_COORDINATOR: {
    channelName: 'di-rate-coord',
    heartbeatInterval: 5000,
    staleTimeout: 15000,
  },
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
      levels: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
      grassOptions: [
        {name: 'Green', levels: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39']},
        {name: 'Blues', levels: ['#ebedf0', '#bdd7e7', '#6baed6', '#3182bd', '#08519c']},
        {name: 'Purples', levels: ['#ebedf0', '#cbc9e2', '#9e9ac8', '#756bb1', '#54278f']},
        {name: 'Oranges', levels: ['#ebedf0', '#fdbe85', '#fd8d3c', '#e6550d', '#a63603']},
      ],
    },
    solarized_light: {
      name: 'Solarized Light',
      bg: '#fdf6e3',
      empty: '#eee8d5',
      text: '#586e75',
      scrollbar: '#93a1a1',
      grassOptions: [
        {name: 'Green', levels: ['#eee8d5', '#9be9a8', '#40c463', '#30a14e', '#216e39']},
        {name: 'YlOrBr', levels: ['#eee8d5', '#fed98e', '#fe9929', '#d95f0e', '#993404']},
        {name: 'Blues', levels: ['#eee8d5', '#bdd7e7', '#6baed6', '#3182bd', '#08519c']},
        {name: 'BuGn', levels: ['#eee8d5', '#b2e2e2', '#66c2a4', '#2ca25f', '#006d2c']},
      ],
    },
    sakura: {
      name: 'Sakura',
      bg: '#fff0f5',
      empty: '#ffe0ea',
      text: '#24292f',
      grassOptions: [
        {name: 'Pink', levels: ['#ffe0ea', '#ffc0cb', '#ff85a2', '#e0245e', '#a8123c']},
        {name: 'Green', levels: ['#ffe0ea', '#9be9a8', '#40c463', '#30a14e', '#216e39']},
        {name: 'Purples', levels: ['#ffe0ea', '#cbc9e2', '#9e9ac8', '#756bb1', '#54278f']},
        {name: 'RdPu', levels: ['#ffe0ea', '#fbb4b9', '#f768a1', '#c51b8a', '#7a0177']},
      ],
    },
    lavender: {
      name: 'Lavender',
      bg: '#f5f0ff',
      empty: '#e8dff5',
      text: '#3d2c5e',
      scrollbar: '#c4b0e0',
      grassOptions: [
        {name: 'Purple', levels: ['#e8dff5', '#d4a5f5', '#b36bdb', '#8a3db5', '#5e1d8a']},
        {name: 'Green', levels: ['#e8dff5', '#9be9a8', '#40c463', '#30a14e', '#216e39']},
        {name: 'Blues', levels: ['#e8dff5', '#bdd7e7', '#6baed6', '#3182bd', '#08519c']},
        {name: 'PuRd', levels: ['#e8dff5', '#d4b9da', '#c994c7', '#dd1c77', '#980043']},
      ],
    },
    ice: {
      name: 'Ice',
      bg: '#e6fffb',
      empty: '#ffffff',
      text: '#006d75',
      scrollbar: '#5cdbd3',
      grassOptions: [
        {name: 'Cyan', levels: ['#ffffff', '#b2e2e2', '#66c2a4', '#2ca25f', '#006d2c']},
        {name: 'Green', levels: ['#ffffff', '#9be9a8', '#40c463', '#30a14e', '#216e39']},
        {name: 'Blues', levels: ['#ffffff', '#bdd7e7', '#6baed6', '#3182bd', '#08519c']},
        {name: 'Purples', levels: ['#ffffff', '#cbc9e2', '#9e9ac8', '#756bb1', '#54278f']},
      ],
    },
    aurora: {
      name: 'Aurora',
      bg: 'linear-gradient(135deg, #BAD1DE 0%, #ECECF5 100%)',
      empty: '#ffffff',
      text: '#2e3338',
      scrollbar: '#9FB5C6',
      grassOptions: [
        {name: 'Blues', levels: ['#ffffff', '#bdd7e7', '#6baed6', '#3182bd', '#08519c']},
        {name: 'Green', levels: ['#ffffff', '#9be9a8', '#40c463', '#30a14e', '#216e39']},
        {name: 'BuPu', levels: ['#ffffff', '#b3cde3', '#8c96c6', '#8856a7', '#810f7c']},
        {name: 'YlGn', levels: ['#ffffff', '#d9f0a3', '#addd8e', '#41ab5d', '#006837']},
      ],
    },

    // Dark Schemes
    midnight: {
      name: 'Midnight',
      bg: '#000000',
      empty: '#222222',
      text: '#f0f6fc',
      levels: ['#222222', '#0e4429', '#006d32', '#26a641', '#39d353'],
      grassOptions: [
        {name: 'Neon Green', levels: ['#222222', '#0e4429', '#006d32', '#26a641', '#39d353']},
        {name: 'Viridis', levels: ['#222222', '#31446b', '#21908d', '#5dc863', '#fde725']},
        {name: 'Plasma', levels: ['#222222', '#6a00a8', '#b12a90', '#e16462', '#fca636']},
        {name: 'Cool', levels: ['#222222', '#4a36b0', '#6e80e0', '#76d7c4', '#afffaf']},
      ],
    },
    solarized_dark: {
      name: 'Solarized Dark',
      bg: '#002b36',
      empty: '#073642',
      text: '#93a1a1',
      scrollbar: '#586e75',
      grassOptions: [
        {name: 'Neon Green', levels: ['#073642', '#0e4429', '#006d32', '#26a641', '#39d353']},
        {name: 'Viridis', levels: ['#073642', '#31446b', '#21908d', '#5dc863', '#fde725']},
        {name: 'Inferno', levels: ['#073642', '#6a176e', '#bb3754', '#f0732a', '#fcffa4']},
        {name: 'Cool', levels: ['#073642', '#4a36b0', '#6e80e0', '#76d7c4', '#afffaf']},
      ],
    },
    newspaper: {
      name: 'Newspaper',
      bg: '#f0f0f0',
      empty: '#dbdbdb',
      text: '#24292f',
      scrollbar: '#d0d7de',
      grassOptions: [
        {name: 'Green', levels: ['#dbdbdb', '#9be9a8', '#40c463', '#30a14e', '#216e39']},
        {name: 'Blues', levels: ['#dbdbdb', '#bdd7e7', '#6baed6', '#3182bd', '#08519c']},
        {name: 'Purples', levels: ['#dbdbdb', '#cbc9e2', '#9e9ac8', '#756bb1', '#54278f']},
        {name: 'Oranges', levels: ['#dbdbdb', '#fdbe85', '#fd8d3c', '#e6550d', '#a63603']},
      ],
    },
    ocean: {
      name: 'Ocean',
      bg: '#1b2a4e',
      empty: '#2b3d68',
      text: '#e6edf3',
      grassOptions: [
        {name: 'Neon Blue', levels: ['#2b3d68', '#1b5e80', '#2188ff', '#58a6ff', '#79c0ff']},
        {name: 'Neon Green', levels: ['#2b3d68', '#0e4429', '#006d32', '#26a641', '#39d353']},
        {name: 'Viridis', levels: ['#2b3d68', '#31446b', '#21908d', '#5dc863', '#fde725']},
        {name: 'Plasma', levels: ['#2b3d68', '#6a00a8', '#b12a90', '#e16462', '#fca636']},
      ],
    },
    monokai: {
      name: 'Monokai',
      bg: '#272822',
      empty: '#3e3d32',
      text: '#f8f8f2',
      scrollbar: '#75715e',
      grassOptions: [
        {name: 'Neon Green', levels: ['#3e3d32', '#0e4429', '#006d32', '#26a641', '#39d353']},
        {name: 'Inferno', levels: ['#3e3d32', '#6a176e', '#bb3754', '#f0732a', '#fcffa4']},
        {name: 'Magma', levels: ['#3e3d32', '#51127c', '#b73779', '#fb8861', '#fcfdbf']},
        {name: 'Turbo', levels: ['#3e3d32', '#3e49bb', '#1ac7c2', '#aad833', '#f5e642']},
      ],
    },
    ember: {
      name: 'Ember',
      bg: 'linear-gradient(135deg, #1a0a0a 0%, #2d1215 100%)',
      empty: '#3a1a1d',
      text: '#f0c0a0',
      scrollbar: '#6b3030',
      grassOptions: [
        {name: 'Ember', levels: ['#3a1a1d', '#5c1a1a', '#a93226', '#e74c3c', '#ff8a75']},
        {name: 'Neon Green', levels: ['#3a1a1d', '#0e4429', '#006d32', '#26a641', '#39d353']},
        {name: 'Inferno', levels: ['#3a1a1d', '#6a176e', '#bb3754', '#f0732a', '#fcffa4']},
        {name: 'OrRd', levels: ['#3a1a1d', '#7a3014', '#b35900', '#e67e22', '#f5b041']},
      ],
    },
  },
};
