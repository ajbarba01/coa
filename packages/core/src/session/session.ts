import type { CapabilityFrame, CapabilitySet, NeutralConfig, Piece, Session } from '@coa/shared';
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
  /** The session's prompt input (the human's first turn). */
  input: string;
  /** The native mid-loop hard stop, when bounded. */
  maxBudgetUsd?: number;
  /** M9's settlement step → M7.charge, called once per settled result. */
  onSettle: (sessionId: string, usage: RuntimeUsage) => void;
}

/** The live core references M8 holds and wires per session (all injected; M8 sorts last). */
export interface SessionDeps {
  newSessionId: () => string;
  /** Bind a git worktree for the session (D90/D96); returns its path. */
  bindWorktree: (sessionId: string, scope: string) => string;
  /** Release the session's worktree at close. */
  releaseWorktree: (worktree: string) => void;
  /** Gather the role/scope's pieces + capability frame (M4 context → M5 input). */
  assemblePieces: (role: string, scope: string) => { pieces: Piece[]; frame: CapabilityFrame };
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
}

/** Start a session: bind, compile, render, wire both SC-1 hooks, and run the loop. */
export async function createSession(
  req: { role: string; scope: string; input: string },
  deps: SessionDeps,
): Promise<Session> {
  const sessionId = deps.newSessionId();
  const worktree = deps.bindWorktree(sessionId, req.scope);
  const { pieces, frame } = deps.assemblePieces(req.role, req.scope);
  const neutral = deps.compile(pieces, frame);
  const sandbox = deps.sandboxPolicy({ sessionId, trust: deps.trust ?? 'local', worktree });
  const maxBudgetUsd = sessionBudget(deps.perSessionCeiling, deps.capState().remaining);

  const adapter = deps.createAdapter({
    sessionId,
    sandbox,
    input: req.input,
    onSettle: deps.charge,
    ...(maxBudgetUsd !== undefined ? { maxBudgetUsd } : {}),
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
  return { id: sessionId, config, worktree };
}

/** Tear a session down: checkpoint at the boundary (M1), then release the worktree. */
export function closeSession(session: Session, deps: SessionDeps): void {
  deps.checkpoint();
  deps.releaseWorktree(session.worktree);
}
