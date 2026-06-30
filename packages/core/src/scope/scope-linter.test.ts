import { describe, expect, it } from 'vitest';
import type { Scope, ScopeResolution } from '@coa/shared';
import { lintScopes } from './scope-linter.js';

const resolution = (scope: string, degraded?: string[]): ScopeResolution => ({
  scope,
  members: [],
  walPosition: 0,
  ...(degraded ? { degraded } : {}),
});

describe('lintScopes (SCO-5)', () => {
  it('flags a leaf that resolves to zero members', () => {
    const scopes: Scope[] = [{ name: 'empty', include: { tag: 'ghost' } }];
    const findings = lintScopes(scopes, {
      resolve: (s) => resolution(s.name, ['tag:ghost']),
      isPiece: () => true,
      isNode: () => true,
    });
    expect(findings).toContainEqual({ scope: 'empty', kind: 'empty-leaf', detail: 'tag:ghost' });
  });

  it('flags a dependsOn to a node that no longer exists', () => {
    const scopes: Scope[] = [{ name: 's', include: { dependsOn: 'deleted.ts' } }];
    const findings = lintScopes(scopes, {
      resolve: (s) => resolution(s.name),
      isPiece: () => true,
      isNode: (id) => id !== 'deleted.ts',
    });
    expect(findings).toContainEqual({
      scope: 's',
      kind: 'dangling-dependency',
      detail: 'deleted.ts',
    });
  });

  it('flags an attach to a missing piece', () => {
    const scopes: Scope[] = [{ name: 's', include: { glob: 'a/**' }, attach: ['guide', 'gone'] }];
    const findings = lintScopes(scopes, {
      resolve: (s) => resolution(s.name),
      isPiece: (ref) => ref === 'guide',
      isNode: () => true,
    });
    expect(findings).toContainEqual({ scope: 's', kind: 'missing-attach', detail: 'gone' });
    expect(findings.some((f) => f.detail === 'guide')).toBe(false);
  });

  it('returns nothing for a healthy scope', () => {
    const scopes: Scope[] = [{ name: 'ok', include: { glob: 'a/**' } }];
    expect(
      lintScopes(scopes, {
        resolve: (s) => resolution(s.name),
        isPiece: () => true,
        isNode: () => true,
      }),
    ).toEqual([]);
  });
});
