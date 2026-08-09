import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentSummary,
  CapabilitySet,
  NeutralConfig,
  Push,
  RpcNotification,
  TurnFrame,
} from '@coa/shared';
import type { BackendConfig, CanUseTool, Delivery, RuntimeAdapter, StopPredicate } from '@coa/spi';
import type { AssemblePiecesContext, SessionAdapterInit, SessionDeps } from './session.js';
import { buildSessionHandlers } from './session-handlers.js';
import { SessionService } from './session-service.js';
import { createConversationStore, type ConversationStore } from './conversation-store.js';
import { configHashOf } from './prompt-freeze.js';
import { unreadableMemoryNotice } from './memory-plan.js';
import { LiveSessionRegistry } from './live-registry.js';
import { TurnLifecycle } from './turn-lifecycle.js';
import type { RpcConnection } from '../rpc/stream.js';
import type { RpcHandlers } from '../rpc/router.js';
import { dispatch } from '../rpc/router.js';

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
  /** Set by the `steerable` mode once `init.drainDeliveries` is consulted (test observation point). */
  deliveryDrained: readonly Delivery[] = [];

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
     * Model the pure-API driver's safe-boundary delivery drain: yield once (so a
     * test can call `steerSession` in the gap) before consulting
     * `init.drainDeliveries`, recording what it drained onto `this.deliveryDrained`.
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
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {} };
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
      this.deliveryDrained = this.init.drainDeliveries?.() ?? [];
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
}

/** A fake backend that streams enriched (frame, full) pairs through `onTurn`, then settles —
 *  proving a tool_result's FULL body (not just the lossy pointer) reaches persistence
 *  (the append-only log's full-body fidelity companion, threaded end to end via `onTurn(frame, full)`). */
