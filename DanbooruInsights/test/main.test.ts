import {describe, it, expect, vi, beforeAll, beforeEach} from 'vitest';

// Mock all modules with side effects (hoisted before imports)
vi.mock('../src/styles', () => ({injectGlobalStyles: vi.fn()}));
vi.mock('../src/core/database', () => ({Database: vi.fn()}));
vi.mock('../src/core/settings', () => ({SettingsManager: vi.fn()}));
vi.mock('../src/core/profile-context', () => ({ProfileContext: vi.fn()}));
vi.mock('../src/apps/grass-app', () => ({GrassApp: vi.fn()}));
vi.mock('../src/apps/user-analytics-app', () => ({UserAnalyticsApp: vi.fn()}));
vi.mock('../src/apps/tag-analytics-app', () => ({TagAnalyticsApp: vi.fn()}));

let detectCurrentTag: () => string | null;

// Mutable location/document objects — tests mutate pathname/dataset directly
const mockLocation = {pathname: '/'};
const mockDocument = {
  readyState: 'loading', // Prevents main() from auto-executing on import
  body: {dataset: {} as Record<string, string>},
  querySelector: vi.fn().mockReturnValue(null),
  addEventListener: vi.fn(),
};

beforeAll(async () => {
  // Stubs must be set before dynamic import so module-level code sees them
  vi.stubGlobal('window', {location: mockLocation});
  vi.stubGlobal('document', mockDocument);
  const mod = await import('../src/main');
  detectCurrentTag = mod.detectCurrentTag;
});

beforeEach(() => {
  mockLocation.pathname = '/';
  mockDocument.body.dataset = {};
  mockDocument.querySelector = vi.fn().mockReturnValue(null);
});

describe('detectCurrentTag', () => {
  it('returns null on a non-tag page', () => {
    mockLocation.pathname = '/posts';
    expect(detectCurrentTag()).toBeNull();
  });

  it('returns null on the root path', () => {
    mockLocation.pathname = '/';
    expect(detectCurrentTag()).toBeNull();
  });

  it('extracts a plain tag name from a wiki page URL', () => {
    mockLocation.pathname = '/wiki_pages/1girl';
    expect(detectCurrentTag()).toBe('1girl');
  });

  it('preserves underscores in wiki page tag names', () => {
    mockLocation.pathname = '/wiki_pages/long_hair';
    expect(detectCurrentTag()).toBe('long_hair');
  });

  it('decodes a percent-encoded tag name from a wiki page URL', () => {
    mockLocation.pathname = '/wiki_pages/blue%20eyes';
    expect(detectCurrentTag()).toBe('blue eyes');
  });

  it('returns the artist name from the data attribute on an artist page', () => {
    mockLocation.pathname = '/artists/12345';
    mockDocument.body.dataset = {artistName: 'some_artist'};
    expect(detectCurrentTag()).toBe('some_artist');
  });

  it('falls back to the post link tags param when data attribute is absent', () => {
    mockLocation.pathname = '/artists/12345';
    mockDocument.body.dataset = {};
    mockDocument.querySelector = vi
      .fn()
      .mockReturnValue({search: '?tags=some_artist'});
    expect(detectCurrentTag()).toBe('some_artist');
  });

  it('returns null on an artist page with no data attribute and no post link', () => {
    mockLocation.pathname = '/artists/12345';
    mockDocument.body.dataset = {};
    mockDocument.querySelector = vi.fn().mockReturnValue(null);
    expect(detectCurrentTag()).toBeNull();
  });
});
