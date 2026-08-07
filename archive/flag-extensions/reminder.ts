// Archived from packages/core/src/flags/reminder.ts
import type { EscapeEvent, Reminder } from '@coa/shared';

/**
 * D107/D133 — the reminder DECISION half (M3 decides WHICH authority rule to
 * inject and WHEN; M9 physically delivers it on the native `role:system` channel).
 * Deterministic, no model on this path (P1):
 *  - **Tier-0** re-surfaces a critical invariant, anticipating an escape-gate event.
 *  - **Tier-A** fires on a deterministic trigger-term match.
 *  - **Tier-B** (the learned salience classifier) is wired-but-OFF (deferred) — this
 *    policy never emits it.
 *
 * A Piece becomes an authority rule by the `governed-by` link (TAX-2), not a
 * `force` flag; M3's gate enforces the linked Type-1 high-severity ones and CF-1
 * surfaces the rest.
 */
export interface AuthorityRule {
  /** The rule text/id injected as the reminder. */
  rule: string;
  /** Why it fires (the reminder reason). */
  reason: string;
  /** A critical invariant — deterministically re-surfaced on an escape (Tier-0). */
  tier0?: boolean;
  /** Tier-A trigger terms (a named entity in the escape context activates it). */
  triggers?: string[];
  /** Optional scope gate — applies only when the escape is in this scope. */
  scope?: string;
  /** Optional tool gate — applies only when the escape is this tool. */
  tool?: string;
}

export class ReminderPolicy {
  private readonly rules: AuthorityRule[] = [];

  register(rule: AuthorityRule): void {
    this.rules.push(rule);
  }

  /** Decide the single highest-authority reminder for an anticipated escape, or none. */
  reminderFor(event: EscapeEvent): Reminder | undefined {
    const applicable = this.rules.filter((r) => this.applies(r, event));

    const tier0 = applicable.find((r) => r.tier0 === true);
    if (tier0 !== undefined) return { rule: tier0.rule, reason: tier0.reason, tier: 0 };

    const tierA = applicable.find((r) => triggerMatch(r, event));
    if (tierA !== undefined) return { rule: tierA.rule, reason: tierA.reason, tier: 'A' };

    return undefined;
  }

  /** A rule applies when its scope/tool gates (if any) match the escape context. */
  private applies(rule: AuthorityRule, event: EscapeEvent): boolean {
    if (rule.scope !== undefined && rule.scope !== event.scope) return false;
    if (rule.tool !== undefined && rule.tool !== event.tool) return false;
    return true;
  }
}

/** Tier-A — a deterministic trigger-term match against the escape's tool/scope. */
function triggerMatch(rule: AuthorityRule, event: EscapeEvent): boolean {
  if (rule.triggers === undefined) return false;
  const terms = [event.tool, event.scope].filter((t): t is string => t !== undefined);
  return rule.triggers.some((trigger) => terms.includes(trigger));
}
