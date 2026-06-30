import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChangeKernel } from './kernel.js';
import { validateScopesConfig } from './scope/scopes-config.js';

let dir: string;
let kernel: ChangeKernel;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coa-ks-'));
  kernel = new ChangeKernel({ walPath: join(dir, 'log.ndjson'), worktree: 'main' });
  for (const path of ['web/a.ts', 'web/b.server.ts', 'app/x.ts']) {
    kernel.indexFile(path, 'typescript', 'export const v = 1;');
  }
  kernel.loadScopes(
    validateScopesConfig({
      scopes: {
        frontend: {
          include: { any: [{ glob: 'web/**' }, { tag: 'ui' }] },
          exclude: { glob: '**/*.server.ts' },
        },
      },
      tags: { ui: ['app/**'] },
    }),
  );
});
afterEach(() => {
  kernel.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ChangeKernel scope tier (SCO)', () => {
  it('resolves a scope over glob + tag with an exclude and a freshness stamp', () => {
    const resolution = kernel.resolveScope('frontend');
    expect(resolution.members).toEqual(['app/x.ts', 'web/a.ts']);
    expect(resolution.walPosition).toBe(kernel.read().length);
  });

  it('answers the inverse membership read (scopesFor)', () => {
    expect(kernel.scopesFor('web/a.ts')).toContain('frontend');
    expect(kernel.scopesFor('web/b.server.ts')).not.toContain('frontend');
  });

  it('lints scopes for silent-failure leaves', () => {
    kernel.loadScopes(validateScopesConfig({ scopes: { dead: { include: { tag: 'ghost' } } } }));
    expect(kernel.lintScopes()).toContainEqual({
      scope: 'dead',
      kind: 'empty-leaf',
      detail: 'tag:ghost',
    });
  });

  it('caches resolution and re-resolves only after a material change', () => {
    const first = kernel.resolveScope('frontend');
    expect(kernel.resolveScope('frontend')).toBe(first); // same cached object
    kernel.indexFile('web/c.ts', 'typescript', 'export const c = 1;');
    expect(kernel.resolveScope('frontend')).not.toBe(first); // invalidated
    expect(kernel.resolveScope('frontend').members).toContain('web/c.ts');
  });
});
