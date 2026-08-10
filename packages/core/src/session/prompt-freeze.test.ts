import { describe, expect, it } from 'vitest';
import type { NeutralConfig } from '@coa/shared';
import { configHashOf, promptHasDrifted, promptVersionOf } from './prompt-freeze.js';

const base: NeutralConfig = {
  prefixHead: [],
  systemReminders: [],
  onDemandPullable: ['skill-a', 'skill-b'],
  scopePushed: [],
  toolIntents: { allow: ['Read'], deny: ['Bash'] },
};

describe('promptVersionOf', () => {
  it('is stable across calls for the same config', () => {
    expect(promptVersionOf(base)).toBe(promptVersionOf(base));
  });

  it('is independent of object key insertion order (no silent invalidator)', () => {
    const reordered: NeutralConfig = {
      toolIntents: { deny: ['Bash'], allow: ['Read'] },
      scopePushed: [],
      onDemandPullable: ['skill-a', 'skill-b'],
      systemReminders: [],
      prefixHead: [],
    };
    expect(promptVersionOf(reordered)).toBe(promptVersionOf(base));
  });

  it('changes when the compiled content changes', () => {
    const changed: NeutralConfig = { ...base, toolIntents: { allow: ['Read', 'Edit'], deny: [] } };
    expect(promptVersionOf(changed)).not.toBe(promptVersionOf(base));
  });
});

describe('configHashOf', () => {
  it('is stable across calls for the same config', () => {
    const cfg = { role: 'swe', packageIds: ['research'], exclude: ['core'] };
    expect(configHashOf(cfg)).toBe(configHashOf(cfg));
  });

  it('treats package selections as sets (order- and duplicate-independent)', () => {
    expect(configHashOf({ role: 'swe', packageIds: ['a', 'b'] })).toBe(
      configHashOf({ role: 'swe', packageIds: ['b', 'a', 'a'] }),
    );
    expect(configHashOf({ role: 'swe', exclude: ['x', 'y'] })).toBe(
      configHashOf({ role: 'swe', exclude: ['y', 'x'] }),
    );
  });

  it('treats an omitted selection the same as an empty one', () => {
    expect(configHashOf({ role: 'swe' })).toBe(
      configHashOf({ role: 'swe', packageIds: [], exclude: [] }),
    );
  });

  it('changes when the role, added packages, or exclusions change', () => {
    const base = configHashOf({ role: 'swe', packageIds: ['research'], exclude: ['core'] });
    expect(configHashOf({ role: 'writer', packageIds: ['research'], exclude: ['core'] })).not.toBe(
      base,
    );
    expect(configHashOf({ role: 'swe', packageIds: ['docs'], exclude: ['core'] })).not.toBe(base);
    expect(configHashOf({ role: 'swe', packageIds: ['research'], exclude: [] })).not.toBe(base);
  });

  it('hashes a skill-less config byte-identically to a pre-library one (no upgrade banner)', () => {
    expect(configHashOf({ role: 'swe', skills: [] })).toBe(configHashOf({ role: 'swe' }));
  });

  it('folds the skill selection in: adding a skill or flipping delivery is drift', () => {
    const none = configHashOf({ role: 'swe' });
    const auto = configHashOf({ role: 'swe', skills: [{ name: 'commits', delivery: 'auto' }] });
    const disclosed = configHashOf({
      role: 'swe',
      skills: [{ name: 'commits', delivery: 'disclosure' }],
    });
    expect(auto).not.toBe(none);
    expect(disclosed).not.toBe(auto);
  });

  it('treats the skill selection as a set (order- and duplicate-independent)', () => {
    const a = configHashOf({
      role: 'swe',
      skills: [
        { name: 'a', delivery: 'auto' },
        { name: 'b', delivery: 'disclosure' },
      ],
    });
    const b = configHashOf({
      role: 'swe',
      skills: [
        { name: 'b', delivery: 'disclosure' },
        { name: 'a', delivery: 'auto' },
        { name: 'A', delivery: 'disclosure' }, // case-folded duplicate: first occurrence wins
      ],
    });
    expect(a).toBe(b);
  });
});

describe('promptHasDrifted', () => {
  const frozen = { configHash: configHashOf({ role: 'swe', packageIds: ['research'] }) };

  it('is false when the current config still hashes to the frozen one', () => {
    expect(promptHasDrifted(frozen, { role: 'swe', packageIds: ['research'] })).toBe(false);
    // Reordering the same selection is not drift.
    expect(promptHasDrifted(frozen, { role: 'swe', packageIds: ['research'] })).toBe(false);
  });

  it('is true when the drift-relevant config changed under the frozen prompt', () => {
    expect(promptHasDrifted(frozen, { role: 'swe', packageIds: ['research', 'docs'] })).toBe(true);
    expect(promptHasDrifted(frozen, { role: 'writer', packageIds: ['research'] })).toBe(true);
  });
});
