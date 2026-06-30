import { describe, expect, it } from 'vitest';
import type { InjectionBundle, ToolCall, ToolResponse } from '@coa/shared';
import type { SymbolOracle } from '../context/grounding.js';
import { enrich, type EnrichDeps } from './enrich.js';

const cleanOracle: SymbolOracle = {
  lookup: () => undefined,
  fuzzyMatch: () => [],
  walPosition: () => 1,
};

const noFlags = (): InjectionBundle => ({ groups: [] });

const baseResponse: ToolResponse<{ ok: boolean }> = {
  result: { ok: true },
  handle: 'h',
  pointer: 'p',
};

const deps = (over: Partial<EnrichDeps> = {}): EnrichDeps => ({
  oracle: cleanOracle,
  flagsForAgent: noFlags,
  ...over,
});

describe('enrich', () => {
  it('attaches an advisory grounding block when the call names a near-miss symbol', () => {
    const call: ToolCall = {
      tool: 'get_symbol',
      args: {},
      ref: { name: 'usrName' },
      sessionId: 's1',
    };
    const oracle: SymbolOracle = {
      lookup: () => undefined,
      fuzzyMatch: () => [
        {
          symbol: { name: 'userName', definedIn: 'src/u.ts' },
          confidence: 0.9,
          why: 'likely rename',
        },
      ],
      walPosition: () => 7,
    };

    const out = enrich(call, baseResponse, deps({ oracle }));

    expect(out.grounding?.status).toBe('stale');
    expect(out.grounding?.named).toBe('usrName');
    expect(out.grounding?.suggestions[0]?.symbol).toBe('userName');
  });

  it('attaches gated agent flags when the pipeline has any for the scope', () => {
    const call: ToolCall = {
      tool: 'get_symbol',
      args: {},
      ref: { path: 'src/u.ts' },
      sessionId: 's1',
    };
    const bundle: InjectionBundle = {
      groups: [{ concernKey: 'sql-injection', flags: [] }],
    };

    const out = enrich(call, baseResponse, deps({ flagsForAgent: () => bundle }));

    expect(out.flags).toEqual(bundle);
  });

  it('passes the return through untouched when there is nothing to surface (the floor)', () => {
    const call: ToolCall = {
      tool: 'get_symbol',
      args: {},
      ref: { name: 'userName' },
      sessionId: 's1',
    };
    const out = enrich(call, baseResponse, deps());
    expect(out).toEqual(baseResponse);
    expect('grounding' in out).toBe(false);
    expect('flags' in out).toBe(false);
  });
});
