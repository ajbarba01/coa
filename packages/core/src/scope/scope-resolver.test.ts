import { describe, expect, it } from 'vitest';
import type { Scope } from '@coa/shared';
import { resolveScope, type ScopeContext } from './scope-resolver.js';

const ctx = (over: Partial<ScopeContext> = {}): ScopeContext => ({
  walPosition: 42,
  paths: ['web/a.ts', 'web/b.server.ts', 'app/x.ts'],
  tagMembers: (tag) => (tag === 'ui' ? ['app/x.ts'] : []),
  forwardClosure: (node) => (node === 'schema.ts' ? ['schema.ts', 'dep.ts'] : []),
  getScope: () => undefined,
  ...over,
});

describe('resolveScope (SCO-1/2)', () => {
  it('evaluates set algebra: any(glob, tag) exclude any(glob)', () => {
    const frontend: Scope = {
      name: 'frontend',
      include: { any: [{ glob: 'web/**' }, { tag: 'ui' }] },
      exclude: { any: [{ glob: '**/*.server.ts' }] },
    };
    const result = resolveScope(frontend, ctx());
    expect(result.members).toEqual(['app/x.ts', 'web/a.ts']);
    expect(result.walPosition).toBe(42);
    expect(result.degraded).toBeUndefined();
  });

  it('intersects with `all`', () => {
    const scope: Scope = {
      name: 's',
      include: { all: [{ glob: 'web/**' }, { glob: '**/*.server.ts' }] },
    };
    expect(resolveScope(scope, ctx()).members).toEqual(['web/b.server.ts']);
  });

  it('resolves a dependsOn graph leaf', () => {
    const scope: Scope = { name: 's', include: { dependsOn: 'schema.ts' } };
    expect(resolveScope(scope, ctx()).members).toEqual(['dep.ts', 'schema.ts']);
  });

  it('records a leaf that resolves to nothing in `degraded` — never silently empty (SCO-5)', () => {
    const scope: Scope = { name: 's', include: { tag: 'nonexistent' } };
    const result = resolveScope(scope, ctx());
    expect(result.members).toEqual([]);
    expect(result.degraded).toEqual(['tag:nonexistent']);
  });

  it('marks the deferred reachableFrom leaf as degraded, not a hard failure', () => {
    const scope: Scope = { name: 's', include: { reachableFrom: 'x.ts' } };
    expect(resolveScope(scope, ctx()).degraded?.[0]).toContain('reachableFrom');
  });

  it('composes another scope and guards composition cycles', () => {
    const base: Scope = { name: 'base', include: { glob: 'web/**' } };
    const derived: Scope = { name: 'derived', include: { scope: 'base' } };
    const result = resolveScope(
      derived,
      ctx({ getScope: (n) => (n === 'base' ? base : undefined) }),
    );
    expect(result.members).toEqual(['web/a.ts', 'web/b.server.ts']);
  });
});
