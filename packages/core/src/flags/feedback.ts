/**
 * D131 — the structured flag-feedback channel. The typed reason records WHY a flag
 * was acted on or dismissed, seeding future constraint proposals (the deferred
 * constraint-mining producer). Any subtractive effect it drives is surfaced via
 * the M7 visibility floor, never a silent reclassification. The typed reason is
 * categorical (recordable); a free-text `note` is prose-bearing and stays
 * WAL-local (DT-5) — never on the sync-eligible ledger.
 */
export type FeedbackReason =
  | 'intentional-historical-reference'
  | 'doc-is-aspirational'
  | 'wrong-guess'
  | 'rule-too-blunt'
  | 'wont-fix-by-policy';

/** What submitting a reason does to the flag: drop it, suppress it, or keep it. */
export type FeedbackResolution = 'resolve' | 'baseline' | 'record';

export interface FeedbackRecord {
  fingerprint: string;
  reason: FeedbackReason;
  /** Optional prose note — WAL-local only, excluded from the sync-eligible ledger. */
  note?: string;
}

/**
 * The deterministic reason → effect mapping. A `wrong-guess` is a false positive
 * (drop it); a won't-fix dismissal suppresses it (baseline — unblocks but stays
 * visible); a too-blunt rule keeps the flag and only seeds a scope-narrow proposal.
 */
export function resolutionFor(reason: FeedbackReason): FeedbackResolution {
  switch (reason) {
    case 'wrong-guess':
      return 'resolve';
    case 'intentional-historical-reference':
    case 'doc-is-aspirational':
    case 'wont-fix-by-policy':
      return 'baseline';
    case 'rule-too-blunt':
      return 'record';
  }
}
