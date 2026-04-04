import {describe, it, expect} from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC_DIR = path.resolve(__dirname, '../src');

/** Recursively collects all .ts files in a directory. */
function collectTsFiles(dir: string): {path: string; content: string}[] {
  const results: {path: string; content: string}[] = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      results.push({path: full, content: fs.readFileSync(full, 'utf-8')});
    }
  }
  return results;
}

/** Extracts relative import paths from a file's content. */
function extractImports(content: string): string[] {
  const matches = content.matchAll(/from\s+['"](\.[^'"]+)['"]/g);
  return Array.from(matches).map(m => m[1]);
}

describe('Architecture constraints', () => {
  const allFiles = collectTsFiles(SRC_DIR);

  it('core/ should not import from apps/', () => {
    const coreFiles = allFiles.filter(f => f.path.includes('/core/'));
    const violations: string[] = [];

    for (const file of coreFiles) {
      const imports = extractImports(file.content);
      for (const imp of imports) {
        if (imp.includes('/apps/') || imp.includes('../apps/')) {
          violations.push(`${path.relative(SRC_DIR, file.path)} imports "${imp}"`);
        }
      }
    }

    expect(violations, 'core/ must not import from apps/. Move shared code to core/ or utils.').toEqual([]);
  });

  it('core/ should not import from ui/', () => {
    const coreFiles = allFiles.filter(f => f.path.includes('/core/'));
    const violations: string[] = [];

    for (const file of coreFiles) {
      const imports = extractImports(file.content);
      for (const imp of imports) {
        if (imp.includes('/ui/') || imp.includes('../ui/')) {
          violations.push(`${path.relative(SRC_DIR, file.path)} imports "${imp}"`);
        }
      }
    }

    expect(violations, 'core/ must not import from ui/. Data layer should not depend on UI.').toEqual([]);
  });

  it('ui/ should not import from apps/', () => {
    const uiFiles = allFiles.filter(f => f.path.includes('/ui/'));
    const violations: string[] = [];

    for (const file of uiFiles) {
      const imports = extractImports(file.content);
      for (const imp of imports) {
        if (imp.includes('/apps/') || imp.includes('../apps/')) {
          violations.push(`${path.relative(SRC_DIR, file.path)} imports "${imp}"`);
        }
      }
    }

    expect(violations, 'ui/ must not import from apps/. UI components should not depend on app orchestration.').toEqual([]);
  });

  it('should not contain [key: string]: any index signatures', () => {
    const violations: string[] = [];

    for (const file of allFiles) {
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('[key: string]: any')) {
          violations.push(`${path.relative(SRC_DIR, file.path)}:${i + 1}`);
        }
      }
    }

    expect(violations, 'Use concrete types instead of [key: string]: any.').toEqual([]);
  });

  it('should not use raw fetch() — use RateLimitedFetch instead', () => {
    const violations: string[] = [];
    // Only check non-core files (core/rate-limiter.ts itself uses fetch internally)
    const filesToCheck = allFiles.filter(f =>
      !f.path.includes('rate-limiter.ts') && !f.path.includes('.test.')
    );

    for (const file of filesToCheck) {
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        // Match standalone fetch( but not this.rateLimiter.fetch( or rateLimiter.fetch(
        const line = lines[i];
        if (/(?<!rateLimiter\.)(?<!this\.)(?<!\.)\bfetch\s*\(/.test(line) &&
            !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
          violations.push(`${path.relative(SRC_DIR, file.path)}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    expect(violations, 'Use this.rateLimiter.fetch() instead of raw fetch() to respect API rate limits.').toEqual([]);
  });
});
