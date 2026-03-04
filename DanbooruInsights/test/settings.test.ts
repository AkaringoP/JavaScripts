import {describe, it, expect, vi, beforeEach} from 'vitest';
import {SettingsManager} from '../src/core/settings';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

beforeEach(() => {
  localStorageMock.clear();
  vi.stubGlobal('localStorage', localStorageMock);
});

describe('SettingsManager', () => {
  describe('load()', () => {
    it('returns defaults when localStorage is empty', () => {
      const sm = new SettingsManager();
      expect(sm.getTheme()).toBe('light');
      expect(sm.getThresholds('uploads')).toEqual([1, 10, 25, 50]);
      expect(sm.getThresholds('approvals')).toEqual([10, 50, 100, 150]);
    });

    it('migrates remembered_modes to rememberedModes', () => {
      localStorageMock.setItem(
        'danbooru_contrib_settings',
        JSON.stringify({remembered_modes: {'123': 'uploads'}})
      );
      const sm = new SettingsManager();
      expect(sm.getLastMode('123')).toBe('uploads');
    });

    it('does not overwrite existing rememberedModes', () => {
      localStorageMock.setItem(
        'danbooru_contrib_settings',
        JSON.stringify({rememberedModes: {'456': 'approvals'}})
      );
      const sm = new SettingsManager();
      expect(sm.getLastMode('456')).toBe('approvals');
    });

    it('deep-merges saved thresholds with defaults', () => {
      localStorageMock.setItem(
        'danbooru_contrib_settings',
        JSON.stringify({thresholds: {uploads: [2, 20, 50, 100]}})
      );
      const sm = new SettingsManager();
      expect(sm.getThresholds('uploads')).toEqual([2, 20, 50, 100]);
      expect(sm.getThresholds('approvals')).toEqual([10, 50, 100, 150]); // default preserved
    });

    it('falls back to defaults on JSON parse error', () => {
      localStorageMock.setItem('danbooru_contrib_settings', 'invalid json{{{');
      const sm = new SettingsManager();
      expect(sm.getTheme()).toBe('light');
      expect(sm.getThresholds('uploads')).toEqual([1, 10, 25, 50]);
    });
  });

  describe('getTheme()', () => {
    it('returns saved theme when valid', () => {
      localStorageMock.setItem(
        'danbooru_contrib_settings',
        JSON.stringify({theme: 'midnight'})
      );
      const sm = new SettingsManager();
      expect(sm.getTheme()).toBe('midnight');
    });

    it('falls back to light for invalid theme key', () => {
      localStorageMock.setItem(
        'danbooru_contrib_settings',
        JSON.stringify({theme: 'nonexistent_theme'})
      );
      const sm = new SettingsManager();
      expect(sm.getTheme()).toBe('light');
    });
  });

  describe('setThresholds() / getThresholds()', () => {
    it('saves and retrieves custom thresholds', () => {
      const sm = new SettingsManager();
      sm.setThresholds('uploads', [5, 20, 50, 100]);
      expect(sm.getThresholds('uploads')).toEqual([5, 20, 50, 100]);
    });

    it('preserves other metrics when one is updated', () => {
      const sm = new SettingsManager();
      sm.setThresholds('notes', [2, 8, 15, 25]);
      expect(sm.getThresholds('approvals')).toEqual([10, 50, 100, 150]); // unchanged
    });
  });

  describe('setLastMode() / getLastMode()', () => {
    it('stores and retrieves mode per user', () => {
      const sm = new SettingsManager();
      sm.setLastMode('user123', 'approvals');
      expect(sm.getLastMode('user123')).toBe('approvals');
    });

    it('returns null for unknown user', () => {
      const sm = new SettingsManager();
      expect(sm.getLastMode('unknown')).toBeNull();
    });
  });

  describe('getSyncThreshold() / setSyncThreshold()', () => {
    it('returns default sync threshold of 5', () => {
      const sm = new SettingsManager();
      expect(sm.getSyncThreshold()).toBe(5);
    });

    it('stores and retrieves custom sync threshold', () => {
      const sm = new SettingsManager();
      sm.setSyncThreshold(10);
      expect(sm.getSyncThreshold()).toBe(10);
    });
  });
});
