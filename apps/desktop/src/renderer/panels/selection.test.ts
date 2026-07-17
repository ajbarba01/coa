import { describe, expect, it } from 'vitest';
import { resolveSelection } from './selection.js';

describe('resolveSelection', () => {
  it('uses the agent config as a coherent unit for a brand-new (unpinned) session', () => {
    expect(resolveSelection(undefined, { provider: 'deepseek', model: 'deepseek-v4-pro' })).toEqual(
      {
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
      },
    );
  });

  it('uses the agent config when the session exists but has never been pinned', () => {
    expect(resolveSelection({}, { model: 'sonnet' })).toEqual({ model: 'sonnet' });
  });

  it('uses the pinned session selection as a unit, ignoring the agent', () => {
    expect(
      resolveSelection(
        { provider: 'claude', model: 'opus', reasoning: { mode: 'effort', effort: 'high' } },
        { provider: 'deepseek', model: 'deepseek-v4-pro' },
      ),
    ).toEqual({ provider: 'claude', model: 'opus', reasoning: { mode: 'effort', effort: 'high' } });
  });

  it('never mixes a pinned session model with the agent provider (the haiku→deepseek crash)', () => {
    // Session pinned to a Claude model with NO provider recorded; the agent was later
    // switched to a DeepSeek model. The old bug combined provider=deepseek + model=haiku.
    expect(
      resolveSelection({ model: 'haiku' }, { provider: 'deepseek', model: 'deepseek-v4-pro' }),
    ).toEqual({ model: 'haiku' }); // no provider leaks in — routes to the default (claude) backend
  });
});
