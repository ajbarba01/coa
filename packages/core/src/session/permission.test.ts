import { describe, expect, it } from 'vitest';
import type { PermissionMode, ToolCall, ToolClass } from '@coa/shared';
import {
  buildCanUseTool,
  buildStopGate,
  type ModeDeps,
  type PermissionDeps,
} from './permission.js';

const call: ToolCall = { tool: 'apply_patch', args: { target: 'src/a.ts' }, sessionId: 's1' };

const deps = (over: Partial<PermissionDeps> = {}): PermissionDeps => ({
  perToolDeny: () => undefined,
  ...over,
});

/** `classify` always answers `toolClass` regardless of the call's real tool name —
 *  these are pure unit tests of the MODE logic, not the real catalogue classifier
 *  (covered separately by tool-class.test.ts). */
function modeDeps(toolClass: ToolClass, over: Partial<ModeDeps> = {}): ModeDeps {
  return {
    getMode: () => 'manual',
    hasApprovalSeam: () => true,
    classify: () => toolClass,
    requestApproval: () => Promise.resolve('allow'),
    ...over,
  };
}

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

describe('buildCanUseTool — F2 mode-aware layer', () => {
  it('a per-tool deny rule wins even under bypass mode (mode never overrides a deny)', async () => {
    const decide = buildCanUseTool(
      deps({
        perToolDeny: () => ({ behavior: 'deny', message: 'no secrets' }),
        mode: modeDeps('write', { getMode: () => 'bypass' }),
      }),
    );
    expect(await decide(call)).toEqual({ behavior: 'deny', message: 'no secrets' });
  });

  it('mode is off entirely when absent — every call that clears the deny rules is allowed', async () => {
    const decide = buildCanUseTool(deps());
    expect(await decide(call)).toEqual({ behavior: 'allow' });
  });

  describe('the mode x tool-class matrix', () => {
    const matrix: {
      mode: PermissionMode;
      toolClass: ToolClass;
      expect: 'allow' | 'deny' | 'ask';
    }[] = [
      { mode: 'plan', toolClass: 'read', expect: 'allow' },
      { mode: 'plan', toolClass: 'write', expect: 'deny' },
      { mode: 'plan', toolClass: 'exec', expect: 'deny' },
      { mode: 'manual', toolClass: 'read', expect: 'allow' },
      { mode: 'manual', toolClass: 'write', expect: 'ask' },
      { mode: 'manual', toolClass: 'exec', expect: 'ask' },
      { mode: 'edits', toolClass: 'read', expect: 'allow' },
      { mode: 'edits', toolClass: 'write', expect: 'allow' },
      { mode: 'edits', toolClass: 'exec', expect: 'ask' },
      { mode: 'bypass', toolClass: 'read', expect: 'allow' },
      { mode: 'bypass', toolClass: 'write', expect: 'allow' },
      { mode: 'bypass', toolClass: 'exec', expect: 'allow' },
    ];

    for (const row of matrix) {
      it(`${row.mode} + ${row.toolClass} → ${row.expect}`, async () => {
        const asked: ToolCall[] = [];
        const decide = buildCanUseTool(
          deps({
            mode: modeDeps(row.toolClass, {
              getMode: () => row.mode,
              requestApproval: (c) => {
                asked.push(c);
                return Promise.resolve('allow');
              },
            }),
          }),
        );
        const decision = await decide(call);

        if (row.expect === 'deny') {
          expect(decision.behavior).toBe('deny');
          expect(asked).toHaveLength(0);
        } else if (row.expect === 'allow') {
          expect(decision).toEqual({ behavior: 'allow' });
          expect(asked).toHaveLength(0);
        } else {
          // 'ask' — the predicate consulted requestApproval, and (since it answered
          // 'allow' here) the call was allowed through.
          expect(asked).toEqual([call]);
          expect(decision).toEqual({ behavior: 'allow' });
        }
      });
    }
  });

  it('a denied ask resolves to a deny with a mode-attributed message', async () => {
    const decide = buildCanUseTool(
      deps({
        mode: modeDeps('write', {
          getMode: () => 'manual',
          requestApproval: () => Promise.resolve('deny'),
        }),
      }),
    );
    const decision = await decide(call);
    expect(decision.behavior).toBe('deny');
    expect(decision.behavior === 'deny' && decision.message).toMatch(/manual/);
  });

  it('degrades to honest bypass when the backend has no approval seam, regardless of configured mode', async () => {
    const asked: ToolCall[] = [];
    const decide = buildCanUseTool(
      deps({
        mode: modeDeps('write', {
          getMode: () => 'manual',
          hasApprovalSeam: () => false,
          requestApproval: (c) => {
            asked.push(c);
            return Promise.resolve('deny');
          },
        }),
      }),
    );
    expect(await decide(call)).toEqual({ behavior: 'allow' });
    expect(asked).toHaveLength(0);
  });

  it('plan mode blocks a write outright — it never asks, unlike manual', async () => {
    const asked: ToolCall[] = [];
    const decide = buildCanUseTool(
      deps({
        mode: modeDeps('write', {
          getMode: () => 'plan',
          requestApproval: (c) => {
            asked.push(c);
            return Promise.resolve('allow');
          },
        }),
      }),
    );
    const decision = await decide(call);
    expect(decision.behavior).toBe('deny');
    expect(asked).toHaveLength(0);
  });

  it('a mid-session mode switch is read fresh on each call — the next call sees it, not a stale snapshot', async () => {
    let current: PermissionMode = 'manual';
    const asked: ToolCall[] = [];
    const decide = buildCanUseTool(
      deps({
        mode: modeDeps('write', {
          getMode: () => current,
          requestApproval: (c) => {
            asked.push(c);
            return Promise.resolve('allow');
          },
        }),
      }),
    );

    // First call, under 'manual': asks.
    expect(await decide(call)).toEqual({ behavior: 'allow' });
    expect(asked).toHaveLength(1);

    // Switch mid-session, THEN the next call: no longer asks (edits auto-approves write).
    current = 'edits';
    expect(await decide(call)).toEqual({ behavior: 'allow' });
    expect(asked).toHaveLength(1); // unchanged — the second call never asked
  });

  it('fails closed when requestApproval rejects', async () => {
    const decide = buildCanUseTool(
      deps({
        mode: modeDeps('write', {
          getMode: () => 'manual',
          requestApproval: () => Promise.reject(new Error('daemon torn down mid-ask')),
        }),
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
