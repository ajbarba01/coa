import type {
  BackendMessage,
  CapabilityFrame,
  CapabilitySet,
  Locator,
  ModelSelection,
  NeutralConfig,
  Piece,
  Session,
  TurnFrame,
} from '@coa/shared';
import type { RuntimeAdapter, RuntimeUsage, StopDecision, ToolCatalogue, TurnInterrupt } from '@coa/spi';
import { buildCanUseTool, buildStopGate, sessionBudget } from './permission.js';

/**
 * M8 — the per-session lifecycle (D121): create → attach-worktree → compile →
 * render → wire → run → close. M8 is the orchestration hub: it calls M5.compile,
 * hands the neutral config to M9 to render, consults M7 for the sandbox + cap,
 * and wires the per-session dependency-injection closures (the two SC-1
 * predicates onto M9's two hooks). M9 stays a swappable leaf — it is reached only
 * through the injected {@link SessionDeps.createAdapter} factory and the
 * {@link RuntimeAdapter} port; M8 never imports a backend.
 */

/** The session-construction inputs M8 computes and hands to the backend factory (the neutral half of D121's seam). */
export interface SessionAdapterInit {
  sessionId: string;
  /** The per-session capability set from M7.sandboxPolicy. */
  sandbox: CapabilitySet;
  /** The session's prompt input — a one-shot string or a stream of user-turn strings (neutral, no backend type). */
  input: string | AsyncIterable<string>;
  /** The agent's model selection; `model`/`reasoning` are the backend's (provider drives adapter routing upstream). */
  model?: ModelSelection;
  /** The native mid-loop hard stop, when bounded. */
  maxBudgetUsd?: number;
  /** M9's settlement step → M7.charge, called once per settled result. */
  onSettle: (sessionId: string, usage: RuntimeUsage) => void;
  /**
   * Per-frame session output: the backend maps its stream to neutral M0 frames; M8
   * sequences + pushes them. `full`, when present (a `tool_result`), is the complete
   * body the model saw — the append-only log's fidelity companion to the lossy
   * pointer frame (docs/adr/0010); M8 persists it alongside the frame, never on the wire.
   */
  onTurn?: (frame: TurnFrame, full?: string) => void;
  /** The active account's login pointer (backend resolves the token); absent ⇒ ambient (today's auth). */
  locator?: Locator;
  /** A prior backend session id to resume (R-7 continuity); absent ⇒ a fresh conversation. */
  resume?: string;
  /** Report the backend's own session id (for the next resume); M8 persists it against the conversation. */
  onBackendSession?: (backendSessionId: string) => void;
  /** The prior conversation transcript (R-7, system omitted). A pure-API backend resends it for memory; the Claude backend carries it for bookkeeping (and, when `deliverHistoryAsPreamble`, as a first-turn preamble). */
  history?: readonly BackendMessage[];
  /** Claude cross-provider switch: deliver `history` as a first-turn preamble (no resumable server session exists for this transcript). Pure-API backends ignore it. */
  deliverHistoryAsPreamble?: boolean;
  /**
   * A neutral user-stop (interrupt) from M8, forwarded to the backend so an
   * in-flight round-trip aborts at its next safe boundary; SC-1 — a user stop,
   * not a governance block. Absent ⇒ current behavior byte-identical (D85).
   */
  signal?: AbortSignal;
  /**
   * A synchronous drain of user turns queued while the session was mid-round-trip
   * (steering). Only the pure-API backends (`adapter-deepseek`/`adapter-longcat`)
   * consult this today — the Claude SDK path has its own steering seam, a
   * follow-up. Absent ⇒ current behavior byte-identical (D85).
   */
  drainSteer?: () => readonly string[];
  /**
   * A synchronous drain of `queue`-mode steers — user turns that should run AFTER the
   * current turn's work, not at the next round-trip boundary. Only the pure-API
   * backends consult this today, mirroring {@link drainSteer}'s reach. Absent ⇒
   * current behavior byte-identical (D85).
   */
  drainQueuedSteer?: () => readonly string[];
  /**
   * A backend that can stop its current turn while keeping the session alive reports
   * its turn-interrupt handle here (the Claude SDK's held-open `query.interrupt`). M8
   * routes a `barge-in` steer through it. Absent ⇒ the backend has no mid-turn
   * interrupt (per-turn backends); byte-identical to today (D85). See docs/adr/0012.
   */
  onTurnInterrupt?: (interrupt: TurnInterrupt) => void;
}

