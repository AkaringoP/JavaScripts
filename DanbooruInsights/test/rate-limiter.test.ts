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

  describe('updateLimits()', () => {
    it('updates rateLimit, refillRate, and maxConcurrency', () => {
      const rl = new RateLimitedFetch(6, [0, 0], 6);
      rl.updateLimits(2, 2);
      expect(rl.rateLimit).toBe(2);
      expect(rl.refillRate).toBe(500); // 1000 / 2
      expect(rl.maxConcurrency).toBe(2);
    });

    it('clamps existing tokens to new rateLimit', () => {
      const rl = new RateLimitedFetch(6, [0, 0], 6);
      expect(rl.tokens).toBe(6);
      rl.updateLimits(2, 2);
      expect(rl.tokens).toBe(2); // clamped from 6 to 2
    });
  });

  describe('setBackoff()', () => {
    it('sets backoffUntil to the given timestamp', () => {
      const rl = new RateLimitedFetch();
      const future = Date.now() + 5000;
      rl.setBackoff(future);
      expect(rl.backoffUntil).toBe(future);
    });

    it('only updates if the new timestamp is later', () => {
      const rl = new RateLimitedFetch();
      const t1 = Date.now() + 5000;
      const t2 = Date.now() + 3000;
      rl.setBackoff(t1);
      rl.setBackoff(t2);
      expect(rl.backoffUntil).toBe(t1); // t1 > t2, so t1 kept
    });
  });

  describe('429 triggers global backoff', () => {
    it('calls onBackoff callback on 429 response', async () => {
      global.fetch = vi.fn().mockResolvedValue({status: 429, ok: false});
      const rl = new RateLimitedFetch(6, [0, 0], 6);
      const backoffSpy = vi.fn();
      rl.onBackoff = backoffSpy;

      const p = rl.fetch('/posts.json');
      await vi.runAllTimersAsync();
      await p;

      expect(backoffSpy).toHaveBeenCalledOnce();
      expect(backoffSpy.mock.calls[0][0]).toBeGreaterThan(Date.now());
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
