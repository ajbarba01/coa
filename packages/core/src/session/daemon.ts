import { readFileSync, writeFileSync } from 'node:fs';
import type { PieceRef, Producer, ProducerInput, SymbolRef } from '@coa/shared';
import { compile } from '../compiler/compile.js';
import { createGovernanceAnchorProducer } from '../context/governance-anchor.js';
import { FlagPipeline } from '../flags/pipeline.js';
import { Governance } from '../governance/governance.js';
import { ChangeKernel } from '../kernel.js';
import { buildGovernedTools, type GovernedToolDeps } from '../workbench/governed-tools.js';
import { buildConsoleHandlers } from '../rpc/console-handlers.js';
import type { RpcHandlers } from '../rpc/router.js';
import type { DaemonCore } from './composition.js';

/**
 * M8 composition root (R-1) — construct the daemon-singleton core once, in
 * dependency order (M1 the kernel → M3 flags → M7 governance, with M5 compile +
 * M6 catalogue bound by reference). The kernel is the governance producer spine
 * (M7 writes through `appendGovernance`). Returns the {@link DaemonCore} the
 * session wiring consumes plus the live singletons, so the daemon host can read
 * projections and drive the worktree/conversation layers as they are built. The
 * backend (M9) is constructed per session, outside this root.
 */
export interface DaemonCoreOptions {
  /** The WAL path (M1) — its parent directory must exist. */
  walPath: string;
  /** The worktree root for git operations; defaults to the process cwd. */
  root?: string;
  /** The SQLite projection path; defaults to in-memory. */
  projectionPath?: string;
  /** The API-route hard ceiling in USD; omitted ⇒ subscription model (no ceiling). */
  ceilingUsd?: number;
  /** The session's configured tool baseline for the sandbox policy. */
  allowedTools?: string[];
  /** The M3 producers (M4's, injected) to register and drive off the kernel feed (R-3). */
  producers?: readonly Producer[];
}

export interface DaemonCoreHandle {
  core: DaemonCore;
  kernel: ChangeKernel;
  flags: FlagPipeline;
  governance: Governance;
}

/** Construct the daemon singletons and bind them into a {@link DaemonCore}. */
export function createDaemonCore(options: DaemonCoreOptions): DaemonCoreHandle {
  const kernel = new ChangeKernel({
    walPath: options.walPath,
    ...(options.root !== undefined ? { root: options.root } : {}),
    ...(options.projectionPath !== undefined ? { projectionPath: options.projectionPath } : {}),
  });
  const governance = new Governance(kernel, {
    ...(options.ceilingUsd !== undefined ? { ceilingUsd: options.ceilingUsd } : {}),
    ...(options.allowedTools !== undefined ? { allowedTools: options.allowedTools } : {}),
  });
  const flags = new FlagPipeline();
  const governanceAnchor = createGovernanceAnchorProducer({
    governedByEdges: () => kernel.graph.governedByEdges(),
    isRegistered: (id) => flags.registeredProducer(id) !== undefined,
  });
  wireProducers(kernel, flags, [...(options.producers ?? []), governanceAnchor]);

  const core: DaemonCore = {
    checkpoint: () => {
      kernel.checkpoint();
    },
    perToolDeny: (tool, input) => flags.perToolDeny(tool, input),
    gate: () => flags.gate(),
    capState: () => governance.capState(),
    charge: (sessionId, costUsd) => governance.charge(sessionId, costUsd),
    sandboxPolicy: (ctx) => governance.sandboxPolicy(ctx),
    compile: (pieces, frame) => {
      const { config, findings } = compile(pieces, frame, {
        isRegistered: (id) => flags.registeredProducer(id) !== undefined,
        hasGeneratedFrom: (name) =>
          kernel.graph.outEdges(name).some((edge) => edge.type === 'generated-from'),
      });
      for (const finding of findings) flags.ingest(finding); // TAX-4 coercions are feed items, never silent
      return config;
    },
    catalogue: buildGovernedTools(governedToolDeps(kernel, governance, flags, options.root ?? '.')),
  };

  return { core, kernel, flags, governance };
}

/**
 * Bind the daemon's live singletons to the read-only inspector handler map the
 * JSON-RPC router serves — the seam between the daemon core and the console's
 * CON-CAT reads. Pure projection wiring: each port reads an existing surface
 * (M7 cap + Decision log, M3 user feed), no new behavior. The transport layer
 * (socket/pipe + peer-cred) calls `dispatch(message, handlers)` with this map.
 */
export function buildDaemonConsoleHandlers(handle: DaemonCoreHandle): RpcHandlers {
  return buildConsoleHandlers({
    capState: (sessionId) => handle.governance.capState(sessionId),
    flagsForUser: (scope) => handle.flags.flagsForUser(scope),
    readDecision: (id) => handle.governance.decisionLog.read(id),
    decisionsByTarget: (target) => handle.governance.decisionLog.findByTarget(target),
    listTimeline: () => handle.kernel.listTimeline(),
  });
}

