import {defineConfig} from 'vite';
import monkey from 'vite-plugin-monkey';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Danbooru Insights',
        namespace: 'http://tampermonkey.net/',
        version: '7.0.0',
        description:
          'Injects a GitHub-style contribution graph and advanced analytics dashboard into Danbooru profile and wiki pages.',
        author: 'AkaringoP with Claude Code',
        match: [
          'https://*.donmai.us/users/*',
          'https://*.donmai.us/profile',
          'https://*.donmai.us/wiki_pages*',
          'https://*.donmai.us/artists/*',
        ],
        grant: 'none',
        icon: 'https://danbooru.donmai.us/favicon.ico',
        homepageURL:
          'https://github.com/AkaringoP/JavaScripts/tree/main/DanbooruInsights',
        updateURL:
          'https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/DanbooruInsights/DanbooruInsights.user.js',
        downloadURL:
          'https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/DanbooruInsights/DanbooruInsights.user.js',
        require: [
          'https://d3js.org/d3.v7.min.js',
          'https://unpkg.com/cal-heatmap/dist/cal-heatmap.min.js',
          'https://unpkg.com/dexie/dist/dexie.js',
        ],
      },
      build: {
        externalGlobals: {
          d3: 'd3',
          'cal-heatmap': 'CalHeatmap',
          dexie: 'Dexie',
        },
      },
    }),
  ],
});
