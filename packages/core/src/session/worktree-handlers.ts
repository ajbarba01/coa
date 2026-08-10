import { z } from 'zod';
import { rpcMethod, type RpcHandlers } from '../rpc/router.js';
import type { WorktreeManager, WorktreeStatus } from './worktree-manager.js';

/**
 * The worktree read/reap RPC surface over the {@link WorktreeManager} — the verbs the
 * console's Worktree dock floor calls (docs/adr/0037: nothing but the explicit reap
 * ever removes an isolated worktree; results may need review before cleanup).
 *
 * `listWorktrees` decorates each record with a cheap dirty/changed-file-count read
 * (one `git status --porcelain` per isolated worktree — the manager's own `status`);
 * a worktree whose status read fails (directory removed by hand, git hiccup) still
 * lists, just without the dirty fields — the row degrades, the list never throws.
 *
 * `reapWorktree` refuses a session whose turn is RUNNING right now (`reaped: false`,
 * `reason: 'running'`): deleting the working directory out from under an in-flight
 * turn breaks the child mid-write. This is a safety interlock on a user-facing
 * cleanup control, not a governance block — the agent is never the caller here.
 */

export interface WorktreeHandlerDeps {
  worktrees: Pick<WorktreeManager, 'list' | 'status' | 'reap'>;
  /** Whether this session has a turn in flight RIGHT NOW (the live registry's own
   *  state, never client tracking). Absent ⇒ nothing is ever considered running —
   *  the permissive floor for a host with no live registry (tests). */
  isRunning?: (sessionId: string) => boolean;
}

const reapParams = z.object({ sessionId: z.string() });

/** `status()` shells out to git — a failed read costs the row its dirty fields, never the list. */
function statusSafely(
  worktrees: WorktreeHandlerDeps['worktrees'],
  sessionId: string,
): WorktreeStatus | undefined {
  try {
    return worktrees.status(sessionId);
  } catch {
    return undefined;
  }
}

export function buildWorktreeHandlers(deps: WorktreeHandlerDeps): RpcHandlers {
  const running = (sessionId: string): boolean => deps.isRunning?.(sessionId) === true;
  return {
    listWorktrees: rpcMethod(z.object({}).optional(), () => ({
      worktrees: deps.worktrees.list().map((record) => {
        const status = statusSafely(deps.worktrees, record.sessionId);
        return {
          sessionId: record.sessionId,
          path: record.path,
          createdAt: record.createdAt,
          running: running(record.sessionId),
          ...(status !== undefined
            ? { dirty: status.dirty, filesChanged: status.filesChanged }
            : {}),
        };
      }),
    })),

    reapWorktree: rpcMethod(reapParams, (params) => {
      if (running(params.sessionId)) return { reaped: false, reason: 'running' };
      // `false` with no reason ⇒ nothing to reap (no isolated worktree for this
      // session — a double reap is a no-op, not an error).
      return { reaped: deps.worktrees.reap(params.sessionId) };
    }),
  };
}
