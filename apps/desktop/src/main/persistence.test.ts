import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLayout, writeLayout } from './persistence.js';

describe('layout persistence', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coa-layout-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a descriptor through a nested path', () => {
    const file = join(dir, 'console', 'layout.json');
    const value = { version: 1, root: { type: 'leaf', panelId: 'cost' } };
    writeLayout(file, value);
    expect(readLayout(file)).toEqual(value);
  });

  it('returns undefined for a missing file', () => {
    expect(readLayout(join(dir, 'nope.json'))).toBeUndefined();
  });

  it('returns undefined for corrupt JSON (renderer falls back to default)', () => {
    const file = join(dir, 'corrupt.json');
    writeFileSync(file, '{ not json', 'utf8');
    expect(readLayout(file)).toBeUndefined();
  });
});
