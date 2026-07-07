import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import { createConversationStore, type ConversationStore } from './conversation-store.js';
import { configHashOf } from './prompt-freeze.js';

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
  /** Set by the `steerable` mode once `init.drainSteer` is consulted (test observation point). */
  drained: readonly string[] = [];

  constructor(
    readonly init: SessionAdapterInit,
    readonly frames: TurnFrame[],
    readonly fail = false,
    /** Simulate a pure-API backend: hand back the settled transcript instead of a server session id. */
    readonly pureApi = false,
    /** Model the fixed adapter: flush the canonical transcript, then throw (a mid-turn drop). */
    readonly flushThenFail = false,
    /**
     * Model a real backend's abort behavior: never settles on its own — only
     * `init.signal` firing ends the loop, by REJECTING (mirroring an aborted
     * in-flight request throwing), after flushing settlement — same shape as
     * the governed loop driver's abort-then-finally-flush.
     */
    readonly abortable = false,
    /**
     * Model the pure-API driver's safe-boundary steer drain: yield once (so a
     * test can call `steerSession` in the gap) before consulting
     * `init.drainSteer`, recording what it drained onto `this.drained`.
     */
    readonly steerable = false,
    /**
     * Model the pure-API driver's CLEAN-BREAK interrupt path: the loop's
     * top-of-iteration `if (deps.signal?.aborted) break;` returns cleanly (no
     * throw) instead of rejecting — so the `.then` branch observes the
     * interrupt, not `.catch`.
     */
    readonly cleanBreakAbortable = false,
  ) {}
  renderNative(): BackendConfig {
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {}, files: [] };
  }
  registerTools(): void {}
  denyBuiltins(): void {}
  interceptTool(_c: CanUseTool): void {}
  interceptStop(_s: StopPredicate): void {}
  async runLoop(): Promise<void> {
    if (this.cleanBreakAbortable) {
      await new Promise<void>((resolve) => {
        this.init.signal?.addEventListener(
          'abort',
          () => {
            this.init.onSettle(this.init.sessionId, { tokensIn: 1, tokensOut: 1, costUsd: 0.1 });
            resolve(); // clean return — the loop's top-of-iteration break, not a throw
          },
          { once: true },
        );
      });
      return;
    }
    if (this.abortable) {
      await new Promise<void>((_resolve, reject) => {
        this.init.signal?.addEventListener(
          'abort',
          () => {
            this.init.onSettle(this.init.sessionId, { tokensIn: 1, tokensOut: 1, costUsd: 0.1 });
            reject(new Error('aborted'));
          },
          { once: true },
        );
      });
      return;
    }
    if (this.steerable) {
      await new Promise((r) => setTimeout(r, 0));
      this.drained = this.init.drainSteer?.() ?? [];
      for (const frame of this.frames) this.init.onTurn?.(frame);
      this.init.onSettle(this.init.sessionId, { tokensIn: 1, tokensOut: 2, costUsd: 0.25 });
      return;
    }
    if (this.flushThenFail) {
      const input = typeof this.init.input === 'string' ? this.init.input : '';
      this.init.onBackendMessages?.([
        ...(this.init.history ?? []),
        { role: 'user', content: input },
        { role: 'assistant', content: 'reply' },
      ]);
      throw new Error('stream dropped after partial work');
    }
    if (this.fail) throw new Error('loop blew up');
    const input = typeof this.init.input === 'string' ? this.init.input : '';
    for (const frame of this.frames) this.init.onTurn?.(frame);
    // A pure-API backend when constructed so, or whenever the turn routes to DeepSeek
    // (so a single session can switch providers across sends).
    const isPureApi = this.pureApi || this.init.model?.provider === 'deepseek';
    // Both backends now report the canonical transcript (prior history + this turn).
    this.init.onBackendMessages?.([
      ...(this.init.history ?? []),
      { role: 'user', content: input },
      { role: 'assistant', content: 'reply' },
    ]);
    // A server-session backend (Claude) additionally reports its resumable id.
    if (!isPureApi) this.init.onBackendSession?.(`backend-${this.init.sessionId}`);
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
    baseCatalogue: [],
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
      if (p.kind === 'status' && (p.state === 'done' || p.state === 'error' || p.state === 'interrupted')) {
        resolve();
      }
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

function depsFlushThenFail(): SessionDeps {
  return { ...deps([]), createAdapter: (init) => new FrameAdapter(init, [], false, false, true) };
}

/** Deps whose adapter factory also records each init, so a test can assert `resume`/`history`. */
function depsCapturing(frames: TurnFrame[], inits: SessionAdapterInit[], pureApi = false): SessionDeps {
  return {
    ...deps(frames),
    createAdapter: (init) => {
      inits.push(init);
      return new FrameAdapter(init, frames, false, pureApi);
    },
  };
}

describe('buildSessionHandlers — persistent conversation (R-7)', () => {
  let dir: string;
  let store: ConversationStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coa-sh-'));
    store = createConversationStore(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('persists the user prompt then the streamed frames, and auto-titles from the prompt', async () => {
    const conn = connection();
    const handlers = buildSessionHandlers(deps([{ t: 'text', text: 'on it' }]), conn, store);
    await handlers['createSession']!.handle({
      input: 'Refactor the auth module',
      role: 'roles/refactor',
      scope: '',
      conversationId: 'c1',
    });
    await conn.settled;

    expect(store.reload('c1')).toEqual([
      { seq: 0, frame: { t: 'text', text: 'Refactor the auth module', role: 'user' } },
      { seq: 1, frame: { t: 'text', text: 'on it' } },
    ]);
    expect(store.getMeta('c1')).toMatchObject({ title: 'Refactor the auth module', agentRef: 'roles/refactor' });
    // The user turn is persisted but NOT pushed (the console showed it optimistically).
    const turns = pushesOf(conn.pushes).filter((p) => p.kind === 'turn');
    expect(turns).toEqual([
      expect.objectContaining({ sessionId: 'c1', seq: 1, frame: { t: 'text', text: 'on it' } }),
    ]);
  });

  it('records the backend session id and resumes it on the next send, continuing the seq', async () => {
    const inits: SessionAdapterInit[] = [];
    const handlers = buildSessionHandlers(depsCapturing([{ t: 'text', text: 'reply' }], inits), connection(), store);

    await handlers['createSession']!.handle({ input: 'first', role: '', scope: '', conversationId: 'c1' });
    expect(store.getMeta('c1')?.backendSessionId).toBe('backend-c1');
    expect(inits[0]?.resume).toBeUndefined(); // no prior memory on the first send

    await handlers['createSession']!.handle({ input: 'second', role: '', scope: '', conversationId: 'c1' });
    expect(inits[1]?.resume).toBe('backend-c1'); // resumes the captured backend session

    expect(store.reload('c1').map((t) => ({ seq: t.seq, frame: t.frame }))).toEqual([
      { seq: 0, frame: { t: 'text', text: 'first', role: 'user' } },
      { seq: 1, frame: { t: 'text', text: 'reply' } },
      { seq: 2, frame: { t: 'text', text: 'second', role: 'user' } },
      { seq: 3, frame: { t: 'text', text: 'reply' } },
    ]);
  });

  it('clears the stale resume token when a send fails mid-turn, so the next send replays a consistent transcript', async () => {
    const conn = connection();
    // Turn 1 succeeds and captures a resumable backend session.
    await buildSessionHandlers(deps([{ t: 'text', text: 'reply' }]), conn, store)['createSession']!.handle({
      input: 'first',
      role: '',
      scope: '',
      conversationId: 'c1',
    });
    await conn.settled;
    expect(store.getMeta('c1')?.backendSessionId).toBe('backend-c1');

    // Turn 2 throws mid-loop (a dropped connection). The stale resume token must be
    // dropped so the next send replays the last-good transcript rather than resuming a
    // phantom server session the model never actually advanced (the "confused agent" bug).
    const conn2 = connection();
    await buildSessionHandlers(deps([], true), conn2, store)['createSession']!.handle({
      input: 'second',
      role: '',
      scope: '',
      conversationId: 'c1',
    });
    await conn2.settled;
    expect(store.getMeta('c1')?.backendSessionId).toBeUndefined();
  });

  it('resends the whole prior transcript as history on the next send (pure-API memory)', async () => {
    const inits: SessionAdapterInit[] = [];
    const handlers = buildSessionHandlers(
      depsCapturing([{ t: 'text', text: 'reply' }], inits, true),
      connection(),
      store,
    );

    await handlers['createSession']!.handle({ input: 'first', role: '', scope: '', conversationId: 'c1' });
    expect(inits[0]?.history).toBeUndefined(); // no memory on the first send

    await handlers['createSession']!.handle({ input: 'second', role: '', scope: '', conversationId: 'c1' });
    // The second send replays turn 1's full transcript verbatim ahead of the new turn.
    expect(inits[1]?.history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
    ]);
    // And the persisted transcript now covers both turns (system omitted).
    expect(store.loadBackendMessages('c1')).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'reply' },
    ]);
  });

  it('does not persist or resume an ephemeral session (no conversationId)', async () => {
    const inits: SessionAdapterInit[] = [];
    const handlers = buildSessionHandlers(depsCapturing([{ t: 'text', text: 'x' }], inits), connection(), store);
    await handlers['createSession']!.handle({ input: 'go' });
    expect(store.list()).toEqual([]);
    expect(inits[0]?.resume).toBeUndefined();
  });
});

