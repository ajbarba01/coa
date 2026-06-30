import { describe, expect, it } from 'vitest';
import type { ToolCall } from '@coa/shared';
import {
  buildCanUseTool,
  buildStopGate,
  sessionBudget,
  type PermissionDeps,
} from './permission.js';

const call: ToolCall = { tool: 'apply_patch', args: { target: 'src/a.ts' }, sessionId: 's1' };

const deps = (over: Partial<PermissionDeps> = {}): PermissionDeps => ({
  capState: () => ({ capHit: false }),
  perToolDeny: () => undefined,
  ...over,
});

describe('buildCanUseTool', () => {
  it('allows a tool when the cap is not hit and no deny rule matches', async () => {
    const decide = buildCanUseTool(deps());
    expect(await decide(call)).toEqual({ behavior: 'allow' });
  });

  it('denies on the cost cap before consulting the per-tool rules (first-deny-wins)', async () => {
    let perToolConsulted = false;
    const decide = buildCanUseTool(
      deps({
        capState: () => ({ capHit: true }),
        perToolDeny: () => {
          perToolConsulted = true;
          return undefined;
        },
      }),
    );
    const out = await decide(call);
    expect(out.behavior).toBe('deny');
    expect(perToolConsulted).toBe(false);
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
        capState: () => {
          throw new Error('cap read failed');
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

describe('sessionBudget', () => {
  it('is unbounded (undefined) under the subscription model with no ceiling', () => {
    expect(sessionBudget(undefined, null)).toBeUndefined();
  });

  it('uses the per-session ceiling when there is no daemon remaining bound', () => {
    expect(sessionBudget(5, null)).toBe(5);
  });

  it('uses the daemon remaining when there is no per-session ceiling', () => {
    expect(sessionBudget(undefined, 3)).toBe(3);
  });

  it('takes the smaller of the per-session ceiling and the daemon remaining', () => {
    expect(sessionBudget(5, 3)).toBe(3);
    expect(sessionBudget(2, 9)).toBe(2);
  });
});
