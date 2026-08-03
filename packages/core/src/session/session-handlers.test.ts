import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { LiveSessionRegistry } from './live-registry.js';

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

/** A fake backend that streams the configured frames through `onTurn`, then settles. */
class FrameAdapter implements RuntimeAdapter {
  /** Set by the `steerable` mode once `init.drainSteer` is consulted (test observation point). */
  drained: readonly string[] = [];
  /** Set by the `steerable` mode once `init.drainQueuedSteer` is consulted (test observation point). */
  queueDrained: readonly string[] = [];

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
      this.queueDrained = this.init.drainQueuedSteer?.() ?? [];
      for (const frame of this.frames) this.init.onTurn?.(frame);
      this.init.onSettle(this.init.sessionId, { tokensIn: 1, tokensOut: 2, costUsd: 0.25 });
      return;
    }
    if (this.flushThenFail) {
      // Partial work streams (and so persists, via the per-frame `onTurn` append) before
      // the mid-turn drop — proving completed work survives a throw (block-preserving
      // persistence), now via the event log rather than a whole-transcript flush.
      this.init.onTurn?.({ t: 'text', text: 'reply' });
      throw new Error('stream dropped after partial work');
    }
    if (this.fail) throw new Error('loop blew up');
    for (const frame of this.frames) this.init.onTurn?.(frame);
    // A pure-API backend when constructed so, or whenever the turn routes to DeepSeek
    // (so a single session can switch providers across sends).
    const isPureApi = this.pureApi || this.init.model?.provider === 'deepseek';
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

/** A fake backend that streams enriched (frame, full) pairs through `onTurn`, then settles —
 *  proving a tool_result's FULL body (not just the lossy pointer) reaches persistence
 *  (docs/adr/0010's fidelity companion, threaded end to end via `onTurn(frame, full)`). */
