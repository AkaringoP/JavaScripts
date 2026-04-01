import {describe, it, expect, vi, beforeAll} from 'vitest';

// Mock all heavy dependencies so we can instantiate TagAnalyticsDataService cheaply
vi.mock('d3', () => ({}));
vi.mock('../src/config', () => ({CONFIG: {RATE_LIMITER: {}, MAX_OPTIMIZED_POSTS: 1200, CACHE_EXPIRY_MS: 86400000}}));
vi.mock('../src/core/analytics-data-manager', () => ({
  AnalyticsDataManager: vi.fn(),
}));
vi.mock('../src/core/rate-limiter', () => ({
  RateLimitedFetch: vi.fn(),
}));
vi.mock('../src/utils', () => ({
  isTopLevelTag: vi.fn(),
  escapeHtml: vi.fn((s: string) => s),
}));

let dataService: InstanceType<typeof import('../src/apps/tag-analytics-data').TagAnalyticsDataService>;

beforeAll(async () => {
  const {TagAnalyticsDataService} = await import('../src/apps/tag-analytics-data');
  dataService = new TagAnalyticsDataService(
    {} as any, // db
    {} as any, // rateLimiter
    'test_tag'
  );
});

// ---------------------------------------------------------------------------
// getMilestoneTargets
// ---------------------------------------------------------------------------
describe('getMilestoneTargets', () => {
  it('always includes 1', () => {
    expect(dataService.getMilestoneTargets(0)).toContain(1);
    expect(dataService.getMilestoneTargets(50)).toContain(1);
  });

  it('returns sorted ascending', () => {
    const targets = dataService.getMilestoneTargets(5000);
    for (let i = 1; i < targets.length; i++) {
      expect(targets[i]).toBeGreaterThan(targets[i - 1]);
    }
  });

  it('includes round milestones for small total', () => {
    const targets = dataService.getMilestoneTargets(350);
    expect(targets).toContain(100);
    expect(targets).toContain(200);
    expect(targets).toContain(300);
    expect(targets).not.toContain(1000);
  });

  it('includes 1000 and 10000 for large total', () => {
    const targets = dataService.getMilestoneTargets(15000);
    expect(targets).toContain(1000);
    expect(targets).toContain(10000);
  });

  it('step scales with total', () => {
    // total=500 → step=100
    const small = dataService.getMilestoneTargets(500);
    expect(small).toContain(100);
    expect(small).toContain(200);
    expect(small).toContain(300);
    expect(small).toContain(400);
    expect(small).toContain(500);

    // total=60000 → step=5000
    const large = dataService.getMilestoneTargets(60000);
    expect(large).toContain(5000);
    expect(large).toContain(10000);
    expect(large).toContain(55000);
    expect(large).toContain(60000);
  });

  it('has no duplicates', () => {
    const targets = dataService.getMilestoneTargets(1200);
    expect(new Set(targets).size).toBe(targets.length);
  });
});