class EnrichedFrameAdapter implements RuntimeAdapter {
  constructor(
    readonly init: SessionAdapterInit,
    readonly enriched: ReadonlyArray<{ frame: TurnFrame; full?: string }>,
  ) {}
  renderNative(): BackendConfig {
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {} };
  }
  registerTools(): void {}
  denyBuiltins(): void {}
  interceptTool(_c: CanUseTool): void {}
  interceptStop(_s: StopPredicate): void {}
  async runLoop(): Promise<void> {
    for (const { frame, full } of this.enriched) this.init.onTurn?.(frame, full);
    this.init.onSettle(this.init.sessionId, { tokensIn: 1, tokensOut: 2, costUsd: 0.25 });
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

/** The daemon-scoped half: one service over one registry, exactly as `apps/cli` builds it.
 *  Tests with more than one connection build ONE of these and hand it to both. */
function sessionService(
  deps: SessionDeps,
  store: ConversationStore | undefined,
  registry: LiveSessionRegistry,
  listAgents?: () => readonly AgentSummary[],
): SessionService {
  return new SessionService({
    deps,
    registry,
    ...(store !== undefined ? { store } : {}),
    ...(listAgents !== undefined ? { listAgents } : {}),
  });
}

/** One connection's handlers over a service built for this call — the single-connection
 *  shape most of these tests want. */
function handlersFor(
  deps: SessionDeps,
  connection: RpcConnection,
  store: ConversationStore | undefined,
  registry: LiveSessionRegistry,
  listAgents?: () => readonly AgentSummary[],
): RpcHandlers {
  return buildSessionHandlers(sessionService(deps, store, registry, listAgents), connection);
}

const pushesOf = (notes: RpcNotification[]): Push[] => notes.map((n) => n.params as Push);

/** Every turn frame pushed, in push order — the read-time view of the append-only log. */
function framesOf(pushes: RpcNotification[]): TurnFrame[] {
  return pushesOf(pushes).flatMap((p) => (p.kind === 'turn' ? [p.frame] : []));
}

/** Let every currently-pending microtask (incl. the loop's post-turn `idle` push,
 *  which lands one hop after the turn's own `done`/`error`/`interrupted`) settle. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('buildSessionHandlers — createSession over RPC', () => {
  it('returns the session id + worktree once the session starts', async () => {
    const conn = connection();
    const handlers = handlersFor(
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
    const handlers = handlersFor(deps(frames), conn, undefined, new LiveSessionRegistry());
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
    const handlers = handlersFor(deps(frames), conn, undefined, new LiveSessionRegistry());
    await handlers['createSession']!.handle({ input: 'go' });
    await conn.settled;
    await flush(); // the live session's post-turn `idle` (run-live-session.ts) lands one hop later

    expect(pushesOf(conn.pushes)).toEqual([
      { kind: 'status', sessionId: 'sess-1', worktree: '/wt/sess-1', state: 'running' },
      { kind: 'turn', sessionId: 'sess-1', worktree: '/wt/sess-1', seq: 0, frame: frames[0] },
      { kind: 'turn', sessionId: 'sess-1', worktree: '/wt/sess-1', seq: 1, frame: frames[1] },
      // The settlement's usage mirror (the context ring feed) lands before the
      // terminal status — the adapter settles as its loop ends.
      { kind: 'usage', sessionId: 'sess-1', tokensIn: 1, tokensOut: 2 },
      { kind: 'status', sessionId: 'sess-1', worktree: '/wt/sess-1', state: 'done' },
      { kind: 'status', sessionId: 'sess-1', worktree: '/wt/sess-1', state: 'idle' },
    ]);
  });

  it('every pushed record is sent as a `push` JSON-RPC notification', async () => {
    const conn = connection();
    const handlers = handlersFor(
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
    const handlers = handlersFor(deps([], true), conn, undefined, new LiveSessionRegistry());
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
    const handlers = handlersFor(deps([]), conn, undefined, new LiveSessionRegistry());
    expect(handlers['createSession']!.params?.safeParse({}).success).toBe(false);
  });

  it('emits a governed deny frame through the same path as any other frame', async () => {
    // A deny is NOT an error, so no error-suppression path may swallow it, and `stamp`
    // must pass it through unreshaped. If either is false, the session layer needs a fix.
    const conn = connection();
    const handlers = handlersFor(
      deps([{ t: 'deny', denyKind: 'close-gate', reason: 'blocked at close' }]),
      conn,
      undefined,
      new LiveSessionRegistry(),
    );
    await handlers['createSession']!.handle({ input: 'go' });
    await conn.settled;

    const frames = pushesOf(conn.pushes).flatMap((p) => (p.kind === 'turn' ? [p.frame] : []));
    expect(frames).toContainEqual({
      t: 'deny',
      denyKind: 'close-gate',
      reason: 'blocked at close',
    });
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

describe('buildSessionHandlers — streaming deltas are delivery-only', () => {
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
      const handlers = handlersFor(deps(frames), conn, store, new LiveSessionRegistry());
      await handlers['createSession']!.handle({ input: 'go', conversationId: 'c1' });
      await conn.settled;

      const pushedFrames = pushesOf(conn.pushes).flatMap((p) =>
        p.kind === 'turn' ? [p.frame] : [],
      );
      expect(pushedFrames).toContainEqual({ t: 'text-delta', text: 'Hel' });
      expect(pushedFrames).toContainEqual({ t: 'text-delta', text: 'lo' });
      expect(pushedFrames).toContainEqual({ t: 'text', text: 'Hello' });

      // The durable log holds only the settled frame — deltas never reach `store.append`.
      const persistedFrames = store.reload('c1').turns.map((t) => t.frame);
      expect(persistedFrames).not.toContainEqual({ t: 'text-delta', text: 'Hel' });
      expect(persistedFrames).not.toContainEqual({ t: 'text-delta', text: 'lo' });
      expect(persistedFrames).toContainEqual({ t: 'text', text: 'Hello' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildSessionHandlers — persistent conversation', () => {
  let dir: string;
  let store: ConversationStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coa-sh-'));
    store = createConversationStore(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('persists the user prompt then the streamed frames, and auto-titles from the prompt', async () => {
    const conn = connection();
    const handlers = handlersFor(
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

    expect(store.reload('c1').turns).toEqual([
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
    const handlers = handlersFor(
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

    expect(store.reload('c1').turns.map((t) => ({ seq: t.seq, frame: t.frame }))).toEqual([
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
    await handlersFor(deps([{ t: 'text', text: 'reply' }]), conn, store, registry)[
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
    await handlersFor(deps([], true), conn2, store, new LiveSessionRegistry())[
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
    const handlers = handlersFor(
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
    expect(store.loadBackendMessages('c1').messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'reply' },
    ]);
  });

  it('hands the model a note when part of the stored record could not be read', async () => {
    const inits: SessionAdapterInit[] = [];
    const handlers = handlersFor(
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
    // A half-written append (the shape a crash mid-flush leaves behind): the line is
    // skipped on read, and the next send would otherwise resume the model on the
    // remainder as if it were the whole conversation.
    appendFileSync(join(dir, 'c1', 'events.ndjson'), '{"seq":9,"frame":{"t":"te\n', 'utf8');

    await handlers['createSession']!.handle({
      input: 'second',
      role: '',
      scope: '',
      conversationId: 'c1',
    });
    await flush();
    const history = inits[1]?.history ?? [];
    expect(history.slice(0, 2)).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
    ]);
    expect(history[history.length - 1]).toEqual({
      role: 'user',
      content: unreadableMemoryNotice(1),
    });
  });

  it('does not persist or resume an ephemeral session (no conversationId)', async () => {
    const inits: SessionAdapterInit[] = [];
    const handlers = handlersFor(
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
      handlersFor(
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
      handlersFor(
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
    const handlers = handlersFor(
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
    const handlers = handlersFor(
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
    const handlers = handlersFor(
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
    const handlers = handlersFor(countingDeps, connection(), store, new LiveSessionRegistry());
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
    const handlers = handlersFor(countingDeps, connection(), store, new LiveSessionRegistry());

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
    const handlers = handlersFor(
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
    const handlers = handlersFor(
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
    const handlers = handlersFor(
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
    const handlers = handlersFor(
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
    const handlers = handlersFor(
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
 * are never persisted — streaming deltas are delivery-only, never persisted) and is stopped before emitting any settled frame. Only
 * the session layer's interrupt closure can settle what it streamed.
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

describe('buildSessionHandlers — F2 permission-mode verbs', () => {
  function build(): { handlers: RpcHandlers; registry: LiveSessionRegistry } {
    const registry = new LiveSessionRegistry();
    const service = sessionService(deps([]), undefined, registry);
    return { handlers: buildSessionHandlers(service, connection()), registry };
  }

  it('setMode switches a live session’s mode; sessionMode reads it back', async () => {
    const { handlers, registry } = build();
    registry.getOrCreate('c1');
    expect(await handlers['setMode']!.handle({ id: 'c1', mode: 'plan' })).toEqual({ set: true });
    expect(registry.get('c1')?.mode).toBe('plan');
    expect(await handlers['sessionMode']!.handle({ id: 'c1' })).toEqual({
      found: true,
      mode: 'plan',
      effectiveMode: 'plan',
      pending: [],
    });
  });

  it('setMode on an unknown session id returns set:false', async () => {
    const { handlers } = build();
    expect(await handlers['setMode']!.handle({ id: 'nope', mode: 'bypass' })).toEqual({
      set: false,
    });
  });

  it('sessionMode on an unknown session id returns found:false', async () => {
    const { handlers } = build();
    expect(await handlers['sessionMode']!.handle({ id: 'nope' })).toEqual({ found: false });
  });

  it('sessionMode surfaces a degraded effectiveMode honestly (SC-1 — never claim an enforcement the backend cannot deliver)', async () => {
    const { handlers, registry } = build();
    const { session } = registry.getOrCreate('c1', undefined, 'manual');
    session.setApprovalSeam(false);
    expect(await handlers['sessionMode']!.handle({ id: 'c1' })).toEqual({
      found: true,
      mode: 'manual',
      effectiveMode: 'bypass',
      pending: [],
    });
  });

  it('the respondApproval round trip: a pending request really blocks the tool call until answered, and approve resolves allow', async () => {
    const { handlers, registry } = build();
    const { session } = registry.getOrCreate('c1');
    let settled: 'allow' | 'deny' | undefined;
    const pending = session
      .requestApproval({ tool: 'Write', args: { path: 'a.ts' }, sessionId: 'c1' }, 'write')
      .then((d) => {
        settled = d;
        return d;
      });
    await Promise.resolve();
    expect(settled).toBeUndefined(); // genuinely still blocking, not a same-tick resolve

    const [request] = session.pendingApprovals();
    expect(request?.tool).toBe('Write');
    expect(
      await handlers['respondApproval']!.handle({
        id: 'c1',
        requestId: request!.requestId,
        decision: 'approve',
      }),
    ).toEqual({ resolved: true });
    await expect(pending).resolves.toBe('allow');
  });

  it('a deny decision resolves deny', async () => {
    const { handlers, registry } = build();
    const { session } = registry.getOrCreate('c1');
    const pending = session.requestApproval(
      { tool: 'Bash', args: { command: 'rm -rf /' }, sessionId: 'c1' },
      'exec',
    );
    const [request] = session.pendingApprovals();
    expect(
      await handlers['respondApproval']!.handle({
        id: 'c1',
        requestId: request!.requestId,
        decision: 'deny',
      }),
    ).toEqual({ resolved: true });
    await expect(pending).resolves.toBe('deny');
  });

  it('respondApproval on an unknown session id, or a stale requestId, returns resolved:false (a harmless no-op, not an error)', async () => {
    const { handlers, registry } = build();
    registry.getOrCreate('c1');
    expect(
      await handlers['respondApproval']!.handle({
        id: 'nope',
        requestId: 'r1',
        decision: 'approve',
      }),
    ).toEqual({ resolved: false });
    expect(
      await handlers['respondApproval']!.handle({
        id: 'c1',
        requestId: 'stale',
        decision: 'approve',
      }),
    ).toEqual({ resolved: false });
  });

  it('interruptSession fail-safe-denies and clears a pending ask — a Stop mid-ask must never leave the composer gate-locked on a request nothing can still answer', async () => {
    const { handlers, registry } = build();
    const { session } = registry.getOrCreate('c1');
    // A turn genuinely in flight — `interruptSession` requires this to do anything.
    session.control = { controller: new AbortController(), lifecycle: new TurnLifecycle() };
    session.setInterruptClosure(() => true);

    const pending = session.requestApproval(
      { tool: 'Bash', args: { command: 'rm -rf /' }, sessionId: 'c1' },
      'exec',
    );
    expect(session.pendingApprovals()).toHaveLength(1);

    expect(await handlers['interruptSession']!.handle({ id: 'c1' })).toEqual({
      interrupted: true,
    });
    await expect(pending).resolves.toBe('deny');
    expect(session.pendingApprovals()).toEqual([]);
  });
});

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
      const handlers = handlersFor(customDeps, conn, store, new LiveSessionRegistry());
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
      expect(store.reload('c1').turns.map((t) => t.frame)).toEqual([
        { t: 'text', text: 'write a poem', role: 'user' },
        { t: 'thinking', text: 'weighing', durationMs: expect.any(Number) },
        { t: 'text', text: 'The clockmaker' },
        { t: 'interrupted' },
      ]);
      // …and the model's NEXT turn reads that it was cut off, not that it finished.
      expect(store.loadBackendMessages('c1').messages).toEqual([
        { role: 'user', content: 'write a poem' },
        { role: 'assistant', content: 'The clockmaker' },
        { role: 'user', content: '[Request interrupted by user]' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('aborts the session and surfaces a clean interrupted stop — never an error (a user stop, never an error)', async () => {
    const conn = connection();
    const handlers = handlersFor(depsAbortable(), conn, undefined, new LiveSessionRegistry());
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
      // An aborted turn still settles what it consumed — the usage mirror fires on
      // EVERY loop exit (a partial turn is still charged), so the ring stays honest.
      { kind: 'usage', sessionId: 'sess-1', tokensIn: 1, tokensOut: 1 },
      { kind: 'status', sessionId: 'sess-1', worktree: '/wt/sess-1', state: 'interrupted' },
      { kind: 'status', sessionId: 'sess-1', worktree: '/wt/sess-1', state: 'idle' },
    ]);
    // No error frame and no error status — an interrupt is a user stop, not a governance block.
    expect(pushes.some((p) => p.kind === 'turn' && p.frame.t === 'error')).toBe(false);
    expect(pushes.some((p) => p.kind === 'status' && p.state === 'error')).toBe(false);
  });

  it('emits `interrupted` exactly once when the loop returns cleanly after an abort (clean-break path)', async () => {
    const conn = connection();
    const handlers = handlersFor(
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

  it('answers a redundant Stop with nothing-to-stop and records the interrupt marker ONCE', async () => {
    // A double-click on Stop. Only a RUNNING turn can be stopped, so the second press finds
    // an already-stopped turn and reports it. That answer is not cosmetic: the close-out is
    // not idempotent, so a second press that got through would settle the partial again and
    // append a SECOND interrupt marker — and the durable transcript is what every later
    // reload reads, so the model would be told it was cut off twice, forever.
    const dir = mkdtempSync(join(tmpdir(), 'coa-int2-'));
    try {
      const store = createConversationStore(dir);
      const conn = connection();
      const handlers = handlersFor(depsAbortable(), conn, store, new LiveSessionRegistry());
      const { sessionId } = await handlers['createSession']!.handle({
        input: 'go',
        conversationId: 'c1',
      });

      // Both presses land against the SAME in-flight turn: the second is issued before the
      // first press's abort has had a chance to unwind the loop.
      const first = handlers['interruptSession']!.handle({ id: sessionId });
      const second = handlers['interruptSession']!.handle({ id: sessionId });
      expect(await first).toEqual({ interrupted: true });
      expect(await second).toEqual({ interrupted: false });
      await flush();

      const pushes = pushesOf(conn.pushes);
      expect(pushes.filter((p) => p.kind === 'turn' && p.frame.t === 'interrupted')).toHaveLength(
        1,
      );
      expect(pushes.filter((p) => p.kind === 'status' && p.state === 'interrupted')).toHaveLength(
        1,
      );
      expect(store.reload('c1').turns.map((t) => t.frame)).toEqual([
        { t: 'text', text: 'go', role: 'user' },
        { t: 'interrupted' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('routes a per-turn steer through steerSession into the delivery queue, not a mode buffer', async () => {
    // There is only one steer left: a running per-turn backend has no held-open sink, so
    // `steerSession` pushes straight onto `session.deliveries` — the same queue the
    // backend's own `drainDeliveries` hook reaches at its next round trip. Nothing routes
    // through `control.steer`/`control.queueSteer` anymore (those buffers are gone).
    const conn = connection();
    const adapters: FrameAdapter[] = [];
    const handlers = handlersFor(
      depsSteerable(adapters),
      conn,
      undefined,
      new LiveSessionRegistry(),
    );
    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });

    expect(
      await handlers['steerSession']!.handle({ id: sessionId, text: 'also fix the tests' }),
    ).toEqual({ steered: true });
    await conn.settled;

    expect(adapters[0]?.deliveryDrained).toEqual([{ origin: 'user', text: 'also fix the tests' }]);
  });

  it("hands the per-turn adapter the session's delivery drain, so a mid-loop delivery reaches a pure-API loop", async () => {
    const conn = connection();
    const adapters: FrameAdapter[] = [];
    const registry = new LiveSessionRegistry();
    const handlers = handlersFor(depsSteerable(adapters), conn, undefined, registry);
    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });

    // Core fills ONE queue per session; the driver drains it at the top of its next
    // round trip. Two entries, mixed origins, so the drain can't pass by luck.
    const session = registry.get(sessionId)!;
    session.deliveries.push({ origin: 'user', text: 'check the schema first' });
    session.deliveries.push({ origin: 'system', text: 'child agent finished' });
    await conn.settled;

    expect(adapters[0]?.deliveryDrained).toEqual([
      { origin: 'user', text: 'check the schema first' },
      { origin: 'system', text: 'child agent finished' },
    ]);
  });

  it('writes a per-turn delivery line once, in the delivered order', async () => {
    const conn = connection();
    const adapters: FrameAdapter[] = [];
    const registry = new LiveSessionRegistry();
    const handlers = handlersFor(depsSteerable(adapters), conn, undefined, registry);
    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });
    const session = registry.get(sessionId)!;
    session.deliveries.push({ origin: 'user', text: 'check the schema first' });
    session.deliveries.push({ origin: 'system', text: 'child agent finished' });
    await conn.settled;
    await flush();

    const written = framesOf(conn.pushes).flatMap((f) =>
      f.t === 'text' && (f.role === 'user' || f.role === 'system') ? [[f.role, f.text]] : [],
    );
    expect(written).toEqual([
      ['user', 'check the schema first'],
      ['system', 'child agent finished'],
    ]);
  });

  it('interruptSession on an unknown id returns the negative result without throwing', async () => {
    const handlers = handlersFor(deps([]), connection(), undefined, new LiveSessionRegistry());
    expect(await handlers['interruptSession']!.handle({ id: 'nope' })).toEqual({
      interrupted: false,
    });
  });

  it('steerSession on an unknown id returns the negative result without throwing', async () => {
    const handlers = handlersFor(deps([]), connection(), undefined, new LiveSessionRegistry());
    expect(await handlers['steerSession']!.handle({ id: 'nope', text: 'hi' })).toEqual({
      steered: false,
    });
  });

  it('rejects a whitespace-only steer, not just a bare empty string', async () => {
    // The console's own composer trims before sending (console.ts), so this only guards
    // a caller other than the shipped console — but a whitespace-only steer would otherwise
    // be recorded as a visible blank "you" turn.
    const conn = connection();
    const adapters: FrameAdapter[] = [];
    const handlers = handlersFor(
      depsSteerable(adapters),
      conn,
      undefined,
      new LiveSessionRegistry(),
    );
    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });

    expect(await handlers['steerSession']!.handle({ id: sessionId, text: '   ' })).toEqual({
      steered: false,
    });
    await conn.settled;

    expect(adapters[0]?.deliveryDrained).toEqual([]);
  });

  it('strips an unknown mode key instead of rejecting it, since there is only one steer', () => {
    const handlers = handlersFor(deps([]), connection(), undefined, new LiveSessionRegistry());
    // Asserted on the SCHEMA, not through `.handle()`: `rpcMethod` is a pure type cast and all
    // Zod validation happens in `dispatch()`, so a direct `.handle()` call proves nothing here.
    // Not `.strict()`: an older console build still sending `mode` (a version-skew straggler)
    // must degrade to an ordinary steer, never a rejected RPC call.
    expect(
      handlers['steerSession']!.params?.parse({ id: 's', text: 't', mode: 'barge-in' }),
    ).toEqual({
      id: 's',
      text: 't',
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
    const handlers = handlersFor(deps([{ t: 'text', text: 'x' }]), conn, undefined, registry);
    await handlers['createSession']!.handle({ input: 'go' });
    await conn.settled;

    const closed = await handlers['closeSession']!.handle({ id: 'sess-1' });
    expect(closed).toEqual({ closed: true });
    expect(released).toEqual(['/wt/sess-1']);
    expect(checkpoints).toBe(1);
  });

  it('reports not-closed for an unknown session id', async () => {
    const conn = connection();
    const handlers = handlersFor(deps([]), conn, undefined, new LiveSessionRegistry());
    expect(await handlers['closeSession']!.handle({ id: 'nope' })).toEqual({ closed: false });
  });
});

describe('buildSessionHandlers — block-preserving persistence on error', () => {
  it('persists the flushed transcript and still surfaces an error status', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-conv-'));
    try {
      const store = createConversationStore(dir);
      const conn = connection();
      const handlers = handlersFor(depsFlushThenFail(), conn, store, new LiveSessionRegistry());
      await handlers['createSession']!.handle({ input: 'edit the file', conversationId: 'c1' });
      await conn.settled;

      // The completed work reached canonical memory despite the mid-turn throw.
      expect(store.loadBackendMessages('c1').messages).toContainEqual({
        role: 'assistant',
        content: 'reply',
      });
      // The failure is still surfaced (surface, don't cage).
      expect(pushesOf(conn.pushes)).toContainEqual(
        expect.objectContaining({ kind: 'status', state: 'error' }),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildSessionHandlers — full tool-result fidelity', () => {
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
      const handlers = handlersFor(depsEnriched(enriched), conn, store, new LiveSessionRegistry());
      await handlers['createSession']!.handle({ input: 'read the file', conversationId: 'c1' });
      await conn.settled;

      // The fold reads the persisted `full` body — not the frame's lossy `pointer` —
      // into the provider-neutral tool message (`reload` deliberately omits `full`;
      // it is a frame-only read surface, see conversation-store.ts).
      expect(store.loadBackendMessages('c1').messages).toContainEqual({
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
    const handlers = handlersFor(
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

/**
 * A daemon owns ONE live session per conversation, and every connection talks to that one
 * session. So the connection that happened to FOUND a session must not be the only one
 * whose turns are honored in full: a second console — a reload, a second window, the
 * desktop app beside the CLI — sends against the same conversation id and its turn has to
 * carry its own role into prompt assembly and hydrate its own sink, exactly as the
 * founder's did. Anything the founding connection captured privately is invisible to it.
 */
describe('buildSessionHandlers — a turn sent over a connection that did not found the session', () => {
  /** Two connections onto one daemon: the founder plus a later arrival, sharing the one
   *  live-session registry the way `apps/cli` wires them. `assembledRoles` records the role
   *  each turn actually compiles under. No store, so nothing freezes the first turn's
   *  prompt — every turn assembles, making that role directly observable. */
  function twoConnections(shared?: SessionDeps): {
    assembledRoles: string[];
    founder: ReturnType<typeof connection>;
    second: ReturnType<typeof connection>;
    founderHandlers: RpcHandlers;
    secondHandlers: RpcHandlers;
  } {
    const assembledRoles: string[] = [];
    const sessionDeps: SessionDeps = {
      ...(shared ?? deps([{ t: 'text', text: 'ok' }])),
      assemblePieces: (ctx) => {
        assembledRoles.push(ctx.role);
        return { pieces: [], frame: { allow: [], deny: [] } };
      },
    };
    // ONE service, as the daemon has — the two connections share it and nothing else.
    const service = sessionService(sessionDeps, undefined, new LiveSessionRegistry());
    const founder = connection();
    const second = connection();
    return {
      assembledRoles,
      founder,
      second,
      founderHandlers: buildSessionHandlers(service, founder),
      secondHandlers: buildSessionHandlers(service, second),
    };
  }

  it("carries that turn's role into prompt assembly, not the empty default", async () => {
    const { assembledRoles, founderHandlers, secondHandlers } = twoConnections();

    await founderHandlers['createSession']!.handle({
      conversationId: 'shared-1',
      input: 'first',
      role: 'alpha',
    });
    await flush();
    await secondHandlers['createSession']!.handle({
      conversationId: 'shared-1',
      input: 'second',
      role: 'beta',
    });
    await flush();
    await flush();

    expect(assembledRoles).toEqual(['alpha', 'beta']);
  });

  it("hydrates the sending connection with that turn's true first status", async () => {
    const { second, founderHandlers, secondHandlers } = twoConnections();

    await founderHandlers['createSession']!.handle({
      conversationId: 'shared-2',
      input: 'first',
      role: 'alpha',
    });
    await flush();
    await secondHandlers['createSession']!.handle({
      conversationId: 'shared-2',
      input: 'second',
      role: 'alpha',
    });
    await flush();
    await flush();

    // The deferred subscribe the founder got, fired for this connection too: hydration
    // lands on `running`, never a spurious leading `idle`.
    expect(pushesOf(second.pushes)[0]).toEqual({
      kind: 'status',
      sessionId: 'shared-2',
      worktree: '/wt/sess-1',
      state: 'running',
    });
  });

  it('rides the open held-open query instead of tearing it down and re-establishing', async () => {
    const adapters: HeldOpenAdapter[] = [];
    const { founderHandlers, secondHandlers } = twoConnections(depsHeldOpen(adapters));

    // Both sends name the SAME role, so the query's pinned prompt-shaping config is
    // unchanged and there is nothing legitimate to re-establish for.
    await founderHandlers['createSession']!.handle({
      conversationId: 'h-shared',
      input: 'first',
      role: 'alpha',
    });
    await flush();
    await secondHandlers['createSession']!.handle({
      conversationId: 'h-shared',
      input: 'second',
      role: 'alpha',
    });
    await flush();
    await flush();

    expect(adapters.length).toBe(1);
    expect(adapters[0]?.consumed).toEqual(['first', 'second']);
  });
});

describe('buildSessionHandlers — subscribeSession (console reattach)', () => {
  it('hydrates a newly subscribing connection with the running status of an in-flight session', async () => {
    const founder = connection();
    const adapters: FrameAdapter[] = [];
    const service = sessionService(depsSteerable(adapters), undefined, new LiveSessionRegistry());
    const handlers = buildSessionHandlers(service, founder);
    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });

    // A second, independent connection joins the SAME daemon-owned live session.
    const watcher = connection();
    const watcherHandlers = buildSessionHandlers(service, watcher);
    const result = await watcherHandlers['subscribeSession']!.handle({ id: sessionId });

    expect(result).toEqual({ subscribed: true });
    expect(pushesOf(watcher.pushes)).toEqual([
      { kind: 'status', sessionId, worktree: '/wt/sess-1', state: 'running' },
    ]);
  });

  it('reports not-subscribed for an unknown session id', async () => {
    const watcher = connection();
    const handlers = handlersFor(deps([]), watcher, undefined, new LiveSessionRegistry());
    expect(await handlers['subscribeSession']!.handle({ id: 'nope' })).toEqual({
      subscribed: false,
    });
  });
});

