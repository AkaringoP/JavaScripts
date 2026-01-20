import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        monkey({
            entry: 'src/main.ts',
            userscript: {
                name: 'GroupingTags',
                namespace: 'http://tampermonkey.net/',
                version: '0.1',
                description: 'try to take over the world!',
                author: 'You',
                match: [
                    'https://danbooru.donmai.us/posts/*',
                    'https://danbooru.donmai.us/uploads/*',
                ],
                grant: ['GM_setValue', 'GM_getValue'],
                icon: 'https://vitejs.dev/logo.svg',
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