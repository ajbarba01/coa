import { describe, expect, it } from 'vitest';
import type { ToolCall } from '@coa/shared';
import { buildCanUseTool, buildStopGate, type PermissionDeps } from './permission.js';

const call: ToolCall = { tool: 'apply_patch', args: { target: 'src/a.ts' }, sessionId: 's1' };

const deps = (over: Partial<PermissionDeps> = {}): PermissionDeps => ({
  perToolDeny: () => undefined,
  ...over,
});

describe('buildCanUseTool', () => {
  it('allows a tool when no deny rule matches', async () => {
    const decide = buildCanUseTool(deps());
    expect(await decide(call)).toEqual({ behavior: 'allow' });
  });

  it('denies when a per-tool deny rule matches', async () => {
    const decide = buildCanUseTool(
      deps({ perToolDeny: () => ({ behavior: 'deny', message: 'no secrets' }) }),
    );
    expect(await decide(call)).toEqual({ behavior: 'deny', message: 'no secrets' });
  });

  it('fails closed (denies) when a governance check throws', async () => {
    const decide = buildCanUseTool(
      deps({
        perToolDeny: () => {
          throw new Error('deny-rule read failed');
        },
      }),
    );
    expect((await decide(call)).behavior).toBe('deny');
  });
});

describe('buildStopGate', () => {
  it('passes an allowing gate through', async () => {
    const stop = buildStopGate({ gate: () => ({ allow: true }) });
    expect(await stop()).toEqual({ allow: true });
  });

  it('passes a blocking gate through with its message', async () => {
    const stop = buildStopGate({ gate: () => ({ allow: false, message: 'open Type-1 flags' }) });
    expect(await stop()).toEqual({ allow: false, message: 'open Type-1 flags' });
  });
});
