/**
 * D35 / D93-simple — the cost cap: a local SEAM that, by default, does NOT block.
 * Under the subscription model (the v1 default) coa imposes no ceiling of its own —
 * the loop runs until the plan's own usage limit stops it (the D85 floor), so
 * `remaining` is unbounded (`null`) and `capHit` is always false. The dollar
 * ceiling becomes meaningful only on the optional **API route**: a single
 * configured, per-user, per-daemon **local** ceiling that, when reached, denies the
 * next call (`fail-expensive`). This is one of only two things in coa that can
 * block the agent (the other is M3's close-gate). Budget is local-only; no
 * shared/team budget. Synchronous and deterministic — no model on any path.
 *
 * Read/write are split (replacing a single `chargeAndCheck`) so the cap is
 * concurrency-safe and the predicate path never charges: `capState` is the
 * non-mutating read the `canUseTool` predicate consults; `charge` is the mutating
 * write M9 calls exactly once per settled usage at the SDK `ResultMessage`.
 */
export interface CapState {
  /** USD remaining under the ceiling, or `null` under the subscription model (unbounded). */
  remaining: number | null;
  capHit: boolean;
}

export interface CostCapOptions {
  /** The API-route hard ceiling in USD. Omitted ⇒ subscription model (no ceiling). */
  ceilingUsd?: number;
}

export class CostCap {
  private readonly ceilingUsd: number | undefined;
  private totalUsd = 0;

  constructor(options: CostCapOptions = {}) {
    this.ceilingUsd = options.ceilingUsd;
  }

  /** Non-mutating read of the daemon-global cost state (safe to call repeatedly). */
  capState(_sessionId?: string): CapState {
    if (this.ceilingUsd === undefined) return { remaining: null, capHit: false };
    const remaining = Math.max(0, this.ceilingUsd - this.totalUsd);
    return { remaining, capHit: this.totalUsd >= this.ceilingUsd };
  }

  /**
   * Mutating write, called exactly once per settled usage. Updates the
   * daemon-global running total atomically (single-threaded JS), so one session's
   * settled spend correctly reduces every other session's `remaining`.
   */
  charge(_sessionId: string, costUsd: number): void {
    this.totalUsd += costUsd;
  }
}
