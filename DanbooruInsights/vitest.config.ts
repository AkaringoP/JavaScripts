/// <reference types="vitest" />
import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    passWithNoTests: true,
    exclude: ['build/**', 'dist/**', 'node_modules/**'],
  },
});
