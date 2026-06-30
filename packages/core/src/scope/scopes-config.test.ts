import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScopesFile, validateScopesConfig } from './scopes-config.js';

describe('validateScopesConfig (SCO-3)', () => {
  it('builds the scope and tag indexes from a valid config', () => {
    const config = validateScopesConfig({
      scopes: { frontend: { include: { any: [{ glob: 'web/**' }, { tag: 'ui' }] } } },
      tags: { ui: ['app/**'] },
    });
    expect(config.scopes.get('frontend')?.name).toBe('frontend');
    expect(config.tags.get('ui')).toEqual(['app/**']);
  });

  it('rejects a malformed expression loudly (never a silent no-op)', () => {
    expect(() => validateScopesConfig({ scopes: { bad: { include: { glob: 5 } } } })).toThrow();
  });

  it('rejects a reference to an unknown scope', () => {
    expect(() => validateScopesConfig({ scopes: { a: { include: { scope: 'ghost' } } } })).toThrow(
      /unknown scope/i,
    );
  });

  it('rejects a composition cycle', () => {
    expect(() =>
      validateScopesConfig({
        scopes: { a: { include: { scope: 'b' } }, b: { include: { scope: 'a' } } },
      }),
    ).toThrow(/cycle/i);
  });
});

describe('loadScopesFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coa-scopes-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('loads and validates a .coa/scopes.yaml', () => {
    const path = join(dir, 'scopes.yaml');
    writeFileSync(
      path,
      'scopes:\n  api:\n    include:\n      glob: "src/api/**"\ntags:\n  core:\n    - "src/core/**"\n',
    );
    const config = loadScopesFile(path);
    expect(config.scopes.get('api')?.include).toEqual({ glob: 'src/api/**' });
    expect(config.tags.get('core')).toEqual(['src/core/**']);
  });

  it('returns an empty config when the file is absent (scopes are optional)', () => {
    const config = loadScopesFile(join(dir, 'missing.yaml'));
    expect(config.scopes.size).toBe(0);
  });
});
