import { describe, expect, it } from 'vitest';
import type { NeutralConfig } from '@coa/shared';
import { promptVersionOf } from './prompt-freeze.js';

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
