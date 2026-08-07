// Archived from packages/core/src/flags/autopatch.test.ts
import { describe, expect, it } from 'vitest';
import type { FlagRecord, Patch } from '@coa/shared';
import { AutoPatcher } from './autopatch.js';
import type { Producer } from './producer.js';

function patch(target = 'charge.ts'): Patch {
  return { target, diff: { form: 'whole-file', body: 'formatted' } };
}

function flag(over: Partial<FlagRecord> = {}): FlagRecord {
  return {
    ruleId: 'prettier',
    location: 'charge.ts:42',
    severity: 'low',
    message: 'formatting',
    fingerprint: 'fp-1',
    type: 1,
    confidence: 'high',
    concernKey: 'chargeFmt',
    ...over,
  };
}

function producer(fix?: (flag: FlagRecord) => Patch): Producer {
  return {
    id: 'prettier',
    kind: 'deterministic',
    activation: 'on-change',
    run: () => [],
    ...(fix ? { fix } : {}),
    golden: { good: { kind: 'scope', scope: 'ok' }, bad: { kind: 'scope', scope: 'ok' } },
  };
}

describe('AutoPatcher.plan (CF-3 visible Type-1 auto-patch)', () => {
  it('plans a visible apply with a patch and a feed item for a Type-1 fix', () => {
    const plan = new AutoPatcher().plan(
      flag(),
      producer(() => patch()),
    );
    expect(plan?.kind).toBe('apply');
    if (plan?.kind === 'apply') {
      expect(plan.patch).toEqual(patch());
      expect(plan.feedItem).toContain('charge.ts');
    }
  });

  it('does not auto-patch a Type-2 flag', () => {
    expect(
      new AutoPatcher().plan(
        flag({ type: 2 }),
        producer(() => patch()),
      ),
    ).toBeUndefined();
  });

  it('does not auto-patch a producer that carries no fix', () => {
    expect(new AutoPatcher().plan(flag(), producer())).toBeUndefined();
  });

  it('demotes a fix that overreaches beyond its flag span to a plain flag', () => {
    const plan = new AutoPatcher().plan(
      flag(),
      producer(() => patch('unrelated.ts')),
    );
    expect(plan?.kind).toBe('flag-only');
  });
});

describe('AutoPatcher flapping detector (CF-3 auto-demote)', () => {
  it('auto-demotes to flag-only after the agent re-reverts a patch on the same fingerprint', () => {
    const patcher = new AutoPatcher();
    const prod = producer(() => patch());
    expect(patcher.plan(flag(), prod)?.kind).toBe('apply');
    patcher.noteApplied('fp-1');
    patcher.noteReverted('fp-1');
    expect(patcher.plan(flag(), prod)?.kind).toBe('flag-only');
  });
});

describe('AutoPatcher.shouldDefer (CF-4 coherence)', () => {
  it('defers a patch to a file the agent holds an uncommitted edit on', () => {
    expect(new AutoPatcher().shouldDefer('charge.ts', ['charge.ts'])).toBe(true);
  });

  it('applies immediately when the target is not held', () => {
    expect(new AutoPatcher().shouldDefer('charge.ts', ['other.ts'])).toBe(false);
  });
});
