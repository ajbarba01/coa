import { describe, expect, it } from 'vitest';
import type { InjectionBundle, ToolCall, ToolResponse } from '@coa/shared';
import { enrich, type EnrichDeps } from './enrich.js';

const noFlags = (): InjectionBundle => ({ groups: [] });

const baseResponse: ToolResponse<{ ok: boolean }> = {
  result: { ok: true },
  handle: 'h',
  pointer: 'p',
};

const deps = (over: Partial<EnrichDeps> = {}): EnrichDeps => ({
  flagsForAgent: noFlags,
  ...over,
});

describe('enrich', () => {
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
    expect('flags' in out).toBe(false);
  });
});
