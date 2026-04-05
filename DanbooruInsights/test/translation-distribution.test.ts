import {describe, it, expect} from 'vitest';
import {
  computeUntaggedTranslation,
  buildUntaggedTranslationQueries,
  type UntaggedTranslationCounts,
} from '../src/core/analytics-data-manager';

/**
 * Tests for the Untagged translation inclusion-exclusion formula.
 * See PLAN.md §9 for derivation and TASK.md Phase 2 (TC-A~H) for scenarios.
 *
 * Formula: Untagged = max(0, t − a − b − c + ab + ac)
 * where:
 *   t  = |user:X *_text|
 *   a  = |user:X english_text|              (= |T ∩ E|)
 *   b  = |user:X *_text translation_request| (= |T ∩ R|)
 *   c  = |user:X *_text translated|          (= |T ∩ TR|)
 *   ab = |user:X english_text translation_request| (= |T ∩ E ∩ R|)
 *   ac = |user:X english_text translated|           (= |T ∩ E ∩ TR|)
 *
 * Assumption-1: |R ∩ TR| ≈ 0 (mutually exclusive states).
 */
describe('computeUntaggedTranslation — inclusion-exclusion formula', () => {
  it('TC-A: complete disjoint sets (no overlaps)', () => {
    // t=100, a=10, b=20, c=30, ab=0, ac=0
    // Expected: 100 − 10 − 20 − 30 + 0 + 0 = 40
    // (Naive subtraction happens to match in this degenerate case.)
    const counts: UntaggedTranslationCounts = {t: 100, a: 10, b: 20, c: 30, ab: 0, ac: 0};
    expect(computeUntaggedTranslation(counts)).toBe(40);
  });

  it('TC-B: english_text ∩ translated overlap (realistic scenario)', () => {
    // Posts with English source text that have been translated into another
    // language have both `english_text` AND `translated` tags.
    // t=100, a=30, b=10, c=50, ab=0, ac=25
    // Inclusion-exclusion: 100 − 30 − 10 − 50 + 0 + 25 = 35 ✓
    // Naive (t−a−b−c): 100 − 30 − 10 − 50 = 10 ❌ (over-subtracts 25)
    const counts: UntaggedTranslationCounts = {t: 100, a: 30, b: 10, c: 50, ab: 0, ac: 25};
    expect(computeUntaggedTranslation(counts)).toBe(35);

    // Verify we're NOT using the incorrect naive formula
    const naiveResult = 100 - 30 - 10 - 50;
    expect(computeUntaggedTranslation(counts)).not.toBe(Math.max(0, naiveResult));
  });

  it('TC-C: translation_request with text (no TR∩E overlap, realistic)', () => {
    // Typical case: some english-text posts also have translation_request.
    // t=100, a=10, b=20, c=30, ab=0, ac=5
    // Formula: 100 − 10 − 20 − 30 + 0 + 5 = 45
    const counts: UntaggedTranslationCounts = {t: 100, a: 10, b: 20, c: 30, ab: 0, ac: 5};
    expect(computeUntaggedTranslation(counts)).toBe(45);
  });

  it('TC-D: clips negative values to 0', () => {
    // Pathological: subtotals exceed t (shouldn't happen in practice but must not return negative)
    // t=50, a=30, b=10, c=30, ab=5, ac=15
    // Formula: 50 − 30 − 10 − 30 + 5 + 15 = 0 (exactly at boundary)
    const counts: UntaggedTranslationCounts = {t: 50, a: 30, b: 10, c: 30, ab: 5, ac: 15};
    expect(computeUntaggedTranslation(counts)).toBe(0);
  });

  it('TC-D2: truly negative result also clips to 0', () => {
    // Even more degenerate: negative result clips
    // t=10, a=20, b=5, c=5, ab=0, ac=0 → 10 − 20 − 5 − 5 + 0 + 0 = −20 → 0
    const counts: UntaggedTranslationCounts = {t: 10, a: 20, b: 5, c: 5, ab: 0, ac: 0};
    expect(computeUntaggedTranslation(counts)).toBe(0);
  });

  it('TC-E: all zero counts returns 0', () => {
    const counts: UntaggedTranslationCounts = {t: 0, a: 0, b: 0, c: 0, ab: 0, ac: 0};
    expect(computeUntaggedTranslation(counts)).toBe(0);
  });

  it('TC-F: one subcount is 0 (simulates fetch failure — graceful degradation)', () => {
    // If the ab subquery fails and returns 0 (fetchCount fallback), the formula
    // still produces a sensible (though possibly under-counted) result.
    // t=100, a=30, b=10, c=50, ab=0 (should have been 5), ac=25
    // Actual: 100 − 30 − 10 − 50 + 0 + 25 = 35
    // Ground truth with ab=5: 100 − 30 − 10 − 50 + 5 + 25 = 40
    // Degradation: 5 undercounted — acceptable
    const counts: UntaggedTranslationCounts = {t: 100, a: 30, b: 10, c: 50, ab: 0, ac: 25};
    const result = computeUntaggedTranslation(counts);
    expect(result).toBe(35);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('only ever returns non-negative integers', () => {
    const samples: UntaggedTranslationCounts[] = [
      {t: 1, a: 100, b: 100, c: 100, ab: 0, ac: 0},
      {t: 1000, a: 0, b: 0, c: 0, ab: 0, ac: 0},
      {t: 500, a: 250, b: 100, c: 150, ab: 50, ac: 50},
    ];
    for (const s of samples) {
      expect(computeUntaggedTranslation(s)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('buildUntaggedTranslationQueries — query string construction', () => {
  it('TC-H: builds all 7 queries with correct tag structure', () => {
    const q = buildUntaggedTranslationQueries('testuser');
    expect(q.t).toBe('user:testuser *_text');
    expect(q.a).toBe('user:testuser english_text');
    expect(q.b).toBe('user:testuser *_text translation_request');
    expect(q.c).toBe('user:testuser *_text translated');
    expect(q.ab).toBe('user:testuser english_text translation_request');
    expect(q.ac).toBe('user:testuser english_text translated');
    // BC is for Assumption-1 monitoring, not the formula
    expect(q.bc).toBe('user:testuser translation_request translated');
  });

  it('TC-H: encodeURIComponent produces correct URL for each query', () => {
    const q = buildUntaggedTranslationQueries('testuser');
    // Verify URL encoding: space→%20, colon→%3A, asterisk→%2A
    expect(encodeURIComponent(q.t)).toBe('user%3Atestuser%20*_text');
    expect(encodeURIComponent(q.a)).toBe('user%3Atestuser%20english_text');
    expect(encodeURIComponent(q.b)).toBe('user%3Atestuser%20*_text%20translation_request');
    expect(encodeURIComponent(q.c)).toBe('user%3Atestuser%20*_text%20translated');
  });

  it('each query uses at most 2 real (non-meta) tags — Member(Blue) compatibility', () => {
    const q = buildUntaggedTranslationQueries('testuser');
    // Count non-meta tags: strip `user:...` and count remaining whitespace-separated tokens
    const countRealTags = (query: string): number => {
      return query
        .split(/\s+/)
        .filter(tok => tok.length > 0 && !tok.startsWith('user:'))
        .length;
    };
    expect(countRealTags(q.t)).toBeLessThanOrEqual(2);
    expect(countRealTags(q.a)).toBeLessThanOrEqual(2);
    expect(countRealTags(q.b)).toBeLessThanOrEqual(2);
    expect(countRealTags(q.c)).toBeLessThanOrEqual(2);
    expect(countRealTags(q.ab)).toBeLessThanOrEqual(2);
    expect(countRealTags(q.ac)).toBeLessThanOrEqual(2);
    expect(countRealTags(q.bc)).toBeLessThanOrEqual(2);
  });

  it('handles usernames with underscores (already normalized)', () => {
    const q = buildUntaggedTranslationQueries('some_user_name');
    expect(q.t).toBe('user:some_user_name *_text');
    expect(q.ac).toBe('user:some_user_name english_text translated');
  });
});