describe('buildSessionHandlers — provider pinning + switching (1a/1b)', () => {
  let dir: string;
  let store: ConversationStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coa-sw-'));
    store = createConversationStore(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const send = async (
    handlers: ReturnType<typeof buildSessionHandlers>,
    input: string,
    provider: string,
  ): Promise<void> => {
    // role/scope are supplied explicitly: calling handle() directly bypasses the
    // router's Zod defaults, and metaSchema requires them as strings.
    await handlers['createSession']!.handle({ input, role: '', scope: '', conversationId: 'c1', model: { provider } });
  };

  it('pins the provider and, on a fresh daemon (restart), routes DeepSeek back to itself with memory intact', async () => {
    const inits: SessionAdapterInit[] = [];
    await send(buildSessionHandlers(depsCapturing([{ t: 'text', text: 'r' }], inits), connection(), store), 'first', 'deepseek');
    expect(store.getMeta('c1')?.provider).toBe('deepseek');
    expect(inits[0]?.resume).toBeUndefined();

    // Simulate a console/daemon restart: brand-new handlers over the same on-disk store.
    const inits2: SessionAdapterInit[] = [];
    await send(buildSessionHandlers(depsCapturing([{ t: 'text', text: 'r' }], inits2), connection(), store), 'second', 'deepseek');
    // No wrong-backend revival: still DeepSeek, no Claude resume, and the prior transcript replayed.
    expect(inits2[0]?.resume).toBeUndefined();
    expect(inits2[0]?.deliverHistoryAsPreamble).toBeFalsy();
    expect(inits2[0]?.history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
    ]);
  });

  it('Claude→DeepSeek: drops the Claude resume token and replays the Claude transcript as history', async () => {
    const inits: SessionAdapterInit[] = [];
    const handlers = buildSessionHandlers(depsCapturing([{ t: 'text', text: 'r' }], inits), connection(), store);
    await send(handlers, 'first', 'claude');
    expect(store.getMeta('c1')?.backendSessionId).toBe('backend-c1'); // Claude captured a session
    await send(handlers, 'second', 'deepseek');
    expect(inits[1]?.resume).toBeUndefined(); // the Claude token is not eligible for DeepSeek
    expect(inits[1]?.deliverHistoryAsPreamble).toBeFalsy(); // DeepSeek replays as messages, not a preamble
    expect(inits[1]?.history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
    ]);
  });

  it('DeepSeek→Claude: no resumable session, so the transcript is delivered as a first-turn preamble', async () => {
    const inits: SessionAdapterInit[] = [];
    const handlers = buildSessionHandlers(depsCapturing([{ t: 'text', text: 'r' }], inits), connection(), store);
    await send(handlers, 'first', 'deepseek');
    await send(handlers, 'second', 'claude');
    expect(inits[1]?.resume).toBeUndefined();
    expect(inits[1]?.deliverHistoryAsPreamble).toBe(true);
    expect(inits[1]?.history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
    ]);
  });

  it('same-provider Claude continuation still uses native resume (fast path preserved)', async () => {
    const inits: SessionAdapterInit[] = [];
    const handlers = buildSessionHandlers(depsCapturing([{ t: 'text', text: 'r' }], inits), connection(), store);
    await send(handlers, 'first', 'claude');
    await send(handlers, 'second', 'claude');
    expect(inits[1]?.resume).toBe('backend-c1');
    expect(inits[1]?.deliverHistoryAsPreamble).toBeFalsy();
  });

  it('compiles the prompt once and freezes it; later turns reuse the frozen compilation', async () => {
    let compiles = 0;
    const base = deps([{ t: 'text', text: 'r' }]);
    const countingDeps: SessionDeps = {
      ...base,
      compile: (...args) => {
        compiles += 1;
        return base.compile(...args);
      },
    };
    const handlers = buildSessionHandlers(countingDeps, connection(), store);
    await handlers['createSession']!.handle({ input: 'first', role: '', scope: '', conversationId: 'c1' });
    expect(compiles).toBe(1);
    expect(store.getCompilation('c1')?.promptVersion).toBeTruthy();

    // The second turn reuses the frozen compilation — no recompile.
    await handlers['createSession']!.handle({ input: 'second', role: '', scope: '', conversationId: 'c1' });
    expect(compiles).toBe(1);
  });

  it('reuses the frozen prompt for the same model but recompiles on a model switch — without reporting drift', async () => {
    let compiles = 0;
    const base = deps([{ t: 'text', text: 'r' }]);
    const countingDeps: SessionDeps = {
      ...base,
      compile: (...args) => {
        compiles += 1;
        return base.compile(...args);
      },
    };
    const handlers = buildSessionHandlers(countingDeps, connection(), store);

    // First send on claude → compiles + freezes, stamped with the model.
    await handlers['createSession']!.handle({
      input: 'first', role: 'swe', scope: '', conversationId: 'c1', model: { provider: 'claude', model: 'opus' },
    });
    expect(compiles).toBe(1);
    const firstHash = store.getCompilation('c1')?.configHash;
    expect(store.getCompilation('c1')?.model).toEqual({ provider: 'claude', model: 'opus' });

    // Same model → frozen prompt reused, no recompile.
    await handlers['createSession']!.handle({
      input: 'second', role: 'swe', scope: '', conversationId: 'c1', model: { provider: 'claude', model: 'opus' },
    });
    expect(compiles).toBe(1);

    // Switched model → recompiles so the `## Model` line is re-authored...
    await handlers['createSession']!.handle({
      input: 'third', role: 'swe', scope: '', conversationId: 'c1', model: { provider: 'deepseek', model: 'v4' },
    });
    expect(compiles).toBe(2);
    expect(store.getCompilation('c1')?.model).toEqual({ provider: 'deepseek', model: 'v4' });
    // ...but the drift key (role + packages) is unchanged: a model switch is NOT drift.
    expect(store.getCompilation('c1')?.configHash).toBe(firstHash);
  });

  it('stamps the frozen compilation with the drift key of the config that produced it', async () => {
    const handlers = buildSessionHandlers(deps([{ t: 'text', text: 'r' }]), connection(), store);
    await handlers['createSession']!.handle({
      input: 'first',
      role: 'swe',
      scope: 'src',
      conversationId: 'c1',
      packageIds: ['research'],
    });
    expect(store.getCompilation('c1')?.configHash).toBe(
      configHashOf({ role: 'swe', packageIds: ['research'] }),
    );
    // The source config is stored too, so the console can detect drift predictively.
    expect(store.getCompilation('c1')?.config).toEqual({ role: 'swe', packageIds: ['research'] });
  });

  it('stamps the frozen compilation with the sorted role list when multiple roles are selected', async () => {
    const handlers = buildSessionHandlers(deps([{ t: 'text', text: 'r' }]), connection(), store);
    await handlers['createSession']!.handle({
      input: 'first',
      role: '',
      scope: '',
      conversationId: 'c1',
      roles: ['swe', 'researcher'],
    });
    expect(store.getCompilation('c1')?.config.roles).toEqual(['researcher', 'swe']);
    expect(store.getCompilation('c1')?.configHash).toBe(
      configHashOf({ role: '', roles: ['swe', 'researcher'] }),
    );
  });

  it('recompilePrompt drops the frozen prompt and the resume token so the next turn recompiles', async () => {
    const conn = connection();
    const handlers = buildSessionHandlers(deps([{ t: 'text', text: 'r' }]), conn, store);
    await handlers['createSession']!.handle({ input: 'first', role: 'swe', scope: '', conversationId: 'c1' });
    await conn.settled;
    expect(store.getCompilation('c1')).toBeDefined();
    expect(store.getMeta('c1')?.backendSessionId).toBe('backend-c1');

    expect(await handlers['recompilePrompt']!.handle({ sessionId: 'c1' })).toEqual({ recompiled: true });
    expect(store.getCompilation('c1')).toBeUndefined();
    expect(store.getMeta('c1')?.backendSessionId).toBeUndefined();
  });

  it('recompilePrompt is a no-op (never throws) without a store', async () => {
    const handlers = buildSessionHandlers(deps([{ t: 'text', text: 'r' }]), connection());
    expect(await handlers['recompilePrompt']!.handle({ sessionId: 'c1' })).toEqual({ recompiled: false });
  });

  it('pins the effective provider even when the send names only a model (keeps the pin complete for routing + drift/cache detection)', async () => {
    const handlers = buildSessionHandlers(deps([{ t: 'text', text: 'r' }]), connection(), store);
    await handlers['createSession']!.handle({
      input: 'first', role: '', scope: '', conversationId: 'c1', model: { model: 'opus' },
    });
    expect(store.getMeta('c1')?.provider).toBe('claude');
    expect(store.getMeta('c1')?.model).toBe('opus');
  });
});

