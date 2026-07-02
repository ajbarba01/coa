import { ulid } from 'ulid';
import type { CapabilityFrame, CapabilitySet, NeutralConfig, Piece } from '@coa/shared';
import type { RuntimeAdapter, StopDecision, ToolCatalogue } from '@coa/spi';
import type {
  ActiveAccountResolution,
  AssemblePiecesContext,
  SessionAdapterInit,
  SessionDeps,
} from './session.js';

/**
 * M8 composition root (R-1) — bind the daemon-singleton core surfaces into the
 * per-session {@link SessionDeps} the lifecycle consumes. The singletons are
 * constructed once in dependency order (M1 → M3 → M4 → M5 → M7 → M6) and held by
 * reference; this maps their methods onto the SessionDeps shape, reconciling the
 * small contract differences (M7.charge takes a `costUsd`, the session settles a
 * full `RuntimeUsage`) and supplying the floors for the not-yet-built worktree
 * manager + M4 context assembly. The backend (M9) stays injected via `wiring`
 * (its construction is backend-coupled and lives outside `core`).
 */

/** The daemon-singleton surfaces M8 wires (structural, so the composition root imports no ring). */
export interface DaemonCore {
  /** M1 — checkpoint at the session boundary. */
  checkpoint: () => void;
  /** M3 — the per-tool deny-rule check. */
  perToolDeny: (tool: string, input: unknown) => { behavior: 'deny'; message: string } | undefined;
  /** M3 — the close-gate verdict. */
  gate: () => StopDecision;
  /** M7 — the non-mutating cost read. */
  capState: () => { capHit: boolean; remaining: number | null };
  /** M7 — settle cost (USD) exactly once per result. */
  charge: (sessionId: string, costUsd: number) => void;
  /** M7 — append a spend record to the audit ledger (allow-list redacted). */
  record: (event: Record<string, unknown>) => void;
  /** M7 — the per-session capability set. */
  sandboxPolicy: (ctx: {
    sessionId: string;
    trust: 'local' | 'imported';
    worktree: string;
  }) => CapabilitySet;
  /** M5 — compile pieces into the backend-neutral config. */
  compile: (pieces: Piece[], frame: CapabilityFrame) => NeutralConfig;
  /** M6 — the governed tool catalogue. */
  catalogue: ToolCatalogue;
}

/** The per-session injection points: the backend factory + the not-yet-built worktree/context floors. */
export interface SessionWiring {
  /** Construct the per-session backend adapter (M9, backend-coupled; lives outside core). */
  createAdapter: (init: SessionAdapterInit) => RuntimeAdapter;
  /** Bind a git worktree for the session; returns its path. */
  bindWorktree: (sessionId: string, scope: string) => string;
  /** Release the session's worktree at close (defaults to a no-op floor). */
  releaseWorktree?: (worktree: string) => void;
  /** Gather the session's pieces + frame (baseline + M4; defaults to the empty/vanilla floor). */
  assemblePieces?: (ctx: AssemblePiecesContext) => { pieces: Piece[]; frame: CapabilityFrame };
  /** Session id source (defaults to a ULID). */
  newSessionId?: () => string;
  trust?: 'local' | 'imported';
  perSessionCeiling?: number;
  /** Resolve the active account for a provider (login pointer + label) at session start; absent ⇒ account selection not wired. */
  activeAccount?: (provider: string) => ActiveAccountResolution;
}

const EMPTY_FRAME: CapabilityFrame = { allow: [], deny: [] };

/** Map the daemon singletons + injection points into the per-session {@link SessionDeps}. */
export function composeSessionDeps(core: DaemonCore, wiring: SessionWiring): SessionDeps {
  return {
    newSessionId: wiring.newSessionId ?? (() => ulid()),
    bindWorktree: wiring.bindWorktree,
    releaseWorktree: wiring.releaseWorktree ?? (() => {}),
    assemblePieces: wiring.assemblePieces ?? (() => ({ pieces: [], frame: EMPTY_FRAME })),
    compile: core.compile,
    sandboxPolicy: core.sandboxPolicy,
    capState: core.capState,
    charge: (sessionId, usage) => core.charge(sessionId, usage.costUsd),
    recordSpend: (record) => core.record(record),
    perToolDeny: core.perToolDeny,
    gate: core.gate,
    catalogue: core.catalogue,
    checkpoint: core.checkpoint,
    createAdapter: wiring.createAdapter,
    ...(wiring.trust !== undefined ? { trust: wiring.trust } : {}),
    ...(wiring.perSessionCeiling !== undefined
      ? { perSessionCeiling: wiring.perSessionCeiling }
      : {}),
    ...(wiring.activeAccount ? { activeAccount: wiring.activeAccount } : {}),
  };
}
