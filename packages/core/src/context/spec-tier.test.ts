import { describe, expect, it } from 'vitest';
import type { ToolCall } from '@coa/shared';
import { governanceFor, type GovernanceOracle } from './spec-tier.js';

function call(ref?: ToolCall['ref']): ToolCall {
  return { tool: 'edit_symbol', args: {}, sessionId: 's1', ...(ref ? { ref } : {}) };
}

function oracle(over: Partial<GovernanceOracle> = {}): GovernanceOracle {
  return {
    governedBy: () => [],
    fileOfSymbol: () => undefined,
    ...over,
  };
}

describe('governanceFor — the L-GND spec tier (coverage resolution)', () => {
  it('resolves the governing constraints for a symbol named with a path', () => {
    const coverage = governanceFor(
      call({ path: 'src/api.ts', symbol: 'Pet' }),
      oracle({
        governedBy: (node) => (node === 'src/api.ts' ? ['generated-stale:api-types'] : []),
      }),
    );
    expect(coverage).toEqual({ target: 'src/api.ts', governedBy: ['generated-stale:api-types'] });
  });

  it('resolves coverage via the defining file for a bare-name ref', () => {
    const coverage = governanceFor(
      call({ name: 'Pet' }),
      oracle({
        fileOfSymbol: (name) => (name === 'Pet' ? 'src/api.ts' : undefined),
        governedBy: (node) => (node === 'src/api.ts' ? ['c1'] : []),
      }),
    );
    expect(coverage).toEqual({ target: 'src/api.ts', governedBy: ['c1'] });
  });

  it('uses the path directly for a path-only ref', () => {
    const coverage = governanceFor(
      call({ path: 'src/api.ts' }),
      oracle({ governedBy: () => ['c1'] }),
    );
    expect(coverage?.target).toBe('src/api.ts');
  });

  it('returns nothing when no governed-by edge covers the symbol (never a guess)', () => {
    expect(governanceFor(call({ path: 'src/api.ts' }), oracle())).toBeUndefined();
  });

  it('returns nothing when the call names no symbol', () => {
    expect(governanceFor(call(), oracle({ governedBy: () => ['c1'] }))).toBeUndefined();
  });

  it('returns nothing when a bare-name symbol has no known defining file', () => {
    expect(
      governanceFor(call({ name: 'Mystery' }), oracle({ governedBy: () => ['c1'] })),
    ).toBeUndefined();
  });
});