class EnrichedFrameAdapter implements RuntimeAdapter {
  constructor(
    readonly init: SessionAdapterInit,
    readonly enriched: ReadonlyArray<{ frame: TurnFrame; full?: string }>,
  ) {}
  renderNative(): BackendConfig {
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {}, files: [] };
  }
  registerTools(): void {}
  denyBuiltins(): void {}
  interceptTool(_c: CanUseTool): void {}
  interceptStop(_s: StopPredicate): void {}
  async runLoop(): Promise<void> {
    for (const { frame, full } of this.enriched) this.init.onTurn?.(frame, full);
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

/** A fake connection that records pushes and resolves once a terminal `status` arrives.
 *  `triggerClose` simulates the underlying stream closing (a dropped socket), firing every
 *  listener registered via `onClose` — the seam `buildSessionHandlers` uses to release its
 *  per-connection sinks. */
function connection(): {
  push: (n: RpcNotification) => void;
  pushes: RpcNotification[];
  settled: Promise<void>;
  onClose: (listener: () => void) => void;
  triggerClose: () => void;
} {
  const pushes: RpcNotification[] = [];
  let resolve!: () => void;
  const settled = new Promise<void>((r) => (resolve = r));
  const closeListeners: (() => void)[] = [];
  return {
    pushes,
    settled,
    push: (n) => {
      pushes.push(n);
      const p = n.params as Push;
      if (
        p.kind === 'status' &&
        (p.state === 'done' || p.state === 'error' || p.state === 'interrupted')
      ) {
        resolve();
      }
    },
    onClose: (listener) => {
      closeListeners.push(listener);
    },
    triggerClose: () => {
      for (const l of [...closeListeners]) l();
    },
  };
}

const pushesOf = (notes: RpcNotification[]): Push[] => notes.map((n) => n.params as Push);

/** Let every currently-pending microtask (incl. the loop's post-turn `idle` push,
 *  which lands one hop after the turn's own `done`/`error`/`interrupted`) settle. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('buildSessionHandlers — createSession over RPC', () => {
  it('returns the session id + worktree once the session starts', async () => {
    const conn = connection();
    const handlers = buildSessionHandlers(
      deps([{ t: 'text', text: 'hi' }]),
      conn,
      undefined,
      new LiveSessionRegistry(),
    );
    const result = await handlers['createSession']!.handle({ input: 'go' });
    expect(result).toEqual({ sessionId: 'sess-1', worktree: '/wt/sess-1' });
    await conn.settled;
  });

  it('stamps a settled thinking frame with a reasoning duration (persisted so reload shows "Thought for Ns")', async () => {
    const conn = connection();
    const frames: TurnFrame[] = [
      { t: 'thinking-delta', text: 'wei' },
      { t: 'thinking-delta', text: 'ghing' },
      { t: 'thinking', text: 'weighing' },
      { t: 'text', text: 'answer' },
    ];
    const handlers = buildSessionHandlers(deps(frames), conn, undefined, new LiveSessionRegistry());
    await handlers['createSession']!.handle({ input: 'go' });
    await conn.settled;
    await flush();

    const pushes = pushesOf(conn.pushes);
    const thinking = pushes.find((p) => p.kind === 'turn' && p.frame.t === 'thinking');
    // The settled thinking frame carries a numeric duration (measured from its delta span).
    expect(thinking?.kind === 'turn' && thinking.frame.t === 'thinking').toBe(true);
    if (thinking?.kind === 'turn' && thinking.frame.t === 'thinking') {
      expect(typeof thinking.frame.durationMs).toBe('number');
    }
    // The answer text frame is untouched — duration is a reasoning-only stamp.
    const text = pushes.find((p) => p.kind === 'turn' && p.frame.t === 'text');
    expect(text?.kind === 'turn' && text.frame.t === 'text' && 'durationMs' in text.frame).toBe(
      false,
    );
  });

  it('streams a running status, sequenced turn frames, then a done status', async () => {
    const conn = connection();
    const frames: TurnFrame[] = [
      { t: 'text', text: 'thinking out loud' },
      { t: 'tool_use', tool: 'Read', input: { path: 'a' }, handle: 'tu1' },
    ];
    const handlers = buildSessionHandlers(deps(frames), conn, undefined, new LiveSessionRegistry());
    await handlers['createSession']!.handle({ input: 'go' });
    await conn.settled;
    await flush(); // the live session's post-turn `idle` (run-live-session.ts) lands one hop later

    expect(pushesOf(conn.pushes)).toEqual([
      { kind: 'status', sessionId: 'sess-1', worktree: '/wt/sess-1', state: 'running' },
      { kind: 'turn', sessionId: 'sess-1', worktree: '/wt/sess-1', seq: 0, frame: frames[0] },
      { kind: 'turn', sessionId: 'sess-1', worktree: '/wt/sess-1', seq: 1, frame: frames[1] },
      { kind: 'status', sessionId: 'sess-1', worktree: '/wt/sess-1', state: 'done' },
      { kind: 'status', sessionId: 'sess-1', worktree: '/wt/sess-1', state: 'idle' },
    ]);
  });

  it('every pushed record is sent as a `push` JSON-RPC notification', async () => {
    const conn = connection();
    const handlers = buildSessionHandlers(
      deps([{ t: 'text', text: 'x' }]),
      conn,
      undefined,
      new LiveSessionRegistry(),
    );
    await handlers['createSession']!.handle({ input: 'go' });
    await conn.settled;
    expect(conn.pushes.every((n) => n.method === 'push')).toBe(true);
  });

  it('surfaces a loop failure as an error frame + an error status (never a thrown RPC)', async () => {
    const conn = connection();
    const handlers = buildSessionHandlers(
      deps([], true),
      conn,
      undefined,
      new LiveSessionRegistry(),
    );
    await handlers['createSession']!.handle({ input: 'go' });
    await conn.settled;
    await flush();

    const kinds = pushesOf(conn.pushes);
    expect(kinds[0]).toMatchObject({ kind: 'status', state: 'running' });
    expect(kinds).toContainEqual(
      expect.objectContaining({
        kind: 'turn',
        frame: { t: 'error', message: 'loop blew up', origin: 'loop' },
      }),
    );
    expect(kinds).toContainEqual(expect.objectContaining({ kind: 'status', state: 'error' }));
    // The live session's own idle-between-turns status trails the turn's terminal one.
    expect(kinds.at(-1)).toMatchObject({ kind: 'status', state: 'idle' });
  });

  it('rejects a request with no input via invalid params (Zod-validated)', () => {
    const conn = connection();
    const handlers = buildSessionHandlers(deps([]), conn, undefined, new LiveSessionRegistry());
    expect(handlers['createSession']!.params?.safeParse({}).success).toBe(false);
  });

  it('emits a governed deny frame through the same path as any other frame', async () => {
    // A deny is NOT an error, so the barge-in error-suppression must not swallow it, and
    // `stamp` must pass it through unreshaped. If either is false, M8 needs a fix.
    const conn = connection();
    const handlers = buildSessionHandlers(
      deps([{ t: 'deny', denyKind: 'cost-cap', reason: 'capped' }]),
      conn,
      undefined,
      new LiveSessionRegistry(),
    );
    await handlers['createSession']!.handle({ input: 'go' });
    await conn.settled;

    const frames = pushesOf(conn.pushes).flatMap((p) => (p.kind === 'turn' ? [p.frame] : []));
    expect(frames).toContainEqual({ t: 'deny', denyKind: 'cost-cap', reason: 'capped' });
  });
});

function depsFlushThenFail(): SessionDeps {
  return { ...deps([]), createAdapter: (init) => new FrameAdapter(init, [], false, false, true) };
}

/** Deps whose adapter streams enriched (frame, full) pairs — see {@link EnrichedFrameAdapter}. */
function depsEnriched(enriched: ReadonlyArray<{ frame: TurnFrame; full?: string }>): SessionDeps {
  return { ...deps([]), createAdapter: (init) => new EnrichedFrameAdapter(init, enriched) };
}

/** Deps whose adapter factory also records each init, so a test can assert `resume`/`history`. */
function depsCapturing(
  frames: TurnFrame[],
  inits: SessionAdapterInit[],
  pureApi = false,
): SessionDeps {
  return {
    ...deps(frames),
    createAdapter: (init) => {
      inits.push(init);
      return new FrameAdapter(init, frames, false, pureApi);
    },
  };
}

describe('buildSessionHandlers — streaming deltas are delivery-only (docs/adr/0013)', () => {
  it('pushes a text-delta frame but never appends it to the durable log (regression: opencode #11329)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-delta-'));
    try {
      const store = createConversationStore(dir);
      const conn = connection();
      const frames: TurnFrame[] = [
        { t: 'text-delta', text: 'Hel' },
        { t: 'text-delta', text: 'lo' },
        { t: 'text', text: 'Hello' },
      ];
      const handlers = buildSessionHandlers(deps(frames), conn, store, new LiveSessionRegistry());
      await handlers['createSession']!.handle({ input: 'go', conversationId: 'c1' });
      await conn.settled;

      const pushedFrames = pushesOf(conn.pushes).flatMap((p) =>
        p.kind === 'turn' ? [p.frame] : [],
      );
      expect(pushedFrames).toContainEqual({ t: 'text-delta', text: 'Hel' });
      expect(pushedFrames).toContainEqual({ t: 'text-delta', text: 'lo' });
      expect(pushedFrames).toContainEqual({ t: 'text', text: 'Hello' });

      // The durable log holds only the settled frame — deltas never reach `store.append`.
      const persistedFrames = store.reload('c1').map((t) => t.frame);
      expect(persistedFrames).not.toContainEqual({ t: 'text-delta', text: 'Hel' });
      expect(persistedFrames).not.toContainEqual({ t: 'text-delta', text: 'lo' });
      expect(persistedFrames).toContainEqual({ t: 'text', text: 'Hello' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

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
    const handlers = buildSessionHandlers(
      deps([{ t: 'text', text: 'on it' }]),
      conn,
      store,
      new LiveSessionRegistry(),
    );
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
    expect(store.getMeta('c1')).toMatchObject({
      title: 'Refactor the auth module',
      agentRef: 'roles/refactor',
    });
    // The user turn is persisted but NOT pushed (the console showed it optimistically).
    const turns = pushesOf(conn.pushes).filter((p) => p.kind === 'turn');
    expect(turns).toEqual([
      expect.objectContaining({ sessionId: 'c1', seq: 1, frame: { t: 'text', text: 'on it' } }),
    ]);
  });

  it('records the backend session id and resumes it on the next send, continuing the seq', async () => {
    const inits: SessionAdapterInit[] = [];
    const handlers = buildSessionHandlers(
      depsCapturing([{ t: 'text', text: 'reply' }], inits),
      connection(),
      store,
      new LiveSessionRegistry(),
    );

    await handlers['createSession']!.handle({
      input: 'first',
      role: '',
      scope: '',
      conversationId: 'c1',
    });
    expect(store.getMeta('c1')?.backendSessionId).toBe('backend-c1');
    expect(inits[0]?.resume).toBeUndefined(); // no prior memory on the first send

    await handlers['createSession']!.handle({
      input: 'second',
      role: '',
      scope: '',
      conversationId: 'c1',
    });
    // An already-live session doesn't block the RPC reply on the queued turn (it may
    // sit behind another one) — flush so the second turn actually runs before assertion.
    await flush();
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
    const registry = new LiveSessionRegistry();
    // Turn 1 succeeds and captures a resumable backend session.
    await buildSessionHandlers(deps([{ t: 'text', text: 'reply' }]), conn, store, registry)[
      'createSession'
    ]!.handle({
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
    await buildSessionHandlers(deps([], true), conn2, store, new LiveSessionRegistry())[
      'createSession'
    ]!.handle({
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
      new LiveSessionRegistry(),
    );

    await handlers['createSession']!.handle({
      input: 'first',
      role: '',
      scope: '',
      conversationId: 'c1',
    });
    expect(inits[0]?.history).toBeUndefined(); // no memory on the first send

    await handlers['createSession']!.handle({
      input: 'second',
      role: '',
      scope: '',
      conversationId: 'c1',
    });
    // An already-live session doesn't block the RPC reply on the queued turn — flush
    // so the second turn actually runs before assertion.
    await flush();
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
    const handlers = buildSessionHandlers(
      depsCapturing([{ t: 'text', text: 'x' }], inits),
      connection(),
      store,
      new LiveSessionRegistry(),
    );
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
    await handlers['createSession']!.handle({
      input,
      role: '',
      scope: '',
      conversationId: 'c1',
      model: { provider },
    });
  };

  it('pins the provider and, on a fresh daemon (restart), routes DeepSeek back to itself with memory intact', async () => {
    const inits: SessionAdapterInit[] = [];
    await send(
      buildSessionHandlers(
        depsCapturing([{ t: 'text', text: 'reply' }], inits),
        connection(),
        store,
        new LiveSessionRegistry(),
      ),
      'first',
      'deepseek',
    );
    expect(store.getMeta('c1')?.provider).toBe('deepseek');
    expect(inits[0]?.resume).toBeUndefined();

    // Simulate a console/daemon restart: brand-new handlers over the same on-disk store.
    const inits2: SessionAdapterInit[] = [];
    await send(
      buildSessionHandlers(
        depsCapturing([{ t: 'text', text: 'reply' }], inits2),
        connection(),
        store,
        new LiveSessionRegistry(),
      ),
      'second',
      'deepseek',
    );
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
    const handlers = buildSessionHandlers(
      depsCapturing([{ t: 'text', text: 'reply' }], inits),
      connection(),
      store,
      new LiveSessionRegistry(),
    );
    await send(handlers, 'first', 'claude');
    expect(store.getMeta('c1')?.backendSessionId).toBe('backend-c1'); // Claude captured a session
    await send(handlers, 'second', 'deepseek');
    // An already-live session doesn't block the RPC reply on the queued turn — flush
    // so the second turn actually runs before assertion.
    await flush();
    expect(inits[1]?.resume).toBeUndefined(); // the Claude token is not eligible for DeepSeek
    expect(inits[1]?.deliverHistoryAsPreamble).toBeFalsy(); // DeepSeek replays as messages, not a preamble
    expect(inits[1]?.history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
    ]);
  });

  it('DeepSeek→Claude: no resumable session, so the transcript is delivered as a first-turn preamble', async () => {
    const inits: SessionAdapterInit[] = [];
    const handlers = buildSessionHandlers(
      depsCapturing([{ t: 'text', text: 'reply' }], inits),
      connection(),
      store,
      new LiveSessionRegistry(),
    );
    await send(handlers, 'first', 'deepseek');
    await send(handlers, 'second', 'claude');
    await flush();
    expect(inits[1]?.resume).toBeUndefined();
    expect(inits[1]?.deliverHistoryAsPreamble).toBe(true);
    expect(inits[1]?.history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
    ]);
  });

  it('same-provider Claude continuation still uses native resume (fast path preserved)', async () => {
    const inits: SessionAdapterInit[] = [];
    const handlers = buildSessionHandlers(
      depsCapturing([{ t: 'text', text: 'r' }], inits),
      connection(),
      store,
      new LiveSessionRegistry(),
    );
    await send(handlers, 'first', 'claude');
    await send(handlers, 'second', 'claude');
    await flush();
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
    const handlers = buildSessionHandlers(
      countingDeps,
      connection(),
      store,
      new LiveSessionRegistry(),
    );
    await handlers['createSession']!.handle({
      input: 'first',
      role: '',
      scope: '',
      conversationId: 'c1',
    });
    expect(compiles).toBe(1);
    expect(store.getCompilation('c1')?.promptVersion).toBeTruthy();

    // The second turn reuses the frozen compilation — no recompile.
    await handlers['createSession']!.handle({
      input: 'second',
      role: '',
      scope: '',
      conversationId: 'c1',
    });
    await flush();
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
    const handlers = buildSessionHandlers(
      countingDeps,
      connection(),
      store,
      new LiveSessionRegistry(),
    );

    // First send on claude → compiles + freezes, stamped with the model.
    await handlers['createSession']!.handle({
      input: 'first',
      role: 'swe',
      scope: '',
      conversationId: 'c1',
      model: { provider: 'claude', model: 'opus' },
    });
    expect(compiles).toBe(1);
    const firstHash = store.getCompilation('c1')?.configHash;
    expect(store.getCompilation('c1')?.model).toEqual({ provider: 'claude', model: 'opus' });

    // Same model → frozen prompt reused, no recompile.
    await handlers['createSession']!.handle({
      input: 'second',
      role: 'swe',
      scope: '',
      conversationId: 'c1',
      model: { provider: 'claude', model: 'opus' },
    });
    await flush();
    expect(compiles).toBe(1);

    // Switched model → recompiles so the `## Model` line is re-authored...
    await handlers['createSession']!.handle({
      input: 'third',
      role: 'swe',
      scope: '',
      conversationId: 'c1',
      model: { provider: 'deepseek', model: 'v4' },
    });
    await flush();
    expect(compiles).toBe(2);
    expect(store.getCompilation('c1')?.model).toEqual({ provider: 'deepseek', model: 'v4' });
    // ...but the drift key (role + packages) is unchanged: a model switch is NOT drift.
    expect(store.getCompilation('c1')?.configHash).toBe(firstHash);
  });

  it('stamps the frozen compilation with the drift key of the config that produced it', async () => {
    const handlers = buildSessionHandlers(
      deps([{ t: 'text', text: 'r' }]),
      connection(),
      store,
      new LiveSessionRegistry(),
    );
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
    const handlers = buildSessionHandlers(
      deps([{ t: 'text', text: 'r' }]),
      connection(),
      store,
      new LiveSessionRegistry(),
    );
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
    const handlers = buildSessionHandlers(
      deps([{ t: 'text', text: 'r' }]),
      conn,
      store,
      new LiveSessionRegistry(),
    );
    await handlers['createSession']!.handle({
      input: 'first',
      role: 'swe',
      scope: '',
      conversationId: 'c1',
    });
    await conn.settled;
    expect(store.getCompilation('c1')).toBeDefined();
    expect(store.getMeta('c1')?.backendSessionId).toBe('backend-c1');

    expect(await handlers['recompilePrompt']!.handle({ sessionId: 'c1' })).toEqual({
      recompiled: true,
    });
    expect(store.getCompilation('c1')).toBeUndefined();
    expect(store.getMeta('c1')?.backendSessionId).toBeUndefined();
  });

  it('recompilePrompt is a no-op (never throws) without a store', async () => {
    const handlers = buildSessionHandlers(
      deps([{ t: 'text', text: 'r' }]),
      connection(),
      undefined,
      new LiveSessionRegistry(),
    );
    expect(await handlers['recompilePrompt']!.handle({ sessionId: 'c1' })).toEqual({
      recompiled: false,
    });
  });

  it('pins the effective provider even when the send names only a model (keeps the pin complete for routing + drift/cache detection)', async () => {
    const handlers = buildSessionHandlers(
      deps([{ t: 'text', text: 'r' }]),
      connection(),
      store,
      new LiveSessionRegistry(),
    );
    await handlers['createSession']!.handle({
      input: 'first',
      role: '',
      scope: '',
      conversationId: 'c1',
      model: { model: 'opus' },
    });
    expect(store.getMeta('c1')?.provider).toBe('claude');
    expect(store.getMeta('c1')?.model).toBe('opus');
  });
});

function depsAbortable(): SessionDeps {
  return {
    ...deps([]),
    createAdapter: (init) => new FrameAdapter(init, [], false, false, false, true),
  };
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
      const adapter = new FrameAdapter(
        init,
        [{ t: 'text', text: 'ok' }],
        false,
        false,
        false,
        false,
        true,
      );
      adapters.push(adapter);
      return adapter;
    },
  };
}

/**
 * The real shape of an interrupted turn: the model streams reasoning + answer as DELTAS (which
 * are never persisted — docs/adr/0013) and is stopped before emitting any settled frame. Only
 * M8's interrupt closure can settle what it streamed.
 */
class PartialStreamAdapter extends FrameAdapter {
  override async runLoop(): Promise<void> {
    this.init.onTurn?.({ t: 'thinking-delta', text: 'weigh' });
    this.init.onTurn?.({ t: 'thinking-delta', text: 'ing' });
    this.init.onTurn?.({ t: 'text-delta', text: 'The clock' });
    this.init.onTurn?.({ t: 'text-delta', text: 'maker' });
    await new Promise<void>((resolve) => {
      this.init.signal?.addEventListener('abort', () => resolve(), { once: true });
    });
  }
}

describe('buildSessionHandlers — interruptSession / steerSession (CHAT-10)', () => {
  it("settles an interrupted turn's streamed partial into the log exactly once, and tells the model", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-int-'));
    try {
      const store = createConversationStore(dir);
      const conn = connection();
      const customDeps: SessionDeps = {
        ...deps([]),
        createAdapter: (init) => new PartialStreamAdapter(init, []),
      };
      const handlers = buildSessionHandlers(customDeps, conn, store, new LiveSessionRegistry());
      const { sessionId } = await handlers['createSession']!.handle({
        input: 'write a poem',
        conversationId: 'c1',
      });
      await flush();
      expect(await handlers['interruptSession']!.handle({ id: sessionId })).toEqual({
        interrupted: true,
      });
      await flush();
      await flush();

      // The streamed reasoning + answer land as ONE settled frame each (the deltas themselves are
      // never persisted), then the marker — so a reload renders exactly what the live stream showed
      // rather than losing the partial or double-rendering it.
      expect(store.reload('c1').map((t) => t.frame)).toEqual([
        { t: 'text', text: 'write a poem', role: 'user' },
        { t: 'thinking', text: 'weighing', durationMs: expect.any(Number) },
        { t: 'text', text: 'The clockmaker' },
        { t: 'interrupted' },
      ]);
      // …and the model's NEXT turn reads that it was cut off, not that it finished.
      expect(store.loadBackendMessages('c1')).toEqual([
        { role: 'user', content: 'write a poem' },
        { role: 'assistant', content: 'The clockmaker' },
        { role: 'user', content: '[Request interrupted by user]' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('aborts the session and surfaces a clean interrupted stop — never an error (SC-1)', async () => {
    const conn = connection();
    const handlers = buildSessionHandlers(
      depsAbortable(),
      conn,
      undefined,
      new LiveSessionRegistry(),
    );
    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });

    expect(await handlers['interruptSession']!.handle({ id: sessionId })).toEqual({
      interrupted: true,
    });
    // Flush the microtasks the abort → reject → `catch` chain (and the live session's
    // post-turn idle) need to settle.
    await flush();

    const pushes = pushesOf(conn.pushes);
    // The stop records an `interrupted` marker frame (persisted — so a reload reads the same
    // transcript AND the model's next turn knows it was cut off) between running and interrupted.
    expect(pushes).toEqual([
      { kind: 'status', sessionId: 'sess-1', worktree: '/wt/sess-1', state: 'running' },
      {
        kind: 'turn',
        sessionId: 'sess-1',
        worktree: '/wt/sess-1',
        seq: 0,
        frame: { t: 'interrupted' },
      },
      { kind: 'status', sessionId: 'sess-1', worktree: '/wt/sess-1', state: 'interrupted' },
      { kind: 'status', sessionId: 'sess-1', worktree: '/wt/sess-1', state: 'idle' },
    ]);
    // No error frame and no error status — an interrupt is a user stop, not a governance block.
    expect(pushes.some((p) => p.kind === 'turn' && p.frame.t === 'error')).toBe(false);
    expect(pushes.some((p) => p.kind === 'status' && p.state === 'error')).toBe(false);
  });

  it('emits `interrupted` exactly once when the loop returns cleanly after an abort (clean-break path)', async () => {
    const conn = connection();
    const handlers = buildSessionHandlers(
      depsCleanBreakAbortable(),
      conn,
      undefined,
      new LiveSessionRegistry(),
    );
    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });

    expect(await handlers['interruptSession']!.handle({ id: sessionId })).toEqual({
      interrupted: true,
    });
    // Flush the microtasks the abort → resolve → settle chain (and the trailing idle) need.
    await flush();

    const pushes = pushesOf(conn.pushes);
    // `interruptSession` emits `interrupted` synchronously; the settle path must NOT
    // emit it a second time once the loop settles cleanly on the same interrupt.
    expect(pushes.filter((p) => p.kind === 'status' && p.state === 'interrupted')).toHaveLength(1);
    expect(pushes.some((p) => p.kind === 'status' && p.state === 'done')).toBe(false);
    expect(pushes.some((p) => p.kind === 'status' && p.state === 'error')).toBe(false);
  });

  it('queues a steer turn the pure-API driver drains at its next safe boundary', async () => {
    const conn = connection();
    const adapters: FrameAdapter[] = [];
    const handlers = buildSessionHandlers(
      depsSteerable(adapters),
      conn,
      undefined,
      new LiveSessionRegistry(),
    );
    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });

    // `barge-in` mode is this test's intent: a next-safe-boundary inject into the
    // pure-API `control.steer` buffer that `drainSteer` reads (`queue` mode instead
    // routes to `control.queueSteer`, drained at the turn-end boundary — Task 4).
    expect(
      await handlers['steerSession']!.handle({
        id: sessionId,
        text: 'also fix the tests',
        mode: 'barge-in',
      }),
    ).toEqual({
      steered: true,
    });
    await conn.settled;

    expect(adapters[0]?.drained).toEqual(['also fix the tests']);
  });

  it('routes a queue-mode steer to control.queueSteer, drained via drainQueuedSteer at the close-gate boundary', async () => {
    const conn = connection();
    const adapters: FrameAdapter[] = [];
    const handlers = buildSessionHandlers(
      depsSteerable(adapters),
      conn,
      undefined,
      new LiveSessionRegistry(),
    );
    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });

    // The default mode (no explicit `mode`) is `queue` — this is the regression-window
    // case (Task 4): a plain steerSession() call must land in `control.queueSteer` and
    // actually be drained, not silently dropped.
    expect(await handlers['steerSession']!.handle({ id: sessionId, text: 'also do X' })).toEqual({
      steered: true,
    });
    await conn.settled;

    expect(adapters[0]?.queueDrained).toEqual(['also do X']);
    // It must NOT have been routed to the barge-in buffer.
    expect(adapters[0]?.drained).toEqual([]);
  });

  it('interruptSession on an unknown id returns the negative result without throwing', async () => {
    const handlers = buildSessionHandlers(
      deps([]),
      connection(),
      undefined,
      new LiveSessionRegistry(),
    );
    expect(await handlers['interruptSession']!.handle({ id: 'nope' })).toEqual({
      interrupted: false,
    });
  });

  it('steerSession on an unknown id returns the negative result without throwing', async () => {
    const handlers = buildSessionHandlers(
      deps([]),
      connection(),
      undefined,
      new LiveSessionRegistry(),
    );
    expect(await handlers['steerSession']!.handle({ id: 'nope', text: 'hi' })).toEqual({
      steered: false,
    });
  });
});

