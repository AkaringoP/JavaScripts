import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        monkey({
            entry: 'src/main.ts',
            userscript: {
                name: 'Danbooru Grouping Tags',
                namespace: 'http://tampermonkey.net/',
                version: '0.1',
                description: 'try to take over the world!',
                author: 'You',
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
//# sourceMappingURL=vite.config.js.map