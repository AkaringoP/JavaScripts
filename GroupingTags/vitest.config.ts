/// <reference types="vitest" />
import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node', // Use 'jsdom' if DOM APIs are heavily used, but 'node' is faster for logic
    globals: true, // Allow 'describe', 'it', 'expect' without import
  },
});