function depsAbortable(): SessionDeps {
  return { ...deps([]), createAdapter: (init) => new FrameAdapter(init, [], false, false, false, true) };
}

/** A backend whose loop returns CLEANLY (no throw) once the interrupt lands — the
 *  pure-API driver's top-of-iteration break, not a rejected in-flight request. */
function depsCleanBreakAbortable(): SessionDeps {
  return {
    ...deps([]),
    createAdapter: (init) => new FrameAdapter(init, [], false, false, false, false, false, true),
  };
}

function depsSteerable(adapters: FrameAdapter[]): SessionDeps {
  return {
    ...deps([]),
    createAdapter: (init) => {
      const adapter = new FrameAdapter(init, [{ t: 'text', text: 'ok' }], false, false, false, false, true);
      adapters.push(adapter);
      return adapter;
    },
  };
}

describe('buildSessionHandlers — interruptSession / steerSession (CHAT-10)', () => {
  it('aborts the session and surfaces a clean interrupted stop — never an error (SC-1)', async () => {
    const conn = connection();
    const handlers = buildSessionHandlers(depsAbortable(), conn);
    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });

    expect(await handlers['interruptSession']!.handle({ id: sessionId })).toEqual({ interrupted: true });
    // Flush the microtasks the abort → reject → `.catch()` chain needs to settle.
    await new Promise((r) => setTimeout(r, 0));

    const pushes = pushesOf(conn.pushes);
    expect(pushes).toEqual([
      { kind: 'status', sessionId: 'sess-1', worktree: '/wt/sess-1', state: 'running' },
      { kind: 'status', sessionId: 'sess-1', worktree: '/wt/sess-1', state: 'interrupted' },
    ]);
    // No error frame and no error status — an interrupt is a user stop, not a governance block.
    expect(pushes.some((p) => p.kind === 'turn' && p.frame.t === 'error')).toBe(false);
    expect(pushes.some((p) => p.kind === 'status' && p.state === 'error')).toBe(false);
  });

  it('emits `interrupted` exactly once when the loop returns cleanly after an abort (clean-break path)', async () => {
    const conn = connection();
    const handlers = buildSessionHandlers(depsCleanBreakAbortable(), conn);
    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });

    expect(await handlers['interruptSession']!.handle({ id: sessionId })).toEqual({ interrupted: true });
    // Flush the microtasks the abort → resolve → `.then()` chain needs to settle.
    await new Promise((r) => setTimeout(r, 0));

    const pushes = pushesOf(conn.pushes);
    // `interruptSession` emits `interrupted` synchronously; the `.then` branch must NOT
    // emit a second status once the loop settles cleanly on the same interrupt.
    expect(pushes.filter((p) => p.kind === 'status' && p.state === 'interrupted')).toHaveLength(1);
    expect(pushes.some((p) => p.kind === 'status' && p.state === 'done')).toBe(false);
    expect(pushes.some((p) => p.kind === 'status' && p.state === 'error')).toBe(false);
  });

  it('queues a steer turn the pure-API driver drains at its next safe boundary', async () => {
    const conn = connection();
    const adapters: FrameAdapter[] = [];
    const handlers = buildSessionHandlers(depsSteerable(adapters), conn);
    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });

    expect(await handlers['steerSession']!.handle({ id: sessionId, text: 'also fix the tests' })).toEqual({
      steered: true,
    });
    await conn.settled;

    expect(adapters[0]?.drained).toEqual(['also fix the tests']);
  });

  it('interruptSession on an unknown id returns the negative result without throwing', async () => {
    const handlers = buildSessionHandlers(deps([]), connection());
    expect(await handlers['interruptSession']!.handle({ id: 'nope' })).toEqual({ interrupted: false });
  });

  it('steerSession on an unknown id returns the negative result without throwing', async () => {
    const handlers = buildSessionHandlers(deps([]), connection());
    expect(await handlers['steerSession']!.handle({ id: 'nope', text: 'hi' })).toEqual({ steered: false });
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

describe('buildSessionHandlers — block-preserving persistence on error', () => {
  it('persists the flushed transcript and still surfaces an error status', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-conv-'));
    try {
      const store = createConversationStore(dir);
      const conn = connection();
      const handlers = buildSessionHandlers(depsFlushThenFail(), conn, store);
      await handlers['createSession']!.handle({ input: 'edit the file', conversationId: 'c1' });
      await conn.settled;

      // The completed work reached canonical memory despite the mid-turn throw.
      expect(store.loadBackendMessages('c1')).toContainEqual({ role: 'assistant', content: 'reply' });
      // The failure is still surfaced (SC-1: surface, don't cage).
      expect(pushesOf(conn.pushes).at(-1)).toMatchObject({ kind: 'status', state: 'error' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
