import { describe, expect, it } from 'vitest';
import { scopeExprSchema, scopeSchema } from './scope.js';

describe('scopeExprSchema (recursive)', () => {
  it('accepts a composed expression with set algebra and exclusion', () => {
    const frontend = {
      name: 'frontend',
      include: { any: [{ glob: 'web/**' }, { tag: 'ui' }] },
      exclude: { any: [{ glob: '**/*.server.ts' }] },
    };
    expect(scopeSchema.parse(frontend).include).toEqual({
      any: [{ glob: 'web/**' }, { tag: 'ui' }],
    });
  });

  it('accepts nested all/any composition and a graph leaf', () => {
    const expr = { all: [{ dependsOn: 'src/schema.ts' }, { any: [{ tag: 'payments' }] }] };
    expect(scopeExprSchema.parse(expr)).toEqual(expr);
  });

  it('rejects an empty/unknown leaf', () => {
    expect(scopeExprSchema.safeParse({ nope: 'x' }).success).toBe(false);
  });
});