// ---------------------------------------------------------------------------
// calculateLocalStats
// ---------------------------------------------------------------------------
describe('calculateLocalStats', () => {
  it('returns zero counts for empty array', () => {
    const stats = dataService.calculateLocalStats([]);
    expect(stats.ratingCounts).toEqual({g: 0, s: 0, q: 0, e: 0});
    expect(stats.uploaderRanking).toEqual([]);
    expect(stats.approverRanking).toEqual([]);
  });

  it('counts ratings correctly', () => {
    const posts = [
      {rating: 'g', uploader_id: 1},
      {rating: 'g', uploader_id: 1},
      {rating: 's', uploader_id: 2},
      {rating: 'e', uploader_id: 3},
    ];
    const stats = dataService.calculateLocalStats(posts);
    expect(stats.ratingCounts).toEqual({g: 2, s: 1, q: 0, e: 1});
  });

  it('ranks uploaders by count descending', () => {
    const posts = [
      {rating: 'g', uploader_id: 10},
      {rating: 'g', uploader_id: 10},
      {rating: 'g', uploader_id: 10},
      {rating: 'g', uploader_id: 20},
    ];
    const stats = dataService.calculateLocalStats(posts);
    expect(stats.uploaderRanking[0].id).toBe('10');
    expect(stats.uploaderRanking[0].count).toBe(3);
    expect(stats.uploaderRanking[0].rank).toBe(1);
    expect(stats.uploaderRanking[1].id).toBe('20');
    expect(stats.uploaderRanking[1].rank).toBe(2);
  });

  it('ranks approvers correctly', () => {
    const posts = [
      {rating: 'g', uploader_id: 1, approver_id: 100},
      {rating: 'g', uploader_id: 1, approver_id: 100},
      {rating: 'g', uploader_id: 1, approver_id: 200},
    ];
    const stats = dataService.calculateLocalStats(posts);
    expect(stats.approverRanking[0].id).toBe('100');
    expect(stats.approverRanking[0].count).toBe(2);
  });

  it('ignores unknown ratings', () => {
    const posts = [{rating: 'x', uploader_id: 1}];
    const stats = dataService.calculateLocalStats(posts);
    expect(stats.ratingCounts).toEqual({g: 0, s: 0, q: 0, e: 0});
  });

  it('limits ranking to top 100', () => {
    const posts = Array.from({length: 150}, (_, i) => ({
      rating: 'g',
      uploader_id: i,
    }));
    const stats = dataService.calculateLocalStats(posts);
    expect(stats.uploaderRanking.length).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// calculateHistoryFromPosts
// ---------------------------------------------------------------------------
describe('calculateHistoryFromPosts', () => {
  it('returns empty array for empty input', () => {
    expect(dataService.calculateHistoryFromPosts([])).toEqual([]);
    expect(dataService.calculateHistoryFromPosts(null as any)).toEqual([]);
  });

  it('groups posts by month and computes cumulative', () => {
    const posts = [
      {created_at: '2024-01-15T00:00:00Z'},
      {created_at: '2024-01-20T00:00:00Z'},
      {created_at: '2024-03-10T00:00:00Z'},
    ];
    const history = dataService.calculateHistoryFromPosts(posts);

    // Should have entries from 2024-01 through at least 2024-03
    const jan = history.find((h: any) => h.date === '2024-01-01');
    expect(jan).toBeDefined();
    expect(jan!.count).toBe(2);
    expect(jan!.cumulative).toBe(2);

    const feb = history.find((h: any) => h.date === '2024-02-01');
    expect(feb).toBeDefined();
    expect(feb!.count).toBe(0);
    expect(feb!.cumulative).toBe(2);

    const mar = history.find((h: any) => h.date === '2024-03-01');
    expect(mar).toBeDefined();
    expect(mar!.count).toBe(1);
    expect(mar!.cumulative).toBe(3);
  });

  it('sorts unsorted posts correctly', () => {
    const posts = [
      {created_at: '2024-06-01T00:00:00Z'},
      {created_at: '2024-01-01T00:00:00Z'},
    ];
    const history = dataService.calculateHistoryFromPosts(posts);
    expect(history[0].date).toBe('2024-01-01');
  });

  it('skips posts with invalid dates', () => {
    const posts = [
      {created_at: '2024-05-01T00:00:00Z'},
      {created_at: 'not-a-date'},
    ];
    const history = dataService.calculateHistoryFromPosts(posts);
    const may = history.find((h: any) => h.date === '2024-05-01');
    expect(may!.count).toBe(1);
  });

  it('fills gap months with zero counts', () => {
    const posts = [
      {created_at: '2024-01-01T00:00:00Z'},
      {created_at: '2024-04-01T00:00:00Z'},
    ];
    const history = dataService.calculateHistoryFromPosts(posts);
    const feb = history.find((h: any) => h.date === '2024-02-01');
    const mar = history.find((h: any) => h.date === '2024-03-01');
    expect(feb!.count).toBe(0);
    expect(mar!.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// mergeHistory
// ---------------------------------------------------------------------------
describe('mergeHistory', () => {
  it('returns newHistory when oldHistory is empty', () => {
    const newH = [{date: '2024-01-01', count: 5, cumulative: 5}];
    expect(dataService.mergeHistory([], newH)).toEqual(newH);
    expect(dataService.mergeHistory(null as any, newH)).toEqual(newH);
  });

  it('returns oldHistory when newHistory is empty', () => {
    const oldH = [{date: '2024-01-01', count: 5, cumulative: 5}];
    expect(dataService.mergeHistory(oldH, [])).toEqual(oldH);
    expect(dataService.mergeHistory(oldH, null as any)).toEqual(oldH);
  });

  it('merges without duplicating overlapping months', () => {
    const oldH = [
      {date: '2024-01-01', count: 10, cumulative: 10},
      {date: '2024-02-01', count: 5, cumulative: 15},
      {date: '2024-03-01', count: 8, cumulative: 23},
    ];
    const newH = [
      {date: '2024-03-01', count: 12, cumulative: 0}, // overlap: updated count
      {date: '2024-04-01', count: 3, cumulative: 0},
    ];

    const merged = dataService.mergeHistory(oldH, newH);
    const dates = merged.map((h: any) => h.date);

    // No duplicate months
    expect(new Set(dates).size).toBe(dates.length);
    // Old data preserved up to overlap point
    expect(dates).toContain('2024-01-01');
    expect(dates).toContain('2024-02-01');
    // New data replaces from overlap point
    expect(dates).toContain('2024-03-01');
    expect(dates).toContain('2024-04-01');
  });

  it('recalculates cumulative from scratch', () => {
    const oldH = [
      {date: '2024-01-01', count: 10, cumulative: 10},
      {date: '2024-02-01', count: 5, cumulative: 15},
    ];
    const newH = [
      {date: '2024-03-01', count: 7, cumulative: 999}, // wrong cumulative
    ];

    const merged = dataService.mergeHistory(oldH, newH);
    expect(merged[0].cumulative).toBe(10);
    expect(merged[1].cumulative).toBe(15);
    expect(merged[2].cumulative).toBe(22);
  });
});

// ---------------------------------------------------------------------------
// mergeMilestones
// ---------------------------------------------------------------------------
describe('mergeMilestones', () => {
  it('returns old milestones when new is empty', () => {
    const old = [{milestone: 100, post_id: 1}];
    expect(dataService.mergeMilestones(old, [])).toEqual(old);
    expect(dataService.mergeMilestones(old, null as any)).toEqual(old);
  });

  it('merges and sorts by milestone number', () => {
    const old = [
      {milestone: 100, post_id: 1},
      {milestone: 1000, post_id: 10},
    ];
    const newM = [{milestone: 500, post_id: 5}];
    const merged = dataService.mergeMilestones(old, newM);

    expect(merged.map((m: any) => m.milestone)).toEqual([100, 500, 1000]);
  });

  it('handles both empty arrays', () => {
    expect(dataService.mergeMilestones([], [])).toEqual([]);
  });
});
