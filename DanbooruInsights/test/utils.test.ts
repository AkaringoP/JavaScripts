import {describe, it, expect, vi, beforeEach} from 'vitest';
import {isTopLevelTag} from '../src/utils';

describe('isTopLevelTag', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns true when tag has no implications (empty array)', async () => {
    const mockRateLimiter = {
      fetch: vi.fn().mockResolvedValue({json: async () => []}),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await isTopLevelTag(mockRateLimiter as any, 'original');
    expect(result).toBe(true);
  });

  it('returns false when tag has active implications', async () => {
    const mockRateLimiter = {
      fetch: vi.fn().mockResolvedValue({
        json: async () => [{status: 'active', consequent_name: 'parent_tag'}],
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await isTopLevelTag(mockRateLimiter as any, 'child_tag');
    expect(result).toBe(false);
  });

  it('returns true on fetch error (default to include)', async () => {
    const mockRateLimiter = {
      fetch: vi.fn().mockRejectedValue(new Error('Network error')),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await isTopLevelTag(mockRateLimiter as any, 'some_tag');
    expect(result).toBe(true);
  });

  it('URI-encodes the tag name in the API URL', async () => {
    const mockRateLimiter = {
      fetch: vi.fn().mockResolvedValue({json: async () => []}),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await isTopLevelTag(mockRateLimiter as any, 'tag with spaces');
    expect(mockRateLimiter.fetch).toHaveBeenCalledWith(
      expect.stringContaining('tag%20with%20spaces')
    );
  });

  it('queries the correct API endpoint', async () => {
    const mockRateLimiter = {
      fetch: vi.fn().mockResolvedValue({json: async () => []}),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await isTopLevelTag(mockRateLimiter as any, 'original');
    expect(mockRateLimiter.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/tag_implications.json')
    );
  });
});