describe('buildSessionHandlers — interrupt on a registry-backed conversation keeps a user stop from surfacing as an error', () => {
  it('interrupts the live session (a real conversationId) and never renders an error', async () => {
    const registry = new LiveSessionRegistry();
    const conn = connection();
    const handlers = handlersFor(depsAbortable(), conn, undefined, registry);
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
    // The interrupt is a user stop (a user stop, never an error) — the live session survives, it isn't torn down.
    expect(registry.get(sessionId)).toBeDefined();
  });
});

describe('buildSessionHandlers — interruptSession resolves via the LiveSession, not a per-connection map (the interrupt resolves via the daemon-owned live session, which survives reattach)', () => {
  it('a second connection that never started the turn can still interrupt it through the shared registry', async () => {
    const service = sessionService(depsAbortable(), undefined, new LiveSessionRegistry());

    // Connection A starts the in-flight (abortable) turn.
    const connA = connection();
    const handlersA = buildSessionHandlers(service, connA);
    const { sessionId } = await handlersA['createSession']!.handle({ input: 'go' });

    // Connection B is a DIFFERENT `buildSessionHandlers` call (its own, empty
    // per-connection state) that only shares the daemon-singleton service — the
    // reattach shape (e.g. a viewer that reconnects and never itself sent the
    // turn). Before the fix, B's own `control` map is empty, so this would
    // silently return `{ interrupted: false }` and never touch A's in-flight turn.
    const connB = connection();
    const handlersB = buildSessionHandlers(service, connB);

    const result = await handlersB['interruptSession']!.handle({ id: sessionId });
    expect(result).toEqual({ interrupted: true });

    // The interrupt lands on the turn connection A is watching: an `interrupted`
    // status is fanned out, and — never rendered as an error.
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
    const handlers = handlersFor(deps([{ t: 'text', text: 'x' }]), conn, undefined, registry);
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
    const handlers = handlersFor(deps([{ t: 'text', text: 'x' }]), conn, undefined, registry);
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

  it('unsubscribes a subscribeSession (console reattach) sink too, once that connection closes', async () => {
    const registry = new LiveSessionRegistry();
    const service = sessionService(depsSteerable([]), undefined, registry);
    const founder = connection();
    const handlers = buildSessionHandlers(service, founder);
    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });

    const watcher = connection();
    const watcherHandlers = buildSessionHandlers(service, watcher);
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
    const handlers = handlersFor(deps([{ t: 'text', text: 'x' }]), conn, undefined, registry);

    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });
    await conn.settled;

    expect(touchSpy).toHaveBeenCalledWith(sessionId);
  });
});

/**
 * A fake held-open streaming adapter: its `input` is the LiveSession's
 * derived {@link InputChannel}, and it consumes EVERY turn (initial + steers) from that
 * ONE iterable, marking each with a `turn-boundary` frame — the per-turn completion
 * signal the session driver awaits. It flushes the canonical transcript at each result
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
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {} };
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
}

/**
 * A held-open adapter whose turn is GENUINELY still running when the test steers: it emits
 * `tool_use`, parks on `toolRunning` (the test resolves it), drains deliveries where the Claude
 * adapter's PostToolUse hook drains them — BEFORE the tool_result reaches core — and only then
 * emits `tool_result` and the boundary. Parking matters: a fixture that completes inside one
 * microtask burst exercises an idle turn while claiming to test a running one.
 */
class OpenToolHeldAdapter implements RuntimeAdapter {
  readonly consumed: string[] = [];
  /** Resolved by the test once its steer has been pushed onto the delivery queue. */
  release: () => void = () => {};
  readonly toolRunning: Promise<void>;
  /** The deliveries this adapter drained, in drain order (test observation point). */
  deliveryDrained: readonly Delivery[] = [];

  constructor(readonly init: SessionAdapterInit) {
    this.toolRunning = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }
  renderNative(): BackendConfig {
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {} };
  }
  registerTools(): void {}
  denyBuiltins(): void {}
  interceptTool(_c: CanUseTool): void {}
  interceptStop(_s: StopPredicate): void {}
  async runLoop(): Promise<void> {
    const input = this.init.input;
    if (typeof input === 'string') return;
    for await (const text of input) {
      this.consumed.push(text);
      this.init.onTurn?.({ t: 'tool_use', tool: 'Bash', input: {}, handle: 'h1' });
      await this.toolRunning;
      this.deliveryDrained = this.init.drainDeliveries?.() ?? [];
      this.init.onTurn?.({ t: 'tool_result', handle: 'h1', ok: true, pointer: 'ok' });
      this.init.onTurn?.({ t: 'text', text: 'ok' });
      this.init.onSettle(this.init.sessionId, { tokensIn: 1, tokensOut: 2, costUsd: 0.25 });
      this.init.onTurn?.({ t: 'turn-boundary', role: 'assistant' });
    }
  }
}

function depsOpenTool(adapters: OpenToolHeldAdapter[]): SessionDeps {
  return {
    ...deps([]),
    sessionStrategy: (provider) => (provider === 'claude' ? 'held-open' : 'per-turn'),
    createAdapter: (init) => {
      const adapter = new OpenToolHeldAdapter(init);
      adapters.push(adapter);
      return adapter;
    },
  };
}

/**
 * A held-open adapter that models a mid-turn provider drop while a tool call is open: it
 * parks on `toolRunning` (mirroring `OpenToolHeldAdapter`), drains deliveries where the
 * Claude adapter's PostToolUse hook drains them — handing the text to the model — and then
 * THROWS instead of ever emitting the matching `tool_result`, the shape a dropped connection
 * produces. Proves `settleHeldQuery`'s error path flushes a parked line rather than stranding
 * it.
 */
class OpenToolThrowAdapter implements RuntimeAdapter {
  readonly consumed: string[] = [];
  release: () => void = () => {};
  readonly toolRunning: Promise<void>;
  deliveryDrained: readonly Delivery[] = [];

  constructor(readonly init: SessionAdapterInit) {
    this.toolRunning = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }
  renderNative(): BackendConfig {
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {} };
  }
  registerTools(): void {}
  denyBuiltins(): void {}
  interceptTool(_c: CanUseTool): void {}
  interceptStop(_s: StopPredicate): void {}
  async runLoop(): Promise<void> {
    const input = this.init.input;
    if (typeof input === 'string') return;
    for await (const text of input) {
      this.consumed.push(text);
      this.init.onTurn?.({ t: 'tool_use', tool: 'Bash', input: {}, handle: 'h1' });
      await this.toolRunning;
      this.deliveryDrained = this.init.drainDeliveries?.() ?? [];
      throw new Error('stream dropped with tool open');
    }
  }
}

function depsOpenToolThrow(adapters: OpenToolThrowAdapter[]): SessionDeps {
  return {
    ...deps([]),
    sessionStrategy: (provider) => (provider === 'claude' ? 'held-open' : 'per-turn'),
    createAdapter: (init) => {
      const adapter = new OpenToolThrowAdapter(init);
      adapters.push(adapter);
      return adapter;
    },
  };
}

/**
 * A per-turn adapter that models the same mid-turn provider drop for the non-held-open
 * strategy: it emits `tool_use`, yields one microtask (so a test can steer into the gap),
 * drains deliveries the way the Claude adapter's PostToolUse hook does, then THROWS instead
 * of emitting the matching `tool_result` — `runPerTurn`'s twin of `OpenToolThrowAdapter`.
 */
