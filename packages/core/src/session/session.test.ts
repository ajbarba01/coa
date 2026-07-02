import { describe, expect, it } from 'vitest';
import type { CapabilitySet, NeutralConfig } from '@coa/shared';
import {
  barebonesProfile,
  type BackendConfig,
  type CanUseTool,
  type RuntimeAdapter,
  type RuntimeUsage,
  type StopPredicate,
} from '@coa/spi';
import {
  createSession,
  closeSession,
  type SessionAdapterInit,
  type SessionDeps,
} from './session.js';

const NEUTRAL: NeutralConfig = {
  prefixHead: [],
  systemReminders: [],
  onDemandPullable: [],
  scopePushed: [],
  toolIntents: { allow: [], deny: [] },
};

const SANDBOX: CapabilitySet = {
  allowedTools: [],
  denyRules: [],
  permissionMode: 'default',
  denyRead: [],
};

class FakeAdapter implements RuntimeAdapter {
  readonly calls: string[] = [];
  canUseTool: CanUseTool | undefined;
  stopPredicate: StopPredicate | undefined;
  ranWith: { worktree: string } | undefined;
  constructor(readonly init: SessionAdapterInit) {}
  renderNative(config: NeutralConfig): BackendConfig {
    this.calls.push('renderNative');
    void config;
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {}, files: [] };
  }
  registerTools(): void {
    this.calls.push('registerTools');
  }
  denyBuiltins(): void {
    this.calls.push('denyBuiltins');
  }
  interceptTool(canUseTool: CanUseTool): void {
    this.calls.push('interceptTool');
    this.canUseTool = canUseTool;
  }
  interceptStop(stopPredicate: StopPredicate): void {
    this.calls.push('interceptStop');
    this.stopPredicate = stopPredicate;
  }
  async runLoop(config: { worktree: string }): Promise<void> {
    this.calls.push('runLoop');
    this.ranWith = { worktree: config.worktree };
    // Simulate the SDK settling a result so the onSettle → charge wire is exercised.
    this.init.onSettle(this.init.sessionId, { tokensIn: 1, tokensOut: 2, costUsd: 0.5 });
  }
  deliverReminder(): void {}
  render_context(): void {}
  inject_runtime(): void {}
  cache_control(): void {}
  usageTelemetry(): RuntimeUsage {
    return { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  }
  capabilityProfile() {
    return barebonesProfile;
  }
  refs() {
    return null;
  }
  runEval() {
    return Promise.reject(new Error('no eval'));
  }
}

interface Stats {
  charged: { sessionId: string; usage: RuntimeUsage }[];
  released: string[];
  checkpoints: number;
}

function harness(over: Partial<SessionDeps> = {}): {
  deps: SessionDeps;
  stats: Stats;
  adapter: () => FakeAdapter | undefined;
} {
  const stats: Stats = { charged: [], released: [], checkpoints: 0 };
  let built: FakeAdapter | undefined;
  const deps: SessionDeps = {
    newSessionId: () => 'sess-1',
    bindWorktree: () => '/repo/.coa/wt/sess-1',
    releaseWorktree: (wt) => stats.released.push(wt),
    assemblePieces: () => ({ pieces: [], frame: { allow: [], deny: [] } }),
    compile: () => NEUTRAL,
    sandboxPolicy: () => SANDBOX,
    capState: () => ({ capHit: false, remaining: null }),
    charge: (sessionId, usage) => stats.charged.push({ sessionId, usage }),
    perToolDeny: () => undefined,
    gate: () => ({ allow: true }),
    catalogue: [],
    checkpoint: () => {
      stats.checkpoints += 1;
    },
    createAdapter: (init) => {
      built = new FakeAdapter(init);
      return built;
    },
    ...over,
  };
  return { deps, stats, adapter: () => built };
}

