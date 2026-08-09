import type { PermissionMode, ToolCall, ToolClass } from '@coa/shared';
import type { CanUseTool, StopDecision, StopPredicate, ToolPermissionDecision } from '@coa/spi';

/**
 * The session predicates handed to the backend adapter's hooks. The close-gate
 * riding the `Stop` hook is the system's ONE deliberate block (a user stop,
 * never an error); the per-tool deny rules ride the `canUseTool` hook as
 * demotable pipeline policy, not a standing block. The backend adapter holds no
 * policy — it only runs the predicates the session layer assembles.
 *
 * F2 layers a mode-aware ask/allow/deny decision ON TOP of the per-tool deny
 * rules (composed, never a second parallel deny channel — SC-1's "help, never
 * cage" still holds exactly one block: THIS `canUseTool` predicate, plus the
 * separate `Stop`-hook close-gate below). The deny rules always run first and
 * unconditionally — mode never overrides a deny, it only adds a further,
 * ADDITIONAL gate over whatever the deny rules already let through.
 */

/** The narrow flag reads the `canUseTool` predicate composes (injected, not imported). */
export interface PermissionDeps {
  /** The per-tool deny rule check. Runs first, unconditionally, regardless of mode. */
  perToolDeny: (tool: string, input: unknown) => { behavior: 'deny'; message: string } | undefined;
  /**
   * The F2 mode-aware layer, composed on top of the deny rules. Absent ⇒ mode
   * enforcement is off entirely — every call that clears the deny rules is
   * allowed, byte-identical to the pre-F2 predicate (the strict-superset floor).
   */
  mode?: ModeDeps;
}

/**
 * The live reads/effects the mode-aware layer needs, injected (not imported) so
 * `permission.ts` stays pure and testable. Bound per session by the daemon
 * composition (`composeSessionDeps`/`session.ts`), which is what lets `getMode`
 * reflect a LIVE mid-session switch and `hasApprovalSeam` reflect the actual
 * backend behind THIS session.
 */
export interface ModeDeps {
  /** Read this session's CONFIGURED mode fresh on every call — never cached —
   *  so a mid-session `setMode` takes effect starting with the NEXT call, never
   *  retroactively on one already in flight (an in-flight call already read its
   *  own snapshot before this could change). */
  getMode: () => PermissionMode;
  /**
   * Whether the active backend adapter can actually honor an ask (a real
   * approval seam) for THIS session. `false` degrades every mode to `bypass` —
   * SC-1 honesty: never claim an enforcement the backend cannot deliver.
   */
  hasApprovalSeam: () => boolean;
  /** Classify a tool call by risk (read/write/exec) for mode purposes. */
  classify: (tool: string) => ToolClass;
  /** Ask the user, blocking until they answer or the session ends (which must
   *  resolve `'deny'` — a torn-down session must never leave a tool call
   *  hanging on a promise nothing will ever settle). Only ever called for a
   *  `write`/`exec` call under a mode that asks (`manual`, or `edits` for `exec`). */
  requestApproval: (call: ToolCall, toolClass: ToolClass) => Promise<'allow' | 'deny'>;
}

const FAIL_CLOSED_DENY: ToolPermissionDecision = {
  behavior: 'deny',
  message: 'governance check failed; refusing the tool call (fail-closed)',
};

/**
 * Assemble the single `canUseTool` predicate: the per-tool deny rules,
 * **first-deny-wins**, and **fail-closed** on any throw (refuse rather than
 * admit an unchecked call) — THEN, only if the deny rules let the call through,
 * the F2 mode-aware layer (when wired).
 */
export function buildCanUseTool(deps: PermissionDeps): CanUseTool {
  return async (call) => {
    let denied: { behavior: 'deny'; message: string } | undefined;
    try {
      denied = deps.perToolDeny(call.tool, call.args);
    } catch {
      return FAIL_CLOSED_DENY;
    }
    if (denied) return denied;
    if (deps.mode === undefined) return { behavior: 'allow' };
    try {
      return await decideMode(call, deps.mode);
    } catch {
      return FAIL_CLOSED_DENY;
    }
  };
}

/**
 * The four-mode matrix (ruled requirement 1), enforced deterministically here —
 * NEVER in the renderer, which only reflects/selects a mode:
 *
 *   plan   — read: allow · write/exec: DENY outright, never asks
 *   manual — read: allow · write/exec: ASK
 *   edits  — read: allow · write: allow (auto) · exec: ASK
 *   bypass — everything: allow, nothing asked
 *
 * `hasApprovalSeam() === false` collapses this to the `bypass` row regardless of
 * the configured mode (the strict-superset degrade, ruled requirement 5).
 */
async function decideMode(call: ToolCall, mode: ModeDeps): Promise<ToolPermissionDecision> {
  const effective: PermissionMode = mode.hasApprovalSeam() ? mode.getMode() : 'bypass';
  if (effective === 'bypass') return { behavior: 'allow' };

  const toolClass = mode.classify(call.tool);
  if (toolClass === 'read') return { behavior: 'allow' };

  if (effective === 'plan') {
    return {
      behavior: 'deny',
      message: `plan mode is read-only — ${call.tool} is blocked (switch to manual, edits, or bypass to allow it)`,
    };
  }
  if (effective === 'edits' && toolClass === 'write') return { behavior: 'allow' };

  // The remaining cases both ask: manual for write or exec, edits for exec.
  const decision = await mode.requestApproval(call, toolClass);
  return decision === 'allow'
    ? { behavior: 'allow' }
    : { behavior: 'deny', message: `denied by the user (${effective} mode)` };
}

/** Wire the close-gate: the close-gate verdict is already the `Stop`-hook decision shape. */
export function buildStopGate(deps: { gate: () => StopDecision }): StopPredicate {
  return () => deps.gate();
}