/** The active-account resolution M8 supplies per session (for the model's provider): a label (incl. `'ambient'`) + the optional login pointer. */
export interface ActiveAccountResolution {
  label: string;
  locator?: Locator;
}

/**
 * How M8 drives the live session's turns for a given backend (see docs/adr/0012):
 * `per-turn` runs a fresh {@link createSession} per turn (the pure-API strategy,
 * unchanged); `held-open` keeps ONE `createSession` open across turns, feeding it
 * the streamed user turns as an {@link SessionAdapterInit.input} async iterable
 * (the SDK streaming-input strategy). This is an ABSTRACT verdict — M8 branches on
 * the returned string, never on which backend is active. The provider→strategy
 * mapping lives with the {@link SessionDeps.createAdapter} factory in the
 * composition root (the one place that knows the backend), so the two stay a
 * single source of truth (ADR 0002/0004).
 */
export type SessionStrategy = 'per-turn' | 'held-open';

/** The per-session facts M8 hands `assemblePieces` so it can author the standing scaffold (incl. the env block). */
export interface AssemblePiecesContext {
  role: string;
  /** The chosen roles (assembly selection); preferred over `role` when present. */
  roles?: string[];
  /** The session's model selection — authored into the `## Model` prompt section so
   *  the agent knows what it is running as (provider defaults to `claude` when unset).
   *  Deliberately NOT part of the drift key: a model switch recompiles via the freeze
   *  reuse gate, never the drift banner. */
  model?: ModelSelection;
  scope: string;
  /** The bound session worktree (the agent's working directory). Available to
   *  context assembly, but deliberately NOT written into the baseline prompt —
   *  the backend supplies the cwd, and keeping dynamic paths out of the compiled
   *  prompt is what keeps `promptVersion` stable across invocations. */
  worktree: string;
  /** Opt-in packages the user added beyond the role's (assembly selection). */
  packageIds?: string[];
  /** Default packages the user turned off (assembly selection). */
  exclude?: string[];
  /** Ad-hoc skill Pieces layered on top of the role (user-added). */
  skills?: Piece[];
}

/** The live core references M8 holds and wires per session (all injected; M8 sorts last). */
export interface SessionDeps {
  newSessionId: () => string;
  /** Bind a git worktree for the session (D90/D96); returns its path. */
  bindWorktree: (sessionId: string, scope: string) => string;
  /** Release the session's worktree at close. */
  releaseWorktree: (worktree: string) => void;
  /** Gather the session's pieces + capability frame (baseline scaffold + M4 context → M5 input). */
  assemblePieces: (ctx: AssemblePiecesContext) => { pieces: Piece[]; frame: CapabilityFrame };
  /** M5.compile — pieces → backend-neutral config. */
  compile: (pieces: Piece[], frame: CapabilityFrame) => NeutralConfig;
  /** M7.sandboxPolicy — the per-session capability set. */
  sandboxPolicy: (ctx: {
    sessionId: string;
    trust: 'local' | 'imported';
    worktree: string;
  }) => CapabilitySet;
  /** M7.capState — the non-mutating cost read. */
  capState: () => { capHit: boolean; remaining: number | null };
  /** M7.charge — settle cost exactly once per result. */
  charge: (sessionId: string, usage: RuntimeUsage) => void;
  /** M7 audit-ledger append, attributed to the active account; absent ⇒ spend recording not wired. */
  recordSpend?: (record: {
    costUsd: number;
    tokensIn: number;
    tokensOut: number;
    account?: string;
  }) => void;
  /** M3.perToolDeny — the per-tool deny-rule check. */
  perToolDeny: (tool: string, input: unknown) => { behavior: 'deny'; message: string } | undefined;
  /** M3.gate — the close-gate verdict. */
  gate: () => StopDecision;
  /** M6's governed tool catalogue (names; the rich surface is registered by M9). */
  catalogue: ToolCatalogue;
  /** The pure-API tool catalogue (governance + base tools); used for non-claude providers. */
  baseCatalogue: ToolCatalogue;
  /** M1 checkpoint at the session boundary. */
  checkpoint: () => void;
  /** Construct the per-session backend adapter (M9, injected — M8 holds no backend type). */
  createAdapter: (init: SessionAdapterInit) => RuntimeAdapter;
  /** Optional API-route per-session ceiling; absent ⇒ subscription model. */
  perSessionCeiling?: number;
  /** Session trust (D148); defaults to local. */
  trust?: 'local' | 'imported';
  /** Resolve the active account for a provider (login pointer + label) at session start; absent ⇒ account selection not wired. */
  activeAccount?: (provider: string) => ActiveAccountResolution;
  /**
   * The turn-driving strategy for a provider — see {@link SessionStrategy}. Absent
   * (or returning `per-turn`) ⇒ today's per-turn drive, byte-identical (D85). Only
   * a backend the composition root maps to `held-open` gets the SDK streaming-input
   * drive; M8 consumes the abstract verdict and never learns the backend.
   */
  sessionStrategy?: (provider: string) => SessionStrategy;
}

