import { describe, expect, it } from 'vitest';
import type { CapabilitySet, NeutralConfig, Push, RpcNotification, TurnFrame } from '@coa/shared';
import {
  barebonesProfile,
  type BackendConfig,
  type CanUseTool,
  type RuntimeAdapter,
  type RuntimeUsage,
  type StopPredicate,
} from '@coa/spi';
import type { SessionAdapterInit, SessionDeps } from './session.js';
import { buildSessionHandlers } from './session-handlers.js';

const NEUTRAL: NeutralConfig = {
  prefixHead: [],
  systemReminders: [],
  onDemandPullable: [],
  scopePushed: [],
  toolIntents: { allow: [], deny: [] },
};
const SANDBOX: CapabilitySet = { allowedTools: [], denyRules: [], permissionMode: 'default', denyRead: [] };

/** A fake backend that streams the configured frames through `onTurn`, then settles. */
class FrameAdapter implements RuntimeAdapter {
  constructor(
    readonly init: SessionAdapterInit,
    readonly frames: TurnFrame[],
    readonly fail = false,
  ) {}
  renderNative(): BackendConfig {
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {}, files: [] };
  }
  registerTools(): void {}
  denyBuiltins(): void {}
  interceptTool(_c: CanUseTool): void {}
  interceptStop(_s: StopPredicate): void {}
  async runLoop(): Promise<void> {
    if (this.fail) throw new Error('loop blew up');
    for (const frame of this.frames) this.init.onTurn?.(frame);
    this.init.onSettle(this.init.sessionId, { tokensIn: 1, tokensOut: 2, costUsd: 0.25 });
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

function deps(frames: TurnFrame[], fail = false): SessionDeps {
  return {
    newSessionId: () => 'sess-1',
    bindWorktree: () => '/wt/sess-1',
    releaseWorktree: () => {},
    assemblePieces: () => ({ pieces: [], frame: { allow: [], deny: [] } }),
    compile: () => NEUTRAL,
    sandboxPolicy: () => SANDBOX,
    capState: () => ({ capHit: false, remaining: null }),
    charge: () => {},
    perToolDeny: () => undefined,
    gate: () => ({ allow: true }),
    catalogue: [],
    checkpoint: () => {},
    createAdapter: (init) => new FrameAdapter(init, frames, fail),
  };
}

/** A fake connection that records pushes and resolves once a terminal `status` arrives. */
function connection(): { push: (n: RpcNotification) => void; pushes: RpcNotification[]; settled: Promise<void> } {
  const pushes: RpcNotification[] = [];
  let resolve!: () => void;
  const settled = new Promise<void>((r) => (resolve = r));
  return {
    pushes,
    settled,
    push: (n) => {
      pushes.push(n);
      const p = n.params as Push;
      if (p.kind === 'status' && (p.state === 'done' || p.state === 'error')) resolve();
    },
  };
}

const pushesOf = (notes: RpcNotification[]): Push[] => notes.map((n) => n.params as Push);

describe('buildSessionHandlers — createSession over RPC', () => {
  it('returns the session id + worktree once the session starts', async () => {
    const conn = connection();
    const handlers = buildSessionHandlers(deps([{ t: 'text', text: 'hi' }]), conn);
    const result = await handlers['createSession']!.handle({ input: 'go' });
    expect(result).toEqual({ sessionId: 'sess-1', worktree: '/wt/sess-1' });
    await conn.settled;
  });

  it('streams a running status, sequenced turn frames, then a done status', async () => {
    const conn = connection();
    const frames: TurnFrame[] = [
      { t: 'text', text: 'thinking out loud' },
      { t: 'tool_use', tool: 'Read', input: { path: 'a' }, handle: 'tu1' },
    ];
    const handlers = buildSessionHandlers(deps(frames), conn);
    await handlers['createSession']!.handle({ input: 'go' });
    await conn.settled;

    expect(pushesOf(conn.pushes)).toEqual([
      { kind: 'status', sessionId: 'sess-1', worktree: '/wt/sess-1', state: 'running' },
      { kind: 'turn', sessionId: 'sess-1', worktree: '/wt/sess-1', seq: 0, frame: frames[0] },
      { kind: 'turn', sessionId: 'sess-1', worktree: '/wt/sess-1', seq: 1, frame: frames[1] },
      { kind: 'status', sessionId: 'sess-1', worktree: '/wt/sess-1', state: 'done' },
    ]);
  });

  it('every pushed record is sent as a `push` JSON-RPC notification', async () => {
    const conn = connection();
    const handlers = buildSessionHandlers(deps([{ t: 'text', text: 'x' }]), conn);
    await handlers['createSession']!.handle({ input: 'go' });
    await conn.settled;
    expect(conn.pushes.every((n) => n.method === 'push')).toBe(true);
  });

  it('surfaces a loop failure as an error frame + an error status (never a thrown RPC)', async () => {
    const conn = connection();
    const handlers = buildSessionHandlers(deps([], true), conn);
    await handlers['createSession']!.handle({ input: 'go' });
    await conn.settled;

    const kinds = pushesOf(conn.pushes);
    expect(kinds[0]).toMatchObject({ kind: 'status', state: 'running' });
    expect(kinds).toContainEqual(
      expect.objectContaining({ kind: 'turn', frame: { t: 'error', message: 'loop blew up', origin: 'loop' } }),
    );
    expect(kinds.at(-1)).toMatchObject({ kind: 'status', state: 'error' });
  });

  it('rejects a request with no input via invalid params (Zod-validated)', () => {
    const conn = connection();
    const handlers = buildSessionHandlers(deps([]), conn);
    expect(handlers['createSession']!.params?.safeParse({}).success).toBe(false);
  });
});

describe('buildSessionHandlers — closeSession', () => {
  it('checkpoints + releases a known finished session and reports closed', async () => {
    const released: string[] = [];
    let checkpoints = 0;
    const base = deps([{ t: 'text', text: 'x' }]);
    const conn = connection();
    const handlers = buildSessionHandlers(
      { ...base, releaseWorktree: (wt) => released.push(wt), checkpoint: () => (checkpoints += 1) },
      conn,
    );
    await handlers['createSession']!.handle({ input: 'go' });
    await conn.settled;

    const closed = await handlers['closeSession']!.handle({ id: 'sess-1' });
    expect(closed).toEqual({ closed: true });
    expect(released).toEqual(['/wt/sess-1']);
    expect(checkpoints).toBe(1);
  });

  it('reports not-closed for an unknown session id', async () => {
    const conn = connection();
    const handlers = buildSessionHandlers(deps([]), conn);
    expect(await handlers['closeSession']!.handle({ id: 'nope' })).toEqual({ closed: false });
  });
});