describe('buildSessionHandlers — closeSession', () => {
  it('delegates to registry.close, which checkpoints + releases via its onClose hook, and reports closed', async () => {
    // Mirrors how `apps/cli`'s daemon composition wires the registry: checkpoint +
    // worktree-release now happen exactly once, via the registry's `onClose` hook
    // (FIX #3) — `closeSession` itself no longer calls `deps.checkpoint`/`releaseWorktree`
    // directly, it only delegates to `registry.close(id)`.
    const released: string[] = [];
    let checkpoints = 0;
    const registry = new LiveSessionRegistry({
      onClose: (s) => {
        checkpoints += 1;
        if (s.worktree !== undefined) released.push(s.worktree);
      },
    });
    const conn = connection();
    const handlers = buildSessionHandlers(
      deps([{ t: 'text', text: 'x' }]),
      conn,
      undefined,
      registry,
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
    const handlers = buildSessionHandlers(deps([]), conn, undefined, new LiveSessionRegistry());
    expect(await handlers['closeSession']!.handle({ id: 'nope' })).toEqual({ closed: false });
  });
});

describe('buildSessionHandlers — block-preserving persistence on error', () => {
  it('persists the flushed transcript and still surfaces an error status', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-conv-'));
    try {
      const store = createConversationStore(dir);
      const conn = connection();
      const handlers = buildSessionHandlers(
        depsFlushThenFail(),
        conn,
        store,
        new LiveSessionRegistry(),
      );
      await handlers['createSession']!.handle({ input: 'edit the file', conversationId: 'c1' });
      await conn.settled;

      // The completed work reached canonical memory despite the mid-turn throw.
      expect(store.loadBackendMessages('c1')).toContainEqual({
        role: 'assistant',
        content: 'reply',
      });
      // The failure is still surfaced (SC-1: surface, don't cage).
      expect(pushesOf(conn.pushes)).toContainEqual(
        expect.objectContaining({ kind: 'status', state: 'error' }),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildSessionHandlers — full tool-result fidelity (docs/adr/0010)', () => {
  it("persists a tool_result's FULL body (not its lossy pointer), so it folds into loadBackendMessages", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-conv-'));
    try {
      const store = createConversationStore(dir);
      const conn = connection();
      const FULL_BODY =
        'the complete tool-result body the model actually saw — longer than any pointer';
      const enriched: Array<{ frame: TurnFrame; full?: string }> = [
        { frame: { t: 'tool_use', tool: 'Read', input: { path: 'a.ts' }, handle: 'h1' } },
        {
          frame: { t: 'tool_result', handle: 'h1', ok: true, pointer: 'a.ts (truncated)' },
          full: FULL_BODY,
        },
      ];
      const handlers = buildSessionHandlers(
        depsEnriched(enriched),
        conn,
        store,
        new LiveSessionRegistry(),
      );
      await handlers['createSession']!.handle({ input: 'read the file', conversationId: 'c1' });
      await conn.settled;

      // The fold reads the persisted `full` body — not the frame's lossy `pointer` —
      // into the provider-neutral tool message (`reload` deliberately omits `full`;
      // it is a frame-only read surface, see conversation-store.ts).
      expect(store.loadBackendMessages('c1')).toContainEqual({
        role: 'tool',
        toolCallId: 'h1',
        content: FULL_BODY,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildSessionHandlers — one live session across turns (P-α multi-turn)', () => {
  it('runs two createSession calls with the same conversationId as two turns on one live session, idling between them', async () => {
    const inits: SessionAdapterInit[] = [];
    const registry = new LiveSessionRegistry();
    const conn = connection();
    const handlers = buildSessionHandlers(
      depsCapturing([{ t: 'text', text: 'ok' }], inits),
      conn,
      undefined,
      registry,
    );

    const first = await handlers['createSession']!.handle({
      input: 'first',
      conversationId: 'live-1',
    });
    await flush();
    expect(registry.get('live-1')?.state).toBe('idle'); // not torn down between turns

    const second = await handlers['createSession']!.handle({
      input: 'second',
      conversationId: 'live-1',
    });
    await flush();

    expect(first).toEqual({ sessionId: 'live-1', worktree: '/wt/sess-1' });
    expect(second).toEqual({ sessionId: 'live-1', worktree: '/wt/sess-1' });
    expect(inits.map((i) => i.input)).toEqual(['first', 'second']);
    expect(registry.get('live-1')).toBeDefined();
    expect(registry.get('live-1')?.state).toBe('idle');
  });
});

describe('buildSessionHandlers — subscribeSession (G4 reattach)', () => {
  it('hydrates a newly subscribing connection with the running status of an in-flight session', async () => {
    const registry = new LiveSessionRegistry();
    const founder = connection();
    const adapters: FrameAdapter[] = [];
    const handlers = buildSessionHandlers(depsSteerable(adapters), founder, undefined, registry);
    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });

    // A second, independent connection joins the SAME daemon-owned live session.
    const watcher = connection();
    const watcherHandlers = buildSessionHandlers(deps([]), watcher, undefined, registry);
    const result = await watcherHandlers['subscribeSession']!.handle({ id: sessionId });

    expect(result).toEqual({ subscribed: true });
    expect(pushesOf(watcher.pushes)).toEqual([
      { kind: 'status', sessionId, worktree: '/wt/sess-1', state: 'running' },
    ]);
  });

  it('reports not-subscribed for an unknown session id', async () => {
    const watcher = connection();
    const handlers = buildSessionHandlers(deps([]), watcher, undefined, new LiveSessionRegistry());
    expect(await handlers['subscribeSession']!.handle({ id: 'nope' })).toEqual({
      subscribed: false,
    });
  });
});

describe('buildSessionHandlers — interrupt on a registry-backed conversation preserves SC-1', () => {
  it('interrupts the live session (a real conversationId) and never renders an error', async () => {
    const registry = new LiveSessionRegistry();
    const conn = connection();
    const handlers = buildSessionHandlers(depsAbortable(), conn, undefined, registry);
    const { sessionId } = await handlers['createSession']!.handle({
      input: 'go',
      conversationId: 'live-int',
    });
    expect(sessionId).toBe('live-int');

    expect(await handlers['interruptSession']!.handle({ id: sessionId })).toEqual({
      interrupted: true,
    });
    await flush();

    const pushes = pushesOf(conn.pushes);
    expect(pushes.some((p) => p.kind === 'turn' && p.frame.t === 'error')).toBe(false);
    expect(pushes.some((p) => p.kind === 'status' && p.state === 'error')).toBe(false);
    expect(pushes.some((p) => p.kind === 'status' && p.state === 'interrupted')).toBe(true);
    // The interrupt is a user stop (SC-1) — the live session survives, it isn't torn down.
    expect(registry.get(sessionId)).toBeDefined();
  });
});

describe('buildSessionHandlers — interruptSession resolves via the LiveSession, not a per-connection map (docs/adr/0011 G4)', () => {
  it('a second connection that never started the turn can still interrupt it through the shared registry', async () => {
    const registry = new LiveSessionRegistry();

    // Connection A starts the in-flight (abortable) turn.
    const connA = connection();
    const handlersA = buildSessionHandlers(depsAbortable(), connA, undefined, registry);
    const { sessionId } = await handlersA['createSession']!.handle({ input: 'go' });

    // Connection B is a DIFFERENT `buildSessionHandlers` call (its own, empty
    // per-connection state) that only shares the daemon-singleton registry — the
    // G4 reattach shape (e.g. a viewer that reconnects and never itself sent the
    // turn). Before the fix, B's own `control` map is empty, so this would
    // silently return `{ interrupted: false }` and never touch A's in-flight turn.
    const connB = connection();
    const handlersB = buildSessionHandlers(deps([]), connB, undefined, registry);

    const result = await handlersB['interruptSession']!.handle({ id: sessionId });
    expect(result).toEqual({ interrupted: true });

    // The interrupt lands on the turn connection A is watching: an `interrupted`
    // status is fanned out, and — SC-1 — never rendered as an error.
    const pushesA = pushesOf(connA.pushes);
    expect(pushesA.some((p) => p.kind === 'status' && p.state === 'interrupted')).toBe(true);
    expect(pushesA.some((p) => p.kind === 'turn' && p.frame.t === 'error')).toBe(false);
    expect(pushesA.some((p) => p.kind === 'status' && p.state === 'error')).toBe(false);
  });
});

describe('buildSessionHandlers — closeSession removes the live session from the registry', () => {
  it('registry.get returns undefined once closeSession has run', async () => {
    const registry = new LiveSessionRegistry();
    const conn = connection();
    const handlers = buildSessionHandlers(
      deps([{ t: 'text', text: 'x' }]),
      conn,
      undefined,
      registry,
    );
    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });
    await conn.settled;

    expect(registry.get(sessionId)).toBeDefined();
    expect(await handlers['closeSession']!.handle({ id: sessionId })).toEqual({ closed: true });
    expect(registry.get(sessionId)).toBeUndefined();
  });
});

describe('buildSessionHandlers — connection-close teardown (FIX #2b)', () => {
  it("unsubscribes this connection's sinks once its connection closes, so a later emit no longer reaches it", async () => {
    const conn = connection();
    const registry = new LiveSessionRegistry();
    const handlers = buildSessionHandlers(
      deps([{ t: 'text', text: 'x' }]),
      conn,
      undefined,
      registry,
    );
    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });
    await conn.settled;
    const pushesBeforeClose = conn.pushes.length;

    conn.triggerClose();

    const session = registry.get(sessionId)!;
    session.emit({
      kind: 'turn',
      sessionId,
      worktree: session.worktree ?? '',
      seq: 999,
      frame: { t: 'text', text: 'late, after this connection closed' },
    });

    // Nothing new reached this connection — its sink was unsubscribed on close.
    expect(conn.pushes.length).toBe(pushesBeforeClose);
  });

  it('unsubscribes a subscribeSession (G4 reattach) sink too, once that connection closes', async () => {
    const registry = new LiveSessionRegistry();
    const founder = connection();
    const handlers = buildSessionHandlers(depsSteerable([]), founder, undefined, registry);
    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });

    const watcher = connection();
    const watcherHandlers = buildSessionHandlers(deps([]), watcher, undefined, registry);
    await watcherHandlers['subscribeSession']!.handle({ id: sessionId });
    const pushesBeforeClose = watcher.pushes.length;

    watcher.triggerClose();

    registry.get(sessionId)!.emit({
      kind: 'turn',
      sessionId,
      worktree: '',
      seq: 1000,
      frame: { t: 'text', text: 'late' },
    });

    expect(watcher.pushes.length).toBe(pushesBeforeClose);
  });
});

