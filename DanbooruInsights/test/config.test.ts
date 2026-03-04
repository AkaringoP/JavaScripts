import {describe, it, expect} from 'vitest';
import {CONFIG} from '../src/config';

describe('CONFIG', () => {
  describe('THEMES', () => {
    const requiredFields = ['name', 'bg', 'empty', 'text'];

    Object.entries(CONFIG.THEMES).forEach(([key, theme]) => {
      it(`theme "${key}" has all required fields`, () => {
        for (const field of requiredFields) {
          expect(theme).toHaveProperty(field);
        }
      });
    });

    it('light theme has 5 level colors', () => {
      expect(CONFIG.THEMES.light.levels).toHaveLength(5);
    });

    it('midnight theme has 5 level colors', () => {
      expect(CONFIG.THEMES.midnight.levels).toHaveLength(5);
    });
  });

  it('CLEANUP_THRESHOLD_MS equals 7 days in milliseconds', () => {
    expect(CONFIG.CLEANUP_THRESHOLD_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('STORAGE_PREFIX is correct', () => {
    expect(CONFIG.STORAGE_PREFIX).toBe('danbooru_contrib_');
  });
});
