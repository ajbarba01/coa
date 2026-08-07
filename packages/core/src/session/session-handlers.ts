import { z } from 'zod';
import {
  modelSelectionSchema,
  type AgentSummary,
  type BackendMessage,
  type CapabilityFrame,
  type NeutralConfig,
  type RpcNotification,
  type TurnFrame,
} from '@coa/shared';
import type { Delivery, TurnInterrupt } from '@coa/spi';
import { rpcMethod, type RpcHandlers } from '../rpc/router.js';
import type { RpcConnection } from '../rpc/stream.js';
import { createSession, type SessionDeps } from './session.js';
import type { ConversationStore } from './conversation-store.js';
import { planMemory, type MemoryPlan } from './memory-plan.js';
import { describeLoopFailure } from './loop-failure.js';
import { renderChildEnded, type SessionEndReason } from './notify.js';
import type { LiveSession, Sink, TurnRequest } from './live-session.js';
import type { LiveSessionRegistry } from './live-registry.js';
import { runLiveSession, type RunTurn } from './run-live-session.js';
import { InputChannel } from './input-channel.js';
import {
  configHashOf,
  frozenModelMatches,
  modelPromptKeyOf,
  promptVersionOf,
  type FrozenCompilation,
  type ModelPromptKey,
  type PromptConfig,
} from './prompt-freeze.js';

/**
 * The session-lifecycle RPC surface (CON-CAT `createSession`/`closeSession`/
 * `subscribeSession`) plus the emission policy for the daemon's push-notification channel.
 *
 * The daemon is the authoritative owner of a live session's lifecycle AND
 * liveness (the daemon owns the live session across turns): a {@link LiveSessionRegistry}, keyed by
 * conversation id, holds one {@link LiveSession} per conversation across every
 * turn it ever runs. `createSession` is **send-or-create**: it resolves (or
 * mints) the conversation id, enqueues the request as a `TurnRequest`, and —
 * only the first time — starts a daemon-owned turn loop (`runLiveSession`) that
 * drains the session's queue one turn at a time, running each through the
 * EXISTING per-turn `createSession` (session.ts) unchanged in substance. A
 * connection is a stateless, reattachable subscriber: it fans into the live
 * session via `subscribe`, which immediately hydrates it with the session's
 * CURRENT run-status — the console-reattach seam. A live session runs headless with
 * zero subscribers; nothing about its lifecycle depends on any one connection.
 *
 * When the request carries a `conversationId` and a {@link ConversationStore} is
 * wired, the conversation is **persistent**: the store supplies the prior
 * backend session id to `resume` (so the model has memory), the user prompt and
 * every streamed frame are appended durably, the `seq` continues from the
 * stored tip, and the backend's own session id is captured for the next send.
 * Without a `conversationId` the conversation is ephemeral (the CLI `coa run`
 * path) — nothing is persisted and `seq` starts at 0 each turn.
 *
 * `interruptSession`/`steerSession` (CHAT-10) act on the CURRENTLY in-flight
 * turn's control state: interrupt aborts a neutral `AbortSignal` the adapter
 * honors on BOTH backends; a steer never abandons the running turn — it lands on
 * the session's delivery queue, drained by whichever backend is driving it, one
 * round trip away — or, when the turn is idle, is fed as a plain next turn.
 * A user-initiated interrupt is never rendered as an
 * error — see the `interrupted` guard in `makeRunTurn`'s settlement below.
 */

const createParams = z.object({
  role: z.string().default(''),
  /** The chosen roles (assembly selection); preferred over `role` when present. */
  roles: z.array(z.string()).optional(),
  scope: z.string().default(''),
  input: z.string(),
  model: modelSelectionSchema.optional(),
  /** Assembly selection: opt-in packages added / default packages excluded (both role-gated). */
  packageIds: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  /** The persistent conversation to run within; absent ⇒ an ephemeral one-shot. */
  conversationId: z.string().optional(),
});
type CreateParams = z.infer<typeof createParams>;

const closeParams = z.object({ id: z.string() });
const interruptParams = z.object({ id: z.string() });
// `mode` is intentionally not accepted (and not `.strict()`-rejected): there is only one
// steer left, and a stale caller still sending `mode` (an older console build) must degrade
// to an ordinary steer, not break — Zod strips the unknown key rather than erroring on it.
const steerParams = z.object({ id: z.string(), text: z.string() });
const subscribeParams = z.object({ id: z.string() });

/** Prefix marking a `system`-origin delivery flushed as a plain turn, so the model reads a
 *  platform notice rather than the person speaking. Mirrors what every backend renders for
 *  a `system` delivery it drains mid-loop; a `user` delivery is fed bare,
 *  matching the text already written to the log when it was queued. */
const FRAME_SYSTEM_NOTICE = '[coa notice] ';

/** Gated stop tracing (off by default). Set `COA_DEBUG_STEER=1` to log a bare stop's
 *  boundary/`pendingTurns` transitions on a live Claude run — the one piece of the
 *  interrupt lifecycle that only the real SDK can reveal (does an interrupted turn boundary,
 *  and in what order relative to the interrupt ack). Written to stderr so it never pollutes
 *  the NDJSON RPC channel on stdout. */
const DEBUG_STEER = process.env['COA_DEBUG_STEER'] === '1';
function dbgSteer(event: string, detail: Record<string, unknown>): void {
  if (DEBUG_STEER) console.error(`[coa steer] ${event}`, JSON.stringify(detail));
}

/**
 * The per-turn bookkeeping `TurnRequest` (live-session.ts) has no room for:
 * the legacy singular `role` field (superseded by `roles` but still read by
 * `assemblePieces`/the config-hash — see `turnRequestFromParams`), the
 * one-shot connection to (re)subscribe once this turn's `onStart` fires, and
 * the one-shot resolver the founding `createSession` call awaits to learn the
 * worktree. Keyed by object identity so it never leaks past the turn it
 * describes.
 */
interface TurnMeta {
  role: string;
  /** Set only the first time a given connection sends against this conversation
   *  id — consumed (once) inside `onStart`, so hydration coincides with the
   *  turn's true first status instead of a spurious leading `idle`. */
  subscribe?: Sink;
  /** Set only for the FOUNDING turn (a brand-new `LiveSession`) — resolves the
   *  RPC response with the worktree once `onStart` fires, mirroring today's
   *  early, non-blocking `ready` resolution. */
  onReady?: (started: { id: string; worktree: string }) => void;
}

/** A session's rail label from its opening prompt (single line, bounded) — the VSCode-style auto-title. */
export function deriveTitle(input: string): string {
  const oneLine = input.replace(/\s+/g, ' ').trim();
  if (oneLine === '') return 'new session';
  return oneLine.length <= 60 ? oneLine : `${oneLine.slice(0, 57)}…`;
}

/** Build the per-turn queue payload from a `createSession` request (the fields
 *  `TurnRequest` — live-session.ts — actually carries; `role` rides separately
 *  in `TurnMeta`, see above). */
function turnRequestFromParams(params: CreateParams): TurnRequest {
  return {
    input: params.input,
    scope: params.scope,
    ...(params.model !== undefined ? { model: params.model } : {}),
    ...(params.roles !== undefined ? { roles: params.roles } : {}),
    ...(params.packageIds !== undefined ? { packageIds: params.packageIds } : {}),
    ...(params.exclude !== undefined ? { exclude: params.exclude } : {}),
  };
}

/** The persistence target for a turn: the conversation id + its store, or `undefined`
 *  for an ephemeral session (no `conversationId`). */