describe('buildSessionHandlers — idle-timer touch on turn activity (FIX #1)', () => {
  it('touches the registry when a turn starts, resetting the idle clock', async () => {
    const conn = connection();
    const registry = new LiveSessionRegistry();
    const touchSpy = vi.spyOn(registry, 'touch');
    const handlers = buildSessionHandlers(
      deps([{ t: 'text', text: 'x' }]),
      conn,
      undefined,
      registry,
    );

    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });
    await conn.settled;

    expect(touchSpy).toHaveBeenCalledWith(sessionId);
  });
});

/**
 * A fake held-open streaming adapter (docs/adr/0012): its `input` is the LiveSession's
 * derived {@link InputChannel}, and it consumes EVERY turn (initial + steers) from that
 * ONE iterable, marking each with a `turn-boundary` frame — the per-turn completion
 * signal M8's driver awaits. It flushes the canonical transcript at each result
 * (per-turn-boundary durability) and again when the feed closes (the A1 net). A string
 * `input` (which only happens if the driver mistakenly runs per-turn) is consumed as a
 * single one-shot — so a mis-wired strategy shows up as multiple adapter constructions.
 */
class HeldOpenAdapter implements RuntimeAdapter {
  readonly consumed: string[] = [];
  ended = false;
  #reported = false;

