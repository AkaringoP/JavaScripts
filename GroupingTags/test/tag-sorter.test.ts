/**
 * @fileoverview Unit tests for the tag sorter module.
 * Verifies that tags are sorted with Character priority and correctly handle API responses.
 */
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {sortGroupTags} from '../src/core/tag-sorter';

// Mock fetch
global.fetch = vi.fn();

describe('sortGroupTags', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should sort Character tags first, then Alphabetical', async () => {
    // Mock API Response
    const mockPostData = {
      tag_string_character: 'himari_(blue_archive) rio_(blue_archive)',
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({post: mockPostData}),
    });

    // Test Data
    const groups = {
      test_group: [
        'official_alternate_costume', // General (Alpha: 'o')
        'himari_(blue_archive)', // Character (First)
        'black_hair', // General (Alpha: 'b')
        'rio_(blue_archive)', // Character (Second)
      ],
    };

    await sortGroupTags(groups, 12345);

    expect(groups['test_group']).toEqual([
      'himari_(blue_archive)', // Char 1
      'rio_(blue_archive)', // Char 2
      'black_hair', // Gen 'b'
      'official_alternate_costume', // Gen 'o'
    ]);
  });

  it('should handle robust whitespace in API response', async () => {
    // API with extra spaces/tabs
    const mockPostData = {
      tag_string_character: '  himari   rio  ',
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({post: mockPostData}),
    });

    const groups = {
      g: ['apple', 'rio', 'himari', 'banana'],
    };

    await sortGroupTags(groups, 999);

    // himari, rio (Chars) -> apple, banana (Gens)
    // Between himari/rio -> alpha
    expect(groups['g']).toEqual(['himari', 'rio', 'apple', 'banana']);
  });
});
