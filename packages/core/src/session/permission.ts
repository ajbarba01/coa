import type { CanUseTool, StopDecision, StopPredicate, ToolPermissionDecision } from '@coa/spi';

/**
 * M8 — the two session predicates handed to M9's hooks (D121). These are the
 * ONLY two blocks in the whole system (SC-1): the cost cap + per-tool deny ride
 * the `canUseTool` hook, and the close-gate rides the `Stop` hook. M9 holds no
 * policy — it only runs the predicate M8 assembles.
 */

/** The narrow M7/M3 reads the `canUseTool` predicate composes (injected, not imported). */
export interface PermissionDeps {
  /** Non-mutating cost read (M7.capState) — the cap check, consulted first. */
  capState: () => { capHit: boolean };
  /** The per-tool deny rule check (M3.perToolDeny) — consulted only if the cap is clear. */
  perToolDeny: (tool: string, input: unknown) => { behavior: 'deny'; message: string } | undefined;
}

const COST_CAP_DENY: ToolPermissionDecision = {
  behavior: 'deny',
  message: 'cost cap reached; refusing further tool calls (fail-expensive)',
};

const FAIL_CLOSED_DENY: ToolPermissionDecision = {
  behavior: 'deny',
  message: 'governance check failed; refusing the tool call (fail-closed)',
};

/**
 * Assemble the single `canUseTool` predicate: the cost cap first, then the
 * per-tool deny rules, **first-deny-wins**, and **fail-closed** on any throw
 * (refuse rather than admit an unchecked call).
 */
export function buildCanUseTool(deps: PermissionDeps): CanUseTool {
  return (call) => {
    try {
      if (deps.capState().capHit) return COST_CAP_DENY;
      const denied = deps.perToolDeny(call.tool, call.args);
      return denied ?? { behavior: 'allow' };
    } catch {
      return FAIL_CLOSED_DENY;
    }
  };
}

/** Wire the close-gate: M3.gate's verdict is already the `Stop`-hook decision shape. */
export function buildStopGate(deps: { gate: () => StopDecision }): StopPredicate {
  return () => deps.gate();
}

/**
 * The native mid-loop hard stop: `min(perSessionCeiling?, daemonRemaining)`.
 * `daemonRemaining` is `null` under the subscription model (unbounded); the
 * result is `undefined` only when neither bound exists.
 */
export function sessionBudget(
  perSessionCeiling: number | undefined,
  daemonRemaining: number | null,
): number | undefined {
  const bounds = [perSessionCeiling, daemonRemaining ?? undefined].filter(
    (value): value is number => value !== undefined,
  );
  return bounds.length === 0 ? undefined : Math.min(...bounds);
}