interface PersistIn {
  convId: string;
  store: ConversationStore;
}

/** The per-turn facts the persistence prelude computes and the `createSession` hooks
 *  consume — shared verbatim by the `per-turn` and `held-open` establishment paths. */
interface PreparedTurn {
  persistIn: PersistIn | undefined;
  role: string;
  provider: string;
  model: string | undefined;
  modelKey: ModelPromptKey;
  currentConfig: PromptConfig;
  plan: MemoryPlan;
  frozen: FrozenCompilation | undefined;
  promptVersion: string | undefined;
}

/** The subset of a `createSession` request that carries memory + persistence — spread
 *  into the call by both drive strategies (built by `buildPersistenceHooks`). */
interface PersistenceHooks {
  resume?: string;
  history?: readonly BackendMessage[];
  deliverHistoryAsPreamble?: true;
  frozen?: { neutral: NeutralConfig; frame: CapabilityFrame };
  onCompile?: (compiled: { neutral: NeutralConfig; frame: CapabilityFrame }) => void;
  onBackendSession?: (id: string) => void;
}

/**
 * A single held-open SDK query (the streaming-input strategy, the held-open streaming-input strategy): its
 * derived input feed, the current turn's boundary latch, the persistence target, and
 * the long-lived `createSession` promise. `close` ends the feed so the query
 * terminates after the last result; `terminated` guards a settled query.
 */
interface HeldQuery {
  configKey: string;
  channel: InputChannel;
  persistIn: PersistIn | undefined;
  /** The in-flight turn's completion latch — resolved on its `turn-boundary` frame
   *  (or when the query settles). `undefined` between turns. */
  boundary: Deferred | undefined;
  /** How many pushed-but-not-yet-boundaried turns are outstanding on this query (initial +
   *  continue). The driver's `boundary` latch resolves only when this returns to 0. */
  pendingTurns: number;
  /** This backend's turn-level interrupt (reported up via `onTurnInterrupt`), used by a
   *  bare stop (`interruptSession`) to stop the current turn while keeping the query alive. */
  turnInterrupt: TurnInterrupt | undefined;
  /** True once a bare stop has closed the in-flight turn: the driver was already released, so
   *  any residual frame the abandoned turn emits must not re-resolve it or surface as an error.
   *  Cleared when the next turn is fed (the query stays alive across a turn-level interrupt). */
  stopped: boolean;
  terminated: boolean;
  close: () => void;
  /** This query's `DeliveryRecorder.flushAtBoundary` — `settleHeldQuery` is a top-level
   *  function with no closure over the recorder, so it reaches the flush through the query
   *  it already receives, the same way `close` does (a steer is recorded when the model receives it: a mid-turn throw must
   *  flush a parked line exactly like a turn boundary or an interrupt already does). */
  flushDeliveries: () => void;
  done: Promise<void>;
}

/** A minimal resolve-only latch — one per held-open turn, awaited by the driver and
 *  resolved from the turn-boundary frame (or query settlement). */
interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Tracks the in-flight turn's streamed-but-unsettled blocks, so the daemon can (a) stamp a
 * settled `thinking` frame with the wall-clock the model spent reasoning (first→last delta) and
 * (b) SETTLE a partial block itself when a turn is interrupted.
 *
 * Both exist because streaming deltas are delivery-only: only settled frames are
 * persisted. An interrupted turn never emits its settled frame, so without (b) the partial would
 * render live but vanish on reload, and its reasoning block would stream forever. Doing this in
 * the session layer — not per backend — keeps the closure backend-agnostic (the backend-blind-core rule): every adapter
 * already streams the same delta frames. The token count the reveal shows is derived from the
 * frame text, so it needs no stamping. One per turn / held query; resets after each settled block.
 */
interface StreamAccumulator {
  /** Observe every frame before it is emitted: accumulate deltas, clear a channel the backend settles. */
  observe: (frame: TurnFrame) => void;
  /** Stamp a settled `thinking` frame with its reasoning wall-clock. */
  stamp: (frame: TurnFrame) => TurnFrame;
  /** Take the still-open partial blocks as settled frames (thinking first, then text), clearing them. */
  drainPartials: () => TurnFrame[];
}

function makeStreamAccumulator(): StreamAccumulator {
  let thinking = '';
  let text = '';
  let startMs: number | undefined;
  let endMs: number | undefined;
  const resetClock = (): void => {
    startMs = undefined;
    endMs = undefined;
  };
  return {
    observe: (frame) => {
      if (frame.t === 'thinking-delta') {
        const now = Date.now();
        startMs ??= now;
        endMs = now;
        thinking += frame.text;
      } else if (frame.t === 'text-delta') {
        text += frame.text;
      } else if (frame.t === 'thinking') {
        thinking = ''; // the backend settled this block itself
      } else if (frame.t === 'text') {
        text = '';
      }
    },
    stamp: (frame) => {
      if (frame.t !== 'thinking' || frame.durationMs !== undefined || startMs === undefined)
        return frame;
      const durationMs = (endMs ?? startMs) - startMs;
      resetClock();
      return { ...frame, durationMs };
    },
    drainPartials: () => {
      const out: TurnFrame[] = [];
      if (thinking !== '') {
        const durationMs = startMs !== undefined ? (endMs ?? startMs) - startMs : undefined;
        out.push({
          t: 'thinking',
          text: thinking,
          ...(durationMs !== undefined ? { durationMs } : {}),
        });
        thinking = '';
      }
      if (text !== '') {
        out.push({ t: 'text', text });
        text = '';
      }
      resetClock();
      return out;
    },
  };
}

/**
 * The delivery-legality gate, and its single writer: a delivery drained
 * while a tool call is open cannot be written until that call's result lands, or the line
 * falls between a `tool_use` and its `tool_result` — the one interleaving the Messages API
 * forbids. The held-open and per-turn closures share this rule so it exists in exactly one
 * place; only how a frame is EMITTED (which `started` handle, which `seqBox`, which
 * persistence target) differs between them, so that part alone is injected as `writeFrame`.
 *
 * The open-tool count is a COUNT, not a set of handles: a mapped `tool_use` can fall back to
 * an empty handle, so a set of them would collide on two concurrent calls.
 */
interface DeliveryRecorder {
  /** Drain the queue via the caller-supplied `drain`, writing each entry immediately or
   *  parking it behind an open tool call. Returns what was drained, so a caller that also
   *  feeds the text to the model sees every entry regardless of whether it was written or
   *  parked. */
  takeDeliveries: (drain: () => readonly Delivery[]) => readonly Delivery[];
  /** Observe every settled frame: tracks `tool_use`/`tool_result` to keep the open-tool
   *  count current, flushing whatever is parked the moment it returns to zero. */
  noteFrame: (frame: TurnFrame) => void;
  /** Force the gate open and flush. A turn boundary, an interrupt, or the loop ending can
   *  all leave a tool call open forever, and a delivery already handed to the model must
   *  never be lost because nothing else was left to close it. */
  flushAtBoundary: () => void;
}

function createDeliveryRecorder(writeFrame: (delivery: Delivery) => void): DeliveryRecorder {
  let openTools = 0;
  const held: Delivery[] = [];

  function flush(): void {
    for (const delivery of held.splice(0, held.length)) writeFrame(delivery);
  }

  return {
    takeDeliveries: (drain) => {
      const pending = drain();
      for (const delivery of pending) {
        if (openTools > 0) held.push(delivery);
        else writeFrame(delivery);
      }
      return pending;
    },
    noteFrame: (frame) => {
      if (frame.t === 'tool_use') openTools += 1;
      else if (frame.t === 'tool_result') {
        openTools = Math.max(0, openTools - 1);
        if (openTools === 0) flush();
      }
    },
    flushAtBoundary: () => {
      openTools = 0;
      flush();
    },
  };
}