describe('createSession', () => {
  it('binds, compiles, renders, wires both hooks, then runs the loop in order', async () => {
    const h = harness();
    const session = await createSession({ role: 'dev', scope: 'src', input: 'go' }, h.deps);
    const adapter = h.adapter();

    expect(session.id).toBe('sess-1');
    expect(session.worktree).toBe('/repo/.coa/wt/sess-1');
    expect(adapter?.ranWith).toEqual({ worktree: '/repo/.coa/wt/sess-1' });
    expect(adapter?.calls).toEqual([
      'renderNative',
      'denyBuiltins',
      'registerTools',
      'interceptTool',
      'interceptStop',
      'runLoop',
    ]);
  });

  it('threads the assembly selection (packageIds + exclude) into assemblePieces', async () => {
    let seen: Parameters<SessionDeps['assemblePieces']>[0] | undefined;
    const h = harness({
      assemblePieces: (ctx) => {
        seen = ctx;
        return { pieces: [], frame: { allow: [], deny: [] } };
      },
    });
    await createSession(
      { role: 'swe', scope: 'src', input: 'go', packageIds: ['research'], exclude: ['core'] },
      h.deps,
    );
    expect(seen).toMatchObject({ packageIds: ['research'], exclude: ['core'] });
  });

  it('wires the settlement callback to the cost charge', async () => {
    const h = harness();
    await createSession({ role: 'dev', scope: 'src', input: 'go' }, h.deps);
    expect(h.stats.charged).toEqual([
      { sessionId: 'sess-1', usage: { tokensIn: 1, tokensOut: 2, costUsd: 0.5 } },
    ]);
  });

  it('wires a cost-cap-aware canUseTool predicate onto the tool hook', async () => {
    const h = harness({ capState: () => ({ capHit: true, remaining: null }) });
    await createSession({ role: 'dev', scope: 'src', input: 'go' }, h.deps);
    const decision = await h
      .adapter()
      ?.canUseTool?.({ tool: 'apply_patch', args: {}, sessionId: 'sess-1' });
    expect(decision?.behavior).toBe('deny');
  });

  it('passes the computed per-session budget to the adapter init', async () => {
    const h = harness({ perSessionCeiling: 4, capState: () => ({ capHit: false, remaining: 9 }) });
    await createSession({ role: 'dev', scope: 'src', input: 'go' }, h.deps);
    expect(h.adapter()?.init.maxBudgetUsd).toBe(4);
  });

  it('threads the active account locator into the adapter init and stamps the session label', async () => {
    const h = harness({
      activeAccount: () => ({ label: 'work', locator: { type: 'config-dir', dir: '/d' } }),
    });
    const session = await createSession({ role: 'dev', scope: 'src', input: 'go' }, h.deps);
    expect(h.adapter()?.init.locator).toEqual({ type: 'config-dir', dir: '/d' });
    expect(session.account).toBe('work');
  });

  it('stamps ambient and passes no locator when the active account is ambient', async () => {
    const h = harness({ activeAccount: () => ({ label: 'ambient' }) });
    const session = await createSession({ role: 'dev', scope: 'src', input: 'go' }, h.deps);
    expect(h.adapter()?.init.locator).toBeUndefined();
    expect(session.account).toBe('ambient');
  });

  it('omits the account entirely when account selection is not wired (strict superset)', async () => {
    const h = harness();
    const session = await createSession({ role: 'dev', scope: 'src', input: 'go' }, h.deps);
    expect(h.adapter()?.init.locator).toBeUndefined();
    expect(session.account).toBeUndefined();
  });

  it('records settled spend attributed to the active account label', async () => {
    const spend: unknown[] = [];
    const h = harness({
      activeAccount: () => ({ label: 'work', locator: { type: 'config-dir', dir: '/d' } }),
      recordSpend: (record) => spend.push(record),
    });
    await createSession({ role: 'dev', scope: 'src', input: 'go' }, h.deps);
    expect(spend).toEqual([{ costUsd: 0.5, tokensIn: 1, tokensOut: 2, account: 'work' }]);
  });
});

describe('closeSession', () => {
  it('checkpoints at the boundary and releases the worktree', () => {
    const h = harness();
    closeSession(
      {
        id: 'sess-1',
        config: {
          role: 'dev',
          scope: 'src',
          worktree: '/wt',
          capabilityFrame: { allow: [], deny: [] },
        },
        worktree: '/wt',
      },
      h.deps,
    );
    expect(h.stats.released).toEqual(['/wt']);
    expect(h.stats.checkpoints).toBe(1);
  });
});
