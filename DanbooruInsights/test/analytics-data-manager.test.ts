import {describe, it, expect} from 'vitest';
import {getBestThumbnailUrl} from '../src/utils';

describe('getBestThumbnailUrl', () => {
  it('빈 post(null)이면 빈 문자열 반환', () => {
    expect(getBestThumbnailUrl(null)).toBe('');
  });

  it('variants에 720x720 webp가 있으면 그 URL 반환', () => {
    const post = {
      variants: [
        {type: '360x360', file_ext: 'webp', url: 'http://example.com/360.webp'},
        {type: '720x720', file_ext: 'webp', url: 'http://example.com/720.webp'},
      ],
    };
    expect(getBestThumbnailUrl(post)).toBe('http://example.com/720.webp');
  });

  it('720x720 webp 없으면 360x360 webp 반환', () => {
    const post = {
      variants: [
        {type: '360x360', file_ext: 'webp', url: 'http://example.com/360.webp'},
        {type: '720x720', file_ext: 'jpg', url: 'http://example.com/720.jpg'},
      ],
    };
    expect(getBestThumbnailUrl(post)).toBe('http://example.com/360.webp');
  });

  it('webp 없으면 preferred type(720x720) 중 첫 번째 반환', () => {
    const post = {
      variants: [
        {type: '720x720', file_ext: 'jpg', url: 'http://example.com/720.jpg'},
        {type: '360x360', file_ext: 'png', url: 'http://example.com/360.png'},
      ],
    };
    expect(getBestThumbnailUrl(post)).toBe('http://example.com/720.jpg');
  });

  it('preferred type 없으면 첫 번째 variant URL 반환', () => {
    const post = {
      variants: [
        {type: 'original', file_ext: 'png', url: 'http://example.com/original.png'},
      ],
    };
    expect(getBestThumbnailUrl(post)).toBe('http://example.com/original.png');
  });

  it('variants가 빈 배열이면 preview_file_url fallback', () => {
    const post = {
      variants: [],
      preview_file_url: 'http://example.com/preview.jpg',
    };
    expect(getBestThumbnailUrl(post)).toBe('http://example.com/preview.jpg');
  });

  it('variants 없으면 file_url fallback', () => {
    const post = {
      file_url: 'http://example.com/file.jpg',
    };
    expect(getBestThumbnailUrl(post)).toBe('http://example.com/file.jpg');
  });

  it('모든 fallback 없으면 빈 문자열', () => {
    expect(getBestThumbnailUrl({})).toBe('');
  });
});
