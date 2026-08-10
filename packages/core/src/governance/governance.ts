import type { CapabilitySet } from '@coa/shared';
import { type CapState, CostCap } from './cost-cap.js';
import { Ledger, type LedgerRecord } from './ledger.js';
import { type SandboxOptions, type SessionTrustCtx, sandboxPolicy } from './sandbox.js';

/**
 * M7 — Governance & Audit. Bounds and records what the rented loop costs and
 * changes, and nothing more: the one hard cost cap, the secret-clean audit ledger,
 * and the sandbox posture. Every method is synchronous and deterministic (no
 * model on any M7 path). M7 is consulted by other modules and surfaces through M3;
 * it never reaches into them.
 */
export interface GovernanceOptions {
  /** The API-route hard ceiling in USD; omitted ⇒ subscription model (no ceiling). */
  ceilingUsd?: number;
  /** The session's configured tool baseline for `sandboxPolicy`. */
  allowedTools?: string[];
}

export class Governance {
  private readonly cap: CostCap;
  private readonly ledger = new Ledger();
  private readonly sandboxOptions: SandboxOptions;

  constructor(options: GovernanceOptions = {}) {
    this.cap = new CostCap(
      options.ceilingUsd !== undefined ? { ceilingUsd: options.ceilingUsd } : {},
    );
    this.sandboxOptions =
      options.allowedTools !== undefined ? { allowedTools: options.allowedTools } : {};
  }

  // --- cost cap (D35) ----------------------------------------------------------
  /** Non-mutating read of the daemon-global cost state (the `canUseTool` predicate consults this). */
  capState(sessionId?: string): CapState {
    return this.cap.capState(sessionId);
  }

  /** Mutating write, called exactly once per settled usage (M9 at the SDK `ResultMessage`). */
  charge(sessionId: string, costUsd: number): void {
    this.cap.charge(sessionId, costUsd);
  }

  // --- the secret-clean ledger (D135) --------------------------------------------
  /** Append the allow-listed projection of a runtime event; prose-bearing fields are dropped (DT-5). */
  record(event: Record<string, unknown>): void {
    this.ledger.record(event);
  }

  ledgerEntries(): LedgerRecord[] {
    return this.ledger.entries();
  }

  // --- sandbox (D148/D141) ------------------------------------------------------
  sandboxPolicy(ctx: SessionTrustCtx): CapabilitySet {
    return sandboxPolicy(ctx, this.sandboxOptions);
  }
}
