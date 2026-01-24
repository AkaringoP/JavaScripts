import { defineConfig } from 'vite';
import monkey, { cdn } from 'vite-plugin-monkey';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        monkey({
            entry: 'src/main.ts',
            userscript: {
                name: 'Danbooru Grouping Tags',
                namespace: 'http://tampermonkey.net/',
                version: '0.8',
                description: 'Grouping Tags for Danbooru',
                author: 'AkaringoP',
                match: [
                    'https://danbooru.donmai.us/posts/*',
                ],
                grant: [
                    'GM_setValue',
                    'GM_getValue',
                    'GM_deleteValue',
                    'GM_xmlhttpRequest',
                ],
                connect: ['api.github.com'],
                icon: 'https://danbooru.donmai.us/favicon.ico',
            },
            build: {
                externalGlobals: {
                    // Add external libraries here if needed, e.g.:
                    // react: cdn.jsdelivr('React', 'umd/react.production.min.js'),
                },
            },
        }),
    ],
});
