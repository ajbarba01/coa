import { ulid } from 'ulid';
import type { CapabilityFrame, CapabilitySet, NeutralConfig, Piece } from '@coa/shared';
import type { RuntimeAdapter, StopDecision, ToolCatalogue } from '@coa/spi';
import type { SpawnDeps } from '../workbench/spawn.js';
import type {
  ActiveAccountResolution,
  AssemblePiecesContext,
  SessionAdapterInit,
  SessionDeps,
  SessionStrategy,
} from './session.js';

/**
 * The daemon composition root — bind the daemon-singleton core surfaces into the
 * per-session {@link SessionDeps} the lifecycle consumes. The singletons are
 * constructed once in dependency order (the change-event spine → the flag pipeline → context assembly → the prompt compiler → cost governance → the tool catalogue) and held by
 * reference; this maps their methods onto the SessionDeps shape, reconciling the
 * small contract differences (the cost charge step takes a `costUsd`, the session settles a
 * full `RuntimeUsage`) and supplying the floors for the not-yet-built worktree
 * manager + context assembly. The backend stays injected via `wiring`
 * (its construction is backend-coupled and lives outside `core`).
 */

/** The daemon-singleton surfaces the session layer wires (structural, so the composition root imports no ring). */
export interface DaemonCore {
  /** Checkpoint the change-event spine at the session boundary. */
  checkpoint: () => void;
  /**
   * Drive spine producer ②: record any on-disk change coa did not perform itself. Both
   * backends call it at their own tool boundary, so the same facts reach the spine
   * whichever loop is running. A no-op where the reconciler cannot run (see daemon.ts).
   */
  observeChanges: () => void;
  /** The flag pipeline's per-tool deny-rule check. */
  perToolDeny: (tool: string, input: unknown) => { behavior: 'deny'; message: string } | undefined;
  /** The flag pipeline's close-gate verdict. */
  gate: () => StopDecision;
  /** The non-mutating cost read (the console verb and the governed inspect read consume it). */
  capState: () => { capHit: boolean; remaining: number | null };
  /** Settle cost (USD) exactly once per result. */
  charge: (sessionId: string, costUsd: number) => void;
  /** Append a spend record to the audit ledger (allow-list redacted). */
  record: (event: Record<string, unknown>) => void;
  /** The per-session capability set. */
  sandboxPolicy: (ctx: {
    sessionId: string;
    trust: 'local' | 'imported';
    worktree: string;
  }) => CapabilitySet;
  /** Compile pieces into the backend-neutral config. */
  compile: (pieces: Piece[], frame: CapabilityFrame) => NeutralConfig;
  /** The governed tool catalogue. */
  catalogue: ToolCatalogue;
  /** The pure-API catalogue (governance + base tools); used for non-claude providers. */
  baseCatalogue: ToolCatalogue;
  /**
   * Build THIS session's own tool catalogue, with `spawn_agent` bound to `sessionId` as
   * parent — the seam that keeps concurrently-live sessions (a parent and its
   * already-running child) from racing over which one a spawn belongs to. `buildGovernedTools`
   * is just closure construction over the same daemon singletons `catalogue` already
   * closes over, so re-deriving it per session is negligible cost. Absent `spawn` ⇒ the
   * same tools as `catalogue`, minus a working `spawn_agent` (the absent-port floor).
   * Absent entirely ⇒ `session.ts` falls back to `catalogue` unchanged — a session that
   * never spawns is byte-identical to before this seam existed.
   */
  catalogueFor?: (sessionId: string, spawn: SpawnDeps | undefined) => ToolCatalogue;
  /** As {@link catalogueFor}, for `baseCatalogue` (non-claude providers) — see its doc:
   *  BOTH catalogues carry `spawn_agent`, and both need this seam covered. */
  baseCatalogueFor?: (sessionId: string, spawn: SpawnDeps | undefined) => ToolCatalogue;
}

/** The per-session injection points: the backend factory + the not-yet-built worktree/context floors. */
export interface SessionWiring {
  /** Construct the per-session backend adapter (backend-coupled; lives outside core). */
  createAdapter: (init: SessionAdapterInit) => RuntimeAdapter;
  /** Bind a git worktree for the session; returns its path. */
  bindWorktree: (sessionId: string, scope: string) => string;
  /** Release the session's worktree at close (defaults to a no-op floor). */
  releaseWorktree?: (worktree: string) => void;
  /** Gather the session's pieces + frame (baseline + assembled context; defaults to the empty/vanilla floor). */
  assemblePieces?: (ctx: AssemblePiecesContext) => { pieces: Piece[]; frame: CapabilityFrame };
  /** Session id source (defaults to a ULID). */
  newSessionId?: () => string;
  trust?: 'local' | 'imported';
  /** Resolve the active account for a provider (login pointer + label) at session start; absent ⇒ account selection not wired. */
  activeAccount?: (provider: string) => ActiveAccountResolution;
  /**
   * The per-provider turn-driving strategy (see `SessionStrategy`). Co-located with
   * {@link createAdapter} in the composition root so the provider→backend and
   * provider→strategy maps stay a single source of truth; absent ⇒ per-turn.
   */
  sessionStrategy?: (provider: string) => SessionStrategy;
  /**
   * Resolve THIS session's subagent-dispatch port, bound to `sessionId` as the parent a
   * spawn writes into the child's lineage. Absent ⇒ spawning unavailable for every
   * session (byte-identical to before this seam existed).
   */
  resolveSpawn?: (sessionId: string) => SpawnDeps | undefined;
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
    charge: (sessionId, usage) => core.charge(sessionId, usage.costUsd),
    recordSpend: (record) => core.record(record),
    perToolDeny: core.perToolDeny,
    gate: core.gate,
    catalogue: core.catalogue,
    baseCatalogue: core.baseCatalogue,
    checkpoint: core.checkpoint,
    observeChanges: core.observeChanges,
    createAdapter: wiring.createAdapter,
    ...(wiring.trust !== undefined ? { trust: wiring.trust } : {}),
    ...(wiring.activeAccount ? { activeAccount: wiring.activeAccount } : {}),
    ...(wiring.sessionStrategy ? { sessionStrategy: wiring.sessionStrategy } : {}),
    ...(core.catalogueFor ? { catalogueFor: core.catalogueFor } : {}),
    ...(core.baseCatalogueFor ? { baseCatalogueFor: core.baseCatalogueFor } : {}),
    ...(wiring.resolveSpawn ? { resolveSpawn: wiring.resolveSpawn } : {}),
  };
}