/**
 * The identity of a held-open query's prompt-shaping config + model. A later turn
 * whose key differs (a mid-conversation model/role/scope switch) cannot ride the open
 * query — the prompt/model were fixed when it was created — so the driver re-establishes
 * (the held-open query is re-keyed when the model changes). The model IS part of the key (unlike the drift/`configHash`),
 * since the held query pinned it.
 */
function configKeyOf(turn: TurnRequest, role: string): string {
  return JSON.stringify({
    provider: turn.model?.provider ?? 'claude',
    model: turn.model?.model ?? null,
    reasoning: turn.model?.reasoning ?? null,
    role,
    roles: turn.roles ? [...turn.roles].sort() : null,
    packageIds: turn.packageIds ?? null,
    exclude: turn.exclude ?? null,
    scope: turn.scope ?? '',
  });
}

/** Start a child session for `parentId`: everything `spawn.ts`'s `SpawnDeps.startChild`
 *  needs, plus the parent id its fixed signature deliberately omits (see the module doc
 *  above `buildSessionHandlers`). Returns once the child has STARTED, never once it has
 *  finished (the non-blocking contract: surface, never block). */
export type StartChildFn = (
  parentId: string,
  req: { agentRef: string; description: string; prompt: string },
) => { sessionId: string };

/**
 * The subagent-dispatch wiring `buildSessionHandlers` needs beyond `registry`/`store`:
 * the live effective agent set (so a spawned child's turn can carry its agent
 * DEFINITION's provider/model/reasoning/roles/packageIds/exclude — the spawn call
 * itself carries none of these, by design) and a callback that receives this
 * connection's `startChild` the moment it's built.
 *
 * `onStartChild` — not a return value — because `buildSessionHandlers` is called fresh
 * per RPC connection, while the daemon's ONE `SpawnDeps.startChild` (wired into the
 * governed tool catalogue at composition time, before any connection exists) is bound
 * to the REAL calling session per spawn via `session.ts`'s `resolveSpawn(sessionId)` —
 * never an ambient "current session" guess, which would race across the concurrently-
 * live sessions this feature itself creates (a parent and its already-running child).
 * The composition root captures whichever `startChild` fires last into a late-bound
 * holder; every connection's version is behaviorally identical (same `deps`/`store`/
 * `registry`), so it doesn't matter which one ends up captured.
 */
export interface SpawnSupport {
  /** The LIVE effective agent set. Called per spawn, never cached (mirrors `spawn.ts`). */
  listAgents: () => readonly AgentSummary[];
  onStartChild: (startChild: StartChildFn) => void;
}