class OpenToolThenThrowAdapter implements RuntimeAdapter {
  deliveryDrained: readonly Delivery[] = [];
  constructor(readonly init: SessionAdapterInit) {}
  renderNative(): BackendConfig {
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {} };
  }
  registerTools(): void {}
  denyBuiltins(): void {}
  interceptTool(_c: CanUseTool): void {}
  interceptStop(_s: StopPredicate): void {}
  async runLoop(): Promise<void> {
    this.init.onTurn?.({ t: 'tool_use', tool: 'Bash', input: {}, handle: 'h1' });
    await new Promise((r) => setTimeout(r, 0));
    this.deliveryDrained = this.init.drainDeliveries?.() ?? [];
    throw new Error('stream dropped with tool open');
  }
}

describe('buildSessionHandlers — a delivery is recorded where the model received it', () => {
  it('writes the line AFTER the tool_result, never between the tool_use and its result', async () => {
    const conn = connection();
    const adapters: OpenToolHeldAdapter[] = [];
    const registry = new LiveSessionRegistry();
    const handlers = handlersFor(depsOpenTool(adapters), conn, undefined, registry);

    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });
    // The turn is parked mid-tool-call: the tool_use frame is out, the tool_result is not.
    await vi.waitFor(() => expect(adapters[0]).toBeDefined());
    await vi.waitFor(() =>
      expect(framesOf(conn.pushes).some((f) => f.t === 'tool_use')).toBe(true),
    );
    expect(framesOf(conn.pushes).some((f) => f.t === 'tool_result')).toBe(false);

    await handlers['steerSession']!.handle({ id: sessionId, text: 'use the JSON one' });
    // Not yet: the model has not been handed it, so nothing may claim it was said. Matched on
    // the steer's own text, not on "any user frame" — the turn's opening input is a user frame
    // too, and asserting against all of them would fail for a reason that is not the bug.
    expect(framesOf(conn.pushes).some((f) => f.t === 'text' && f.text === 'use the JSON one')).toBe(
      false,
    );

    adapters[0]!.release();
    await conn.settled;
    await flush();

    const frames = framesOf(conn.pushes);
    const useAt = frames.findIndex((f) => f.t === 'tool_use');
    const resultAt = frames.findIndex((f) => f.t === 'tool_result');
    const steerAt = frames.findIndex(
      (f) => f.t === 'text' && f.role === 'user' && f.text === 'use the JSON one',
    );
    const diag = JSON.stringify(frames.map((f) => f.t));
    expect(steerAt, diag).toBeGreaterThan(-1);
    // THE ASSERTION THAT MATTERS: position, not existence. A line between the pair is the
    // interleaving the Messages API forbids, and it is what the old code produced.
    expect(steerAt, diag).toBeGreaterThan(resultAt);
    expect(useAt, diag).toBeLessThan(resultAt);
  });

  it("records a system-origin delivery in the system role, not the person's", async () => {
    const conn = connection();
    const adapters: OpenToolHeldAdapter[] = [];
    const registry = new LiveSessionRegistry();
    const handlers = handlersFor(depsOpenTool(adapters), conn, undefined, registry);

    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });
    await vi.waitFor(() => expect(adapters[0]).toBeDefined());
    // Two entries, mixed origins: a single-item fixture cannot show the roles diverging.
    const session = registry.get(sessionId)!;
    session.deliveries.push({ origin: 'user', text: 'from the person' });
    session.deliveries.push({ origin: 'system', text: 'child agent finished' });
    adapters[0]!.release();
    await conn.settled;
    await flush();

    const texts = framesOf(conn.pushes).flatMap((f) =>
      f.t === 'text' && (f.role === 'user' || f.role === 'system') ? [[f.role, f.text]] : [],
    );
    expect(texts).toEqual([
      ['user', 'from the person'],
      ['system', 'child agent finished'],
    ]);
  });

  it('never records a delivery the model was never handed (sealed queue)', async () => {
    const conn = connection();
    const adapters: OpenToolHeldAdapter[] = [];
    const registry = new LiveSessionRegistry();
    const handlers = handlersFor(depsOpenTool(adapters), conn, undefined, registry);

    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });
    await vi.waitFor(() => expect(adapters[0]).toBeDefined());
    const session = registry.get(sessionId)!;
    session.deliveries.seal();
    await handlers['steerSession']!.handle({ id: sessionId, text: 'never delivered' });
    adapters[0]!.release();
    await conn.settled;
    await flush();

    expect(framesOf(conn.pushes).some((f) => f.t === 'text' && f.text === 'never delivered')).toBe(
      false,
    );
  });
});

describe('buildSessionHandlers — a mid-turn throw does not strand a parked delivery', () => {
  it('flushes a parked delivery line when a held-open query dies mid-tool-call', async () => {
    const conn = connection();
    const adapters: OpenToolThrowAdapter[] = [];
    const registry = new LiveSessionRegistry();
    const handlers = handlersFor(depsOpenToolThrow(adapters), conn, undefined, registry);

    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });
    // The turn is parked mid-tool-call: the tool_use frame is out, no tool_result yet.
    await vi.waitFor(() => expect(adapters[0]).toBeDefined());
    await vi.waitFor(() =>
      expect(framesOf(conn.pushes).some((f) => f.t === 'tool_use')).toBe(true),
    );

    await handlers['steerSession']!.handle({
      id: sessionId,
      text: 'check the other file too',
    });
    // Not yet: the model has not been handed it while the queue sits behind the open tool.
    expect(
      framesOf(conn.pushes).some((f) => f.t === 'text' && f.text === 'check the other file too'),
    ).toBe(false);

    // Release the park: the adapter drains the queue (handing the text to the model, exactly
    // like a real PostToolUse hook), then throws instead of ever emitting `tool_result` — a
    // dropped provider connection mid-tool-call.
    adapters[0]!.release();
    await conn.settled;
    await flush();

    expect(adapters[0]!.deliveryDrained.map((d) => d.text)).toEqual(['check the other file too']);

    const frames = framesOf(conn.pushes);
    const steerAt = frames.findIndex(
      (f) => f.t === 'text' && f.role === 'user' && f.text === 'check the other file too',
    );
    const errorAt = frames.findIndex((f) => f.t === 'error');
    const diag = JSON.stringify(frames.map((f) => f.t));
    // THE ASSERTION THAT MATTERS: the model already read this line, so it must land in the
    // log — and it must land ABOVE the terminal error frame, matching the interrupt closure's
    // ordering (the delivery was handed to the model before the turn died).
    expect(steerAt, diag).toBeGreaterThan(-1);
    expect(errorAt, diag).toBeGreaterThan(-1);
    expect(steerAt, diag).toBeLessThan(errorAt);
  });

  it('flushes a parked delivery line when a per-turn loop throws mid-tool-call', async () => {
    const conn = connection();
    const adapters: OpenToolThenThrowAdapter[] = [];
    const customDeps: SessionDeps = {
      ...deps([]),
      createAdapter: (init) => {
        const adapter = new OpenToolThenThrowAdapter(init);
        adapters.push(adapter);
        return adapter;
      },
    };
    const handlers = handlersFor(customDeps, conn, undefined, new LiveSessionRegistry());

    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });
    await vi.waitFor(() =>
      expect(framesOf(conn.pushes).some((f) => f.t === 'tool_use')).toBe(true),
    );

    await handlers['steerSession']!.handle({
      id: sessionId,
      text: 'check the other file too',
    });
    expect(
      framesOf(conn.pushes).some((f) => f.t === 'text' && f.text === 'check the other file too'),
    ).toBe(false);

    await conn.settled;
    await flush();

    expect(adapters[0]!.deliveryDrained.map((d) => d.text)).toEqual(['check the other file too']);

    const frames = framesOf(conn.pushes);
    const steerAt = frames.findIndex(
      (f) => f.t === 'text' && f.role === 'user' && f.text === 'check the other file too',
    );
    const errorAt = frames.findIndex((f) => f.t === 'error');
    const diag = JSON.stringify(frames.map((f) => f.t));
    expect(steerAt, diag).toBeGreaterThan(-1);
    expect(errorAt, diag).toBeGreaterThan(-1);
    expect(steerAt, diag).toBeLessThan(errorAt);
  });
});

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
 * A held-open adapter that reports its turn-interrupt handle via `onTurnInterrupt` before
 * consuming any input (mirroring the real Claude adapter's streaming-input path), runs a
 * turn to a single PARTIAL frame, and then parks until the reported handle is called. The
 * handle models what a real interrupted SDK turn can still do — emit a residual terminal
 * result (here, an `error` + boundary) for the ABANDONED turn — before letting the loop
 * resume waiting on the same open feed. Used to prove the user-Stop path (`interruptSession`)
 * actually uses the reported turn-level handle rather than falling back to a whole-query
 * abort, and that the turn's `stopped` phase alone drops that residual result.
 */
class TurnInterruptAdapter implements RuntimeAdapter {
  readonly consumed: string[] = [];
  interruptCalls = 0;

  constructor(readonly init: SessionAdapterInit) {}
  renderNative(): BackendConfig {
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {} };
  }
  registerTools(): void {}
  denyBuiltins(): void {}
  interceptTool(_c: CanUseTool): void {}
  interceptStop(_s: StopPredicate): void {}
  async runLoop(): Promise<void> {
    let resolveTurn: (() => void) | undefined;
    this.init.onTurnInterrupt?.(async () => {
      this.interruptCalls += 1;
      // The abandoned turn's residual terminal result — a real SDK turn-level interrupt can
      // still surface one. The turn is already `stopped` by the time this runs, so it must
      // never reach the session sink or the transcript.
      this.init.onTurn?.({ t: 'error', message: 'interrupted mid-flight', origin: 'loop' });
      this.init.onTurn?.({ t: 'turn-boundary', role: 'assistant' });
      resolveTurn?.();
    });
    const input = this.init.input;
    if (typeof input === 'string')
      throw new Error('TurnInterruptAdapter expects a streamed held-open input');
    for await (const text of input) {
      this.consumed.push(text);
      this.init.onTurn?.({ t: 'text', text: 'partial' });
      await new Promise<void>((resolve) => {
        resolveTurn = resolve;
      });
    }
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
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {} };
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
}

/**
 * Deps whose held-open adapter PARKS mid-turn ({@link QueueSteerAdapter}), so a test can
 * act while a turn is genuinely in flight. `HeldOpenAdapter` runs each turn to its
 * boundary within the same microtask burst, so by the time a test's `await` resumes its
 * query is already IDLE — a fixture that silently turns any "while running" assertion
 * into an idle-path one.
 */
function depsParkedHeldOpen(adapters: QueueSteerAdapter[]): SessionDeps {
  return {
    ...deps([]),
    sessionStrategy: (provider) => (provider === 'claude' ? 'held-open' : 'per-turn'),
    createAdapter: (init) => {
      const adapter = new QueueSteerAdapter(init);
      adapters.push(adapter);
      return adapter;
    },
  };
}

/**
 * A held-open adapter that runs its turns to completion until turn `failOnTurn`, where it
 * throws mid-turn: a dropped provider connection, with no user stop anywhere near it. That
 * is the failure a settlement must still be able to SURFACE — it is the honest end of the
 * run, not something to swallow.
 */
class HeldOpenDropAdapter implements RuntimeAdapter {
  readonly consumed: string[] = [];

  constructor(
    readonly init: SessionAdapterInit,
    /** Which consumed turn (1-based) drops the connection. */
    readonly failOnTurn = 1,
  ) {}
  renderNative(): BackendConfig {
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {} };
  }
  registerTools(): void {}
  denyBuiltins(): void {}
  interceptTool(_c: CanUseTool): void {}
  interceptStop(_s: StopPredicate): void {}
  async runLoop(): Promise<void> {
    const input = this.init.input;
    if (typeof input === 'string')
      throw new Error('HeldOpenDropAdapter expects a streamed held-open input');
    for await (const text of input) {
      this.consumed.push(text);
      if (this.consumed.length === this.failOnTurn) throw new Error('provider connection dropped');
      this.init.onTurn?.({ t: 'text', text: `reply:${text}` });
      this.init.onSettle(this.init.sessionId, { tokensIn: 1, tokensOut: 2, costUsd: 0.25 });
      this.init.onTurn?.({ t: 'turn-boundary', role: 'assistant' });
    }
  }
}

