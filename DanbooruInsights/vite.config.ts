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
        version: '7.6.0',
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
          'https://github.com/AkaringoP/JavaScripts/raw/build/danbooruinsights.user.js',
        downloadURL:
          'https://github.com/AkaringoP/JavaScripts/raw/build/danbooruinsights.user.js',
        require: [
          'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js',
          'https://cdn.jsdelivr.net/npm/d3-cloud@1.2.7/build/d3.layout.cloud.min.js',
          'https://cdn.jsdelivr.net/npm/cal-heatmap@4.2.4/dist/cal-heatmap.min.js',
          'https://cdn.jsdelivr.net/npm/dexie@3.2.7/dist/dexie.min.js',
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