export function buildSessionHandlers(
  deps: SessionDeps,
  connection: RpcConnection,
  store: ConversationStore | undefined,
  registry: LiveSessionRegistry,
  spawnSupport?: SpawnSupport,
): RpcHandlers {
  const emit: Sink = (push) => {
    connection.push({ jsonrpc: '2.0', method: 'push', params: push } satisfies RpcNotification);
  };
  const emitStatus = (
    session: LiveSession,
    worktree: string,
    state: 'done' | 'error' | 'interrupted',
    detail?: string,
  ): void => {
    session.emit({ kind: 'status', sessionId: session.id, worktree, state });
    notifyParentIfChild(session, state, detail);
  };

  /**
   * A child's ending is a system fact, not a message from the child: the child never
   * composes it, and a model must not be able to fabricate one about itself —
   * `renderChildEnded` hardcodes `origin: 'system'`, unreachable from any tool handler.
   * Hooked into `emitStatus` — the ONE place every drive strategy (per-turn, held-open),
   * a direct `interruptSession` call, AND a cascade abort all funnel their terminal
   * status through — rather than duplicated at each settlement call site. A cascade
   * abort (`live-registry.ts`'s `#closeOne`) marks `control.interrupted` before it
   * aborts a running turn, so that turn's own settlement lands here exactly like a
   * direct interrupt would, reported as `stopped`. A session with no parent (the
   * overwhelming common case) is untouched: `store?.getMeta(...)?.parent` is undefined,
   * so this is a no-op.
   */
  function notifyParentIfChild(
    session: LiveSession,
    state: 'done' | 'error' | 'interrupted',
    detail?: string,
  ): void {
    const meta = store?.getMeta(session.id);
    if (meta?.parent === undefined) return;
    const parentSession = registry.get(meta.parent);
    const reason: SessionEndReason =
      state === 'done' ? 'completed' : state === 'error' ? 'errored' : 'stopped';
    // A sealed queue silently drops this — the cancel-guard doing its job after a
    // cascade stop (delivery.ts), not an error to handle. An already-gone parent
    // (`registry.get` returns undefined) is the same: nothing left to notify.
    parentSession?.deliveries.push(
      renderChildEnded({
        child: session.id,
        agentRef: meta.agentRef,
        reason,
        ...(detail !== undefined ? { detail } : {}),
      }),
    );
  }

  const turnMeta = new WeakMap<TurnRequest, TurnMeta>();
  // Which conversation ids THIS connection has already arranged to (re)subscribe
  // to — so a second send on the same conversation doesn't queue a redundant
  // onStart-time subscribe (subscribe() always re-hydrates on every call).
  const subscribedSessions = new Set<string>();
  // Every unsubscribe this CONNECTION has accumulated (the onStart founder-subscribe
  // AND subscribeSession) — run once, in full, when the connection closes, so a
  // dropped connection (a console reload, a crashed client) doesn't leak a sink
  // forever fanned out to (see connection-close teardown hardening).
  const unsubscribers: Array<() => void> = [];
  connection.onClose(() => {
    for (const off of unsubscribers) off();
    unsubscribers.length = 0;
    subscribedSessions.clear();
  });

  /**
   * The per-turn persistence prelude shared by BOTH drive strategies: create
   * the conversation if new, decide the memory hand-off (resume/replay/preamble),
   * pin the effective selection, auto-title, and append this turn's user prompt —
   * advancing `seqBox` past it. The `seqBox` is a shared cursor: for a `per-turn`
   * turn it is fresh; for the `held-open` strategy it is the query-scoped cursor the
   * long-lived record closure keeps incrementing, so a later turn's user prompt
   * never collides with the prior turn's streamed frames. Ephemeral (no-store) turns
   * carry no memory and start at `seq` 0.
   */
  function prepareTurnPersistence(
    turn: TurnRequest,
    session: LiveSession,
    persistentStore: ConversationStore | undefined,
    seqBox: { value: number },
  ): PreparedTurn {
    const meta = turnMeta.get(turn);
    const role = meta?.role ?? '';
    const persistIn: PersistIn | undefined =
      persistentStore !== undefined ? { convId: session.id, store: persistentStore } : undefined;
    const provider = turn.model?.provider ?? 'claude';
    const model = turn.model?.model;
    const modelKey = modelPromptKeyOf(turn.model);
    const currentConfig: PromptConfig = {
      role,
      ...(turn.roles !== undefined ? { roles: [...turn.roles].sort() } : {}),
      ...(turn.packageIds !== undefined ? { packageIds: turn.packageIds } : {}),
      ...(turn.exclude !== undefined ? { exclude: turn.exclude } : {}),
    };
    let plan: MemoryPlan = { history: [], deliverHistoryAsPreamble: false };
    let frozen: FrozenCompilation | undefined;
    let promptVersion: string | undefined;
    seqBox.value = 0;

    if (persistIn !== undefined) {
      const { convId: id, store: cs } = persistIn;
      if (cs.getMeta(id) === undefined) {
        cs.create({
          // Known mock coupling: `agentRef` stands in for a real agent reference;
          // prefer the first selected role when present.
          id,
          agentRef: turn.roles?.[0] ?? role,
          title: deriveTitle(turn.input),
          scope: turn.scope ?? '',
        });
      }
      const prior = cs.reload(id);
      const transcript = cs.loadBackendMessages(id);
      const storedFrozen = cs.getCompilation(id);
      // Reuse the frozen prompt only when the send's model matches the one it was
      // compiled with; a model switch drops it here (undefined ⇒ recompile), so the
      // `## Model` line is re-authored — silently, WITHOUT touching drift.
      frozen =
        storedFrozen !== undefined && frozenModelMatches(storedFrozen, modelKey)
          ? storedFrozen
          : undefined;
      promptVersion = frozen?.promptVersion;
      const priorMeta = cs.getMeta(id);
      seqBox.value = prior.length === 0 ? 0 : prior[prior.length - 1]!.seq + 1;
      if (prior.length === 0) {
        const title = cs.getMeta(id)?.title;
        if (title === undefined || title === '' || title === 'new session') {
          cs.rename(id, deriveTitle(turn.input));
        }
      }
      // Decide the memory hand-off BEFORE re-pinning the selection (the plan reads the
      // PRIOR turn's resume stamp), then pin what this turn runs on so a restart/next
      // turn routes to the same backend the memory lives in.
      plan = planMemory({
        provider,
        ...(model !== undefined ? { model } : {}),
        ...(promptVersion !== undefined ? { promptVersion } : {}),
        meta: priorMeta,
        transcript,
      });
      cs.setSelection(id, {
        provider,
        ...(model !== undefined ? { model } : {}),
        ...(turn.model?.reasoning !== undefined ? { reasoning: turn.model.reasoning } : {}),
      });
      // Persist (but never push — the console already showed it optimistically) the user turn.
      cs.append(id, [{ seq: seqBox.value, frame: { t: 'text', text: turn.input, role: 'user' } }]);
      seqBox.value += 1;
    }

    return {
      persistIn,
      role,
      provider,
      model,
      modelKey,
      currentConfig,
      plan,
      frozen,
      promptVersion,
    };
  }

  /**
   * Build the `createSession` persistence hooks from a prepared turn — the memory
   * hand-off (`resume`/`history`/preamble), the frozen-prompt reuse or fresh-compile
   * capture, and the backend-session/transcript persistence. Owns the mutable
   * `promptVersion` the compile capture writes and the session/transcript stamps read.
   */
  function buildPersistenceHooks(prep: PreparedTurn): PersistenceHooks {
    const { persistIn, plan, frozen, currentConfig, modelKey, provider, model } = prep;
    let promptVersion = prep.promptVersion;
    return {
      ...(plan.resume !== undefined ? { resume: plan.resume } : {}),
      ...(plan.history.length > 0 ? { history: plan.history } : {}),
      ...(plan.deliverHistoryAsPreamble ? { deliverHistoryAsPreamble: true as const } : {}),
      // Reuse the frozen prompt when the session has one; otherwise compile fresh and
      // freeze the result (first turn only).
      ...(frozen !== undefined ? { frozen: { neutral: frozen.neutral, frame: frozen.frame } } : {}),
      ...(persistIn !== undefined && frozen === undefined
        ? {
            onCompile: (compiled: { neutral: NeutralConfig; frame: CapabilityFrame }): void => {
              promptVersion = promptVersionOf(compiled.neutral);
              persistIn.store.setCompilation(persistIn.convId, {
                ...compiled,
                promptVersion,
                configHash: configHashOf(currentConfig),
                config: currentConfig,
                model: modelKey,
              });
            },
          }
        : {}),
      ...(persistIn !== undefined
        ? {
            // Stamp the resume token with the provider/model + frozen prompt it's valid
            // for, so a later model/provider switch OR a deliberate recompile falls back
            // to replay instead of resuming a stale server session.
            onBackendSession: (id: string): void =>
              persistIn.store.setBackendSession(persistIn.convId, id, {
                provider,
                ...(model !== undefined ? { model } : {}),
                ...(promptVersion !== undefined ? { promptVersion } : {}),
              }),
          }
        : {}),
    };
  }

  /**
   * Run ONE turn of `session` through today's per-turn `createSession` (session.ts)
   * — the `per-turn` strategy every pure-API backend runs unchanged (see
   * the daemon-authoritative live session, the held-open streaming-input strategy). A fresh adapter, a one-shot string `input`, and
   * the loop awaited to completion; the neutral user-stop lives on `control`. A
   * steer lands on `session.deliveries` (see `steerSession`), which this turn's own
   * `drainDeliveries` hook reaches at its next round trip.
   */
  async function runPerTurn(
    turn: TurnRequest,
    session: LiveSession,
    persistentStore: ConversationStore | undefined,
  ): Promise<void> {
    const meta = turnMeta.get(turn);
    const seqBox = { value: 0 };
    const prep = prepareTurnPersistence(turn, session, persistentStore, seqBox);
    let started: { id: string; worktree: string } | undefined;
    // `full`, present on a `tool_result`, is the complete body the model saw —
    // pushed to the connection ONLY as `frame` (never on the wire); persisted alongside it.
    const acc = makeStreamAccumulator();
    // Same rule as the held-open path: a delivery's line is written when the model receives
    // it, and never between a `tool_use` and its `tool_result`. Only the
    // frame-emission shape differs (a plain `started` local, this closure's own `seqBox`).
    const deliveries = createDeliveryRecorder((delivery) => {
      if (started === undefined) return;
      const s = seqBox.value++;
      const frame: TurnFrame = {
        t: 'text',
        text: delivery.text,
        role: delivery.origin === 'system' ? 'system' : 'user',
      };
      session.emit({
        kind: 'turn',
        sessionId: started.id,
        worktree: started.worktree,
        seq: s,
        frame,
      });
      if (prep.persistIn !== undefined)
        prep.persistIn.store.append(prep.persistIn.convId, [{ seq: s, frame }]);
    });
    const takeDeliveries = (): readonly Delivery[] =>
      deliveries.takeDeliveries(() => session.deliveries.drain());
    const record = (frame: TurnFrame, full?: string): void => {
      if (started === undefined) return;
      acc.observe(frame);
      // Streaming deltas are delivery-only: push for live render, but
      // NEVER persist — the append-only log holds only settled frames,
      // so the read-time fold and cross-turn memory are unchanged (opencode #11329).
      if (frame.t === 'text-delta' || frame.t === 'thinking-delta') {
        const s = seqBox.value++;
        session.emit({
          kind: 'turn',
          sessionId: started.id,
          worktree: started.worktree,
          seq: s,
          frame,
        });
        return;
      }
      // A settled `thinking` frame is stamped with the reasoning wall-clock (persisted so a
      // reload shows "Thought for Ns" identically); every other frame passes through unchanged.
      const settled = acc.stamp(frame);
      const s = seqBox.value++;
      session.emit({
        kind: 'turn',
        sessionId: started.id,
        worktree: started.worktree,
        seq: s,
        frame: settled,
      });
      if (prep.persistIn !== undefined) {
        prep.persistIn.store.append(prep.persistIn.convId, [
          { seq: s, frame: settled, ...(full !== undefined ? { full } : {}) },
        ]);
      }
      deliveries.noteFrame(frame);
    };
    const controller = new AbortController();

    try {
      await createSession(
        {
          role: prep.role,
          ...(turn.roles !== undefined ? { roles: turn.roles } : {}),
          scope: turn.scope ?? '',
          input: turn.input,
          ...(turn.model ? { model: turn.model } : {}),
          ...(turn.packageIds !== undefined ? { packageIds: turn.packageIds } : {}),
          ...(turn.exclude !== undefined ? { exclude: turn.exclude } : {}),
          sessionId: session.id,
          // A root session's own spend carries no `root` (byte-identical to
          // before lineage existed); a spawned child's does, tagged with its
          // top-of-tree ancestor regardless of nesting depth (`session.root` already
          // walks that far — see `startChild`).
          ...(session.parent !== undefined ? { root: session.root } : {}),
          ...buildPersistenceHooks(prep),
          signal: controller.signal,
          drainDeliveries: takeDeliveries,
          onStart: (s) => {
            started = s;
            session.control = {
              controller,
              interrupted: false,
              mode: 'per-turn',
            };
            // A user stop settles whatever the model streamed (so it persists and a reload reads
            // the same transcript), records the interrupt marker, THEN aborts the loop. Flushing
            // before the abort is what keeps the partial from being lost — deltas are never
            // persisted, so only this settled frame reaches the durable log.
            session.setInterruptClosure(() => {
              for (const partial of acc.drainPartials()) record(partial);
              deliveries.flushAtBoundary();
              record({ t: 'interrupted' });
              controller.abort();
              return true;
            });
            session.setState('running', s.worktree);
            // Turn activity resets the idle-eviction clock (FIX #1) — belt-and-braces
            // alongside the running-aware idle timer in live-registry.ts.
            registry.touch(session.id);
            // Hydration reflects the true first status ('running') — this fires AFTER setState.
            if (meta?.subscribe !== undefined)
              unsubscribers.push(session.subscribe(meta.subscribe));
            meta?.onReady?.(s);
          },
          onTurn: record,
        },
        deps,
      );
      // The loop is over; anything still parked behind a tool that never returned its result
      // was still handed to the model, so it is written rather than lost.
      deliveries.flushAtBoundary();
      // A pure-API backend aborted at the loop's top-of-iteration boundary settles
      // cleanly (no throw) — so a completed interrupt is seen here, not in `catch`.
      const interrupted = session.control?.interrupted === true;
      session.control = undefined;
      session.setInterruptClosure(undefined);
      // `interruptSession` already emitted `'interrupted'` synchronously — this
      // clean-break settle must not emit it again. Only a genuine completion emits `'done'`.
      if (interrupted) return;
      if (started !== undefined) emitStatus(session, started.worktree, 'done');
    } catch (err) {
      // A mid-turn throw (most often a dropped provider connection) leaves the backend
      // session id captured but this turn's transcript unsaved — a resume on the next
      // send would replay a phantom server session. Drop the token so the next send
      // replays the last-good transcript instead (fail-safe, not resume).
      if (prep.persistIn !== undefined)
        prep.persistIn.store.clearBackendSession(prep.persistIn.convId);
      const interrupted = session.control?.interrupted === true;
      session.control = undefined;
      session.setInterruptClosure(undefined);
      // an interrupt is a user stop, not a governance block; `interruptSession`
      // already emitted `'interrupted'`. Nothing further to surface.
      if (interrupted) return;
      // A genuine mid-turn throw reaches neither the interrupt closure nor the `try` block's
      // own post-await flush — so anything parked behind a still-open tool call is flushed
      // here, BEFORE the error frame below, so the log shows the delivery where the model
      // actually read it, above the failure that followed it.
      deliveries.flushAtBoundary();
      const message = describeLoopFailure(err);
      if (started !== undefined) {
        record({ t: 'error', message, origin: 'loop' });
        emitStatus(session, started.worktree, 'error', message);
      }
    }
  }

  /**
   * The turn dispatcher. It consults the injected, abstract
   * per-provider strategy verdict — NEVER the backend itself, keeping composition
   * backend-neutral (the backend-blind-core rule) — and drives the turn accordingly. The
   * `held-open` strategy keeps ONE `createSession` open across turns, feeding it the
   * streamed user turns as an {@link InputChannel}; `per-turn` (the default, and every
   * pure-API backend) runs a fresh `createSession` per turn, unchanged. State that a
   * held-open query threads across its turns (the open query, its shared `seq` cursor,
   * and the started handle) is hoisted here, session-scoped, since `makeRunTurn` is
   * built once per live session.
   */
  function makeRunTurn(persistentStore: ConversationStore | undefined): RunTurn {
    // Held-open, query-scoped state (the SDK streaming strategy only). `held` is the
    // currently open query, if any; `heldSeqBox`/`heldStarted` are the shared cursor +
    // start handle its long-lived record closure and its per-turn user-append both use.
    let held: HeldQuery | undefined;
    const heldSeqBox = { value: 0 };
    const heldStarted: { current: { id: string; worktree: string } | undefined } = {
      current: undefined,
    };

    const closeHeld = async (): Promise<void> => {
      if (held === undefined) return;
      const closing = held;
      closing.close();
      await closing.done;
      if (held === closing) held = undefined;
    };

    return async (turn, session) => {
      const provider = turn.model?.provider ?? 'claude';
      const strategy = deps.sessionStrategy?.(provider) ?? 'per-turn';
      if (strategy !== 'held-open') {
        // Provider switched to a per-turn backend mid-conversation ⇒ retire any open
        // held query first (its input feed closes, the query terminates), then run the
        // turn through the unchanged per-turn facade.
        await closeHeld();
        await runPerTurn(turn, session, persistentStore);
        return;
      }

      const configKey = configKeyOf(turn, turnMeta.get(turn)?.role ?? '');
      // Re-establish (rather than continue) when the open query can no longer serve this
      // turn — otherwise a continue pushes into a feed with no consumer and hangs on a
      // boundary that never resolves. Two cases: (1) it has TERMINATED — a prior interrupt
      // or mid-turn error already settled the query (its adapter loop is gone); the next
      // turn must start a fresh one, not resume the dead one (an interrupt must leave
      // the session usable). (2) its pinned prompt-shaping config + model DIFFER from this
      // turn's — a mid-conversation model/role/scope switch can't ride the pinned query
      // (the held-open query is keyed by model, so a model change re-establishes it).
      if (held !== undefined && (held.terminated || held.configKey !== configKey))
        await closeHeld();

      if (held === undefined) {
        await establishHeldQuery(
          turn,
          session,
          configKey,
          persistentStore,
          heldSeqBox,
          heldStarted,
          (q) => {
            held = q;
          },
        );
      } else {
        await continueHeldQuery(turn, session, held, heldSeqBox, heldStarted);
      }
    };
  }

  /**
   * Establish a held-open SDK query for this turn: run the full persistence prelude,
   * create the derived {@link InputChannel} the query reads, start ONE `createSession`
   * over it (NOT awaited to completion — it spans every later turn), route steers +
   * the close finalizer at it, feed this turn, and await this turn's boundary. The
   * per-turn-boundary transcript flush + cost settle happen inside the adapter/loop
   * at each result; the boundary is observed here from the `turn-boundary` frame.
   */
  async function establishHeldQuery(
    turn: TurnRequest,
    session: LiveSession,
    configKey: string,
    persistentStore: ConversationStore | undefined,
    seqBox: { value: number },
    startedRef: { current: { id: string; worktree: string } | undefined },
    setHeld: (q: HeldQuery) => void,
  ): Promise<void> {
    const meta = turnMeta.get(turn);
    startedRef.current = undefined;
    const prep = prepareTurnPersistence(turn, session, persistentStore, seqBox);
    const channel = new InputChannel();
    const controller = new AbortController();
    const boundary = deferred();

    // `full`, present on a `tool_result`, is the complete body the model saw —
    // pushed to the connection ONLY as `frame` (never on the wire); persisted alongside it.
    const acc = makeStreamAccumulator();

    // Record the steer as a user turn in the single log (the SoT — the single append-only conversation log) AND push
    // it live. Pushing it (rather than leaving the console to render it optimistically) is
    // the single source of truth: the console shows the steer the instant it is sent, in the
    // exact form the model saw, and a later reload folds the same persisted frame into the
    // same place — so the steer never double-renders. Also called for a delivery's line
    // (below) — the write itself is identical, only the source differs.
    const recordSteerTurn = (steerText: string, role: 'user' | 'system' = 'user'): void => {
      const started = startedRef.current;
      if (started === undefined) return;
      const s = seqBox.value++;
      const frame: TurnFrame = { t: 'text', text: steerText, role };
      session.emit({
        kind: 'turn',
        sessionId: started.id,
        worktree: started.worktree,
        seq: s,
        frame,
      });
      if (prep.persistIn !== undefined)
        prep.persistIn.store.append(prep.persistIn.convId, [{ seq: s, frame }]);
    };

    const deliveries = createDeliveryRecorder((delivery) =>
      recordSteerTurn(delivery.text, delivery.origin === 'system' ? 'system' : 'user'),
    );

    const query: HeldQuery = {
      configKey,
      channel,
      persistIn: prep.persistIn,
      boundary,
      pendingTurns: 0,
      turnInterrupt: undefined,
      stopped: false,
      terminated: false,
      close: () => channel.close(),
      flushDeliveries: deliveries.flushAtBoundary,
      done: Promise.resolve(),
    };
    setHeld(query);
    const takeDeliveries = (): readonly Delivery[] =>
      deliveries.takeDeliveries(() => session.deliveries.drain());

    /**
     * Feed whatever is still queued after a turn ends into the input feed as one plain next
     * turn, preserving FIFO order. Returns whether anything was fed.
     *
     * Recorded HERE, by `takeDeliveries`, like every other drain point: nothing wrote these
     * lines earlier. A `user` entry is then fed bare so the log and the model
     * agree on the text; a `system` entry is framed as a notice, so the model cannot read an
     * automated report as the person speaking.
     *
     * A sealed queue yields nothing, so a torn-down session is never revived by this.
     */
    function flushStrandedDeliveries(): boolean {
      if (session.deliveries.size() === 0) return false;
      const pending = takeDeliveries();
      if (pending.length === 0) return false;
      const text = pending
        .map((d) => (d.origin === 'system' ? FRAME_SYSTEM_NOTICE + d.text : d.text))
        .join('\n');
      query.pendingTurns += 1;
      channel.push(text);
      return true;
    }

    const record = (frame: TurnFrame, full?: string): void => {
      const started = startedRef.current;
      if (started === undefined) return;
      // After a bare stop, everything the abandoned turn still emits is inert: its partial was
      // already settled, its marker recorded, and its driver released. Dropping the stragglers
      // keeps content from appearing BELOW the interrupt marker (never an error either).
      // Cleared when the next turn is fed (`continueHeldQuery`).
      if (query.stopped) return;
      acc.observe(frame);
      // Streaming deltas are delivery-only: push for live render, but
      // NEVER persist, and never touch the boundary accounting below — the append-only
      // log holds only settled frames (opencode #11329).
      if (frame.t === 'text-delta' || frame.t === 'thinking-delta') {
        const s = seqBox.value++;
        session.emit({
          kind: 'turn',
          sessionId: started.id,
          worktree: started.worktree,
          seq: s,
          frame,
        });
        return;
      }
      // A settled `thinking` frame is stamped with the reasoning wall-clock (persisted so a
      // reload shows "Thought for Ns" identically); every other frame passes through unchanged.
      const settled = acc.stamp(frame);
      const s = seqBox.value++;
      session.emit({
        kind: 'turn',
        sessionId: started.id,
        worktree: started.worktree,
        seq: s,
        frame: settled,
      });
      if (prep.persistIn !== undefined) {
        prep.persistIn.store.append(prep.persistIn.convId, [
          { seq: s, frame: settled, ...(full !== undefined ? { full } : {}) },
        ]);
      }
      deliveries.noteFrame(frame);
      if (frame.t === 'turn-boundary') {
        // A turn can end with a tool still open (an interrupt, an error, a result that never
        // arrived). Nothing else will close it, so write what is parked rather than lose text
        // the model was already handed.
        deliveries.flushAtBoundary();
        query.pendingTurns -= 1;
        dbgSteer('boundary counted', { pendingTurns: query.pendingTurns });
        // Resolve the driver only when every outstanding turn has boundaried.
        if (query.pendingTurns <= 0) {
          query.pendingTurns = 0;
          // The turn is over, so any delivery still queued missed every mid-loop drain
          // point this turn had — the last of them (the Claude backend's `Stop` hook) has
          // already fired and returned by the time this frame lands. Feed it as an ordinary
          // next turn instead of leaving it queued: the user has already seen it rendered as
          // their own turn, so silence is the one outcome that must not happen (and
          // the degradation delivery is one intent, realized per backend promises). It becomes a real turn, so it takes the
          // pending slot and this driver stays parked until IT boundaries.
          if (flushStrandedDeliveries()) return;
          emitStatus(session, started.worktree, 'done');
          query.boundary?.resolve();
          query.boundary = undefined;
        }
      }
    };

    // NOT awaited: this createSession spans the whole live session. Its promise settles
    // only when the input feed closes (clean) or the query aborts (interrupt/error).
    query.done = createSession(
      {
        role: prep.role,
        ...(turn.roles !== undefined ? { roles: turn.roles } : {}),
        scope: turn.scope ?? '',
        input: channel,
        ...(turn.model ? { model: turn.model } : {}),
        ...(turn.packageIds !== undefined ? { packageIds: turn.packageIds } : {}),
        ...(turn.exclude !== undefined ? { exclude: turn.exclude } : {}),
        sessionId: session.id,
        // See the `per-turn` call site's identical spread: a root session's own spend
        // stays root-less; a spawned child's is tagged with its top-of-tree
        // ancestor, whatever the nesting depth.
        ...(session.parent !== undefined ? { root: session.root } : {}),
        ...buildPersistenceHooks(prep),
        signal: controller.signal,
        drainDeliveries: takeDeliveries,
        onTurnInterrupt: (fn) => {
          query.turnInterrupt = fn;
        },
        onStart: (s) => {
          startedRef.current = s;
          session.control = {
            controller,
            interrupted: false,
            mode: 'held-open',
          };
          // A steer never abandons work in flight: while a turn runs it rides the session's
          // delivery queue, which the backend drains from inside that turn — beside the next
          // tool result, one round trip away, discarding nothing. Only an idle
          // steer enters the input feed, as a plain next turn, where send and pickup coincide.
          session.setSteerSink((text) => {
            if (query.pendingTurns > 0) {
              // NOT another SDK turn, so it must not be counted — the in-flight turn still
              // owns the single pending slot (the single-pending-steer-slot invariant). Its log line is written when
              // the backend drains it, not here.
              session.deliveries.push({ origin: 'user', text });
            } else {
              recordSteerTurn(text);
              channel.push(text);
            }
          });
          // A user stop (bare, no redirect). Settle whatever the model streamed so it PERSISTS
          // (deltas never do — streaming deltas are delivery-only, never persisted — so without this the partial renders live and
          // vanishes on reload) and record the interrupt marker, which also makes the model aware
          // next turn. Then stop the TURN via the backend's turn-level interrupt, keeping the
          // query alive for the next send: a whole-query abort does not reliably stop an
          // in-flight streaming response (the reported "stop does nothing"). A backend with no
          // turn-level interrupt falls back to the abort, which kills the query (re-established
          // on the next turn). Finally release the driver deterministically — an interrupted turn
          // emits no boundary, so nothing else ever would (a user stop, never an error).
          session.setInterruptClosure(() => {
            if (query.pendingTurns === 0) return false;
            for (const partial of acc.drainPartials()) record(partial);
            deliveries.flushAtBoundary();
            record({ t: 'interrupted' });
            query.stopped = true;
            dbgSteer('bare stop issued', {
              pendingTurns: query.pendingTurns,
              turnLevel: query.turnInterrupt !== undefined,
            });
            if (query.turnInterrupt !== undefined) {
              void (async () => {
                try {
                  await query.turnInterrupt?.();
                } catch {
                  // non-fatal: the turn is already closed for the user; the query settles or is
                  // re-established on the next send.
                }
              })();
            } else {
              controller.abort();
            }
            query.pendingTurns = 0;
            const pending = query.boundary;
            query.boundary = undefined;
            pending?.resolve();
            return true;
          });
          session.setState('running', s.worktree);
          registry.touch(session.id);
          if (meta?.subscribe !== undefined) unsubscribers.push(session.subscribe(meta.subscribe));
          meta?.onReady?.(s);
        },
        onTurn: record,
      },
      deps,
    ).then(
      () => settleHeldQuery(session, query, seqBox, startedRef, undefined),
      (err: unknown) => settleHeldQuery(session, query, seqBox, startedRef, err),
    );

    // Closing the session ends this query's input feed ⇒ the query terminates after
    // the last turn's result (the held-open strategy's termination contract).
    session.onClose(() => query.close());

    query.pendingTurns += 1;
    channel.push(turn.input);
    await boundary.promise;
  }

  /**
   * Feed a further turn into an already-open held query (same config): append the
   * user turn (continuing the shared `seq`), re-mark `running` + (re)subscribe this
   * connection, push the text into the live feed, and await this turn's boundary.
   * No new `createSession` — the open query's record closure handles the frames.
   */
  async function continueHeldQuery(
    turn: TurnRequest,
    session: LiveSession,
    query: HeldQuery,
    seqBox: { value: number },
    startedRef: { current: { id: string; worktree: string } | undefined },
  ): Promise<void> {
    const meta = turnMeta.get(turn);
    // A bare stop closed the PREVIOUS turn but kept this query alive (turn-level interrupt).
    // Re-arm it: frames flow again, and the stale `interrupted` flag must not make this turn's
    // settlement look like a user stop.
    query.stopped = false;
    if (session.control !== undefined) session.control.interrupted = false;
    if (query.persistIn !== undefined) {
      query.persistIn.store.append(query.persistIn.convId, [
        { seq: seqBox.value, frame: { t: 'text', text: turn.input, role: 'user' } },
      ]);
      seqBox.value += 1;
    }
    const started = startedRef.current;
    if (started !== undefined) {
      session.setState('running', started.worktree);
      registry.touch(session.id);
      // A connection sending its first turn to an already-live session subscribes here
      // (there is no fresh `onStart` on a continue turn).
      if (meta?.subscribe !== undefined) unsubscribers.push(session.subscribe(meta.subscribe));
    }
    const boundary = deferred();
    query.boundary = boundary;
    query.pendingTurns += 1; // a normal continue expects one boundary
    query.channel.push(turn.input);
    await boundary.promise;
  }

  /**
   * Settle a held query once its long-lived `createSession` promise resolves (input
   * feed closed) or rejects (an interrupt-abort or a mid-turn provider drop). Clears
   * the steer route + control, releases any turn still awaiting a boundary, and — on
   * a genuine (non-interrupt) error — flushes a delivery still parked behind an open
   * tool call (a steer is recorded when the model receives it: nothing else will ever close it now), drops the stale
   * resume token, and surfaces the failure (an interrupt is a user stop, never
   * rendered as an error).
   */
  function settleHeldQuery(
    session: LiveSession,
    query: HeldQuery,
    seqBox: { value: number },
    startedRef: { current: { id: string; worktree: string } | undefined },
    err: unknown,
  ): void {
    query.terminated = true;
    session.setSteerSink(undefined);
    const interrupted = session.control?.interrupted === true;
    session.control = undefined;
    // Release a turn parked on this query's boundary so its driver returns and the
    // live-session loop can advance/idle instead of hanging on a dead query.
    const pending = query.boundary;
    query.boundary = undefined;
    pending?.resolve();
    if (err === undefined) return; // clean termination: the per-turn `'done'` already fired.
    if (query.persistIn !== undefined)
      query.persistIn.store.clearBackendSession(query.persistIn.convId);
    if (interrupted) return; // `interruptSession` already emitted `'interrupted'`.
    // A genuine mid-turn throw (most often a dropped provider connection) reaches neither the
    // interrupt closure nor a `turn-boundary` frame — the two other flush points — so nothing
    // else will ever write a line already parked behind a still-open tool call. Flush it BEFORE
    // the error frame below, so the log shows the delivery where the model actually read it,
    // above the failure that followed it (mirrors the interrupt closure's own ordering).
    query.flushDeliveries();
    const started = startedRef.current;
    if (started !== undefined) {
      const message = describeLoopFailure(err);
      const s = seqBox.value++;
      const frame: TurnFrame = { t: 'error', message, origin: 'loop' };
      session.emit({
        kind: 'turn',
        sessionId: started.id,
        worktree: started.worktree,
        seq: s,
        frame,
      });
      if (query.persistIn !== undefined)
        query.persistIn.store.append(query.persistIn.convId, [{ seq: s, frame }]);
      emitStatus(session, started.worktree, 'error', message);
    }
  }

  // Spawning needs BOTH a persistent store (a child's lineage lives in `SessionMeta`,
  // and `store.create`/`getMeta` are what makes the notify hook above ever fire) and
  // the caller-supplied agent lookup — absent either, spawning stays unavailable for
  // this connection (nothing about this branch runs when spawnSupport is unset).
  if (spawnSupport !== undefined && store !== undefined) {
    const boundStore = store;
    const startChild: StartChildFn = (parentId, req) => {
      const id = deps.newSessionId();
      // `registry.get(parentId)?.root` — not `store`'s — because a parent already torn
      // down still has a durable `SessionMeta`, but its LIVE root is what the cascade
      // (a parent-link walk over live sessions, lineage.ts) actually needs. Falling back
      // to `parentId` covers the already-gone-parent case below: the child still gets a
      // well-formed (if orphaned) root rather than an undefined one.
      const root = registry.get(parentId)?.root ?? parentId;
      const scope = boundStore.getMeta(parentId)?.scope ?? '';
      // The LIVE effective set, read fresh (never cached) — an agent authored moments
      // ago must be spawnable immediately, and `req.agentRef` already comes from a
      // registry-resolved match (`spawn.ts` validates before ever calling this).
      const agent = spawnSupport.listAgents().find((a) => a.ref === req.agentRef);

      // A spawn against an already-closed (or, since `registry.close` never yields
      // mid-cascade, equivalently an already-CLOSING) parent still creates and runs the
      // child: refusing would need either a throw (forbidden — the system never blocks a spawn) or a bogus id the
      // caller would wrongly read as success (worse — the work the model asked for
      // would silently never happen). The result is a deliberate orphan: no live
      // ancestor is left to ever cascade a stop through it, but it still runs its one
      // assigned turn to completion and self-cleans via the ordinary idle-eviction timer.
      const { session } = registry.getOrCreate(id, { parent: parentId, root });
      boundStore.create({
        id,
        agentRef: req.agentRef,
        title: deriveTitle(req.description),
        scope,
        parent: parentId,
        root,
      });

      const turn: TurnRequest = {
        input: req.prompt,
        scope,
        // Model choice routes through the agent DEFINITION, never the spawn call — the
        // whole reason dispatch goes via the registry. An agentRef the registry no
        // longer recognizes by the time this runs (a narrow TOCTOU on a hand-edited
        // agent file) degrades to the account default rather than carrying no model.
        ...(agent?.provider !== undefined ||
        agent?.model !== undefined ||
        agent?.reasoning !== undefined
          ? {
              model: {
                ...(agent?.provider !== undefined ? { provider: agent.provider } : {}),
                ...(agent?.model !== undefined ? { model: agent.model } : {}),
                ...(agent?.reasoning !== undefined ? { reasoning: agent.reasoning } : {}),
              },
            }
          : {}),
        ...(agent?.roles !== undefined ? { roles: agent.roles } : {}),
        ...(agent?.packageIds !== undefined ? { packageIds: agent.packageIds } : {}),
        ...(agent?.exclude !== undefined ? { exclude: agent.exclude } : {}),
      };
      turnMeta.set(turn, { role: agent?.roles?.[0] ?? '' });

      // Non-blocking (the design's re-entrancy retirement): start the loop and return
      // immediately, never awaiting its completion. `runLiveSession` never rejects — a
      // turn's own failure is caught and rendered as an error frame (`runPerTurn`'s own
      // try/catch, above) — so there is no unhandled rejection here to strand the
      // parent; the `errored` notice reaches it through `emitStatus` like any other end.
      void runLiveSession(session, makeRunTurn(boundStore));
      session.enqueue(turn);
      registry.touch(id);
      return { sessionId: id };
    };
    spawnSupport.onStartChild(startChild);
  }

  return {
    createSession: rpcMethod(createParams, async (params) => {
      const id = params.conversationId ?? deps.newSessionId();
      const { session, created } = registry.getOrCreate(id);

      const turn = turnRequestFromParams(params);
      const meta: TurnMeta = { role: params.role };
      turnMeta.set(turn, meta);
      // Subscribe THIS connection (once) — deferred to inside `onStart` (see
      // `makeRunTurn`) so hydration lands on the turn's true first status
      // instead of firing here, ahead of it, as a spurious leading `idle`.
      if (!subscribedSessions.has(id)) {
        meta.subscribe = emit;
        subscribedSessions.add(id);
      }

      let ready: Promise<string> | undefined;
      if (created) {
        ready = new Promise<string>((resolve) => {
          meta.onReady = (s) => resolve(s.worktree);
        });
        void runLiveSession(
          session,
          makeRunTurn(params.conversationId !== undefined ? store : undefined),
        );
      }

      session.enqueue(turn);
      registry.touch(id);

      if (ready !== undefined) return { sessionId: id, worktree: await ready };
      // An already-live session: don't block on the queued turn (it may sit
      // behind another in-flight one) — the worktree is already known.
      return { sessionId: id, worktree: session.worktree ?? '' };
    }),

    // Console reattach: join an already-known session's push stream. `subscribe`
    // immediately hydrates this connection with the session's CURRENT run-status —
    // the daemon is the source of truth for liveness, never the client's own tracking.
    subscribeSession: rpcMethod(subscribeParams, (params) => {
      const session = registry.get(params.id);
      if (session === undefined) return { subscribed: false };
      unsubscribers.push(session.subscribe(emit));
      subscribedSessions.add(params.id);
      return { subscribed: true };
    }),

    // Delegates entirely to `registry.close` — the SINGLE teardown path (FIX #3):
    // checkpoint + worktree-release now happen exactly once, via the registry's
    // `onClose` hook (wired at daemon composition in `apps/cli/src/cli.ts`), so
    // this verb no longer calls `deps.checkpoint`/`deps.releaseWorktree` itself
    // (that would double-release under idle-eviction/shutdown also calling it).
    closeSession: rpcMethod(closeParams, (params) => {
      const session = registry.get(params.id);
      if (session === undefined) return { closed: false };
      registry.close(params.id);
      return { closed: true };
    }),

    // A user-initiated stop (CHAT-10) — never a governance block. Strategy-agnostic: the
    // in-flight turn's registered closure settles the partial the model streamed, records the
    // `interrupted` marker (persisted, so a reload reads the same transcript AND the model's
    // next turn knows it was cut off), and stops the backend the way that drive strategy must.
    // `makeRunTurn`'s settlement suppresses the resulting throw/settle from rendering as an error.
    interruptSession: rpcMethod(interruptParams, (params) => {
      const session = registry.get(params.id);
      if (session?.control === undefined) return { interrupted: false };
      session.control.interrupted = true;
      // A held-open query keeps `control` between turns, so the closure is the authority on
      // whether a turn was actually in flight.
      if (!session.closeInterrupted()) {
        session.control.interrupted = false;
        return { interrupted: false };
      }
      emitStatus(session, session.worktree ?? '', 'interrupted');
      return { interrupted: true };
    }),

    // Queue a mid-turn steer (CHAT-10): one steer, one destination. The held-open route
    // (see the steer sink in `establishHeldQuery`) delivers it into the WORKING turn via
    // the session's delivery queue, or feeds it as a plain next turn when the query idles;
    // a `per-turn` backend has no held-open sink, so the same delivery queue is pushed
    // directly here — the running loop drains it at its own next round trip.
    // A blank-after-trim steer is a no-op — it would otherwise be recorded as a blank user
    // turn in canonical memory. The TRIMMED text is what gets recorded (not the raw param):
    // the console's own composer already trims before sending (console.ts `steerSession`),
    // so this is a no-op on the shipped path, and it keeps the console's optimistic pin —
    // built from that same trimmed text — matching the daemon's recorded line exactly (the
    // count-baseline reconciliation in a steer is recorded when the model receives it needs an exact match, or the pin hangs
    // until the idle sweep clears it).
    steerSession: rpcMethod(steerParams, (params) => {
      const session = registry.get(params.id);
      if (session?.control === undefined) return { steered: false };
      const text = params.text.trim();
      if (text === '') return { steered: false };
      if (session.control.mode === 'held-open') {
        session.pushSteer(text);
      } else {
        // Per-turn backends have no held-open sink; the same one queue reaches their loop
        // at the top of its next round trip.
        session.deliveries.push({ origin: 'user', text });
      }
      return { steered: true };
    }),

    // The drift banner's `recompile` action: drop the session's frozen prompt AND its
    // resume token, so the next send recompiles from the current config and starts a
    // fresh backend session with it (memory is carried across via the transcript). The
    // old server session still holds the superseded prompt, so resuming it would keep
    // the stale prompt — hence both are cleared.
    recompilePrompt: rpcMethod(z.object({ sessionId: z.string() }), (params) => {
      if (store === undefined) return { recompiled: false };
      store.clearCompilation(params.sessionId);
      store.clearBackendSession(params.sessionId);
      return { recompiled: true };
    }),
  };
}