describe('buildSessionHandlers — held-open SDK streaming-input strategy', () => {
  it('feeds two turns of one live session into ONE held-open query, not two createSession calls', async () => {
    const adapters: HeldOpenAdapter[] = [];
    const conn = connection();
    const registry = new LiveSessionRegistry();
    const handlers = handlersFor(depsHeldOpen(adapters), conn, undefined, registry);

    await handlers['createSession']!.handle({ input: 'first', conversationId: 'h1' });
    await flush();
    await handlers['createSession']!.handle({ input: 'second', conversationId: 'h1' });
    await flush();
    await flush();

    // ONE adapter (one createSession) fed BOTH user turns off the same open iterable.
    expect(adapters.length).toBe(1);
    expect(adapters[0]?.consumed).toEqual(['first', 'second']);
  });

  it('delivers a steer enqueued while running INTO the running turn, not into the input feed', async () => {
    const adapters: QueueSteerAdapter[] = [];
    const conn = connection();
    const handlers = handlersFor(
      depsParkedHeldOpen(adapters),
      conn,
      undefined,
      new LiveSessionRegistry(),
    );
    const { sessionId } = await handlers['createSession']!.handle({
      input: 'go',
      conversationId: 'h1',
    });
    await flush(); // the turn is consumed and PARKED — genuinely mid-flight

    expect(await handlers['steerSession']!.handle({ id: sessionId, text: 'also do X' })).toEqual({
      steered: true,
    });

    // It reaches the WORKING turn through the adapter's delivery port — the one the SDK's
    // PostToolUse hook pulls, which lands the text beside the next tool result (the same
    // round trip) instead of after the whole turn (the held-open strategy's measured latency ceiling).
    expect(adapters[0]?.init.drainDeliveries?.()).toEqual([{ origin: 'user', text: 'also do X' }]);

    adapters[0]!.boundaryCurrent();
    await flush();
    await flush();

    // …and NOT into the input feed, where it would have queued as its own later turn.
    expect(adapters.length).toBe(1);
    expect(adapters[0]?.consumed).toEqual(['go']);
  });

  it("appends each turn's user prompt and continues the seq under the one held-open query", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-ho-'));
    try {
      const store = createConversationStore(dir);
      const adapters: HeldOpenAdapter[] = [];
      const conn = connection();
      const handlers = handlersFor(depsHeldOpen(adapters), conn, store, new LiveSessionRegistry());

      await handlers['createSession']!.handle({ input: 'first', conversationId: 'h1' });
      await flush();
      await handlers['createSession']!.handle({ input: 'second', conversationId: 'h1' });
      await flush();
      await flush();

      expect(adapters.length).toBe(1);
      // Both user turns landed, and the seq continued monotonically across the two turns
      // of the single query (turn 2's prompt never collides with turn 1's streamed frames).
      expect(store.reload('h1').turns.map((t) => ({ seq: t.seq, frame: t.frame }))).toEqual([
        { seq: 0, frame: { t: 'text', text: 'first', role: 'user' } },
        { seq: 1, frame: { t: 'text', text: 'ok' } },
        { seq: 2, frame: { t: 'turn-boundary', role: 'assistant' } },
        { seq: 3, frame: { t: 'text', text: 'second', role: 'user' } },
        { seq: 4, frame: { t: 'text', text: 'ok' } },
        { seq: 5, frame: { t: 'turn-boundary', role: 'assistant' } },
      ]);
      // The canonical transcript is the read-time fold of the persisted frame stream
      // above — it covers both turns.
      expect(store.loadBackendMessages('h1').messages).toEqual([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'second' },
        { role: 'assistant', content: 'ok' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('surfaces an interrupt as a clean interrupted stop — never an error (a user stop, never an error)', async () => {
    const adapters: HeldOpenAdapter[] = [];
    const conn = connection();
    const handlers = handlersFor(
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

  it('a user Stop against a turn-level interrupt handle keeps the query alive and drops the abandoned turn (a user stop, never an error)', async () => {
    const adapters: TurnInterruptAdapter[] = [];
    const conn = connection();
    const customDeps: SessionDeps = {
      ...deps([]),
      sessionStrategy: (provider) => (provider === 'claude' ? 'held-open' : 'per-turn'),
      createAdapter: (init) => {
        const adapter = new TurnInterruptAdapter(init);
        adapters.push(adapter);
        return adapter;
      },
    };
    const handlers = handlersFor(customDeps, conn, undefined, new LiveSessionRegistry());

    const { sessionId } = await handlers['createSession']!.handle({
      input: 'go',
      conversationId: 'h1',
    });
    await flush(); // the partial frame lands; the adapter now blocks on the interrupt handle

    expect(await handlers['interruptSession']!.handle({ id: sessionId })).toEqual({
      interrupted: true,
    });
    await flush();
    await flush();

    // The reported turn-level handle was used — Stop did not fall back to aborting the
    // whole query.
    expect(adapters[0]?.interruptCalls).toBe(1);

    const pushes = pushesOf(conn.pushes);
    // The abandoned turn's residual result never surfaces: no error frame, no error status.
    expect(pushes.some((p) => p.kind === 'turn' && p.frame.t === 'error')).toBe(false);
    expect(pushes.some((p) => p.kind === 'status' && p.state === 'error')).toBe(false);
    // Nothing renders below the `interrupted` marker — the `stopped` phase is the sole guard
    // for this never-an-error guarantee.
    const interruptedAt = pushes.findIndex((p) => p.kind === 'turn' && p.frame.t === 'interrupted');
    expect(interruptedAt).toBeGreaterThan(-1);
    expect(pushes.slice(interruptedAt + 1).some((p) => p.kind === 'turn')).toBe(false);
  });

  it('re-arms the surviving query on the next send, so the turn AFTER a stop renders instead of staying inert', async () => {
    // The other half of the turn-level stop: the previous test proves the abandoned turn
    // goes quiet, this one proves the quiet ends. A query that stayed inert would swallow
    // every later turn silently — the user sends, the model answers, and nothing appears.
    const adapters: TurnInterruptAdapter[] = [];
    const conn = connection();
    const customDeps: SessionDeps = {
      ...deps([]),
      sessionStrategy: (provider) => (provider === 'claude' ? 'held-open' : 'per-turn'),
      createAdapter: (init) => {
        const adapter = new TurnInterruptAdapter(init);
        adapters.push(adapter);
        return adapter;
      },
    };
    const handlers = handlersFor(customDeps, conn, undefined, new LiveSessionRegistry());

    const { sessionId } = await handlers['createSession']!.handle({
      input: 'go',
      conversationId: 'h1',
    });
    await flush();
    await handlers['interruptSession']!.handle({ id: sessionId });
    await flush();
    await flush();
    const beforeNextSend = pushesOf(conn.pushes).length;

    await handlers['createSession']!.handle({ input: 'again', conversationId: 'h1' });
    await flush();
    await flush();

    // ONE adapter still: a turn-level stop closes the turn, never the held-open query.
    expect(adapters.length).toBe(1);
    expect(adapters[0]?.consumed).toEqual(['go', 'again']);
    // …and the new turn's frames reach the connection, so the inert window ended with the
    // turn it belonged to.
    expect(
      pushesOf(conn.pushes)
        .slice(beforeNextSend)
        .some((p) => p.kind === 'turn' && p.frame.t === 'text' && p.frame.text === 'partial'),
    ).toBe(true);
  });

  /**
   * A held-open adapter that registers no turn-level interrupt handle, so a Stop always takes
   * the whole-query abort branch, and emits a straggler once `init.signal` fires: one frame
   * SYNCHRONOUSLY in the abort listener (a chunk already in flight when the signal fired) and a
   * second one 20ms later via a real timer (a chunk still queued in the backend's own
   * transport, with no synchronous relationship to the abort at all). Neither should ever be
   * recorded — the sync one because `closeStop()` already ran before the abort; the delayed one
   * because settlement is terminal and nothing legitimate emits after it.
   */
  class AbortStragglerAdapter implements RuntimeAdapter {
    constructor(readonly init: SessionAdapterInit) {}
    renderNative(): BackendConfig {
      return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {} };
    }
    registerTools(): void {}
    denyBuiltins(): void {}
    interceptTool(_c: CanUseTool): void {}
    interceptStop(_s: StopPredicate): void {}
    async runLoop(): Promise<void> {
      const input = this.init.input;
      if (typeof input === 'string')
        throw new Error('AbortStragglerAdapter expects a streamed held-open input');
      for await (const _text of input) {
        this.init.onTurn?.({ t: 'text', text: 'partial' });
        await new Promise<void>((_resolve, reject) => {
          this.init.signal?.addEventListener(
            'abort',
            () => {
              this.init.onTurn?.({ t: 'text', text: 'SYNC-STRAGGLER' });
              setTimeout(() => this.init.onTurn?.({ t: 'text', text: 'LATE-STRAGGLER' }), 20);
              reject(new Error('aborted'));
            },
            { once: true },
          );
        });
        return; // unreachable — the promise above only ever rejects
      }
    }
  }

  it('drops a straggler that arrives after settle(), not just one that arrives before stopped (5b)', async () => {
    // TurnLifecycle.inert used to be phase==='stopped' only; settle() moves the phase OFF
    // stopped, so a straggler arriving after the whole query has settled read inert as false
    // and would be recorded — landing content below the interrupted marker, exactly what this
    // getter exists to prevent. This is the everyday `interruptSession` verb, not a contrived
    // backend: closeStop() runs before the abort regardless of whether a turn-level interrupt
    // handle was ever registered.
    const adapters: AbortStragglerAdapter[] = [];
    const conn = connection();
    const customDeps: SessionDeps = {
      ...deps([]),
      sessionStrategy: (provider) => (provider === 'claude' ? 'held-open' : 'per-turn'),
      createAdapter: (init) => {
        const adapter = new AbortStragglerAdapter(init);
        adapters.push(adapter);
        return adapter;
      },
    };
    const handlers = handlersFor(customDeps, conn, undefined, new LiveSessionRegistry());

    const { sessionId } = await handlers['createSession']!.handle({
      input: 'go',
      conversationId: 'h1',
    });
    await flush();
    expect(await handlers['interruptSession']!.handle({ id: sessionId })).toEqual({
      interrupted: true,
    });
    await new Promise((r) => setTimeout(r, 40)); // past the 20ms late straggler's own timer

    const pushes = pushesOf(conn.pushes);
    // The legitimate 'partial' frame IS expected — only the two named stragglers must not be.
    expect(
      pushes.some(
        (p) => p.kind === 'turn' && p.frame.t === 'text' && p.frame.text.includes('STRAGGLER'),
      ),
    ).toBe(false);
    const interruptedAt = pushes.findIndex((p) => p.kind === 'turn' && p.frame.t === 'interrupted');
    expect(interruptedAt).toBeGreaterThan(-1);
    expect(pushes.slice(interruptedAt + 1).some((p) => p.kind === 'turn')).toBe(false);
  });

  it('a registry-driven cascade close also leaves a stopped query inert, not just a settled one (5a/5b)', async () => {
    // #closeOne used to call requestStop() alone — the phase stuck at stop-requested, where
    // frames are still meant to flow, and settle() later moved it straight to settled without
    // ever passing through stopped. A straggler the abort provoked was recorded either way.
    // closeStop() now runs synchronously before the abort, so this path is inert immediately.
    const adapters: AbortStragglerAdapter[] = [];
    const conn = connection();
    const registry = new LiveSessionRegistry();
    const customDeps: SessionDeps = {
      ...deps([]),
      sessionStrategy: (provider) => (provider === 'claude' ? 'held-open' : 'per-turn'),
      createAdapter: (init) => {
        const adapter = new AbortStragglerAdapter(init);
        adapters.push(adapter);
        return adapter;
      },
    };
    const handlers = handlersFor(customDeps, conn, undefined, registry);

    const { sessionId } = await handlers['createSession']!.handle({
      input: 'go',
      conversationId: 'h1',
    });
    await flush();
    expect(await handlers['closeSession']!.handle({ id: sessionId })).toEqual({ closed: true });
    await new Promise((r) => setTimeout(r, 40)); // past the 20ms late straggler's own timer

    const pushes = pushesOf(conn.pushes);
    // The legitimate 'partial' frame IS expected — only the two named stragglers must not be.
    expect(
      pushes.some(
        (p) => p.kind === 'turn' && p.frame.t === 'text' && p.frame.text.includes('STRAGGLER'),
      ),
    ).toBe(false);
    expect(pushes.some((p) => p.kind === 'status' && p.state === 'error')).toBe(false);
  });

  it('still surfaces a genuine failure on the turn after a Stop that found nothing to stop', async () => {
    // A held-open query holds its control state BETWEEN turns, so Stop pressed while it
    // idles reaches a close-out that reports there was no turn in flight — a common, real
    // path, not an exotic one. The stop request has to be WITHDRAWN there. Left standing, it
    // marks the run as user-stopped for the rest of its life, and every settlement after it
    // reads that mark and stays deliberately silent — so the NEXT turn's genuine provider
    // drop would kill the session with no error frame and no error status at all.
    const adapters: HeldOpenDropAdapter[] = [];
    const conn = connection();
    const customDeps: SessionDeps = {
      ...deps([]),
      sessionStrategy: (provider) => (provider === 'claude' ? 'held-open' : 'per-turn'),
      createAdapter: (init) => {
        const adapter = new HeldOpenDropAdapter(init, 2);
        adapters.push(adapter);
        return adapter;
      },
    };
    const handlers = handlersFor(customDeps, conn, undefined, new LiveSessionRegistry());

    const { sessionId } = await handlers['createSession']!.handle({
      input: 'go',
      conversationId: 'h1',
    });
    await conn.settled; // turn one reached its boundary; the query now idles between turns
    await flush();
    expect(adapters[0]?.consumed).toEqual(['go']);

    // Nothing is running, so the press finds no turn to close and answers so.
    expect(await handlers['interruptSession']!.handle({ id: sessionId })).toEqual({
      interrupted: false,
    });
    await flush();

    await handlers['createSession']!.handle({ input: 'again', conversationId: 'h1' });
    await flush();
    await flush();
    await flush();

    const pushes = pushesOf(conn.pushes);
    // THE ASSERTION THAT MATTERS: the withdrawn stop left nothing behind, so the next turn's
    // real failure still reaches the user as a failure rather than dying quietly.
    expect(pushes.some((p) => p.kind === 'turn' && p.frame.t === 'error')).toBe(true);
    expect(pushes.some((p) => p.kind === 'status' && p.state === 'error')).toBe(true);
    // …and the press that found nothing never claimed a stop had happened.
    expect(pushes.some((p) => p.kind === 'status' && p.state === 'interrupted')).toBe(false);
  });

  it('re-establishes after a mid-turn provider drop, so the next turn runs instead of hanging on the dead query', async () => {
    // The companion to the interrupt case below: a query can also die from a genuine
    // failure, with no user stop anywhere in it. Either way its input feed has no consumer
    // left, so continuing it would push text into nothing and park on a boundary that never
    // comes — the next turn must start a fresh query instead.
    const adapters: Array<HeldOpenDropAdapter | HeldOpenAdapter> = [];
    const conn = connection();
    const customDeps: SessionDeps = {
      ...deps([]),
      sessionStrategy: (provider) => (provider === 'claude' ? 'held-open' : 'per-turn'),
      createAdapter: (init) => {
        const adapter =
          adapters.length === 0 ? new HeldOpenDropAdapter(init, 1) : new HeldOpenAdapter(init);
        adapters.push(adapter);
        return adapter;
      },
    };
    const handlers = handlersFor(customDeps, conn, undefined, new LiveSessionRegistry());

    await handlers['createSession']!.handle({ input: 'go', conversationId: 'h1' });
    await conn.settled; // the drop surfaced as an error status
    await flush();

    await handlers['createSession']!.handle({ input: 'after', conversationId: 'h1' });
    await flush();
    await flush();

    expect(adapters.length).toBe(2);
    expect(adapters[1]?.consumed).toEqual(['after']);
    const states = pushesOf(conn.pushes).flatMap((p) => (p.kind === 'status' ? [p.state] : []));
    expect(states).toContain('error');
    // The follow-up turn reached a terminal `done`: the session recovered rather than
    // hanging on the dead query.
    expect(states.filter((s) => s === 'done')).toHaveLength(1);
  });

  it('re-establishes after an interrupt so the next turn runs instead of hanging on the dead query (a user stop, never an error)', async () => {
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
    const handlers = handlersFor(customDeps, conn, undefined, new LiveSessionRegistry());
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

  it("re-establishes a NEW query when a later turn switches model — not turn 1's query (config-change safety: the held-open query is keyed by model)", async () => {
    const adapters: HeldOpenAdapter[] = [];
    const conn = connection();
    const handlers = handlersFor(
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
    const handlers = handlersFor(depsHeldOpen(adapters), conn, undefined, registry);
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

  it('a one-turn SDK conversation is observably unchanged: running, the turn frames, done, idle', async () => {
    const adapters: HeldOpenAdapter[] = [];
    const conn = connection();
    const handlers = handlersFor(
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

  it('routes a steer at a working held-open turn to the delivery queue, never an interrupt', async () => {
    const conn = connection();
    const adapters: OpenToolHeldAdapter[] = [];
    const registry = new LiveSessionRegistry();
    const handlers = handlersFor(depsOpenTool(adapters), conn, undefined, registry);

    const { sessionId } = await handlers['createSession']!.handle({ input: 'go' });
    await vi.waitFor(() => expect(adapters[0]).toBeDefined());
    await handlers['steerSession']!.handle({ id: sessionId, text: 'use the JSON one' });

    // The running turn keeps its work: the steer rides the delivery queue, and the input
    // channel is untouched (a second consumed input would mean it ran as its own turn).
    expect(registry.get(sessionId)!.deliveries.size()).toBe(1);
    adapters[0]!.release();
    await conn.settled;
    await flush();
    expect(adapters[0]!.consumed).toEqual(['go']);
    expect(adapters[0]!.deliveryDrained).toEqual([{ origin: 'user', text: 'use the JSON one' }]);
  });

  it('a queue-mode steer with no turn in flight is a plain next turn, not a pending delivery', async () => {
    // The delivery queue only reaches a WORKING agent — a backend drains it from inside a
    // running turn. Routing an idle steer there would strand it until some later turn
    // happened to run, so an idle steer stays exactly today's plain next turn.
    const adapters: HeldOpenAdapter[] = [];
    const conn = connection();
    const handlers = handlersFor(
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

    await handlers['steerSession']!.handle({ id: sessionId, text: 'more' });
    await flush();
    await flush();

    expect(adapters.length).toBe(1);
    expect(adapters[0]?.consumed).toEqual(['first', 'more']);
    expect(adapters[0]?.init.drainDeliveries?.()).toEqual([]);
  });

  it('a queue-mode steer delivered mid-turn adds no SDK turn, so a later send rides its OWN boundary (I3)', async () => {
    // A queue-mode steer used to be fed into the input feed as its own SDK turn, whose
    // boundary had to be counted or a later send's latch resolved on it (the single-pending-steer-slot invariant).
    // Delivered mid-loop it is not a turn at all — so it must add NO pending turn either:
    // over-counting strands the first send in 'running' forever, under-counting resolves a
    // later send early. This pins exactly one completion per client send across the change.
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
    const handlers = handlersFor(customDeps, conn, undefined, new LiveSessionRegistry());

    // Turn A starts and parks (running).
    const { sessionId } = await handlers['createSession']!.handle({
      input: 'A',
      conversationId: 'h1',
    });
    await flush();

    // A queue-mode steer (the DEFAULT mode) arrives while A runs — it joins A's own loop.
    expect(await handlers['steerSession']!.handle({ id: sessionId, text: 'steer' })).toEqual({
      steered: true,
    });
    expect(adapter!.init.drainDeliveries?.()).toEqual([{ origin: 'user', text: 'steer' }]);

    // A boundaries — and that alone must release A's driver: the steer added no turn.
    adapter!.boundaryCurrent();
    await flush();

    // A SECOND send C arrives, runs, and parks.
    await handlers['createSession']!.handle({ input: 'C', conversationId: 'h1' });
    await flush();

    // Finally C boundaries — the only thing that should complete C.
    adapter!.boundaryCurrent();
    await flush();

    expect(adapter!.consumed).toEqual(['A', 'C']);
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
      const adapters: QueueSteerAdapter[] = [];
      const conn = connection();
      const handlers = handlersFor(
        depsParkedHeldOpen(adapters),
        conn,
        store,
        new LiveSessionRegistry(),
      );

      const { sessionId } = await handlers['createSession']!.handle({
        input: 'go',
        conversationId: 'h1',
      });
      await flush(); // the turn is consumed and PARKED — genuinely mid-flight
      expect(await handlers['steerSession']!.handle({ id: sessionId, text: 'also do X' })).toEqual({
        steered: true,
      });
      // The running turn's own drain point consumes it — the backend's job, which this
      // fixture does not do on its own. Without this the delivery would never be picked up
      // by anything and would degrade to a plain next turn at the boundary,
      // so the "rides the queue, not the feed" claim below would be tested against a turn
      // that had already given up on the queue.
      expect(adapters[0]!.init.drainDeliveries?.()).toEqual([
        { origin: 'user', text: 'also do X' },
      ]);
      adapters[0]!.boundaryCurrent();
      await flush();
      await flush();

      expect(adapters.length).toBe(1);
      expect(adapters[0]?.consumed).toEqual(['go']);
      // The steer reaches canonical memory as its own user turn even though it now rides
      // the delivery queue rather than the input feed — the hook route bypasses every
      // stream tap, and the append-only log is the only durable record of what the user
      // sent. Recorded when the drain call above consumed it, so it lands
      // after what the turn had already streamed.
      expect(store.loadBackendMessages('h1').messages).toEqual([
        { role: 'user', content: 'go' },
        { role: 'assistant', content: 'reply:go' },
        { role: 'user', content: 'also do X' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flushes a delivery stranded past the turn's last drain point as a plain next turn", async () => {
    const adapters: QueueSteerAdapter[] = [];
    const conn = connection();
    const handlers = handlersFor(
      depsParkedHeldOpen(adapters),
      conn,
      undefined,
      new LiveSessionRegistry(),
    );

    const { sessionId } = await handlers['createSession']!.handle({
      input: 'go',
      conversationId: 'h1',
    });
    await flush(); // the turn is consumed and PARKED — genuinely mid-flight

    // The turn's LAST mid-loop drain point fires and finds nothing pending. On Claude this
    // is the `Stop` hook, which has already fired AND RETURNED by the time the turn-boundary
    // frame lands — that gap is the window this test constructs.
    expect(adapters[0]!.init.drainDeliveries?.()).toEqual([]);

    // The steer arrives inside that window. `pendingTurns` is still 1, so it reads as
    // running, takes the delivery branch, and is acknowledged `{ steered: true }` — yet no
    // drain point remains in this turn to pick it up.
    expect(await handlers['steerSession']!.handle({ id: sessionId, text: 'also do X' })).toEqual({
      steered: true,
    });

    adapters[0]!.boundaryCurrent();
    await flush();
    await flush();

    // help, never cage: it degrades to the ordinary turn boundary rather than sitting in
    // the queue forever while the user watches their own message get no reply and no error.
    expect(adapters[0]?.consumed).toEqual(['go', 'also do X']);
    // Drained, not duplicated — a later hook must not deliver it a second time.
    expect(adapters[0]!.init.drainDeliveries?.()).toEqual([]);

    // The flushed text is a real turn, so it owns the pending slot: the session reports
    // done ONCE, on the flushed turn's own boundary, never twice and never early.
    const donesBefore = pushesOf(conn.pushes).filter(
      (p) => p.kind === 'status' && p.state === 'done',
    ).length;
    expect(donesBefore).toBe(0);
    adapters[0]!.boundaryCurrent();
    await flush();
    await flush();
    expect(
      pushesOf(conn.pushes).filter((p) => p.kind === 'status' && p.state === 'done'),
    ).toHaveLength(1);
  });

  it('flushes mixed origins in FIFO order, framing only the system notice', async () => {
    const adapters: QueueSteerAdapter[] = [];
    const conn = connection();
    const registry = new LiveSessionRegistry();
    const handlers = handlersFor(depsParkedHeldOpen(adapters), conn, undefined, registry);

    const { sessionId } = await handlers['createSession']!.handle({
      input: 'go',
      conversationId: 'h1',
    });
    await flush();
    expect(adapters[0]!.init.drainDeliveries?.()).toEqual([]); // the turn's last drain point

    // Both origins can be pending at once. A `user` entry is fed bare — it is already in the
    // log verbatim — while a `system` notice is framed, so nothing automated can be read as
    // the person speaking. Order is the queue's, never the origin's.
    const session = registry.get(sessionId)!;
    session.deliveries.push({ origin: 'user', text: 'also do X' });
    session.deliveries.push({ origin: 'system', text: 'child agent finished' });

    adapters[0]!.boundaryCurrent();
    await flush();
    await flush();

    expect(adapters[0]?.consumed).toEqual(['go', 'also do X\n[coa notice] child agent finished']);
  });

  it('leaves a sealed queue alone — a closed session is never revived by a late delivery', async () => {
    const adapters: QueueSteerAdapter[] = [];
    const conn = connection();
    const registry = new LiveSessionRegistry();
    const handlers = handlersFor(depsParkedHeldOpen(adapters), conn, undefined, registry);

    const { sessionId } = await handlers['createSession']!.handle({
      input: 'go',
      conversationId: 'h1',
    });
    await flush();
    const session = registry.get(sessionId)!;
    session.deliveries.push({ origin: 'system', text: 'child agent finished' });
    session.deliveries.seal(); // the cancel-guard: the person stopped this subtree

    adapters[0]!.boundaryCurrent();
    await flush();
    await flush();

    expect(adapters[0]?.consumed).toEqual(['go']);
    expect(
      pushesOf(conn.pushes).filter((p) => p.kind === 'status' && p.state === 'done'),
    ).toHaveLength(1);
  });

  it('records a stranded delivery exactly once — the flush re-sends, it does not re-log', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-ho-strand-'));
    try {
      const store = createConversationStore(dir);
      const adapters: QueueSteerAdapter[] = [];
      const conn = connection();
      const handlers = handlersFor(
        depsParkedHeldOpen(adapters),
        conn,
        store,
        new LiveSessionRegistry(),
      );

      const { sessionId } = await handlers['createSession']!.handle({
        input: 'go',
        conversationId: 'h1',
      });
      await flush();
      expect(adapters[0]!.init.drainDeliveries?.()).toEqual([]); // the turn's last drain point
      await handlers['steerSession']!.handle({ id: sessionId, text: 'also do X' });
      adapters[0]!.boundaryCurrent();
      await flush();
      await flush();
      adapters[0]!.boundaryCurrent(); // the flushed turn's own boundary
      await flush();
      await flush();

      // ONE writer per record: `takeDeliveries` recorded the steer once, at the drain call
      // above, so the flush feeds the model WITHOUT appending a second user frame.
      expect(store.loadBackendMessages('h1').messages).toEqual([
        { role: 'user', content: 'go' },
        { role: 'assistant', content: 'reply:go' },
        { role: 'user', content: 'also do X' },
        { role: 'assistant', content: 'reply:also do X' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pushes streaming deltas over the held-open query but never appends them', async () => {
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
      const handlers = handlersFor(customDeps, conn, store, new LiveSessionRegistry());

      await handlers['createSession']!.handle({ input: 'go', conversationId: 'h1' });
      await flush();

      const pushedFrames = pushesOf(conn.pushes).flatMap((p) =>
        p.kind === 'turn' ? [p.frame] : [],
      );
      expect(pushedFrames).toContainEqual({ t: 'text-delta', text: 'Hel' });
      expect(pushedFrames).toContainEqual({ t: 'text-delta', text: 'lo' });
      expect(pushedFrames).toContainEqual({ t: 'text', text: 'Hello' });

      const persistedFrames = store.reload('h1').turns.map((t) => t.frame);
      expect(persistedFrames).not.toContainEqual({ t: 'text-delta', text: 'Hel' });
      expect(persistedFrames).not.toContainEqual({ t: 'text-delta', text: 'lo' });
      expect(persistedFrames).toContainEqual({ t: 'text', text: 'Hello' });

      // The delta guard sits ahead of the pendingTurns boundary accounting — the turn's
      // `turn-boundary` still resolves the driver normally (a delta must not touch it).
      const pushes = pushesOf(conn.pushes);
      expect(pushes.some((p) => p.kind === 'status' && p.state === 'done')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildSessionHandlers — spawning a subagent child', () => {
  const AGENTS: AgentSummary[] = [
    {
      ref: 'explorer',
      scope: 'builtin',
      name: 'Explorer',
      description: 'read-only',
      icon: 'search',
      color: 'sky',
      roles: ['researcher'],
    },
    {
      ref: 'general-purpose',
      scope: 'builtin',
      name: 'General purpose',
      description: 'general',
      icon: 'bot',
      color: 'slate',
      roles: ['swe'],
    },
  ];

  /** Deps for a spawn test: a distinct id per `newSessionId()` call (a child always needs an id
   *  different from the parent's explicit `conversationId`), and a per-session-id behavior lookup
   *  so one test can make one child finish while another fails or is stopped. */
  function spawnableDeps(
    behaviors: Map<string, 'fail' | 'stop'> = new Map(),
    recordSpend?: SessionDeps['recordSpend'],
  ): SessionDeps {
    let n = 0;
    return {
      newSessionId: () => `child-${++n}`,
      bindWorktree: (id) => `/wt/${id}`,
      releaseWorktree: () => {},
      assemblePieces: () => ({ pieces: [], frame: { allow: [], deny: [] } }),
      compile: () => NEUTRAL,
      sandboxPolicy: () => SANDBOX,
      charge: () => {},
      ...(recordSpend !== undefined ? { recordSpend } : {}),
      perToolDeny: () => undefined,
      gate: () => ({ allow: true }),
      catalogue: [],
      baseCatalogue: [],
      checkpoint: () => {},
      createAdapter: (init) => {
        const behavior = behaviors.get(init.sessionId);
        if (behavior === 'fail') return new FrameAdapter(init, [], true);
        if (behavior === 'stop') {
          return new FrameAdapter(init, [], false, false, false, false, false, true);
        }
        return new FrameAdapter(init, [{ t: 'text', text: 'ok' }]);
      },
    };
  }

  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0, dirs.length)) rmSync(d, { recursive: true, force: true });
  });

  function buildTestServer(opts?: {
    behaviors?: Map<string, 'fail' | 'stop'>;
    agents?: AgentSummary[];
    recordSpend?: SessionDeps['recordSpend'];
  }): {
    dispatch: (msg: unknown) => ReturnType<typeof dispatch>;
    registry: LiveSessionRegistry;
    store: ConversationStore;
    startChildForTest: (
      parentId: string,
      agentRef: string,
      overrides?: { description?: string; prompt?: string },
    ) => { sessionId: string };
  } {
    const dir = mkdtempSync(join(tmpdir(), 'coa-spawn-'));
    dirs.push(dir);
    const store = createConversationStore(dir);
    const registry = new LiveSessionRegistry();
    const conn = connection();
    const service = sessionService(
      spawnableDeps(opts?.behaviors, opts?.recordSpend),
      store,
      registry,
      () => opts?.agents ?? AGENTS,
    );
    const handlers = buildSessionHandlers(service, conn);
    return {
      dispatch: (msg) => dispatch(msg, handlers),
      registry,
      store,
      // Dispatched through the real port the governed `spawn_agent` tool is handed —
      // `resolveSpawn(sessionId)` in the composition root — not a side channel.
      startChildForTest: (parentId, agentRef, overrides) => {
        const spawn = service.spawnFor(parentId);
        if (spawn === undefined) throw new Error('the session service exposed no spawn port');
        return spawn.startChild({
          agentRef,
          description: overrides?.description ?? 'investigate the thing',
          prompt: overrides?.prompt ?? 'go look',
        });
      },
    };
  }

  /** Let every currently-pending microtask settle (a child's turn is enqueued and driven
   *  asynchronously — `startChild` never awaits it, matching the non-blocking contract). */
  async function settleChild(): Promise<void> {
    await flush();
    await flush();
    await flush();
  }

  it('starts a child with lineage and notifies the parent when it ends', async () => {
    const { dispatch: send, registry, store, startChildForTest } = buildTestServer();
    await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'createSession',
      params: { conversationId: 'root-1', input: 'hello', role: 'general-purpose', scope: 'repo' },
    });
    const parent = registry.get('root-1');
    expect(parent).toBeDefined();

    const child = startChildForTest('root-1', 'explorer');
    expect(store.getMeta(child.sessionId)?.parent).toBe('root-1');
    expect(store.getMeta(child.sessionId)?.root).toBe('root-1');
    expect(registry.get(child.sessionId)?.root).toBe('root-1');

    await settleChild();
    const pending = parent!.deliveries.drain();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.origin).toBe('system');
    expect(pending[0]?.text).toContain(child.sessionId);
  });

  it('F2: a spawned child inherits ITS agent’s configured default mode, not the parent’s live mode', async () => {
    const agentsWithModes: AgentSummary[] = [
      { ...AGENTS[0]!, defaultMode: 'plan' }, // explorer
      { ...AGENTS[1]!, defaultMode: 'edits' }, // general-purpose
    ];
    const {
      dispatch: send,
      registry,
      startChildForTest,
    } = buildTestServer({
      agents: agentsWithModes,
    });
    await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'createSession',
      params: { conversationId: 'root-1', input: 'hello', role: 'general-purpose', scope: 'repo' },
    });
    // The parent's own mode switched live to something neither child's default matches —
    // proves inheritance reads the CHILD's agent, never the parent's current mode.
    registry.get('root-1')?.setMode('bypass');

    const explorerChild = startChildForTest('root-1', 'explorer');
    const generalChild = startChildForTest('root-1', 'general-purpose');
    expect(registry.get(explorerChild.sessionId)?.mode).toBe('plan');
    expect(registry.get(generalChild.sessionId)?.mode).toBe('edits');
  });

  it('F2: a spawned child whose agent declares no default mode falls back to the system floor', async () => {
    const { startChildForTest, registry } = buildTestServer(); // AGENTS has no defaultMode set
    const child = startChildForTest('root-1', 'explorer');
    expect(registry.get(child.sessionId)?.mode).toBe('manual');
  });

  it('drops the notice when the parent was already stopped', async () => {
    const { dispatch: send, registry, startChildForTest } = buildTestServer();
    await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'createSession',
      params: { conversationId: 'root-1', input: 'hello', role: 'general-purpose', scope: 'repo' },
    });
    const child = startChildForTest('root-1', 'explorer');
    registry.close('root-1'); // cascades and seals
    await settleChild();
    // Nothing to assert on the parent's queue — it is gone. The point is that this
    // does not throw and does not resurrect the session.
    expect(registry.get('root-1')).toBeUndefined();
    expect(() => registry.get(child.sessionId)).not.toThrow();
  });

  it('reaches a grandchild: stopping the middle node cascades to it too, and its root is the top of the tree', async () => {
    const { dispatch: send, registry, store, startChildForTest } = buildTestServer();
    await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'createSession',
      params: { conversationId: 'root-1', input: 'hello', role: 'general-purpose', scope: 'repo' },
    });

    const mid = startChildForTest('root-1', 'explorer');
    await settleChild(); // let the middle child's own turn settle so it stays live, idle

    const grandkid = startChildForTest(mid.sessionId, 'explorer');
    await settleChild();

    expect(store.getMeta(grandkid.sessionId)?.parent).toBe(mid.sessionId);
    expect(store.getMeta(grandkid.sessionId)?.root).toBe('root-1');
    expect(registry.get(grandkid.sessionId)?.root).toBe('root-1');

    // Stop the MIDDLE node, not the root — a fixture one level deep can't tell "cascades to
    // every descendant" apart from "cascades only when the target is the literal root".
    registry.close(mid.sessionId);
    expect(registry.get(mid.sessionId)).toBeUndefined();
    expect(registry.get(grandkid.sessionId)).toBeUndefined();
    expect(registry.get('root-1')).toBeDefined(); // the root itself is untouched
  });

  it('attributes settled spend to the top-of-tree root at every real tree depth, leaving the root itself root-less (mixed three-node fixture)', async () => {
    const spend: Array<{ costUsd: number; root?: string }> = [];
    const { dispatch: send, startChildForTest } = buildTestServer({
      recordSpend: (record) => spend.push(record),
    });
    await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'createSession',
      params: { conversationId: 'root-1', input: 'hello', role: 'general-purpose', scope: 'repo' },
    });
    await settleChild(); // let the root's own first turn settle before spawning off it

    const mid = startChildForTest('root-1', 'explorer');
    await settleChild();

    // A grandchild, not just a child — a one-level tree can't distinguish "rolls up to
    // the root" from "rolls up to whoever spawned it" (they're the same node at depth 1).
    startChildForTest(mid.sessionId, 'explorer');
    await settleChild();

    // The root's own turn carries no `root` (byte-identical to before lineage
    // existed); the middle child's and the grandchild's BOTH carry the same top-of-tree
    // id, proving the rollup survives real nesting, not just one level.
    expect(spend).toEqual([
      { costUsd: 0.25, tokensIn: 1, tokensOut: 2 },
      { costUsd: 0.25, tokensIn: 1, tokensOut: 2, root: 'root-1' },
      { costUsd: 0.25, tokensIn: 1, tokensOut: 2, root: 'root-1' },
    ]);
  });

  it('routes provider/model/reasoning/roles/packageIds/exclude through the agent DEFINITION, never the spawn call', async () => {
    const assembleCalls: AssemblePiecesContext[] = [];
    let n = 0;
    const modeledAgent: AgentSummary = {
      ref: 'modeled',
      scope: 'project',
      name: 'Modeled',
      description: 'carries a pinned model',
      icon: 'bot',
      color: 'slate',
      provider: 'deepseek',
      model: 'deepseek-chat',
      reasoning: { mode: 'effort', effort: 'high' },
      roles: ['researcher'],
      packageIds: ['pkg-a'],
      exclude: ['pkg-b'],
    };
    const customDeps: SessionDeps = {
      newSessionId: () => `child-${++n}`,
      bindWorktree: (id) => `/wt/${id}`,
      releaseWorktree: () => {},
      assemblePieces: (ctx) => {
        assembleCalls.push(ctx);
        return { pieces: [], frame: { allow: [], deny: [] } };
      },
      compile: () => NEUTRAL,
      sandboxPolicy: () => SANDBOX,
      charge: () => {},
      perToolDeny: () => undefined,
      gate: () => ({ allow: true }),
      catalogue: [],
      baseCatalogue: [],
      checkpoint: () => {},
      createAdapter: (init) => new FrameAdapter(init, [{ t: 'text', text: 'ok' }]),
    };
    const dir = mkdtempSync(join(tmpdir(), 'coa-spawn-model-'));
    dirs.push(dir);
    const store = createConversationStore(dir);
    const registry = new LiveSessionRegistry();
    const conn = connection();
    const service = sessionService(customDeps, store, registry, () => [modeledAgent]);
    const handlers = buildSessionHandlers(service, conn);
    await dispatch(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'createSession',
        params: {
          input: 'hello',
          conversationId: 'root-1',
          role: 'general-purpose',
          scope: 'repo',
        },
      },
      handlers,
    );
    assembleCalls.length = 0; // drop the parent's own compile; only the child's is under test

    const child = service.spawnFor('root-1')!.startChild({
      agentRef: 'modeled',
      description: 'd',
      prompt: 'p',
    });
    await settleChild();

    expect(assembleCalls).toHaveLength(1);
    expect(assembleCalls[0]).toMatchObject({
      role: 'researcher',
      roles: ['researcher'],
      packageIds: ['pkg-a'],
      exclude: ['pkg-b'],
      model: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        reasoning: { mode: 'effort', effort: 'high' },
      },
    });
    // A second, independent observable: the same facts landed in persistence.
    expect(store.getMeta(child.sessionId)?.provider).toBe('deepseek');
    expect(store.getMeta(child.sessionId)?.model).toBe('deepseek-chat');
  });

  it("derives the child's title from `description` (never raw-injected) and its first turn from `prompt`", async () => {
    const { registry, store, startChildForTest } = buildTestServer();
    registry.getOrCreate('root-1');
    store.create({ id: 'root-1', agentRef: 'general-purpose', title: 'root', scope: 'repo' });

    const lineSep = String.fromCharCode(8232);
    const child = startChildForTest('root-1', 'explorer', {
      description: `investigate${lineSep}the thing`,
      prompt: 'hostile prompt with a fake line break',
    });
    await settleChild();

    // `deriveTitle` already collapses every JS-whitespace-class character (which includes
    // U+2028/U+2029) into a single space — the same path every ordinary session's
    // auto-title goes through, so a hostile `description` gets no new injection surface.
    expect(store.getMeta(child.sessionId)?.title).toBe('investigate the thing');
    expect(store.getMeta(child.sessionId)?.title).not.toContain(lineSep);
    // The prompt becomes the child's first turn, persisted byte-for-byte like any other
    // user-authored turn (no extra escaping/mangling introduced by the spawn path).
    expect(store.loadBackendMessages(child.sessionId).messages).toEqual([
      { role: 'user', content: 'hostile prompt with a fake line break' },
      { role: 'assistant', content: 'ok' },
    ]);
  });

  it("stamps the child's own meta with a registry-resolved agentRef, never caller-supplied text", async () => {
    const { store, startChildForTest } = buildTestServer();
    const child = startChildForTest('root-1', 'explorer');
    await settleChild();
    expect(store.getMeta(child.sessionId)?.agentRef).toBe('explorer');
  });

  it('does not await the child — it returns before the turn has even started running', () => {
    const { registry, startChildForTest } = buildTestServer();
    const child = startChildForTest('root-1', 'explorer');
    // Enqueuing the turn only schedules a microtask continuation of `runLiveSession`'s
    // parked `nextTurn()` wait — synchronously after `startChild` returns, nothing has run.
    expect(registry.get(child.sessionId)?.state).toBe('idle');
  });

  it("a child whose loop rejects notifies the parent as errored and never reaches Node's unhandledRejection", async () => {
    const behaviors = new Map<string, 'fail' | 'stop'>([['child-1', 'fail']]);
    const { registry, startChildForTest } = buildTestServer({ behaviors });
    registry.getOrCreate('root-1');

    let unhandled = 0;
    const onUnhandled = (): void => {
      unhandled += 1;
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const parent = registry.get('root-1')!;
      const child = startChildForTest('root-1', 'explorer');
      await settleChild();
      await settleChild(); // extra headroom: an unhandled rejection is reported on a later tick

      expect(unhandled).toBe(0);
      const pending = parent.deliveries.drain();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.text).toContain(child.sessionId);
      expect(pending[0]?.text).toContain('failed');
      expect(pending[0]?.text).toContain('loop blew up');
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('reports a stopped child (interrupted mid-turn) as `stopped`, not `errored`', async () => {
    const behaviors = new Map<string, 'fail' | 'stop'>([['child-1', 'stop']]);
    const { dispatch: send, registry, startChildForTest } = buildTestServer({ behaviors });
    registry.getOrCreate('root-1');
    const parent = registry.get('root-1')!;

    const child = startChildForTest('root-1', 'explorer');
    await flush();
    expect(registry.get(child.sessionId)?.control).toBeDefined();
    // The real trigger a child can be stopped by: the `interruptSession` verb, exactly as
    // a person stopping it (or a future control surface) would call it — NOT a hand-rolled
    // shortcut that skips the `emitStatus('interrupted')` the verb itself is responsible for.
    const result = await send({
      jsonrpc: '2.0',
      id: 2,
      method: 'interruptSession',
      params: { id: child.sessionId },
    });
    expect((result as { result: unknown })?.result).toEqual({ interrupted: true });
    await settleChild();

    const pending = parent.deliveries.drain();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.text).toContain('was stopped');
  });

  it('creates and runs a child even against an already-closed parent (an orphan, never a throw)', async () => {
    const { registry, startChildForTest } = buildTestServer();
    registry.getOrCreate('root-1');
    registry.close('root-1'); // the parent is fully gone before the spawn ever happens

    let child: { sessionId: string } | undefined;
    expect(() => {
      child = startChildForTest('root-1', 'explorer');
    }).not.toThrow();
    expect(child).toBeDefined();
    expect(registry.get(child!.sessionId)).toBeDefined();
    await settleChild();
    // The orphan still ran its assigned turn to completion — spawning wasn't silently dropped.
    expect(registry.get(child!.sessionId)?.state).toBe('idle');
  });

  it('exposes no spawn port at all when the daemon wires no agent list, and still serves turns', async () => {
    const conn = connection();
    // No store and no agent list — spawning needs both, so it stays unavailable rather
    // than half-working, and every other verb is untouched.
    const service = sessionService(deps([]), undefined, new LiveSessionRegistry());
    expect(service.spawnFor('anything')).toBeUndefined();

    const response = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'createSession', params: { input: 'go' } },
      buildSessionHandlers(service, conn),
    );
    expect(response).toMatchObject({ result: { sessionId: 'sess-1', worktree: '/wt/sess-1' } });
    await conn.settled;
  });
});

describe('buildSessionHandlers — attachments (capability-gated at the RPC edge)', () => {
  const IMAGE = { kind: 'image' as const, mimeType: 'image/png', data: 'aWJt', name: 'shot.png' };

  it('threads attachments + the daemon-resolved vision fact to the adapter for a capable provider', async () => {
    const conn = connection();
    let seen: SessionAdapterInit | undefined;
    const d: SessionDeps = {
      ...deps([]),
      createAdapter: (init) => {
        seen = init;
        return new FrameAdapter(init, []);
      },
    };
    const handlers = buildSessionHandlers(
      sessionService(d, undefined, new LiveSessionRegistry()),
      conn,
      {
        attachmentsSupported: (provider) => provider === 'deepseek',
        // The vision fact is resolved HERE, daemon-side — the client never claims it.
        visionSupported: (provider, modelId) => provider === 'deepseek' && modelId === 'v4',
      },
    );
    await handlers['createSession']!.handle({
      input: 'what is in this screenshot?',
      model: { provider: 'deepseek', model: 'v4' },
      attachments: [IMAGE],
    });
    await conn.settled;
    expect(seen?.attachments).toEqual([IMAGE]);
    expect(seen?.visionSupported).toBe(true);
  });

  it('resolves visionSupported false for a model the catalog cannot verify', async () => {
    const conn = connection();
    let seen: SessionAdapterInit | undefined;
    const d: SessionDeps = {
      ...deps([]),
      createAdapter: (init) => {
        seen = init;
        return new FrameAdapter(init, []);
      },
    };
    const handlers = buildSessionHandlers(
      sessionService(d, undefined, new LiveSessionRegistry()),
      conn,
      { attachmentsSupported: () => true, visionSupported: () => false },
    );
    await handlers['createSession']!.handle({
      input: 'look',
      model: { provider: 'deepseek', model: 'unknown-model' },
      attachments: [IMAGE],
    });
    await conn.settled;
    // Threaded as an explicit false — the adapter's image gate then rejects with the
    // typed capability error rather than silently sending an unverifiable block.
    expect(seen?.visionSupported).toBe(false);
  });

  it('refuses an attachment-carrying send for a provider whose adapter has no seam (never a silent drop)', async () => {
    const conn = connection();
    const handlers = buildSessionHandlers(
      sessionService(deps([]), undefined, new LiveSessionRegistry()),
      conn,
      { attachmentsSupported: (provider) => provider !== 'claude' },
    );
    // No model ⇒ the claude default — exactly the backend with no attachment seam.
    await expect(
      handlers['createSession']!.handle({ input: 'look', attachments: [IMAGE] }),
    ).rejects.toThrow(/cannot carry attachments/);
  });

  it('defaults to refusing attachments when no capability facts are injected (the conservative floor)', async () => {
    const conn = connection();
    const handlers = handlersFor(deps([]), conn, undefined, new LiveSessionRegistry());
    await expect(
      handlers['createSession']!.handle({
        input: 'look',
        model: { provider: 'deepseek', model: 'v4' },
        attachments: [IMAGE],
      }),
    ).rejects.toThrow(/cannot carry attachments/);
  });

  it('an attachment-free send never consults the capability seam and runs unchanged', async () => {
    const conn = connection();
    const handlers = buildSessionHandlers(
      sessionService(deps([{ t: 'text', text: 'hi' }]), undefined, new LiveSessionRegistry()),
      conn,
      {
        attachmentsSupported: () => {
          throw new Error('must not be consulted');
        },
      },
    );
    const result = await handlers['createSession']!.handle({ input: 'go' });
    expect(result).toMatchObject({ sessionId: 'sess-1' });
    await conn.settled;
  });
});
