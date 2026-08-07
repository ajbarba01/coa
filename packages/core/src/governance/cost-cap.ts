/**
 * The cost accounting seam: a daemon-global spend counter that never blocks.
 * coa imposes no ceiling of its own — the loop runs until the plan's own usage
 * limit stops it (the pass-through floor), so `remaining` is unbounded (`null`)
 * and `capHit` is always false. The hard dollar ceiling and its deny path were
 * deliberately archived: the close gate is the system's one deliberate block,
 * and spend is accounted, not bounded. The counter itself stays — `charge`
 * still accumulates every settled result, so a future usage surface can expose
 * real spend without re-plumbing the settlement path.
 *
 * Read/write are split so the read path never charges: `capState` is the
 * non-mutating read the daemon's inspection surfaces consult; `charge` is the
 * mutating write the backend adapter calls exactly once per settled usage at
 * the SDK `ResultMessage`. Synchronous and deterministic — no model on any path.
 */
export interface CapState {
  /** USD remaining under a ceiling; always `null` (unbounded — no ceiling exists). */
  remaining: number | null;
  capHit: boolean;
}

export class CostCap {
  private totalUsd = 0;

  /** Non-mutating read of the daemon-global cost state (safe to call repeatedly). */
  capState(_sessionId?: string): CapState {
    return { remaining: null, capHit: false };
  }

  /**
   * Mutating write, called exactly once per settled usage. Updates the
   * daemon-global running total atomically (single-threaded JS), so the whole
   * process's spend is one number, whichever session settled it.
   */
  charge(_sessionId: string, costUsd: number): void {
    this.totalUsd += costUsd;
  }
}
