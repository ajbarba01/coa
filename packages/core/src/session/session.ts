import type {
  Attachment,
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
import type {
  DrainDeliveries,
  RuntimeAdapter,
  RuntimeUsage,
  StopDecision,
  ToolCatalogue,
  TurnInterrupt,
} from '@coa/spi';
import type { SpawnDeps } from '../workbench/spawn.js';
import { buildCanUseTool, buildStopGate, type ModeDeps } from './permission.js';

/**
 * The per-session lifecycle: create → attach-worktree → compile →
 * render → wire → run → close. The session layer is the orchestration hub: it calls the prompt compile step,
 * hands the neutral config to the backend adapter to render, consults governance for the sandbox,
 * and wires the per-session dependency-injection closures (the close-gate and per-tool deny
 * predicates onto the backend adapter's two hooks). The backend adapter stays a swappable leaf — it is reached only
 * through the injected {@link SessionDeps.createAdapter} factory and the
 * {@link RuntimeAdapter} port; the session layer never imports a backend.
 */

/** The session-construction inputs the session layer computes and hands to the backend factory (the neutral half of the session-lifecycle seam). */
export interface SessionAdapterInit {
  sessionId: string;
  /** The per-session capability set from the sandbox policy. */
  sandbox: CapabilitySet;
  /** The session's prompt input — a one-shot string or a stream of user-turn strings (neutral, no backend type). */
  input: string | AsyncIterable<string>;
  /** Attachments on this run's user message (the one shared wire shape). The adapter
   *  maps each onto its backend's own encoding, or rejects with a typed
   *  `AttachmentCapabilityError` when it can't honor one — never a silent drop. */
  attachments?: readonly Attachment[];
  /** Whether the chosen model reports image-input support (daemon-resolved from the
   *  model-metadata catalog) — the adapter's image gate. Absent ⇒ unverified/no. */
  visionSupported?: boolean;
  /** The agent's model selection; `model`/`reasoning` are the backend's (provider drives adapter routing upstream). */
  model?: ModelSelection;
  /** The backend's settlement step → the cost charge step, called once per settled result. */
  onSettle: (sessionId: string, usage: RuntimeUsage) => void;
  /**
   * spine producer ② — record on-disk changes no governed tool made. Every backend fires it
   * at its own tool boundary (the SDK's PostToolUse hook; the pure-API loop's per-call
   * block), which is what keeps the change spine identical across backends. Optional so
   * a backend or test that omits it behaves exactly as before.
   */
  observeChanges?: () => void;
  /**
   * Per-frame session output: the backend maps its stream to neutral wire frames; the session layer
   * sequences + pushes them. `full`, when present (a `tool_result`), is the complete
   * body the model saw — the append-only log's fidelity companion to the lossy
   * pointer frame; the session layer persists it alongside the frame, never on the wire.
   */
  onTurn?: (frame: TurnFrame, full?: string) => void;
  /** The active account's login pointer (backend resolves the token); absent ⇒ ambient (today's auth). */
  locator?: Locator;
  /** A prior backend session id to resume (conversation continuity); absent ⇒ a fresh conversation. */
  resume?: string;
  /** Report the backend's own session id (for the next resume); the session layer persists it against the conversation. */
  onBackendSession?: (backendSessionId: string) => void;
  /** The prior conversation transcript (system omitted). A pure-API backend resends it for memory; the Claude backend carries it for bookkeeping (and, when `deliverHistoryAsPreamble`, as a first-turn preamble). */
  history?: readonly BackendMessage[];
  /** Claude cross-provider switch: deliver `history` as a first-turn preamble (no resumable server session exists for this transcript). Pure-API backends ignore it. */
  deliverHistoryAsPreamble?: boolean;
  /**
   * A neutral user-stop (interrupt) from the session layer, forwarded to the backend so an
   * in-flight round-trip aborts at its next safe boundary; a user stop,
   * not a governance block. Absent ⇒ current behavior byte-identical.
   */
  signal?: AbortSignal;
  /**
   * A synchronous drain of the session's pending mid-loop deliveries — text that should
   * reach the model INSIDE the turn already running (a user steer, a system notice).
   * Not a turn: every backend realizes it at the soonest point its own turn model
   * allows (the pure-API loop's next round trip, the SDK's post-tool hook), so no
   * plane above the backend port branches on backend. Absent ⇒ nothing is ever delivered,
   * byte-identical to today.
   */
  drainDeliveries?: DrainDeliveries;
  /**
   * A backend that can stop its current turn while keeping the session alive reports
   * its turn-interrupt handle here (the Claude SDK's held-open `query.interrupt`). The session layer
   * routes a user Stop (`interruptSession` → `setInterruptClosure`) through it — distinct
   * from the whole-session abort `signal`, which ends the loop rather than just the turn.
   * Absent ⇒ the backend has no mid-turn interrupt (per-turn backends); byte-identical to
   * today. See the held-open streaming-input strategy.
   */
  onTurnInterrupt?: (interrupt: TurnInterrupt) => void;
}

/** The active-account resolution the session layer supplies per session (for the model's provider): a label (incl. `'ambient'`) + the optional login pointer. */
export interface ActiveAccountResolution {
  label: string;
  locator?: Locator;
}

/**
 * How the session layer drives the live session's turns for a given backend (the held-open streaming-input strategy):
 * `per-turn` runs a fresh {@link createSession} per turn (the pure-API strategy,
 * unchanged); `held-open` keeps ONE `createSession` open across turns, feeding it
 * the streamed user turns as an {@link SessionAdapterInit.input} async iterable
 * (the SDK streaming-input strategy). This is an ABSTRACT verdict — the session layer branches on
 * the returned string, never on which backend is active. The provider→strategy
 * mapping lives with the {@link SessionDeps.createAdapter} factory in the
 * composition root (the one place that knows the backend), so the two stay a
 * single source of truth (the backend-blind-core rule).
 */
export type SessionStrategy = 'per-turn' | 'held-open';

/** The per-session facts the session layer hands `assemblePieces` so it can author the standing scaffold (incl. the env block). */
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

/** The live core references the session layer holds and wires per session (all injected; the session layer sorts last). */
export interface SessionDeps {
  newSessionId: () => string;
  /** Bind a git worktree for the session; returns its path. */
  bindWorktree: (sessionId: string, scope: string) => string;
  /** Release the session's worktree at close. */
  releaseWorktree: (worktree: string) => void;
  /** Gather the session's pieces + capability frame (baseline scaffold + assembled context → compiler input). */
  assemblePieces: (ctx: AssemblePiecesContext) => { pieces: Piece[]; frame: CapabilityFrame };
  /** Compile pieces → backend-neutral config. */
  compile: (pieces: Piece[], frame: CapabilityFrame) => NeutralConfig;
  /** The per-session capability set. */
  sandboxPolicy: (ctx: {
    sessionId: string;
    trust: 'local' | 'imported';
    worktree: string;
  }) => CapabilitySet;
  /** Settle cost exactly once per result. */
  charge: (sessionId: string, usage: RuntimeUsage) => void;
  /** Audit-ledger append, attributed to the active account; absent ⇒ spend recording not wired. */
  recordSpend?: (record: {
    costUsd: number;
    tokensIn: number;
    tokensOut: number;
    account?: string;
    /** The family-tree root this spend belongs to — what makes a whole run's cost
     *  answerable, not just an account's; absent for a session with no lineage
     *  (byte-identical to before this field existed). */
    root?: string;
  }) => void;
  /** The per-tool deny-rule check. */
  perToolDeny: (tool: string, input: unknown) => { behavior: 'deny'; message: string } | undefined;
  /**
   * F2: resolve THIS session's mode-aware layer, bound to its live-session
   * mode/approval-seam state and given the session's resolved `provider` (a
   * static per-backend fact, known here before the adapter is even
   * constructed). Absent, or returning `undefined` (an unknown session id —
   * should not happen in practice), ⇒ mode enforcement is off for this session,
   * byte-identical to before F2 existed (the strict-superset floor).
   */
  resolveMode?: (sessionId: string, provider: string) => ModeDeps | undefined;
  /** The close-gate verdict. */
  gate: () => StopDecision;
  /** The governed tool catalogue (names; the rich surface is registered by the backend port). */
  catalogue: ToolCatalogue;
  /** The pure-API tool catalogue (governance + base tools); used for non-claude providers. */
  baseCatalogue: ToolCatalogue;
  /**
   * Build THIS session's own copy of `catalogue`, with `spawn_agent` bound to the given
   * session id as parent. Preferred over the shared `catalogue` when present (`createSession`
   * calls it with `resolveSpawn`'s result); absent ⇒ falls back to `catalogue` unchanged —
   * a session that never spawns behaves byte-identically to before this seam existed.
   */
  catalogueFor?: (sessionId: string, spawn: SpawnDeps | undefined) => ToolCatalogue;
  /** As {@link catalogueFor}, for `baseCatalogue` (non-claude providers). */
  baseCatalogueFor?: (sessionId: string, spawn: SpawnDeps | undefined) => ToolCatalogue;
  /** change-event-spine checkpoint at the session boundary. */
  checkpoint: () => void;
  /**
   * spine producer ② — record on-disk changes no governed tool made. Handed to every
   * adapter, which fires it at its own tool boundary, so the same facts reach the spine
   * whichever backend runs the loop.
   */
  observeChanges: () => void;
  /** Construct the per-session backend adapter (injected — the session layer holds no backend type). */
  createAdapter: (init: SessionAdapterInit) => RuntimeAdapter;
  /** Session trust level; defaults to local. */
  trust?: 'local' | 'imported';
  /** Resolve the active account for a provider (login pointer + label) at session start; absent ⇒ account selection not wired. */
  activeAccount?: (provider: string) => ActiveAccountResolution;
  /**
   * The turn-driving strategy for a provider — see {@link SessionStrategy}. Absent
   * (or returning `per-turn`) ⇒ today's per-turn drive, byte-identical. Only
   * a backend the composition root maps to `held-open` gets the SDK streaming-input
   * drive; the session layer consumes the abstract verdict and never learns the backend.
   */
  sessionStrategy?: (provider: string) => SessionStrategy;
  /**
   * Resolve THIS session's subagent-dispatch port (bound to `sessionId` as the parent a
   * spawn writes into the child's lineage) — read once, right before `registerTools`, so
   * the binding is never an ambient "current session" guess that could race across
   * concurrently-live sessions (a parent and its already-running child, this feature's
   * own central case). Absent ⇒ spawning stays unavailable.
   */
  resolveSpawn?: (sessionId: string) => SpawnDeps | undefined;
}

/** Start a session: bind, compile, render, wire both governance hooks, and run the loop. */
export async function createSession(
  req: {
    role: string;
    /** The chosen roles (assembly selection); preferred over `role` when present. */
    roles?: string[];
    scope: string;
    /** This session's family-tree root (a spawned child's top-of-tree ancestor id); the
     *  caller — the one place that knows a session's lineage — supplies it, absent for a
     *  session with no lineage, the overwhelming common case. Reaches the settled
     *  ledger record alongside `account` so a whole spawned run's cost is answerable, not
     *  just an account's. */
    root?: string;
    input: string | AsyncIterable<string>;
    /** Attachments on this run's user message (see {@link SessionAdapterInit.attachments}). */
    attachments?: readonly Attachment[];
    /** Daemon-resolved image-input capability (see {@link SessionAdapterInit.visionSupported}). */
    visionSupported?: boolean;
    model?: ModelSelection;
    /** Opt-in packages the user added beyond the role's (assembly selection). */
    packageIds?: string[];
    /** Default packages the user turned off (assembly selection). */
    exclude?: string[];
    onTurn?: (frame: TurnFrame, full?: string) => void;
    /** Fired once the id + worktree are bound, before the loop runs — lets a caller respond/stream before the loop settles. */
    onStart?: (started: { id: string; worktree: string }) => void;
    /** The persistent conversation id to run within; absent ⇒ an ephemeral session (a fresh generated id). */
    sessionId?: string;
    /** A prior backend session id to resume this conversation's memory. */
    resume?: string;
    /** Report the backend's own session id once the loop learns it. */
    onBackendSession?: (backendSessionId: string) => void;
    /** The prior conversation transcript (system omitted) — carried to any backend. */
    history?: readonly BackendMessage[];
    /** Claude cross-provider switch: deliver `history` as a first-turn preamble. */
    deliverHistoryAsPreamble?: boolean;
    /** The session layer's per-session user-stop, forwarded to the adapter (see {@link SessionAdapterInit.signal}). */
    signal?: AbortSignal;
    /** The session layer's per-session delivery drain, forwarded to the adapter (see {@link SessionAdapterInit.drainDeliveries}). */
    drainDeliveries?: DrainDeliveries;
    /** The session layer's turn-interrupt receiver, forwarded to the adapter (see {@link SessionAdapterInit.onTurnInterrupt}). */
    onTurnInterrupt?: (interrupt: TurnInterrupt) => void;
    /** Mirror of each settlement's usage, fired alongside the charge — the drivers
     *  push it to subscribers so the console's context ring rides the SAME per-turn
     *  usage the adapters already report (never a second tracking mechanism).
     *  Absent ⇒ byte-identical to before this hook existed. */
    onUsage?: (usage: RuntimeUsage) => void;
    /** The session's frozen compilation (neutral config + frame). When present the
     *  prompt is NOT recompiled — the byte-stable frozen prompt is reused (cache
     *  warmth + "static unless raised"); absent ⇒ compile fresh (the first turn). */
    frozen?: { neutral: NeutralConfig; frame: CapabilityFrame };
    /** Report the fresh compilation (first turn only) so the session layer can freeze it. */
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
  // The chosen model names its provider (from the merged model list); that provider's
  // active account supplies the auth pointer. So a DeepSeek model authenticates with the
  // DeepSeek account regardless of which Claude account is active, and vice versa.
  const provider = req.model?.provider ?? 'claude';
  const account = deps.activeAccount?.(provider);

  // Settle once per result: charge the cap, then append the account-attributed
  // spend to the audit ledger (when wired). The backend adapter calls this exactly once per result.
  const onSettle = (sid: string, usage: RuntimeUsage): void => {
    deps.charge(sid, usage);
    req.onUsage?.(usage);
    deps.recordSpend?.({
      costUsd: usage.costUsd,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      ...(account ? { account: account.label } : {}),
      ...(req.root !== undefined ? { root: req.root } : {}),
    });
  };

  const adapter = deps.createAdapter({
    sessionId,
    sandbox,
    input: req.input,
    onSettle,
    ...(req.attachments !== undefined ? { attachments: req.attachments } : {}),
    ...(req.visionSupported !== undefined ? { visionSupported: req.visionSupported } : {}),
    ...(req.model ? { model: req.model } : {}),
    ...(req.onTurn ? { onTurn: req.onTurn } : {}),
    observeChanges: deps.observeChanges,
    ...(account?.locator ? { locator: account.locator } : {}),
    ...(req.resume !== undefined ? { resume: req.resume } : {}),
    ...(req.onBackendSession ? { onBackendSession: req.onBackendSession } : {}),
    ...(req.history !== undefined ? { history: req.history } : {}),
    ...(req.deliverHistoryAsPreamble !== undefined
      ? { deliverHistoryAsPreamble: req.deliverHistoryAsPreamble }
      : {}),
    ...(req.signal !== undefined ? { signal: req.signal } : {}),
    ...(req.drainDeliveries !== undefined ? { drainDeliveries: req.drainDeliveries } : {}),
    ...(req.onTurnInterrupt !== undefined ? { onTurnInterrupt: req.onTurnInterrupt } : {}),
  });

  adapter.renderNative(neutral);
  adapter.denyBuiltins();
  // The session-scoped catalogue is preferred whenever the composition root wired one:
  // `spawn_agent` on the SHARED daemon-wide catalogue would have no way to learn which
  // live session is calling it, and a naive shared "current session" ambient would race
  // across concurrently-live sessions (a parent and its already-running child — this
  // feature's own central case). `resolveSpawn` reads the real `sessionId` right here,
  // not from anywhere it could go stale. Neither seam present ⇒ the original static
  // catalogue, byte-identical to before this existed.
  const spawn = deps.resolveSpawn?.(sessionId);
  const catalogueFor = provider === 'claude' ? deps.catalogueFor : deps.baseCatalogueFor;
  const catalogue =
    catalogueFor !== undefined
      ? catalogueFor(sessionId, spawn)
      : provider === 'claude'
        ? deps.catalogue
        : deps.baseCatalogue;
  adapter.registerTools(catalogue);
  // F2: resolved AFTER `provider` is known (above) so a per-provider approval-seam
  // fact is never stale; `resolveMode` itself binds to the live session by
  // `sessionId`, so the predicate's `getMode`/`hasApprovalSeam` stay live reads
  // even though this composition runs once (per turn, or once for a whole
  // held-open query — see permission.ts's `ModeDeps` doc).
  const modeDeps = deps.resolveMode?.(sessionId, provider);
  adapter.interceptTool(
    buildCanUseTool({ perToolDeny: deps.perToolDeny, ...(modeDeps ? { mode: modeDeps } : {}) }),
  );
  adapter.interceptStop(buildStopGate({ gate: deps.gate }));

  const config = { role: req.role, scope: req.scope, worktree, capabilityFrame: frame };
  await adapter.runLoop(config);
  return { id: sessionId, config, worktree, ...(account ? { account: account.label } : {}) };
}

/** Tear a session down: checkpoint at the boundary (the change-event spine), then release the worktree. */
export function closeSession(session: Session, deps: SessionDeps): void {
  deps.checkpoint();
  deps.releaseWorktree(session.worktree);
}
