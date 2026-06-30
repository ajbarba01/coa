import { readFileSync, writeFileSync } from 'node:fs';
import type { PieceRef, SymbolRef } from '@coa/shared';
import { compile } from '../compiler/compile.js';
import { FlagPipeline } from '../flags/pipeline.js';
import { Governance } from '../governance/governance.js';
import { ChangeKernel } from '../kernel.js';
import { buildGovernedTools, type GovernedToolDeps } from '../workbench/governed-tools.js';
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

  const core: DaemonCore = {
    checkpoint: () => {
      kernel.checkpoint();
    },
    perToolDeny: (tool, input) => flags.perToolDeny(tool, input),
    gate: () => flags.gate(),
    capState: () => governance.capState(),
    charge: (sessionId, costUsd) => governance.charge(sessionId, costUsd),
    sandboxPolicy: (ctx) => governance.sandboxPolicy(ctx),
    compile,
    catalogue: buildGovernedTools(governedToolDeps(kernel, governance, flags, options.root ?? '.')),
  };

  return { core, kernel, flags, governance };
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
