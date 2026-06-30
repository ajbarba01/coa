import { describe, expect, it } from 'vitest';
import { matchGlob } from './glob.js';

describe('matchGlob (the SCO-1 neutral-floor leaf)', () => {
  it('matches a single segment wildcard without crossing directories', () => {
    expect(matchGlob('*.ts', 'a.ts')).toBe(true);
    expect(matchGlob('*.ts', 'a.js')).toBe(false);
    expect(matchGlob('*.ts', 'src/a.ts')).toBe(false);
  });

  it('matches a directory-scoped wildcard', () => {
    expect(matchGlob('src/*.ts', 'src/a.ts')).toBe(true);
    expect(matchGlob('src/*.ts', 'src/sub/a.ts')).toBe(false);
  });

  it('matches a recursive globstar across directories', () => {
    expect(matchGlob('web/**', 'web/a.ts')).toBe(true);
    expect(matchGlob('web/**', 'web/sub/deep/b.ts')).toBe(true);
    expect(matchGlob('web/**', 'app/a.ts')).toBe(false);
  });

  it('matches a globstar suffix pattern', () => {
    expect(matchGlob('**/*.server.ts', 'web/api/x.server.ts')).toBe(true);
    expect(matchGlob('**/*.server.ts', 'web/api/x.client.ts')).toBe(false);
  });

  it('treats a single char wildcard literally within a segment', () => {
    expect(matchGlob('a?.ts', 'ab.ts')).toBe(true);
    expect(matchGlob('a?.ts', 'a/.ts')).toBe(false);
  });
});
