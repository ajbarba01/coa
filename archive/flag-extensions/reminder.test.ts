// Archived from packages/core/src/flags/reminder.test.ts
import { describe, expect, it } from 'vitest';
import { type AuthorityRule, ReminderPolicy } from './reminder.js';

function rule(over: Partial<AuthorityRule> = {}): AuthorityRule {
  return { rule: 'never log secrets', reason: 'privacy invariant', ...over };
}

describe('ReminderPolicy.reminderFor (D107/D133 reminder decision)', () => {
  it('returns nothing when no authority rule applies', () => {
    const policy = new ReminderPolicy();
    expect(policy.reminderFor({ kind: 'pre-tool', tool: 'Bash' })).toBeUndefined();
  });

  it('re-surfaces a Tier-0 critical invariant on an escape (D133)', () => {
    const policy = new ReminderPolicy();
    policy.register(rule({ tier0: true, scope: '@payments' }));
    expect(policy.reminderFor({ kind: 'pre-tool', tool: 'Bash', scope: '@payments' })).toEqual({
      rule: 'never log secrets',
      reason: 'privacy invariant',
      tier: 0,
    });
  });

  it('fires a Tier-A reminder on a trigger-term match', () => {
    const policy = new ReminderPolicy();
    policy.register(rule({ rule: 'use the money type', triggers: ['Stripe'] }));
    const result = policy.reminderFor({ kind: 'prompt', scope: 'Stripe' });
    expect(result?.tier).toBe('A');
  });

  it('prefers the Tier-0 invariant over a Tier-A trigger match', () => {
    const policy = new ReminderPolicy();
    policy.register(rule({ rule: 'a-trigger', triggers: ['Bash'] }));
    policy.register(rule({ rule: 'zero-invariant', tier0: true }));
    expect(policy.reminderFor({ kind: 'pre-tool', tool: 'Bash' })?.tier).toBe(0);
  });

  it('does not apply a rule scoped to a different scope', () => {
    const policy = new ReminderPolicy();
    policy.register(rule({ tier0: true, scope: '@payments' }));
    expect(
      policy.reminderFor({ kind: 'pre-tool', tool: 'Bash', scope: '@billing' }),
    ).toBeUndefined();
  });

  it('never emits the deferred learned Tier-B (wired-but-OFF)', () => {
    const policy = new ReminderPolicy();
    policy.register(rule({ tier0: true }));
    policy.register(rule({ rule: 'r2', triggers: ['Bash'] }));
    const result = policy.reminderFor({ kind: 'pre-tool', tool: 'Bash' });
    expect(result?.tier).not.toBe('B');
  });
});
