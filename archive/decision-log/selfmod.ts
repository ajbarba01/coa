// Archived from packages/core/src/governance/selfmod.ts
/**
 * D138 — the self-mod guard (the guard POLICY half; the golden-corpus eval-gate
 * MECHANISM is M9's `runEval`). A self-modifying promotion must pass the
 * golden-corpus eval gate, and the **pinned-spine-before-it-can-solely-block** rule
 * applies: a promoted rule cannot become the SOLE thing blocking the agent without
 * a pinned spine behind it. M8 orchestrates proposal → `runEval` → `selfModGuard`
 * → apply. For attended v1 the guard is the eval gate + surfaced/reviewed approval
 * (D147), NOT the heavy two-key ceremony (which re-arms with autonomy).
 */
export type SelfModVerdict = 'allow' | 'needsPinnedSpine';

export interface Promotion {
  rule: string;
  /** Would this promotion make the rule a SOLE gate-blocker (gate-eligible, high-severity, nothing behind it)? */
  becomesSoleBlocker: boolean;
}

export interface EvalResult {
  /** Did the promotion pass the golden corpus (M9.runEval)? */
  passed: boolean;
}

export function selfModGuard(promotion: Promotion, evalResult: EvalResult): SelfModVerdict {
  if (!evalResult.passed) return 'needsPinnedSpine';
  if (promotion.becomesSoleBlocker) return 'needsPinnedSpine';
  return 'allow';
}
