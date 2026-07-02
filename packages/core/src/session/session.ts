import type {
  CapabilityFrame,
  CapabilitySet,
  Locator,
  ModelSelection,
  NeutralConfig,
  Piece,
  Session,
  TurnFrame,
} from '@coa/shared';
import type { RuntimeAdapter, RuntimeUsage, StopDecision, ToolCatalogue } from '@coa/spi';
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
  /** Per-frame session output: the backend maps its stream to neutral M0 frames; M8 sequences + pushes them. */
  onTurn?: (frame: TurnFrame) => void;
  /** The active account's login pointer (backend resolves the token); absent ⇒ ambient (today's auth). */
  locator?: Locator;
  /** A prior backend session id to resume (R-7 continuity); absent ⇒ a fresh conversation. */
  resume?: string;
  /** Report the backend's own session id (for the next resume); M8 persists it against the conversation. */
  onBackendSession?: (backendSessionId: string) => void;
}

/** The active-account resolution M8 supplies per session (for the model's provider): a label (incl. `'ambient'`) + the optional login pointer. */
export interface ActiveAccountResolution {
  label: string;
  locator?: Locator;
}

/** The per-session facts M8 hands `assemblePieces` so it can author the standing scaffold (incl. the env block). */
export interface AssemblePiecesContext {
  role: string;
  scope: string;
  /** The bound session worktree (the agent's working directory). */
  worktree: string;
  /** The active model id, when selected. */
  model?: string;
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
}

/** Start a session: bind, compile, render, wire both SC-1 hooks, and run the loop. */
export async function createSession(
  req: {
    role: string;
    scope: string;
    input: string | AsyncIterable<string>;
    model?: ModelSelection;
    /** Opt-in packages the user added beyond the role's (assembly selection). */
    packageIds?: string[];
    /** Default packages the user turned off (assembly selection). */
    exclude?: string[];
    onTurn?: (frame: TurnFrame) => void;
    /** Fired once the id + worktree are bound, before the loop runs — lets a caller respond/stream before the loop settles. */
    onStart?: (started: { id: string; worktree: string }) => void;
    /** The persistent conversation id to run within (R-7); absent ⇒ an ephemeral session (a fresh generated id). */
    sessionId?: string;
    /** A prior backend session id to resume this conversation's memory. */
    resume?: string;
    /** Report the backend's own session id once the loop learns it. */
    onBackendSession?: (backendSessionId: string) => void;
  },
  deps: SessionDeps,
): Promise<Session> {
  const sessionId = req.sessionId ?? deps.newSessionId();
  const worktree = deps.bindWorktree(sessionId, req.scope);
  req.onStart?.({ id: sessionId, worktree });
  const { pieces, frame } = deps.assemblePieces({
    role: req.role,
    scope: req.scope,
    worktree,
    ...(req.model?.model !== undefined ? { model: req.model.model } : {}),
    ...(req.packageIds !== undefined ? { packageIds: req.packageIds } : {}),
    ...(req.exclude !== undefined ? { exclude: req.exclude } : {}),
  });
  const neutral = deps.compile(pieces, frame);
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
  });

  adapter.renderNative(neutral);
  adapter.denyBuiltins();
  adapter.registerTools(deps.catalogue);
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
