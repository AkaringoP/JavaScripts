import {describe, it, expect} from 'vitest';
import {computeFontSizes} from '../src/apps/tag-cloud-widget';
import type {TagCloudItem} from '../src/types';

describe('computeFontSizes', () => {
  it('returns empty array for empty input', () => {
    expect(computeFontSizes([])).toEqual([]);
  });

  it('assigns min and max font sizes to lowest and highest frequency', () => {
    const items: TagCloudItem[] = [
      {name: 'high', tagName: 'high', frequency: 0.9, count: 900},
      {name: 'low', tagName: 'low', frequency: 0.1, count: 100},
    ];
    const result = computeFontSizes(items);
    expect(result).toHaveLength(2);
    // Highest frequency → MAX_FONT (43)
    expect(result[0].size).toBeCloseTo(38);
    // Lowest frequency → MIN_FONT (11)
    expect(result[1].size).toBeCloseTo(11);
  });

  it('uses log scale mapping (mid-range tag gets more than linear mid)', () => {
    const items: TagCloudItem[] = [
      {name: 'high', tagName: 'high', frequency: 0.8, count: 800},
      {name: 'mid', tagName: 'mid', frequency: 0.4, count: 400},
      {name: 'low', tagName: 'low', frequency: 0.1, count: 100},
    ];
    const result = computeFontSizes(items);
    const midSize = result[1].size;
    // Linear midpoint would be (43+11)/2 = 27
    // Log scale should push mid above linear midpoint
    const linearMid = (38 + 11) / 2; // 24.5
    expect(midSize).toBeGreaterThan(linearMid);
  });

  it('handles single item (all same frequency)', () => {
    const items: TagCloudItem[] = [
      {name: 'only', tagName: 'only', frequency: 0.5, count: 500},
    ];
    const result = computeFontSizes(items);
    expect(result).toHaveLength(1);
    // Single item → midpoint font size
    expect(result[0].size).toBeCloseTo((38 + 11) / 2);
  });

  it('handles items with equal frequencies', () => {
    const items: TagCloudItem[] = [
      {name: 'a', tagName: 'a', frequency: 0.5, count: 500},
      {name: 'b', tagName: 'b', frequency: 0.5, count: 500},
      {name: 'c', tagName: 'c', frequency: 0.5, count: 500},
    ];
    const result = computeFontSizes(items);
    // All same frequency → all same (midpoint) size
    expect(result[0].size).toBeCloseTo(result[1].size);
    expect(result[1].size).toBeCloseTo(result[2].size);
  });

  it('marks top 20% as bold', () => {
    const items: TagCloudItem[] = Array.from({length: 10}, (_, i) => ({
      name: `tag${i}`,
      tagName: `tag${i}`,
      frequency: 0.5 - i * 0.04, count: Math.round((0.5 - i * 0.04) * 1000),
    }));
    const result = computeFontSizes(items);
    // Top 20% of 10 items = ceil(2) = 2 bold items
    expect(result[0].bold).toBe(true);
    expect(result[1].bold).toBe(true);
    expect(result[2].bold).toBe(false);
  });

  it('preserves text and tagName from input', () => {
    const items: TagCloudItem[] = [
      {name: 'long hair', tagName: 'long_hair', frequency: 0.5, count: 500},
    ];
    const result = computeFontSizes(items);
    expect(result[0].text).toBe('long hair');
    expect(result[0].tagName).toBe('long_hair');
    expect(result[0].frequency).toBe(0.5);
  });

  it('handles realistic General tag distribution (high clustering)', () => {
    // Based on real data: General tags cluster at 0.1~0.84
    const items: TagCloudItem[] = [
      {name: '1girl', tagName: '1girl', frequency: 0.8354, count: 36576},
      {name: 'blush', tagName: 'blush', frequency: 0.7580, count: 33188},
      {name: 'solo', tagName: 'solo', frequency: 0.6620, count: 28984},
      {name: 'smile', tagName: 'smile', frequency: 0.3900, count: 17069},
      {name: 'shirt', tagName: 'shirt', frequency: 0.3308, count: 14481},
      {name: 'short hair', tagName: 'short_hair', frequency: 0.1370, count: 5996},
    ];
    const result = computeFontSizes(items);

    // All sizes should be within valid range
    for (const r of result) {
      expect(r.size).toBeGreaterThanOrEqual(11);
      expect(r.size).toBeLessThanOrEqual(38);
    }

    // Should be monotonically decreasing
    for (let i = 1; i < result.length; i++) {
      expect(result[i].size).toBeLessThanOrEqual(result[i - 1].size);
    }

    // Log scale: smile(0.39) should be noticeably bigger than linear midpoint
    // With linear: smile would be ~(0.39-0.137)/(0.835-0.137)*32+11 = ~22.6
    // With log: should be higher
    const smileItem = result.find(r => r.text === 'smile')!;
    expect(smileItem.size).toBeGreaterThan(25);
  });

  it('handles realistic Character tag distribution (low values)', () => {
    // Based on real data: Character tags are all < 4%
    const items: TagCloudItem[] = [
      {name: 'producer', tagName: 'producer_(idolmaster)', frequency: 0.0366, count: 1602},
      {name: 'fujita kotone', tagName: 'fujita_kotone', frequency: 0.0336, count: 1470},
      {name: 'sensei', tagName: 'sensei_(blue_archive)', frequency: 0.0292, count: 1278},
      {name: 'yuuka', tagName: 'yuuka_(blue_archive)', frequency: 0.0226, count: 989},
      {name: 'aru', tagName: 'aru_(blue_archive)', frequency: 0.0092, count: 403},
    ];
    const result = computeFontSizes(items);

    // First should be max, last should be min
    expect(result[0].size).toBeCloseTo(38);
    expect(result[result.length - 1].size).toBeCloseTo(11);

    // All valid range
    for (const r of result) {
      expect(r.size).toBeGreaterThanOrEqual(11);
      expect(r.size).toBeLessThanOrEqual(38);
    }
  });

  it('handles extreme Copyright distribution (one dominant tag)', () => {
    // Based on real data: idolmaster=0.586, rest < 0.25
    const items: TagCloudItem[] = [
      {name: 'idolmaster', tagName: 'idolmaster', frequency: 0.586, count: 25647},
      {name: 'blue archive', tagName: 'blue_archive', frequency: 0.247, count: 10810},
      {name: 'original', tagName: 'original', frequency: 0.0548, count: 2398},
      {name: 'pokemon', tagName: 'pokemon', frequency: 0.002, count: 88},
    ];
    const result = computeFontSizes(items);

    expect(result[0].size).toBeCloseTo(38);
    expect(result[result.length - 1].size).toBeCloseTo(11);

    // Log scale: blue_archive(0.247) should still be big despite 0.586 dominant
    const ba = result.find(r => r.text === 'blue archive')!;
    expect(ba.size).toBeGreaterThan(29);
  });
});