  constructor(
    readonly init: SessionAdapterInit,
    readonly replyFrames: TurnFrame[] = [{ t: 'text', text: 'ok' }],
    /** Model a real backend's abort: never settle on its own — only `signal` ends it,
     *  by rejecting after flushing settlement (the interrupt path). */
    readonly abortable = false,
  ) {}
  renderNative(): BackendConfig {
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {}, files: [] };
  }
  registerTools(): void {}
  denyBuiltins(): void {}
  interceptTool(_c: CanUseTool): void {}
  interceptStop(_s: StopPredicate): void {}
  async runLoop(): Promise<void> {
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
    const process = (text: string): void => {
      this.consumed.push(text);
      for (const frame of this.replyFrames) this.init.onTurn?.(frame);
      this.init.onSettle(this.init.sessionId, { tokensIn: 1, tokensOut: 2, costUsd: 0.25 });
      if (!this.#reported) {
        this.#reported = true;
        this.init.onBackendSession?.(`backend-${this.init.sessionId}`);
      }
      this.init.onTurn?.({ t: 'turn-boundary', role: 'assistant' }); // the completion signal, last
    };
    const input = this.init.input;
    if (typeof input === 'string') {
      process(input);
    } else {
      for await (const text of input) process(text);
    }
    this.ended = true;
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

/** Deps whose injected strategy marks `claude` as `held-open` (mirroring the composition
 *  root) and whose adapter factory records each constructed held-open adapter. */
function depsHeldOpen(
  adapters: HeldOpenAdapter[],
  opts: { abortable?: boolean } = {},
): SessionDeps {
  return {
    ...deps([]),
    sessionStrategy: (provider) => (provider === 'claude' ? 'held-open' : 'per-turn'),
    createAdapter: (init) => {
      const adapter = new HeldOpenAdapter(
        init,
        [{ t: 'text', text: 'ok' }],
        opts.abortable ?? false,
      );
      adapters.push(adapter);
      return adapter;
    },
  };
}

/**
 * A held-open adapter that models the I3/SC-1 barge-in contract (docs/adr/0012): it
 * reports its turn-interrupt handle via `onTurnInterrupt` before consuming any input
 * (mirroring the real Claude adapter's streaming-input path), runs turn A only to a
 * PARTIAL frame — never its normal reply — and then blocks until the test's barge-in
 * calls the reported handle. The interrupt handle emits `interruptFrames` for turn A
 * (default: a single terminal `turn-boundary`, the success-subtype live-smoke case; a
 * non-success interrupt scripts an `error` frame + boundary, as turn-frames.ts maps a
 * non-success result to BOTH) and lets the loop resume, consuming the next turn (the
 * framed steer) to a normal completion. A later turn whose index equals
 * `errorOnTurnIndex` emits a genuine `error` frame + boundary instead of the normal
 * reply — the unrelated failure used to prove `barging` was cleared, not leaked.
 * Deterministic: turn A's boundary is driven by the interrupt call itself, never a timer.
 */
class BargeInAdapter implements RuntimeAdapter {
  readonly consumed: string[] = [];
  interruptCalls = 0;

  constructor(
    readonly init: SessionAdapterInit,
    /** What the interrupt handle emits to end turn A. */
    readonly interruptFrames: TurnFrame[] = [{ t: 'turn-boundary', role: 'assistant' }],
    /** A later turn index (in `consumed` order) that emits a genuine `error` + boundary. */
    readonly errorOnTurnIndex = -1,
    /** Model a rejecting SDK `interrupt()`: after ending turn A, the reported handle throws.
     *  The daemon must still feed the framed steer so the boundary latch can't hang. */
    readonly interruptRejects = false,
  ) {}
  renderNative(): BackendConfig {
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {}, files: [] };
  }
  registerTools(): void {}
  denyBuiltins(): void {}
  interceptTool(_c: CanUseTool): void {}
  interceptStop(_s: StopPredicate): void {}
  async runLoop(): Promise<void> {
    let resolveTurnA: (() => void) | undefined;
    this.init.onTurnInterrupt?.(async () => {
      this.interruptCalls += 1;
      for (const frame of this.interruptFrames) this.init.onTurn?.(frame);
      resolveTurnA?.();
      if (this.interruptRejects) throw new Error('interrupt rejected');
    });
    const input = this.init.input;
    if (typeof input === 'string')
      throw new Error('BargeInAdapter expects a streamed held-open input');
    let turnIndex = 0;
    for await (const text of input) {
      this.consumed.push(text);
      if (turnIndex === 0) {
        // Turn A: a partial frame only — the barge-in interrupts before it completes.
        this.init.onTurn?.({ t: 'text', text: 'partial' });
        await new Promise<void>((resolve) => {
          resolveTurnA = resolve;
        });
      } else if (turnIndex === this.errorOnTurnIndex) {
        // A later, UNRELATED turn that genuinely fails: its error must surface (proving
        // an earlier barge-in's `barging` suppression did not leak into this turn).
        this.init.onTurn?.({ t: 'error', message: 'genuine failure', origin: 'loop' });
        this.init.onTurn?.({ t: 'turn-boundary', role: 'assistant' });
      } else {
        // Turn B (the framed steer): runs to a normal completion + boundary.
        this.init.onTurn?.({ t: 'text', text: 'ok' });
        this.init.onSettle(this.init.sessionId, { tokensIn: 1, tokensOut: 2, costUsd: 0.25 });
        this.init.onTurn?.({ t: 'turn-boundary', role: 'assistant' });
      }
      turnIndex += 1;
    }
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

/**
 * A held-open adapter whose every turn's boundary is driven explicitly by the test
 * (`boundaryCurrent()`), so a test can interleave sends/steers with turn completions
 * deterministically. Each consumed turn emits a distinguishable `reply:<text>` frame,
 * then parks until the test emits its `turn-boundary`. Used to prove the I3 latch
 * accounts a queue-mode steer that runs as its own SDK turn.
 */
class QueueSteerAdapter implements RuntimeAdapter {
  readonly consumed: string[] = [];
  #gate: (() => void) | undefined;

  constructor(readonly init: SessionAdapterInit) {}
  renderNative(): BackendConfig {
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {}, files: [] };
  }
  registerTools(): void {}
  denyBuiltins(): void {}
  interceptTool(_c: CanUseTool): void {}
  interceptStop(_s: StopPredicate): void {}
  /** Complete the currently in-flight turn: emit its `turn-boundary` and advance the loop. */
  boundaryCurrent(): void {
    const gate = this.#gate;
    this.#gate = undefined;
    gate?.();
  }
  async runLoop(): Promise<void> {
    const input = this.init.input;
    if (typeof input === 'string')
      throw new Error('QueueSteerAdapter expects a streamed held-open input');
    for await (const text of input) {
      this.consumed.push(text);
      this.init.onTurn?.({ t: 'text', text: `reply:${text}` });
      this.init.onSettle(this.init.sessionId, { tokensIn: 1, tokensOut: 2, costUsd: 0.25 });
      await new Promise<void>((resolve) => {
        this.#gate = resolve;
      });
      this.init.onTurn?.({ t: 'turn-boundary', role: 'assistant' });
    }
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

describe('buildSessionHandlers — held-open SDK streaming-input strategy (docs/adr/0012)', () => {
  it('feeds two turns of one live session into ONE held-open query, not two createSession calls', async () => {
    const adapters: HeldOpenAdapter[] = [];
    const conn = connection();
    const registry = new LiveSessionRegistry();
    const handlers = buildSessionHandlers(depsHeldOpen(adapters), conn, undefined, registry);

    await handlers['createSession']!.handle({ input: 'first', conversationId: 'h1' });
    await flush();
    await handlers['createSession']!.handle({ input: 'second', conversationId: 'h1' });
    await flush();
    await flush();

    // ONE adapter (one createSession) fed BOTH user turns off the same open iterable.
    expect(adapters.length).toBe(1);
    expect(adapters[0]?.consumed).toEqual(['first', 'second']);
  });

  it('yields a steer enqueued while running into the SAME open query (reaches the running turn)', async () => {
    const adapters: HeldOpenAdapter[] = [];
    const conn = connection();
    const handlers = buildSessionHandlers(
      depsHeldOpen(adapters),
      conn,
      undefined,
      new LiveSessionRegistry(),
    );
    const { sessionId } = await handlers['createSession']!.handle({
      input: 'go',
      conversationId: 'h1',
    });

    expect(await handlers['steerSession']!.handle({ id: sessionId, text: 'also do X' })).toEqual({
      steered: true,
    });
    await flush();
    await flush();

    expect(adapters.length).toBe(1);
    expect(adapters[0]?.consumed).toEqual(['go', 'also do X']);
  });

  it("appends each turn's user prompt and continues the seq under the one held-open query", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-ho-'));
    try {
      const store = createConversationStore(dir);
      const adapters: HeldOpenAdapter[] = [];
      const conn = connection();
      const handlers = buildSessionHandlers(
        depsHeldOpen(adapters),
        conn,
        store,
        new LiveSessionRegistry(),
      );

      await handlers['createSession']!.handle({ input: 'first', conversationId: 'h1' });
      await flush();
      await handlers['createSession']!.handle({ input: 'second', conversationId: 'h1' });
      await flush();
      await flush();

      expect(adapters.length).toBe(1);
      // Both user turns landed, and the seq continued monotonically across the two turns
      // of the single query (turn 2's prompt never collides with turn 1's streamed frames).
      expect(store.reload('h1').map((t) => ({ seq: t.seq, frame: t.frame }))).toEqual([
        { seq: 0, frame: { t: 'text', text: 'first', role: 'user' } },
        { seq: 1, frame: { t: 'text', text: 'ok' } },
        { seq: 2, frame: { t: 'turn-boundary', role: 'assistant' } },
        { seq: 3, frame: { t: 'text', text: 'second', role: 'user' } },
        { seq: 4, frame: { t: 'text', text: 'ok' } },
        { seq: 5, frame: { t: 'turn-boundary', role: 'assistant' } },
      ]);
      // The canonical transcript is the read-time fold of the persisted frame stream
      // above (docs/adr/0010) — it covers both turns.
      expect(store.loadBackendMessages('h1')).toEqual([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'second' },
        { role: 'assistant', content: 'ok' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('surfaces an interrupt as a clean interrupted stop — never an error (SC-1)', async () => {
    const adapters: HeldOpenAdapter[] = [];
    const conn = connection();
    const handlers = buildSessionHandlers(
      depsHeldOpen(adapters, { abortable: true }),
      conn,
      undefined,
      new LiveSessionRegistry(),
    );
    const { sessionId } = await handlers['createSession']!.handle({
      input: 'go',
      conversationId: 'h1',
    });

    expect(await handlers['interruptSession']!.handle({ id: sessionId })).toEqual({
      interrupted: true,
    });
    await flush();
    await flush();

    const pushes = pushesOf(conn.pushes);
    expect(pushes.flatMap((p) => (p.kind === 'status' ? [p.state] : []))).toEqual([
      'running',
      'interrupted',
      'idle',
    ]);
    expect(pushes.some((p) => p.kind === 'turn' && p.frame.t === 'error')).toBe(false);
    expect(pushes.some((p) => p.kind === 'status' && p.state === 'error')).toBe(false);
  });

  it('re-establishes after an interrupt so the next turn runs instead of hanging on the dead query (SC-1)', async () => {
    const adapters: HeldOpenAdapter[] = [];
    const conn = connection();
    // Only the FIRST query is abortable — it gets interrupted and never settles on its
    // own; the follow-up turn's re-established query must process normally.
    const customDeps: SessionDeps = {
      ...deps([]),
      sessionStrategy: (provider) => (provider === 'claude' ? 'held-open' : 'per-turn'),
      createAdapter: (init) => {
        const adapter = new HeldOpenAdapter(
          init,
          [{ t: 'text', text: 'ok' }],
          adapters.length === 0,
        );
        adapters.push(adapter);
        return adapter;
      },
    };
    const handlers = buildSessionHandlers(customDeps, conn, undefined, new LiveSessionRegistry());
    const { sessionId } = await handlers['createSession']!.handle({
      input: 'go',
      conversationId: 'h1',
    });

    expect(await handlers['interruptSession']!.handle({ id: sessionId })).toEqual({
      interrupted: true,
    });
    await flush();
    await flush();

    // The interrupted query terminated — its feed has no consumer, so continuing it would
    // hang forever. The next turn MUST re-establish a fresh query and run to completion.
    await handlers['createSession']!.handle({ input: 'after', conversationId: 'h1' });
    await flush();
    await flush();

    expect(adapters.length).toBe(2);
    expect(adapters[1]?.consumed).toEqual(['after']);
    const states = pushesOf(conn.pushes).flatMap((p) => (p.kind === 'status' ? [p.state] : []));
    expect(states).toContain('interrupted');
    // The follow-up turn reached a terminal `done` (the session recovered, not stuck running).
    expect(states.filter((s) => s === 'done')).toHaveLength(1);
  });

  it("re-establishes a NEW query when a later turn switches model — not turn 1's query (config-change safety, R4)", async () => {
    const adapters: HeldOpenAdapter[] = [];
    const conn = connection();
    const handlers = buildSessionHandlers(
      depsHeldOpen(adapters),
      conn,
      undefined,
      new LiveSessionRegistry(),
    );

    await handlers['createSession']!.handle({
      input: 'first',
      conversationId: 'h1',
      model: { provider: 'claude', model: 'opus' },
    });
    await flush();
    await handlers['createSession']!.handle({
      input: 'second',
      conversationId: 'h1',
      model: { provider: 'claude', model: 'sonnet' },
    });
    await flush();
    await flush();

    // A model switch cannot ride turn 1's pinned query: it re-establishes a second one.
    expect(adapters.length).toBe(2);
    expect(adapters[0]?.consumed).toEqual(['first']);
    expect(adapters[1]?.consumed).toEqual(['second']);
  });

  it('terminates the held-open query when the session closes (the streaming-termination contract, R2)', async () => {
    const adapters: HeldOpenAdapter[] = [];
    const conn = connection();
    const registry = new LiveSessionRegistry();
    const handlers = buildSessionHandlers(depsHeldOpen(adapters), conn, undefined, registry);
    const { sessionId } = await handlers['createSession']!.handle({
      input: 'go',
      conversationId: 'h1',
    });
    await flush();

    expect(adapters[0]?.ended).toBe(false); // still open across turns
    await handlers['closeSession']!.handle({ id: sessionId });
    await flush();

    // Closing the session ended the derived input feed ⇒ the query terminated.
    expect(adapters[0]?.ended).toBe(true);
    expect(registry.get(sessionId)).toBeUndefined();
  });

  it('a one-turn SDK conversation is observably unchanged: running, the turn frames, done, idle (D85)', async () => {
    const adapters: HeldOpenAdapter[] = [];
    const conn = connection();
    const handlers = buildSessionHandlers(
      depsHeldOpen(adapters),
      conn,
      undefined,
      new LiveSessionRegistry(),
    );
    await handlers['createSession']!.handle({ input: 'go', conversationId: 'h1' });
    await conn.settled;
    await flush();

    const pushes = pushesOf(conn.pushes);
    expect(pushes.flatMap((p) => (p.kind === 'status' ? [p.state] : []))).toEqual([
      'running',
      'done',
      'idle',
    ]);
    // The content frames (excluding the turn-boundary marker the real SDK path also emits)
    // match the single turn's output — the observable stream is unchanged.
    expect(
      pushes.flatMap((p) => (p.kind === 'turn' && p.frame.t !== 'turn-boundary' ? [p.frame] : [])),
    ).toEqual([{ t: 'text', text: 'ok' }]);
  });

  it('barge-in interrupts the running turn and runs the framed steer next (I3: resolves the steer turn)', async () => {
    const adapters: BargeInAdapter[] = [];
    const conn = connection();
    const customDeps: SessionDeps = {
      ...deps([]),
      sessionStrategy: (provider) => (provider === 'claude' ? 'held-open' : 'per-turn'),
      createAdapter: (init) => {
        const adapter = new BargeInAdapter(init);
        adapters.push(adapter);
        return adapter;
      },
    };
    const handlers = buildSessionHandlers(customDeps, conn, undefined, new LiveSessionRegistry());

    const { sessionId } = await handlers['createSession']!.handle({
      input: 'go',
      conversationId: 'h1',
    });
    await flush(); // turn A's partial frame lands; the adapter now blocks on the interrupt handle

    expect(
      await handlers['steerSession']!.handle({ id: sessionId, text: 'redirect', mode: 'barge-in' }),
    ).toEqual({ steered: true });
    await flush();
    await flush();

    expect(adapters.length).toBe(1);
    // (a) the turn-interrupt handle was called exactly once.
    expect(adapters[0]?.interruptCalls).toBe(1);
    // (b) the framed text — not the bare steer — is what landed in the input feed.
    expect(adapters[0]?.consumed).toEqual(['go', '[The user interrupted to steer you] redirect']);

    // (c) the driver's turn promise resolves only after the STEER turn's (B) boundary,
    // not the interrupted turn's (A): exactly one `turn-boundary` frame — A's — precedes
    // the `done` status, and it is NOT immediately followed by `done` (B's frames land
    // first).
    const pushes = pushesOf(conn.pushes);
    const boundaryIndices = pushes
      .map((p, i) => (p.kind === 'turn' && p.frame.t === 'turn-boundary' ? i : -1))
      .filter((i) => i >= 0);
    const doneIndex = pushes.findIndex((p) => p.kind === 'status' && p.state === 'done');
    expect(boundaryIndices).toHaveLength(2); // A's boundary, then B's
    expect(doneIndex).toBeGreaterThan(boundaryIndices[0]!); // NOT resolved right after A
    expect(doneIndex).toBe(boundaryIndices[1]! + 1); // resolved immediately after B
  });

  it('reaches a terminal done on a barge-in even when the interrupted turn emits NO boundary (real SDK interrupt)', async () => {
    // Ground truth (SDK source): `query.interrupt()` stops the running turn WITHOUT the
    // subprocess emitting a result/boundary for it — the abandoned turn simply ends. A
    // scheme that PREDICTS the interrupted turn will boundary therefore waits forever and
    // the pill sticks in 'running' (the reported bug). `interruptFrames: []` models the
    // real interrupt: no boundary for turn A. The redirect turn B must still complete and
    // drive the session to a terminal 'done'.
    const adapters: BargeInAdapter[] = [];
    const conn = connection();
    const customDeps: SessionDeps = {
      ...deps([]),
      sessionStrategy: (provider) => (provider === 'claude' ? 'held-open' : 'per-turn'),
      createAdapter: (init) => {
        const adapter = new BargeInAdapter(init, []); // interrupt emits NO boundary for turn A
        adapters.push(adapter);
        return adapter;
      },
    };
    const handlers = buildSessionHandlers(customDeps, conn, undefined, new LiveSessionRegistry());

    const { sessionId } = await handlers['createSession']!.handle({
      input: 'go',
      conversationId: 'h1',
    });
    await flush();
    expect(
      await handlers['steerSession']!.handle({ id: sessionId, text: 'redirect', mode: 'barge-in' }),
    ).toEqual({ steered: true });
    await flush();
    await flush();

    // The framed steer (turn B) still ran…
    expect(adapters[0]?.consumed).toEqual(['go', '[The user interrupted to steer you] redirect']);
    // …and the session reached a terminal 'done' rather than hanging in 'running' forever.
    const pushes = pushesOf(conn.pushes);
    expect(pushes.some((p) => p.kind === 'status' && p.state === 'done')).toBe(true);
  });

  it("suppresses the interrupted turn's own error frame — never emitted nor persisted (SC-1)", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-bi-'));
    try {
      const store = createConversationStore(dir);
      const adapters: BargeInAdapter[] = [];
      const conn = connection();
      const customDeps: SessionDeps = {
        ...deps([]),
        sessionStrategy: (provider) => (provider === 'claude' ? 'held-open' : 'per-turn'),
        createAdapter: (init) => {
          // A NON-success interrupt: turn A's terminal result maps to an `error` frame
          // AND a boundary (turn-frames.ts pairs both from one non-success message).
          const adapter = new BargeInAdapter(init, [
            { t: 'error', message: 'interrupted mid-flight', origin: 'loop' },
            { t: 'turn-boundary', role: 'assistant' },
          ]);
          adapters.push(adapter);
          return adapter;
        },
      };
      const handlers = buildSessionHandlers(customDeps, conn, store, new LiveSessionRegistry());

      const { sessionId } = await handlers['createSession']!.handle({
        input: 'go',
        conversationId: 'h1',
      });
      await flush();
      expect(
        await handlers['steerSession']!.handle({
          id: sessionId,
          text: 'redirect',
          mode: 'barge-in',
        }),
      ).toEqual({ steered: true });
      await flush();
      await flush();

      const pushes = pushesOf(conn.pushes);
      // SC-1: the interrupted turn's error is never surfaced to the session sink…
      expect(pushes.some((p) => p.kind === 'turn' && p.frame.t === 'error')).toBe(false);
      expect(pushes.some((p) => p.kind === 'status' && p.state === 'error')).toBe(false);
      // …nor persisted into canonical memory.
      expect(store.reload('h1').some((t) => t.frame.t === 'error')).toBe(false);
      // The framed steer (turn B) still ran to completion, and the driver resolved on it.
      expect(adapters[0]?.consumed).toEqual(['go', '[The user interrupted to steer you] redirect']);
      expect(pushes.some((p) => p.kind === 'status' && p.state === 'done')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('feeds the framed steer even when the SDK interrupt rejects, so the session never hangs in running', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-bi-'));
    try {
      const store = createConversationStore(dir);
      const adapters: BargeInAdapter[] = [];
      const conn = connection();
      const customDeps: SessionDeps = {
        ...deps([]),
        sessionStrategy: (provider) => (provider === 'claude' ? 'held-open' : 'per-turn'),
        createAdapter: (init) => {
          // The SDK interrupt REJECTS after ending turn A (a real-world failure mode the
          // live GUI hit): the framed steer must still be fed or the latch hangs forever.
          const adapter = new BargeInAdapter(
            init,
            [
              { t: 'error', message: 'interrupted mid-flight', origin: 'loop' },
              { t: 'turn-boundary', role: 'assistant' },
            ],
            -1,
            true, // interruptRejects
          );
          adapters.push(adapter);
          return adapter;
        },
      };
      const handlers = buildSessionHandlers(customDeps, conn, store, new LiveSessionRegistry());

      const { sessionId } = await handlers['createSession']!.handle({
        input: 'go',
        conversationId: 'h1',
      });
      await flush();
      expect(
        await handlers['steerSession']!.handle({
          id: sessionId,
          text: 'redirect',
          mode: 'barge-in',
        }),
      ).toEqual({ steered: true });
      await flush();
      await flush();

      // Despite the rejecting interrupt, the framed steer (turn B) was still fed and ran…
      expect(adapters[0]?.consumed).toEqual(['go', '[The user interrupted to steer you] redirect']);
      // …so the boundary latch resolved and the session reached a terminal 'done' status,
      // rather than hanging in 'running' forever (the #2 stuck-status bug).
      const pushes = pushesOf(conn.pushes);
      expect(pushes.some((p) => p.kind === 'status' && p.state === 'done')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not leak barge-in error-suppression into a later turn — a success-subtype interrupt clears it (SC-1)', async () => {
    const adapters: BargeInAdapter[] = [];
    const conn = connection();
    const customDeps: SessionDeps = {
      ...deps([]),
      sessionStrategy: (provider) => (provider === 'claude' ? 'held-open' : 'per-turn'),
      createAdapter: (init) => {
        // Turn A's interrupt is a SUCCESS subtype: only a boundary, NO error frame — so
        // `barging` is never decremented by an error and would leak without the reset.
        // The third consumed turn (index 2, turn C) genuinely fails.
        const adapter = new BargeInAdapter(init, [{ t: 'turn-boundary', role: 'assistant' }], 2);
        adapters.push(adapter);
        return adapter;
      },
    };
    const handlers = buildSessionHandlers(customDeps, conn, undefined, new LiveSessionRegistry());

    const { sessionId } = await handlers['createSession']!.handle({
      input: 'go',
      conversationId: 'h1',
    });
    await flush();
    // Barge-in during turn A (success-subtype interrupt, then framed steer B runs).
    await handlers['steerSession']!.handle({ id: sessionId, text: 'redirect', mode: 'barge-in' });
    await flush();
    await flush();

    // A later, unrelated turn C that genuinely fails.
    await handlers['createSession']!.handle({ input: 'unrelated', conversationId: 'h1' });
    await flush();
    await flush();

    expect(adapters.length).toBe(1);
    expect(adapters[0]?.consumed).toEqual([
      'go',
      '[The user interrupted to steer you] redirect',
      'unrelated',
    ]);
    // C's genuine error IS surfaced — the barge-in's `barging` counter was cleared when
    // the redirect completed, not left to swallow this unrelated turn's failure.
    const pushes = pushesOf(conn.pushes);
    expect(
      pushes.some(
        (p) => p.kind === 'turn' && p.frame.t === 'error' && p.frame.message === 'genuine failure',
      ),
    ).toBe(true);
  });

  it('a barge-in with no turn in flight is a plain next turn — no interrupt, no framing (SC-1)', async () => {
    // `control` stays set between turns of a held-open query; a `barge-in` steer arriving
    // while idle (pendingTurns === 0) must NOT interrupt nothing, frame the text, or bump
    // the counters — it is just a normal next turn.
    const adapters: HeldOpenAdapter[] = [];
    const conn = connection();
    const handlers = buildSessionHandlers(
      depsHeldOpen(adapters),
      conn,
      undefined,
      new LiveSessionRegistry(),
    );

    const { sessionId } = await handlers['createSession']!.handle({
      input: 'first',
      conversationId: 'h1',
    });
    await flush(); // turn 1 completes; the query is open but idle (pendingTurns === 0)

    await handlers['steerSession']!.handle({ id: sessionId, text: 'more', mode: 'barge-in' });
    await flush();
    await flush();

    // The raw text — NOT the `FRAME_BARGE_IN`-prefixed form — was fed as a normal turn.
    expect(adapters.length).toBe(1);
    expect(adapters[0]?.consumed).toEqual(['first', 'more']);
  });

  it("counts a queue-mode steer pushed while running, so a LATER turn's latch does not resolve early (I3)", async () => {
    // A queue-mode steer delivered mid-turn runs as its OWN SDK turn (its own boundary).
    // If that boundary is unaccounted, a later send's latch resolves on it instead of on
    // the later turn's own boundary (docs/adr/0012 I3) — the desync this test pins down.
    let adapter: QueueSteerAdapter | undefined;
    const conn = connection();
    const customDeps: SessionDeps = {
      ...deps([]),
      sessionStrategy: (provider) => (provider === 'claude' ? 'held-open' : 'per-turn'),
      createAdapter: (init) => {
        adapter = new QueueSteerAdapter(init);
        return adapter;
      },
    };
    const handlers = buildSessionHandlers(customDeps, conn, undefined, new LiveSessionRegistry());

    // Turn A starts and parks (running).
    const { sessionId } = await handlers['createSession']!.handle({
      input: 'A',
      conversationId: 'h1',
    });
    await flush();

    // A queue-mode steer (the DEFAULT mode) arrives while A runs — it becomes its own turn.
    expect(await handlers['steerSession']!.handle({ id: sessionId, text: 'steer' })).toEqual({
      steered: true,
    });

    // A boundaries; the steer turn is then consumed and parks (still no completion for A's
    // driver, which must now also await the steer turn's boundary).
    adapter!.boundaryCurrent();
    await flush();

    // A SECOND send C arrives. It must NOT start until A's driver returns (after the steer
    // turn boundaries) — and once it runs, its latch must ride C's OWN boundary.
    await handlers['createSession']!.handle({ input: 'C', conversationId: 'h1' });
    await flush();

    // The steer turn boundaries: this releases A's driver (pendingTurns → 0), after which C
    // runs and parks. If the steer turn were UNCOUNTED, this boundary would instead resolve
    // C's latch early (the bug).
    adapter!.boundaryCurrent();
    await flush();

    // Finally C boundaries — the only thing that should complete C.
    adapter!.boundaryCurrent();
    await flush();

    expect(adapter!.consumed).toEqual(['A', 'steer', 'C']);
    const pushes = pushesOf(conn.pushes);
    const idxReplyC = pushes.findIndex(
      (p) => p.kind === 'turn' && p.frame.t === 'text' && p.frame.text === 'reply:C',
    );
    expect(idxReplyC).toBeGreaterThanOrEqual(0);
    const doneIdxs = pushes
      .map((p, i) => (p.kind === 'status' && p.state === 'done' ? i : -1))
      .filter((i) => i >= 0);
    // Exactly one completion per client send (A and C) — the queued steer turn does NOT add a
    // spurious completion. With the bug there are THREE dones (A, an early C, then C again).
    expect(doneIdxs).toHaveLength(2);
    // Only turn A completed before C was ever generated. With the bug, the queued steer's
    // boundary resolves C's latch early, so TWO dones land before `reply:C`.
    expect(doneIdxs.filter((i) => i < idxReplyC)).toHaveLength(1);
    // C's completion rides its own boundary — the last done follows C's content.
    expect(doneIdxs[doneIdxs.length - 1]!).toBeGreaterThan(idxReplyC);
  });

  it('persists a queue-mode steer as a user turn in the append-only log (regression: steers used to vanish from canonical memory)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-ho-queue-'));
    try {
      const store = createConversationStore(dir);
      const adapters: HeldOpenAdapter[] = [];
      const conn = connection();
      const handlers = buildSessionHandlers(
        depsHeldOpen(adapters),
        conn,
        store,
        new LiveSessionRegistry(),
      );

      const { sessionId } = await handlers['createSession']!.handle({
        input: 'go',
        conversationId: 'h1',
      });
      expect(await handlers['steerSession']!.handle({ id: sessionId, text: 'also do X' })).toEqual({
        steered: true,
      });
      await flush();
      await flush();

      expect(adapters.length).toBe(1);
      expect(adapters[0]?.consumed).toEqual(['go', 'also do X']);
      // The steer reaches canonical memory as its own user turn — not just the live feed —
      // so it survives a console reload (the retired streaming tap used to record this).
      expect(store.loadBackendMessages('h1')).toEqual([
        { role: 'user', content: 'go' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'also do X' },
        { role: 'assistant', content: 'ok' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists a barge-in steer as a FRAMED user turn in the append-only log (regression: steers used to vanish from canonical memory)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-bi-persist-'));
    try {
      const store = createConversationStore(dir);
      const adapters: BargeInAdapter[] = [];
      const conn = connection();
      const customDeps: SessionDeps = {
        ...deps([]),
        sessionStrategy: (provider) => (provider === 'claude' ? 'held-open' : 'per-turn'),
        createAdapter: (init) => {
          const adapter = new BargeInAdapter(init);
          adapters.push(adapter);
          return adapter;
        },
      };
      const handlers = buildSessionHandlers(customDeps, conn, store, new LiveSessionRegistry());

      const { sessionId } = await handlers['createSession']!.handle({
        input: 'go',
        conversationId: 'h1',
      });
      await flush(); // turn A's partial frame lands; the adapter now blocks on the interrupt handle

      expect(
        await handlers['steerSession']!.handle({
          id: sessionId,
          text: 'redirect',
          mode: 'barge-in',
        }),
      ).toEqual({ steered: true });
      await flush();
      await flush();

      // The FRAMED text — as fed to the model, not the bare steer — reaches canonical
      // memory as its own user turn (docs/adr/0012's framing is part of what happened).
      expect(store.loadBackendMessages('h1')).toEqual([
        { role: 'user', content: 'go' },
        { role: 'assistant', content: 'partial' },
        { role: 'user', content: '[The user interrupted to steer you] redirect' },
        { role: 'assistant', content: 'ok' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pushes streaming deltas over the held-open query but never appends them (docs/adr/0013)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-ho-delta-'));
    try {
      const store = createConversationStore(dir);
      const adapters: HeldOpenAdapter[] = [];
      const conn = connection();
      const customDeps: SessionDeps = {
        ...deps([]),
        sessionStrategy: (provider) => (provider === 'claude' ? 'held-open' : 'per-turn'),
        createAdapter: (init) => {
          const adapter = new HeldOpenAdapter(init, [
            { t: 'text-delta', text: 'Hel' },
            { t: 'text-delta', text: 'lo' },
            { t: 'text', text: 'Hello' },
          ]);
          adapters.push(adapter);
          return adapter;
        },
      };
      const handlers = buildSessionHandlers(customDeps, conn, store, new LiveSessionRegistry());

      await handlers['createSession']!.handle({ input: 'go', conversationId: 'h1' });
      await flush();

      const pushedFrames = pushesOf(conn.pushes).flatMap((p) =>
        p.kind === 'turn' ? [p.frame] : [],
      );
      expect(pushedFrames).toContainEqual({ t: 'text-delta', text: 'Hel' });
      expect(pushedFrames).toContainEqual({ t: 'text-delta', text: 'lo' });
      expect(pushedFrames).toContainEqual({ t: 'text', text: 'Hello' });

      const persistedFrames = store.reload('h1').map((t) => t.frame);
      expect(persistedFrames).not.toContainEqual({ t: 'text-delta', text: 'Hel' });
      expect(persistedFrames).not.toContainEqual({ t: 'text-delta', text: 'lo' });
      expect(persistedFrames).toContainEqual({ t: 'text', text: 'Hello' });

      // The delta guard sits ahead of the barging/boundary accounting — the turn's
      // `turn-boundary` still resolves the driver normally (a delta must not touch it).
      const pushes = pushesOf(conn.pushes);
      expect(pushes.some((p) => p.kind === 'status' && p.state === 'done')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
