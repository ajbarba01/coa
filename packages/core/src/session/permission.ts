import type { CanUseTool, StopDecision, StopPredicate, ToolPermissionDecision } from '@coa/spi';

/**
 * The session predicates handed to the backend adapter's hooks. The close-gate
 * riding the `Stop` hook is the system's ONE deliberate block (a user stop,
 * never an error); the per-tool deny rules ride the `canUseTool` hook as
 * demotable pipeline policy, not a standing block. The backend adapter holds no
 * policy — it only runs the predicates the session layer assembles.
 */

/** The narrow flag reads the `canUseTool` predicate composes (injected, not imported). */
export interface PermissionDeps {
  /** The per-tool deny rule check. */
  perToolDeny: (tool: string, input: unknown) => { behavior: 'deny'; message: string } | undefined;
}

const FAIL_CLOSED_DENY: ToolPermissionDecision = {
  behavior: 'deny',
  message: 'governance check failed; refusing the tool call (fail-closed)',
};

/**
 * Assemble the single `canUseTool` predicate: the per-tool deny rules,
 * **first-deny-wins**, and **fail-closed** on any throw (refuse rather than
 * admit an unchecked call).
 */
export function buildCanUseTool(deps: PermissionDeps): CanUseTool {
  return (call) => {
    try {
      const denied = deps.perToolDeny(call.tool, call.args);
      return denied ?? { behavior: 'allow' };
    } catch {
      return FAIL_CLOSED_DENY;
    }
  };
}

/** Wire the close-gate: the close-gate verdict is already the `Stop`-hook decision shape. */
export function buildStopGate(deps: { gate: () => StopDecision }): StopPredicate {
  return () => deps.gate();
}
