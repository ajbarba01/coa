import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readJson, writeJson } from './persistence.js';

describe('json persistence', () => {
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
    writeJson(file, value);
    expect(readJson(file)).toEqual(value);
  });

  it('returns undefined for a missing file', () => {
    expect(readJson(join(dir, 'nope.json'))).toBeUndefined();
  });

  it('returns undefined for corrupt JSON (renderer falls back to default)', () => {
    const file = join(dir, 'corrupt.json');
    writeFileSync(file, '{ not json', 'utf8');
    expect(readJson(file)).toBeUndefined();
  });
});