/** The sweep scope for a reconciling producer's full-set recompute (any non-golden scope). */
const RECONCILE_SWEEP: ProducerInput = { kind: 'scope', scope: '' };

/**
 * R-3 — register M4's producers into M3 (each gated by the CF-6 `validateProducer`
 * stamp inside `registerProducer`) and drive them off the kernel feed: M3 is a
 * projection-owning consumer, so it subscribes **from cursor 0** (replay-from-0)
 * and every change-event — historical on replay, then live — runs each producer
 * over `{ kind: 'change', event }`, ingesting the flags it emits. With no
 * producers configured the pipeline stays inert (the D85 strict-superset floor:
 * the gate allows and no flag fires). Each producer's own `run` decides whether
 * the event is relevant; coarse activation-label filtering is a later optimization.
 *
 * A **reconciling** producer (rebuild-to-follow) is driven differently: it emits
 * its complete current set, so the driver tracks the fingerprints it last emitted
 * (per producer) and resolves any it no longer emits — the self-heal. A one-shot
 * convergence sweep runs it at wiring so dangling state already present at startup
 * surfaces even with no change events. Per-producer tracking keeps the diff scoped
 * to that producer, never touching another's flags.
 */
function wireProducers(
  kernel: ChangeKernel,
  flags: FlagPipeline,
  producers: readonly Producer[],
): void {
  if (producers.length === 0) return;
  for (const producer of producers) flags.registerProducer(producer);

  const lastEmitted = new Map<string, Set<string>>();
  const drive = (producer: Producer, input: ProducerInput): void => {
    if (producer.reconciling !== true) {
      flags.runProducer(producer.id, input);
      return;
    }
    const fresh = producer.run(input);
    for (const flag of fresh) flags.ingest(flag);
    const freshFps = new Set(fresh.map((flag) => flag.fingerprint));
    for (const fp of lastEmitted.get(producer.id) ?? []) {
      if (!freshFps.has(fp)) flags.resolve(fp);
    }
    lastEmitted.set(producer.id, freshFps);
  };

  for (const producer of producers) {
    if (producer.reconciling === true) drive(producer, RECONCILE_SWEEP);
  }
  kernel.subscribe(0, (event) => {
    for (const producer of producers) drive(producer, { kind: 'change', event });
  });
}

/** Resolve a Piece, degrading a missing/ambiguous ref to `undefined` (SC-1, never a throw). */
function resolvePieceSafely(kernel: ChangeKernel, ref: PieceRef) {
  try {
    return kernel.resolvePiece(ref);
  } catch {
    return undefined;
  }
}

/**
 * Wire M6's governed tools to the live daemon singletons: Retrieve/enrich read
 * the resident kernel index/graph, Mutate routes writes through the kernel spine
 * (producer ①) and the worktree's disk, and Inspect reads M7's cap + Decision
 * log and M3's flag pipeline. The not-yet-built halves degrade to a floor (D85):
 * the graph outline/dependents reads, the M4 assembled-context/spec store, and
 * the reconciler's precise-write expectation. The worktree is the configured root
 * (the per-session worktree manager is later); confinement runs in POSIX path
 * space, so the root is normalized to forward slashes.
 */
function governedToolDeps(
  kernel: ChangeKernel,
  governance: Governance,
  flags: FlagPipeline,
  root: string,
): GovernedToolDeps {
  const worktreeRoot = root.replace(/\\/g, '/');
  return {
    sessionId: 'daemon',
    retrieve: {
      worktreeRoot,
      lookupSymbol: (name) => kernel.lookup(name),
      outline: () => [],
      references: () => [],
      resolvePiece: (ref) => resolvePieceSafely(kernel, ref),
    },
    mutate: {
      worktreeRoot,
      worktree: 'main',
      readFile: (absolutePath) => readFileSync(absolutePath, 'utf8'),
      writeFile: (absolutePath, bytes) => writeFileSync(absolutePath, bytes),
      emit: (draft) => kernel.emit(draft),
      resolveFile: (ref: SymbolRef) =>
        'name' in ref ? kernel.lookup(ref.name)?.definedIn : ref.path,
    },
    inspect: {
      runChecks: (scope) => flags.flagsForUser(scope),
      capState: () => governance.capState(),
      decisionsByTarget: (target) => governance.decisionLog.findByTarget(target),
      readDecision: (id) => governance.decisionLog.read(id),
    },
    enrich: {
      oracle: {
        lookup: (name) => kernel.lookup(name),
        fuzzyMatch: (name, limit) => kernel.fuzzyMatch(name, limit),
        walPosition: () => kernel.walPosition(),
      },
      flagsForAgent: (scope) => flags.flagsForAgent(scope),
    },
  };
}
