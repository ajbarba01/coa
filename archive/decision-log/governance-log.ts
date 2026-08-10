// Archived from packages/core/src/governance/governance-log.ts
import type { ChangeEvent, GovernancePayload } from '@coa/shared';

/**
 * D73 / D137 / D147 — M7's sanctioned governance-producer records, all written
 * through `M1.appendGovernance` (the one `emit` chokepoint, preserving P7) and
 * projected back from the WAL. The prose-bearing bodies live in the kernel's WAL
 * (WAL-local, DT-5) and never reach the sync-eligible ledger. The projection is
 * reconstructible: a fresh `GovernanceLog` over the same WAL replays every
 * governance frame.
 */

/** The M1 subset M7 needs — write a governance frame, and replay/subscribe to the WAL. */
export interface GovernanceSpine {
  appendGovernance(payload: GovernancePayload): number;
  subscribe(cursor: number, fn: (event: ChangeEvent) => void): void;
}

export interface DecisionEntry {
  id: number;
  target: string;
  entry: string;
}

export interface VouchEntry {
  node: string;
  vouchedAt: string;
  note?: string;
}

export interface SubtractiveEntry {
  id: number;
  target: string;
  diff: string;
}

/** The caller principal — only a human may grant a vouch (D137 / S-3). */
export interface Principal {
  human: boolean;
}

export class GovernanceLog {
  private readonly decisions = new Map<number, DecisionEntry>();
  private readonly decisionsByTarget = new Map<string, DecisionEntry[]>();
  private readonly vouches = new Map<string, VouchEntry>();
  private readonly subtractive: SubtractiveEntry[] = [];

  /** The append-only, numbered Decision log (D73). */
  readonly decisionLog: {
    append: (target: string, entry: string) => number;
    read: (id: number) => DecisionEntry | undefined;
    findByTarget: (target: string) => DecisionEntry[];
  };

  constructor(private readonly spine: GovernanceSpine) {
    spine.subscribe(0, (event) => this.apply(event));
    this.decisionLog = {
      append: (target, entry) => this.spine.appendGovernance({ sub: 'decision', target, entry }),
      read: (id) => this.decisions.get(id),
      findByTarget: (target) => [...(this.decisionsByTarget.get(target) ?? [])],
    };
  }

  /**
   * D137 — record a human-issued vouch (a confirmation timestamp + commit hash on
   * the node's provenance). The agent may *request* a vouch but can never grant
   * one: a non-human principal is refused.
   */
  vouch(node: string, vouchedAt: string, principal: Principal, note?: string): void {
    if (!principal.human)
      throw new Error('vouch is human-only (D137): an agent may request, never grant');
    this.spine.appendGovernance({ sub: 'vouch', node, vouchedAt, ...(note ? { note } : {}) });
  }

  vouchOf(node: string): VouchEntry | undefined {
    return this.vouches.get(node);
  }

  /**
   * D147 — the visibility floor. Turn a *subtractive* governance change (muting a
   * constraint, broadening a scope, adding a suppression region) into a reviewable
   * feed item. It notifies/logs; it does NOT block (returns void).
   */
  surfaceSubtractiveChange(target: string, diff: string): void {
    this.spine.appendGovernance({ sub: 'subtractive-change', target, diff });
  }

  subtractiveFeed(): SubtractiveEntry[] {
    return [...this.subtractive];
  }

  /** The WAL-fed projector — rebuilds every record from the governance frames. */
  private apply(event: ChangeEvent): void {
    if (event.kind !== 'governance') return;
    const payload = event.payload;
    switch (payload.sub) {
      case 'decision': {
        const decision: DecisionEntry = {
          id: event.seq,
          target: payload.target,
          entry: payload.entry,
        };
        this.decisions.set(decision.id, decision);
        const list = this.decisionsByTarget.get(decision.target) ?? [];
        list.push(decision);
        this.decisionsByTarget.set(decision.target, list);
        break;
      }
      case 'vouch':
        this.vouches.set(payload.node, {
          node: payload.node,
          vouchedAt: payload.vouchedAt,
          ...(payload.note !== undefined ? { note: payload.note } : {}),
        });
        break;
      case 'subtractive-change':
        this.subtractive.push({ id: event.seq, target: payload.target, diff: payload.diff });
        break;
      case 'cap-record':
        break;
    }
  }
}
