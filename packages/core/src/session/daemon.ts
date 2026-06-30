import { compile } from '../compiler/compile.js';
import { FlagPipeline } from '../flags/pipeline.js';
import { Governance } from '../governance/governance.js';
import { ChangeKernel } from '../kernel.js';
import { TOOL_CATALOGUE } from '../workbench/catalogue.js';
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
    catalogue: TOOL_CATALOGUE,
  };

  return { core, kernel, flags, governance };
}
