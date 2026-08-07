import type { Delivery } from '@coa/spi';

/**
 * The neutral pending-delivery queue: text waiting to reach a session's model at
 * the soonest point its backend's turn model allows. Core fills it; each adapter
 * drains it at its own boundary (the pure-API loop's next round trip, the Claude
 * adapter's PostToolUse hook), so no plane above the backend port branches on backend.
 *
 * `origin` separates what a person said from what the system reports: a `user`
 * entry is recorded as a user turn in canonical memory, a `system` entry is a
 * notice and is never attributable to the person. A model cannot reach a producer,
 * so a `system` origin is unforgeable by construction.
 *
 * Sealing is the cancel-guard: a stopped session's queue accepts nothing further,
 * so a late notice can never revive a subtree a person deliberately stopped.
 */
export class DeliveryQueue {
  #pending: Delivery[] = [];
  #sealed = false;

  push(delivery: Delivery): void {
    if (this.#sealed) return;
    this.#pending.push(delivery);
  }

  /** Take everything pending, leaving the queue empty (at-most-once delivery). */
  drain(): readonly Delivery[] {
    if (this.#sealed) return [];
    return this.#pending.splice(0, this.#pending.length);
  }

  size(): number {
    return this.#pending.length;
  }

  /** Permanently stop accepting and yielding deliveries. Not reversible. */
  seal(): void {
    this.#sealed = true;
    this.#pending = [];
  }

  isSealed(): boolean {
    return this.#sealed;
  }
}
