import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {RateLimitedFetch} from '../src/core/rate-limiter';

beforeEach(() => {
  vi.useFakeTimers();
  global.fetch = vi.fn().mockResolvedValue({ok: true, json: async () => ({})});
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('RateLimitedFetch', () => {
  describe('getRequestCount()', () => {
    it('starts at 0', () => {
      const rl = new RateLimitedFetch();
      expect(rl.getRequestCount()).toBe(0);
    });
  });

  describe('refillTokens()', () => {
    it('does not refill when elapsed time < refillRate', () => {
      const rl = new RateLimitedFetch(6, [0, 0], 5); // refillRate = 200ms
      rl.tokens = 0;
      rl.lastRefill = Date.now() - 100; // 100ms < 200ms
      rl.refillTokens();
      expect(rl.tokens).toBe(0);
    });

    it('refills tokens proportional to elapsed time', () => {
      const rl = new RateLimitedFetch(6, [0, 0], 5); // rateLimit=5, refillRate=200ms
      rl.tokens = 0;
      rl.lastRefill = Date.now() - 600; // 600ms / 200ms = 3 tokens
      rl.refillTokens();
      expect(rl.tokens).toBe(3);
    });

    it('caps tokens at rateLimit', () => {
      const rl = new RateLimitedFetch(6, [0, 0], 5); // rateLimit=5
      rl.tokens = 0;
      rl.lastRefill = Date.now() - 5000; // way more than needed
      rl.refillTokens();
      expect(rl.tokens).toBe(5); // capped at rateLimit
    });
  });

  describe('fetch() routing', () => {
    it('routes /reports/ URLs to the report queue', async () => {
      const rl = new RateLimitedFetch(6, [0, 0], 6);
      const p = rl.fetch('/reports/something');
      await vi.runAllTimersAsync();
      await p;
      expect(global.fetch).toHaveBeenCalledWith('/reports/something', undefined);
      expect(rl.getRequestCount()).toBe(1);
    });

    it('routes /reposts/ URLs to the repost queue', async () => {
      const rl = new RateLimitedFetch(6, [0, 0], 6);
      const p = rl.fetch('/reposts/posts.json');
      await vi.runAllTimersAsync();
      await p;
      expect(global.fetch).toHaveBeenCalledWith('/reposts/posts.json', undefined);
      expect(rl.getRequestCount()).toBe(1);
    });

    it('routes general URLs to the token bucket queue', async () => {
      const rl = new RateLimitedFetch(6, [0, 0], 6);
      const p = rl.fetch('/posts.json');
      await vi.runAllTimersAsync();
      await p;
      expect(global.fetch).toHaveBeenCalledWith('/posts.json', undefined);
      expect(rl.getRequestCount()).toBe(1);
    });
  });
});
