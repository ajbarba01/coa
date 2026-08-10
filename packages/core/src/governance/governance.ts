import type { CapabilitySet } from '@coa/shared';
import { type CapState, CostCap } from './cost-cap.js';
import { Ledger, type LedgerRecord } from './ledger.js';
import { type SandboxOptions, type SessionTrustCtx, sandboxPolicy } from './sandbox.js';

/**
 * Governance & Audit. Accounts and records what the rented loop costs and
 * changes, and nothing more: the spend counter, the secret-clean audit ledger,
 * and the sandbox posture. Every method is synchronous and deterministic (no
 * model on any governance path). Governance is consulted by other modules and surfaces through the flag pipeline;
 * it never reaches into them.
 */
export interface GovernanceOptions {
  /** The session's configured tool baseline for `sandboxPolicy`. */
  allowedTools?: string[];
}

export class Governance {
  private readonly cap = new CostCap();
  private readonly ledger = new Ledger();
  private readonly sandboxOptions: SandboxOptions;

  constructor(options: GovernanceOptions = {}) {
    this.sandboxOptions =
      options.allowedTools !== undefined ? { allowedTools: options.allowedTools } : {};
  }

  // --- the spend counter --------------------------------------------------
  /** Non-mutating read of the daemon-global cost state (the inspection surfaces consult this). */
  capState(sessionId?: string): CapState {
    return this.cap.capState(sessionId);
  }

  /** Mutating write, called exactly once per settled usage (the backend adapter at the SDK `ResultMessage`). */
  charge(sessionId: string, costUsd: number): void {
    this.cap.charge(sessionId, costUsd);
  }

  // --- the secret-clean ledger --------------------------------------------
  /** Append the allow-listed projection of a runtime event; prose-bearing fields are dropped (DT-5). */
  record(event: Record<string, unknown>): void {
    this.ledger.record(event);
  }

  ledgerEntries(): LedgerRecord[] {
    return this.ledger.entries();
  }

  // --- sandbox ------------------------------------------------------
  sandboxPolicy(ctx: SessionTrustCtx): CapabilitySet {
    return sandboxPolicy(ctx, this.sandboxOptions);
  }
}