/** Start a session: bind, compile, render, wire both SC-1 hooks, and run the loop. */
export async function createSession(
  req: {
    role: string;
    /** The chosen roles (assembly selection); preferred over `role` when present. */
    roles?: string[];
    scope: string;
    input: string | AsyncIterable<string>;
    model?: ModelSelection;
    /** Opt-in packages the user added beyond the role's (assembly selection). */
    packageIds?: string[];
    /** Default packages the user turned off (assembly selection). */
    exclude?: string[];
    onTurn?: (frame: TurnFrame, full?: string) => void;
    /** Fired once the id + worktree are bound, before the loop runs — lets a caller respond/stream before the loop settles. */
    onStart?: (started: { id: string; worktree: string }) => void;
    /** The persistent conversation id to run within (R-7); absent ⇒ an ephemeral session (a fresh generated id). */
    sessionId?: string;
    /** A prior backend session id to resume this conversation's memory. */
    resume?: string;
    /** Report the backend's own session id once the loop learns it. */
    onBackendSession?: (backendSessionId: string) => void;
    /** The prior conversation transcript (system omitted) — carried to any backend. */
    history?: readonly BackendMessage[];
    /** Claude cross-provider switch: deliver `history` as a first-turn preamble. */
    deliverHistoryAsPreamble?: boolean;
    /** M8's per-session user-stop, forwarded to the adapter (see {@link SessionAdapterInit.signal}). */
    signal?: AbortSignal;
    /** M8's per-session steer drain, forwarded to the adapter (see {@link SessionAdapterInit.drainSteer}). */
    drainSteer?: () => readonly string[];
    /** M8's per-session queued-steer drain, forwarded to the adapter (see {@link SessionAdapterInit.drainQueuedSteer}). */
    drainQueuedSteer?: () => readonly string[];
    /** M8's turn-interrupt receiver, forwarded to the adapter (see {@link SessionAdapterInit.onTurnInterrupt}). */
    onTurnInterrupt?: (interrupt: TurnInterrupt) => void;
    /** The session's frozen compilation (neutral config + frame). When present the
     *  prompt is NOT recompiled — the byte-stable frozen prompt is reused (cache
     *  warmth + "static unless raised"); absent ⇒ compile fresh (the first turn). */
    frozen?: { neutral: NeutralConfig; frame: CapabilityFrame };
    /** Report the fresh compilation (first turn only) so M8 can freeze it. */
    onCompile?: (compiled: { neutral: NeutralConfig; frame: CapabilityFrame }) => void;
  },
  deps: SessionDeps,
): Promise<Session> {
  const sessionId = req.sessionId ?? deps.newSessionId();
  const worktree = deps.bindWorktree(sessionId, req.scope);
  req.onStart?.({ id: sessionId, worktree });
  // Reuse the frozen compilation when the session already has one; otherwise compile
  // once and report it up so it can be frozen for every later turn.
  let neutral: NeutralConfig;
  let frame: CapabilityFrame;
  if (req.frozen !== undefined) {
    neutral = req.frozen.neutral;
    frame = req.frozen.frame;
  } else {
    const assembled = deps.assemblePieces({
      role: req.role,
      ...(req.roles !== undefined ? { roles: req.roles } : {}),
      ...(req.model !== undefined ? { model: req.model } : {}),
      scope: req.scope,
      worktree,
      ...(req.packageIds !== undefined ? { packageIds: req.packageIds } : {}),
      ...(req.exclude !== undefined ? { exclude: req.exclude } : {}),
    });
    frame = assembled.frame;
    neutral = deps.compile(assembled.pieces, frame);
    req.onCompile?.({ neutral, frame });
  }
  const sandbox = deps.sandboxPolicy({ sessionId, trust: deps.trust ?? 'local', worktree });
  const maxBudgetUsd = sessionBudget(deps.perSessionCeiling, deps.capState().remaining);
  // The chosen model names its provider (from the merged model list); that provider's
  // active account supplies the auth pointer. So a DeepSeek model authenticates with the
  // DeepSeek account regardless of which Claude account is active, and vice versa.
  const provider = req.model?.provider ?? 'claude';
  const account = deps.activeAccount?.(provider);

  // Settle once per result: charge the cap, then append the account-attributed
  // spend to the audit ledger (when wired). M9 calls this exactly once per result.
  const onSettle = (sid: string, usage: RuntimeUsage): void => {
    deps.charge(sid, usage);
    deps.recordSpend?.({
      costUsd: usage.costUsd,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      ...(account ? { account: account.label } : {}),
    });
  };

  const adapter = deps.createAdapter({
    sessionId,
    sandbox,
    input: req.input,
    onSettle,
    ...(req.model ? { model: req.model } : {}),
    ...(req.onTurn ? { onTurn: req.onTurn } : {}),
    ...(maxBudgetUsd !== undefined ? { maxBudgetUsd } : {}),
    ...(account?.locator ? { locator: account.locator } : {}),
    ...(req.resume !== undefined ? { resume: req.resume } : {}),
    ...(req.onBackendSession ? { onBackendSession: req.onBackendSession } : {}),
    ...(req.history !== undefined ? { history: req.history } : {}),
    ...(req.deliverHistoryAsPreamble !== undefined
      ? { deliverHistoryAsPreamble: req.deliverHistoryAsPreamble }
      : {}),
    ...(req.signal !== undefined ? { signal: req.signal } : {}),
    ...(req.drainSteer !== undefined ? { drainSteer: req.drainSteer } : {}),
    ...(req.drainQueuedSteer !== undefined ? { drainQueuedSteer: req.drainQueuedSteer } : {}),
    ...(req.onTurnInterrupt !== undefined ? { onTurnInterrupt: req.onTurnInterrupt } : {}),
  });

  adapter.renderNative(neutral);
  adapter.denyBuiltins();
  adapter.registerTools(provider === 'claude' ? deps.catalogue : deps.baseCatalogue);
  adapter.interceptTool(
    buildCanUseTool({ capState: deps.capState, perToolDeny: deps.perToolDeny }),
  );
  adapter.interceptStop(buildStopGate({ gate: deps.gate }));

  const config = { role: req.role, scope: req.scope, worktree, capabilityFrame: frame };
  await adapter.runLoop(config);
  return { id: sessionId, config, worktree, ...(account ? { account: account.label } : {}) };
}

/** Tear a session down: checkpoint at the boundary (M1), then release the worktree. */
export function closeSession(session: Session, deps: SessionDeps): void {
  deps.checkpoint();
  deps.releaseWorktree(session.worktree);
}
